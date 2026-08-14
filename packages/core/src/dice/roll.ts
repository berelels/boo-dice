import { cryptoRng, type Rng } from './rng.js';
import { parseNotation, type DiceTerm, type ParsedNotation, type Term } from './notation.js';

/**
 * Um dado individual. `kept: false` significa que ele foi rolado mas descartado
 * por um seletor (o menor dos dois d20 na vantagem, o 1 descartado num 4d6kh3).
 * A UI mostra os descartados esmaecidos — ver o dado que você *não* usou é
 * metade da graça de rolar.
 */
export interface DieRoll {
  readonly sides: number;
  readonly value: number;
  readonly kept: boolean;
}

export interface RolledTerm {
  readonly term: Term;
  readonly dice: readonly DieRoll[];
  /** Já com o sinal do termo aplicado. */
  readonly subtotal: number;
}

export interface RollResult {
  readonly notation: string;
  readonly terms: readonly RolledTerm[];
  readonly total: number;
}

export interface RollOptions {
  readonly rng?: Rng;
  /**
   * Acerto crítico: em 5e você rola os dados de dano duas vezes e soma os
   * modificadores uma vez só. Só os termos de dado dobram.
   */
  readonly critical?: boolean;
}

export function roll(input: string | ParsedNotation, options: RollOptions = {}): RollResult {
  const parsed = typeof input === 'string' ? parseNotation(input) : input;
  const rng = options.rng ?? cryptoRng;

  const terms = parsed.terms.map((term) =>
    term.kind === 'const'
      ? { term, dice: [] as DieRoll[], subtotal: term.sign * term.value }
      : rollDiceTerm(term, rng, options.critical ?? false),
  );

  return {
    notation: parsed.notation,
    terms,
    total: terms.reduce((sum, term) => sum + term.subtotal, 0),
  };
}

function rollDiceTerm(term: DiceTerm, rng: Rng, critical: boolean): RolledTerm {
  const count = critical ? term.count * 2 : term.count;
  const values = Array.from({ length: count }, () => rng.rollDie(term.sides));

  const keptIndices = selectKept(values, term, critical);
  const dice: DieRoll[] = values.map((value, index) => ({
    sides: term.sides,
    value,
    kept: keptIndices.has(index),
  }));

  const sum = dice.reduce((acc, die) => (die.kept ? acc + die.value : acc), 0);
  return { term, dice, subtotal: term.sign * sum };
}

/**
 * Devolve os índices dos dados que contam. Ordenamos índices — não valores —
 * para que a ordem original em que os dados saíram seja preservada na exibição.
 * Empates resolvem pelo primeiro índice, o que só afeta *qual* dado idêntico
 * aparece esmaecido.
 */
function selectKept(values: readonly number[], term: DiceTerm, critical: boolean): Set<number> {
  const all = new Set(values.map((_, index) => index));
  if (!term.keep) return all;

  const amount = critical ? term.keep.amount * 2 : term.keep.amount;
  const byValue = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => (a.value === b.value ? a.index - b.index : a.value - b.value));

  switch (term.keep.mode) {
    case 'kh':
      return new Set(byValue.slice(-amount).map((entry) => entry.index));
    case 'kl':
      return new Set(byValue.slice(0, amount).map((entry) => entry.index));
    case 'dh':
      return new Set(byValue.slice(0, byValue.length - amount).map((entry) => entry.index));
    case 'dl':
      return new Set(byValue.slice(amount).map((entry) => entry.index));
  }
}

// ---------------------------------------------------------------------------
// Rolagens de d20 — testes de habilidade, resistência e jogadas de ataque
// ---------------------------------------------------------------------------

export type Advantage = 'normal' | 'advantage' | 'disadvantage';

export interface D20Result {
  /** Os d20 crus, na ordem em que saíram. Com vantagem/desvantagem são dois. */
  readonly rolls: readonly number[];
  /** O índice de `rolls` que valeu. */
  readonly usedIndex: number;
  readonly natural: number;
  readonly modifier: number;
  readonly total: number;
  readonly advantage: Advantage;
  /** Natural 20 ou natural 1 — relevante para ataques e testes contra a morte. */
  readonly critical: 'success' | 'failure' | null;
}

export interface D20Options {
  readonly rng?: Rng;
  readonly advantage?: Advantage;
  readonly modifier?: number;
}

export function rollD20(options: D20Options = {}): D20Result {
  const rng = options.rng ?? cryptoRng;
  const advantage = options.advantage ?? 'normal';
  const modifier = options.modifier ?? 0;

  const rolls = advantage === 'normal' ? [rng.rollDie(20)] : [rng.rollDie(20), rng.rollDie(20)];

  let usedIndex = 0;
  if (advantage === 'advantage') {
    usedIndex = rolls[0]! >= rolls[1]! ? 0 : 1;
  } else if (advantage === 'disadvantage') {
    usedIndex = rolls[0]! <= rolls[1]! ? 0 : 1;
  }

  const natural = rolls[usedIndex]!;
  return {
    rolls,
    usedIndex,
    natural,
    modifier,
    total: natural + modifier,
    advantage,
    critical: natural === 20 ? 'success' : natural === 1 ? 'failure' : null,
  };
}

/**
 * Combina vantagem e desvantagem da mesma jogada. Em 5e elas não se acumulam:
 * qualquer quantidade de uma anula qualquer quantidade da outra, e o resultado
 * é uma rolagem normal.
 */
export function combineAdvantage(
  hasAdvantage: boolean,
  hasDisadvantage: boolean,
): Advantage {
  if (hasAdvantage === hasDisadvantage) return 'normal';
  return hasAdvantage ? 'advantage' : 'disadvantage';
}
