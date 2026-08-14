import { z } from 'zod';

/**
 * Ações de ataque de um monstro do bestiário.
 *
 * O pipeline do SRD já grava `data.actions` de cada monstro (ver
 * `tools/build-data/src/srd.ts`, função `monsters()`) — um repasse bruto do
 * JSON de origem, sem tipo nenhum (`CatalogEntry.data` é
 * `Record<string, unknown> | null`). Ninguém no app lia isso até agora. Esta
 * é a primeira leitura de verdade: um schema permissivo que extrai só o que
 * dá pra confiar (bônus de acerto + dado de dano), ignorando ações sem esses
 * dois números (efeitos especiais, descrições soltas).
 */

const monsterDamageSchema = z
  .object({
    damage_dice: z.string(),
  })
  .passthrough();

const monsterActionRawSchema = z
  .object({
    name: z.string(),
    attack_bonus: z.number().optional(),
    damage: z.array(monsterDamageSchema).optional(),
  })
  .passthrough();

export interface MonsterAction {
  readonly name: string;
  readonly attackBonus: number;
  readonly damageDice: string;
}

/** Extrai as ações com dado de ataque de um `CatalogEntry.data` de monstro. */
export function parseMonsterActions(data: unknown): MonsterAction[] {
  if (typeof data !== 'object' || data === null || !('actions' in data)) return [];
  const raw = (data as { actions: unknown }).actions;
  if (!Array.isArray(raw)) return [];

  const actions: MonsterAction[] = [];
  for (const entry of raw) {
    const parsed = monsterActionRawSchema.safeParse(entry);
    if (!parsed.success) continue;

    const damageDice = parsed.data.damage?.[0]?.damage_dice;
    if (parsed.data.attack_bonus === undefined || !damageDice) continue;

    actions.push({ name: parsed.data.name, attackBonus: parsed.data.attack_bonus, damageDice });
  }
  return actions;
}
