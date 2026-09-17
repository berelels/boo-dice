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

const monsterActionSchema = z.object({
  name: z.string(),
  attackBonus: z.number(),
  damageDice: z.string(),
});

/**
 * Lê a lista de ataques gravada num combatente do rastreador.
 *
 * É JSON vindo do banco, não de código — um encontro salvo por uma versão
 * antiga, ou editado à mão, não pode derrubar a tela do encontro inteira.
 * Qualquer coisa fora do formato vira lista vazia, que a UI já trata (o
 * combatente simplesmente não ganha o botão de atacar).
 */
export function parseStoredAttacks(json: string | null): MonsterAction[] {
  if (!json) return [];
  try {
    const parsed = z.array(monsterActionSchema).safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
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
