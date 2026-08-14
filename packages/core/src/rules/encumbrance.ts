/**
 * Capacidade de carga.
 *
 * A edição brasileira do livro trabalha em quilos, não em libras: "você não
 * deve carregar peso superior a 7,5 vezes seu valor de Força". Mantemos o kg
 * como unidade canônica para bater com o material que a mesa tem na mão, com
 * conversão para libras só na exibição, se alguém quiser.
 */

import { type AbilityScores } from './abilities.js';

export const KG_PER_POUND = 0.45359237;

/** Multiplicadores do PHB traduzidos para quilos. */
const CARRY_CAPACITY_PER_STRENGTH = 7.5;
const ENCUMBERED_PER_STRENGTH = 2.5;
const HEAVILY_ENCUMBERED_PER_STRENGTH = 5;
const PUSH_DRAG_LIFT_MULTIPLIER = 2;

export type EncumbranceLevel = 'unencumbered' | 'encumbered' | 'heavily-encumbered' | 'overloaded';

export interface CarryingCapacity {
  /** Peso máximo sem penalidade nenhuma (regra padrão). */
  readonly capacityKg: number;
  /** Empurrar, arrastar ou erguer — o dobro da capacidade. */
  readonly pushDragLiftKg: number;
  /** Limiares da regra opcional de sobrecarga (PHB, "Variante: Sobrecarga"). */
  readonly encumberedAtKg: number;
  readonly heavilyEncumberedAtKg: number;
}

export function carryingCapacity(scores: AbilityScores, sizeMultiplier = 1): CarryingCapacity {
  const strength = scores.str * sizeMultiplier;
  return {
    capacityKg: strength * CARRY_CAPACITY_PER_STRENGTH,
    pushDragLiftKg: strength * CARRY_CAPACITY_PER_STRENGTH * PUSH_DRAG_LIFT_MULTIPLIER,
    encumberedAtKg: strength * ENCUMBERED_PER_STRENGTH,
    heavilyEncumberedAtKg: strength * HEAVILY_ENCUMBERED_PER_STRENGTH,
  };
}

/**
 * Criaturas Miúdas carregam metade; Grandes, Enormes e Colossais dobram a cada
 * categoria acima de Média.
 */
export type CreatureSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';

export const SIZE_CARRY_MULTIPLIER: Readonly<Record<CreatureSize, number>> = {
  tiny: 0.5,
  small: 1,
  medium: 1,
  large: 2,
  huge: 4,
  gargantuan: 8,
};

export interface EncumbranceState {
  readonly level: EncumbranceLevel;
  readonly carriedKg: number;
  readonly capacity: CarryingCapacity;
  /** Penalidade de deslocamento em metros, já negativa. */
  readonly speedPenaltyMeters: number;
}

/**
 * A regra padrão só conhece "dentro" ou "fora" da capacidade. A variante de
 * sobrecarga acrescenta duas faixas intermediárias com penalidade de
 * deslocamento; ligue com `useVariant` se a mesa usar.
 */
export function encumbranceState(
  scores: AbilityScores,
  carriedKg: number,
  options: { size?: CreatureSize; useVariant?: boolean } = {},
): EncumbranceState {
  const capacity = carryingCapacity(scores, SIZE_CARRY_MULTIPLIER[options.size ?? 'medium']);

  if (!options.useVariant) {
    const level: EncumbranceLevel =
      carriedKg > capacity.capacityKg ? 'overloaded' : 'unencumbered';
    return { level, carriedKg, capacity, speedPenaltyMeters: 0 };
  }

  if (carriedKg > capacity.capacityKg) {
    return { level: 'overloaded', carriedKg, capacity, speedPenaltyMeters: -6 };
  }
  if (carriedKg > capacity.heavilyEncumberedAtKg) {
    return { level: 'heavily-encumbered', carriedKg, capacity, speedPenaltyMeters: -6 };
  }
  if (carriedKg > capacity.encumberedAtKg) {
    return { level: 'encumbered', carriedKg, capacity, speedPenaltyMeters: -3 };
  }
  return { level: 'unencumbered', carriedKg, capacity, speedPenaltyMeters: 0 };
}

export const ENCUMBRANCE_LABELS: Readonly<Record<EncumbranceLevel, string>> = {
  unencumbered: 'Sem sobrecarga',
  encumbered: 'Sobrecarregado',
  'heavily-encumbered': 'Muito sobrecarregado',
  overloaded: 'Acima da capacidade',
};

// ---------------------------------------------------------------------------
// Moedas
// ---------------------------------------------------------------------------

export const COINS = ['cp', 'sp', 'ep', 'gp', 'pp'] as const;
export type Coin = (typeof COINS)[number];

export type Purse = Readonly<Record<Coin, number>>;

export const EMPTY_PURSE: Purse = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };

export const COIN_LABELS: Readonly<Record<Coin, string>> = {
  cp: 'PC',
  sp: 'PP',
  ep: 'PE',
  gp: 'PO',
  pp: 'PL',
};

export const COIN_NAMES: Readonly<Record<Coin, string>> = {
  cp: 'Peças de cobre',
  sp: 'Peças de prata',
  ep: 'Peças de electro',
  gp: 'Peças de ouro',
  pp: 'Peças de platina',
};

/** Valor em peças de cobre — a menor unidade, para comparar bolsas sem fração. */
const COIN_VALUE_IN_COPPER: Readonly<Record<Coin, number>> = {
  cp: 1,
  sp: 10,
  ep: 50,
  gp: 100,
  pp: 1000,
};

export function purseValueInCopper(purse: Purse): number {
  return COINS.reduce((total, coin) => total + purse[coin] * COIN_VALUE_IN_COPPER[coin], 0);
}

export function purseValueInGold(purse: Purse): number {
  return purseValueInCopper(purse) / COIN_VALUE_IN_COPPER.gp;
}

/** Cinquenta moedas pesam meio quilo, independentemente do metal (PHB). */
export const COINS_PER_KG = 100;

export function purseWeightKg(purse: Purse): number {
  return COINS.reduce((total, coin) => total + purse[coin], 0) / COINS_PER_KG;
}
