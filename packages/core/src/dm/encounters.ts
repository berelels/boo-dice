import {
  applyDamage,
  applyHealing,
  applyTemporaryHitPoints,
  type HitPoints,
} from '../rules/combat.js';
import { expandConditions, type ConditionId } from '../rules/conditions.js';
import type { SqlDriver } from '../db/driver.js';

/**
 * Rastreador de iniciativa do mestre.
 *
 * Um encontro é uma lista ordenada de combatentes; `sort_order` é a ordem de
 * turno de verdade (o que `advance()` percorre), separada da `initiative` que
 * é só o valor rolado. As duas coincidem na maior parte do tempo — o mestre
 * roda "ordenar por iniciativa" depois de lançar os dados — mas ficam livres
 * pra divergir quando ele quiser reordenar na mão (empates, surpresa).
 */

export type CombatantKind = 'pc' | 'npc' | 'monster';

export interface Encounter {
  readonly id: string;
  readonly name: string;
  readonly round: number;
  readonly currentCombatantId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Combatant {
  readonly id: string;
  readonly encounterId: string;
  readonly name: string;
  readonly kind: CombatantKind;
  readonly initiative: number;
  readonly sortOrder: number;
  readonly hp: HitPoints;
  readonly armorClass: number | null;
  readonly conditions: readonly ConditionId[];
  readonly notes: string;
}

export interface EncounterWithCombatants extends Encounter {
  readonly combatants: readonly Combatant[];
}

export interface NewCombatantInput {
  readonly name: string;
  readonly kind?: CombatantKind;
  readonly initiative: number;
  readonly hpMax?: number;
  readonly armorClass?: number | null;
  readonly notes?: string;
}

export interface CombatantPatch {
  readonly name?: string;
  readonly initiative?: number;
  readonly armorClass?: number | null;
  readonly notes?: string;
  /** Delta a aplicar via `applyDamage`. */
  readonly damage?: number;
  /** Delta a aplicar via `applyHealing`. */
  readonly heal?: number;
  /** Novo valor de PV temporário, via `applyTemporaryHitPoints` (não soma — substitui pelo maior). */
  readonly temporaryHp?: number;
  /** Conjunto de condições ativas; expandido automaticamente (marcar "Inconsciente" acende "Incapacitado"+"Caído"). */
  readonly conditions?: readonly ConditionId[];
}

/** Ordem de turno por iniciativa: maior primeiro, empate resolvido pela ordem manual. */
export function sortByInitiative(combatants: readonly Combatant[]): Combatant[] {
  return [...combatants].sort(
    (a, b) => b.initiative - a.initiative || a.sortOrder - b.sortOrder,
  );
}

/**
 * Avança (ou volta) um turno dentro da ordem de combate.
 *
 * Puro — não toca em banco — para ser testável sem SQLite e reutilizável se a
 * UI algum dia quiser "pré-visualizar" o próximo turno antes de confirmar.
 */
export function advanceTurn(
  orderedIds: readonly string[],
  currentId: string | null,
  round: number,
  direction: 'next' | 'previous',
): { readonly currentCombatantId: string | null; readonly round: number } {
  if (orderedIds.length === 0) return { currentCombatantId: null, round };

  const currentIndex = currentId === null ? -1 : orderedIds.indexOf(currentId);

  if (direction === 'next') {
    // Sem turno definido, ou o combatente de antes foi removido: começa do
    // topo da ordem sem mexer na rodada.
    if (currentIndex === -1) return { currentCombatantId: orderedIds[0]!, round };
    const nextIndex = currentIndex + 1;
    if (nextIndex < orderedIds.length) {
      return { currentCombatantId: orderedIds[nextIndex]!, round };
    }
    // Deu a volta na ordem: nova rodada, primeiro combatente de novo.
    return { currentCombatantId: orderedIds[0]!, round: round + 1 };
  }

  // direction === 'previous' — simétrico ao 'next', sem deixar a rodada
  // cair abaixo de 1.
  if (currentIndex <= 0) {
    return {
      currentCombatantId: orderedIds[orderedIds.length - 1]!,
      round: Math.max(1, round - 1),
    };
  }
  return { currentCombatantId: orderedIds[currentIndex - 1]!, round };
}

interface EncounterRow {
  id: string;
  name: string;
  round: number;
  current_combatant_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CombatantRow {
  id: string;
  encounter_id: string;
  name: string;
  kind: string;
  initiative: number;
  sort_order: number;
  hp_current: number;
  hp_max: number;
  hp_temp: number;
  armor_class: number | null;
  conditions: string;
  notes: string;
}

function toEncounter(row: EncounterRow): Encounter {
  return {
    id: row.id,
    name: row.name,
    round: row.round,
    currentCombatantId: row.current_combatant_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCombatant(row: CombatantRow): Combatant {
  return {
    id: row.id,
    encounterId: row.encounter_id,
    name: row.name,
    kind: row.kind as CombatantKind,
    initiative: row.initiative,
    sortOrder: row.sort_order,
    hp: { current: row.hp_current, max: row.hp_max, temporary: row.hp_temp },
    armorClass: row.armor_class,
    conditions: JSON.parse(row.conditions) as ConditionId[],
    notes: row.notes,
  };
}

export class EncounterRepository {
  constructor(private readonly driver: SqlDriver) {}

  async list(): Promise<Encounter[]> {
    const rows = await this.driver.query<EncounterRow>(
      'SELECT * FROM encounters ORDER BY updated_at DESC',
    );
    return rows.map(toEncounter);
  }

  async create(name: string): Promise<Encounter> {
    const now = new Date().toISOString();
    const encounter: Encounter = {
      id: crypto.randomUUID(),
      name,
      round: 1,
      currentCombatantId: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.driver.execute(
      `INSERT INTO encounters (id, name, round, current_combatant_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [encounter.id, encounter.name, encounter.round, encounter.currentCombatantId, now, now],
    );
    return encounter;
  }

  async get(id: string): Promise<EncounterWithCombatants | null> {
    const row = await this.driver.queryOne<EncounterRow>(
      'SELECT * FROM encounters WHERE id = ?',
      [id],
    );
    if (!row) return null;

    const combatantRows = await this.driver.query<CombatantRow>(
      'SELECT * FROM combatants WHERE encounter_id = ? ORDER BY sort_order',
      [id],
    );
    return { ...toEncounter(row), combatants: combatantRows.map(toCombatant) };
  }

  async rename(id: string, name: string): Promise<void> {
    await this.driver.execute(
      'UPDATE encounters SET name = ?, updated_at = ? WHERE id = ?',
      [name, new Date().toISOString(), id],
    );
  }

  async delete(id: string): Promise<void> {
    await this.driver.execute('DELETE FROM encounters WHERE id = ?', [id]);
  }

  async addCombatant(encounterId: string, input: NewCombatantInput): Promise<Combatant> {
    const row = await this.driver.queryOne<{ next: number }>(
      'SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM combatants WHERE encounter_id = ?',
      [encounterId],
    );
    const hpMax = input.hpMax ?? 0;

    const combatant: Combatant = {
      id: crypto.randomUUID(),
      encounterId,
      name: input.name,
      kind: input.kind ?? 'npc',
      initiative: input.initiative,
      sortOrder: row?.next ?? 0,
      hp: { current: hpMax, max: hpMax, temporary: 0 },
      armorClass: input.armorClass ?? null,
      conditions: [],
      notes: input.notes ?? '',
    };

    await this.driver.execute(
      `INSERT INTO combatants
         (id, encounter_id, name, kind, initiative, sort_order, hp_current, hp_max, hp_temp, armor_class, conditions, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        combatant.id,
        combatant.encounterId,
        combatant.name,
        combatant.kind,
        combatant.initiative,
        combatant.sortOrder,
        combatant.hp.current,
        combatant.hp.max,
        combatant.hp.temporary,
        combatant.armorClass,
        JSON.stringify(combatant.conditions),
        combatant.notes,
      ],
    );
    await this.touchEncounter(encounterId);
    return combatant;
  }

  async updateCombatant(id: string, patch: CombatantPatch): Promise<Combatant> {
    const row = await this.driver.queryOne<CombatantRow>(
      'SELECT * FROM combatants WHERE id = ?',
      [id],
    );
    if (!row) throw new Error(`Combatente "${id}" não encontrado.`);

    let combatant = toCombatant(row);

    if (patch.damage !== undefined) {
      combatant = { ...combatant, hp: applyDamage(combatant.hp, patch.damage).hitPoints };
    }
    if (patch.heal !== undefined) {
      combatant = { ...combatant, hp: applyHealing(combatant.hp, patch.heal) };
    }
    if (patch.temporaryHp !== undefined) {
      combatant = { ...combatant, hp: applyTemporaryHitPoints(combatant.hp, patch.temporaryHp) };
    }
    if (patch.conditions !== undefined) {
      combatant = { ...combatant, conditions: [...expandConditions(patch.conditions)] };
    }
    if (patch.name !== undefined) combatant = { ...combatant, name: patch.name };
    if (patch.initiative !== undefined) combatant = { ...combatant, initiative: patch.initiative };
    if (patch.armorClass !== undefined) combatant = { ...combatant, armorClass: patch.armorClass };
    if (patch.notes !== undefined) combatant = { ...combatant, notes: patch.notes };

    await this.driver.execute(
      `UPDATE combatants SET
         name = ?, kind = ?, initiative = ?, hp_current = ?, hp_max = ?, hp_temp = ?,
         armor_class = ?, conditions = ?, notes = ?
       WHERE id = ?`,
      [
        combatant.name,
        combatant.kind,
        combatant.initiative,
        combatant.hp.current,
        combatant.hp.max,
        combatant.hp.temporary,
        combatant.armorClass,
        JSON.stringify(combatant.conditions),
        combatant.notes,
        combatant.id,
      ],
    );
    await this.touchEncounter(combatant.encounterId);
    return combatant;
  }

  async removeCombatant(id: string): Promise<void> {
    const row = await this.driver.queryOne<{ encounter_id: string }>(
      'SELECT encounter_id FROM combatants WHERE id = ?',
      [id],
    );
    if (!row) return;

    await this.driver.execute('DELETE FROM combatants WHERE id = ?', [id]);
    // O turno não pode continuar apontando pra alguém que não existe mais —
    // o mestre aperta "próximo" de novo pra escolher quem segue.
    await this.driver.execute(
      'UPDATE encounters SET current_combatant_id = NULL, updated_at = ? WHERE id = ? AND current_combatant_id = ?',
      [new Date().toISOString(), row.encounter_id, id],
    );
  }

  async reorderCombatants(encounterId: string, orderedIds: readonly string[]): Promise<void> {
    await this.driver.transaction(async (tx) => {
      for (const [index, id] of orderedIds.entries()) {
        await tx.execute(
          'UPDATE combatants SET sort_order = ? WHERE id = ? AND encounter_id = ?',
          [index, id, encounterId],
        );
      }
    });
    await this.touchEncounter(encounterId);
  }

  async advance(
    encounterId: string,
    direction: 'next' | 'previous',
  ): Promise<{ readonly currentCombatantId: string | null; readonly round: number }> {
    const encounter = await this.get(encounterId);
    if (!encounter) throw new Error(`Encontro "${encounterId}" não encontrado.`);

    const orderedIds = encounter.combatants.map((combatant) => combatant.id);
    const next = advanceTurn(orderedIds, encounter.currentCombatantId, encounter.round, direction);

    await this.driver.execute(
      'UPDATE encounters SET current_combatant_id = ?, round = ?, updated_at = ? WHERE id = ?',
      [next.currentCombatantId, next.round, new Date().toISOString(), encounterId],
    );
    return next;
  }

  private async touchEncounter(encounterId: string): Promise<void> {
    await this.driver.execute('UPDATE encounters SET updated_at = ? WHERE id = ?', [
      new Date().toISOString(),
      encounterId,
    ]);
  }
}
