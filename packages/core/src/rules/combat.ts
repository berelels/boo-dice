import { abilityModifier, type AbilityScores } from './abilities.js';
import type { D20Result } from '../dice/roll.js';

// ---------------------------------------------------------------------------
// Classe de Armadura
// ---------------------------------------------------------------------------

export type ArmorCategory = 'light' | 'medium' | 'heavy';

export interface ArmorProfile {
  readonly id: string;
  readonly label: string;
  readonly category: ArmorCategory;
  readonly baseAc: number;
  /** Desvantagem em Furtividade enquanto vestida. */
  readonly stealthDisadvantage: boolean;
  /** Força mínima; abaixo dela o deslocamento cai 3 m (não impede vestir). */
  readonly strengthRequirement?: number;
}

/**
 * Teto de Destreza que a armadura permite somar à CA.
 * Leve: sem teto. Média: +2. Pesada: nenhum.
 */
export function maxDexBonus(category: ArmorCategory): number {
  switch (category) {
    case 'light':
      return Number.POSITIVE_INFINITY;
    case 'medium':
      return 2;
    case 'heavy':
      return 0;
  }
}

/**
 * Defesa Sem Armadura — a variante do bárbaro soma Constituição, a do monge
 * soma Sabedoria. Ambas só valem sem armadura; a do monge também exige estar
 * sem escudo.
 */
export type UnarmoredDefense = { readonly kind: 'barbarian' } | { readonly kind: 'monk' } | null;

export interface ArmorClassInput {
  readonly scores: AbilityScores;
  readonly armor?: ArmorProfile | null;
  readonly shield?: boolean;
  readonly unarmoredDefense?: UnarmoredDefense;
  /** Bônus avulsos: anel de proteção, magia de escudo, estilo de luta Defesa. */
  readonly bonuses?: readonly { readonly source: string; readonly value: number }[];
}

export interface ArmorClassResult {
  readonly total: number;
  /** De onde veio cada ponto — a ficha mostra isso ao tocar na CA. */
  readonly breakdown: readonly { readonly source: string; readonly value: number }[];
}

export function armorClass(input: ArmorClassInput): ArmorClassResult {
  const dex = abilityModifier(input.scores.dex);
  const breakdown: { source: string; value: number }[] = [];

  if (input.armor) {
    const cap = maxDexBonus(input.armor.category);
    breakdown.push({ source: input.armor.label, value: input.armor.baseAc });
    const applied = Math.min(dex, cap);
    if (applied !== 0) breakdown.push({ source: 'Destreza', value: applied });
  } else if (input.unarmoredDefense?.kind === 'barbarian') {
    breakdown.push({ source: 'Base', value: 10 });
    if (dex !== 0) breakdown.push({ source: 'Destreza', value: dex });
    const con = abilityModifier(input.scores.con);
    if (con !== 0) breakdown.push({ source: 'Defesa sem Armadura (CON)', value: con });
  } else if (input.unarmoredDefense?.kind === 'monk' && !input.shield) {
    // A Defesa sem Armadura do monge cai por terra se ele empunhar escudo — aí
    // ele volta à CA base, mais o escudo somado abaixo.
    breakdown.push({ source: 'Base', value: 10 });
    if (dex !== 0) breakdown.push({ source: 'Destreza', value: dex });
    const wis = abilityModifier(input.scores.wis);
    if (wis !== 0) breakdown.push({ source: 'Defesa sem Armadura (SAB)', value: wis });
  } else {
    breakdown.push({ source: 'Base', value: 10 });
    if (dex !== 0) breakdown.push({ source: 'Destreza', value: dex });
  }

  if (input.shield) breakdown.push({ source: 'Escudo', value: 2 });
  for (const bonus of input.bonuses ?? []) {
    if (bonus.value !== 0) breakdown.push(bonus);
  }

  return {
    total: breakdown.reduce((sum, part) => sum + part.value, 0),
    breakdown,
  };
}

// ---------------------------------------------------------------------------
// Iniciativa e valores passivos
// ---------------------------------------------------------------------------

export function initiativeModifier(scores: AbilityScores, bonus = 0): number {
  return abilityModifier(scores.dex) + bonus;
}

/**
 * Valor passivo: 10 + modificador total. Vantagem soma 5 e desvantagem tira 5 —
 * é assim que a Percepção Passiva reage a uma condição, já que não há rolagem.
 */
export function passiveScore(
  totalModifier: number,
  options: { advantage?: boolean; disadvantage?: boolean; bonus?: number } = {},
): number {
  let value = 10 + totalModifier + (options.bonus ?? 0);
  if (options.advantage && !options.disadvantage) value += 5;
  if (options.disadvantage && !options.advantage) value -= 5;
  return value;
}

// ---------------------------------------------------------------------------
// Pontos de vida
// ---------------------------------------------------------------------------

export interface HitPoints {
  readonly current: number;
  readonly max: number;
  /** PV temporários não se somam: o maior valor substitui o anterior. */
  readonly temporary: number;
}

export interface DamageResult {
  readonly hitPoints: HitPoints;
  /** Quanto foi absorvido pelos PV temporários. */
  readonly absorbed: number;
  /** Caiu a 0 PV com este golpe. */
  readonly downed: boolean;
  /**
   * Morte instantânea: o dano restante depois de zerar os PV é igual ou maior
   * que o máximo de PV (PHB, "Dano Massivo").
   */
  readonly instantDeath: boolean;
}

export function applyDamage(hp: HitPoints, amount: number): DamageResult {
  const damage = Math.max(0, Math.floor(amount));

  const absorbed = Math.min(hp.temporary, damage);
  const remaining = damage - absorbed;
  const current = Math.max(0, hp.current - remaining);
  const overflow = remaining - hp.current;

  return {
    hitPoints: { current, max: hp.max, temporary: hp.temporary - absorbed },
    absorbed,
    downed: current === 0 && hp.current > 0,
    instantDeath: current === 0 && overflow >= hp.max,
  };
}

export function applyHealing(hp: HitPoints, amount: number): HitPoints {
  const healing = Math.max(0, Math.floor(amount));
  return { ...hp, current: Math.min(hp.max, hp.current + healing) };
}

/** PV temporários nunca acumulam — você fica com o maior dos dois. */
export function applyTemporaryHitPoints(hp: HitPoints, amount: number): HitPoints {
  return { ...hp, temporary: Math.max(hp.temporary, Math.max(0, Math.floor(amount))) };
}

// ---------------------------------------------------------------------------
// Testes contra a morte
// ---------------------------------------------------------------------------

export interface DeathSaves {
  readonly successes: number;
  readonly failures: number;
}

export const EMPTY_DEATH_SAVES: DeathSaves = { successes: 0, failures: 0 };

export type DeathSaveOutcome = 'ongoing' | 'stable' | 'dead' | 'revived';

export interface DeathSaveResult {
  readonly saves: DeathSaves;
  readonly outcome: DeathSaveOutcome;
}

/**
 * Um teste contra a morte. O natural importa mais que o total:
 * 20 natural volta consciente com 1 PV, 1 natural conta como duas falhas.
 */
export function applyDeathSave(saves: DeathSaves, result: D20Result): DeathSaveResult {
  if (result.natural === 20) {
    return { saves: EMPTY_DEATH_SAVES, outcome: 'revived' };
  }

  const isFailure = result.total < 10;
  const failureWeight = result.natural === 1 ? 2 : 1;

  const next: DeathSaves = isFailure
    ? { successes: saves.successes, failures: Math.min(3, saves.failures + failureWeight) }
    : { successes: Math.min(3, saves.successes + 1), failures: saves.failures };

  if (next.failures >= 3) return { saves: next, outcome: 'dead' };
  if (next.successes >= 3) return { saves: EMPTY_DEATH_SAVES, outcome: 'stable' };
  return { saves: next, outcome: 'ongoing' };
}

/** Dano sofrido a 0 PV causa uma falha automática — duas se for crítico. */
export function damageWhileDown(saves: DeathSaves, critical: boolean): DeathSaveResult {
  const next: DeathSaves = {
    successes: saves.successes,
    failures: Math.min(3, saves.failures + (critical ? 2 : 1)),
  };
  return { saves: next, outcome: next.failures >= 3 ? 'dead' : 'ongoing' };
}
