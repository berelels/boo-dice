/**
 * Parser da notação de dados.
 *
 * Gramática suportada:
 *
 *   expressão := termo (('+' | '-') termo)*
 *   termo     := dado | constante
 *   dado      := INT? 'd' INT seletor?
 *   seletor   := ('kh' | 'kl' | 'dh' | 'dl') INT?
 *
 * Exemplos: `1d20`, `2d6+3`, `4d6kh3` (rolagem de atributo), `1d8+1d6+2`,
 * `2d20kl1` (desvantagem escrita à mão), `8d6-2`.
 *
 * O parser é separado do rolador de propósito: assim dá para validar o que o
 * usuário digitou (e mostrar o erro) sem consumir aleatoriedade.
 */

export type KeepMode = 'kh' | 'kl' | 'dh' | 'dl';

export interface DiceTerm {
  readonly kind: 'dice';
  /** `+1` ou `-1` — o sinal com que o termo entra na soma. */
  readonly sign: 1 | -1;
  readonly count: number;
  readonly sides: number;
  readonly keep?: { readonly mode: KeepMode; readonly amount: number };
  readonly source: string;
}

export interface ConstantTerm {
  readonly kind: 'const';
  readonly sign: 1 | -1;
  readonly value: number;
  readonly source: string;
}

export type Term = DiceTerm | ConstantTerm;

export interface ParsedNotation {
  readonly notation: string;
  readonly terms: readonly Term[];
}

export class DiceNotationError extends Error {
  constructor(
    message: string,
    readonly notation: string,
    readonly position: number,
  ) {
    super(message);
    this.name = 'DiceNotationError';
  }
}

/** Tetos defensivos: `999999d20` numa caixa de texto não deve travar o app. */
const MAX_DICE_PER_TERM = 500;
const MAX_SIDES = 1000;

const TERM_PATTERN = /^(?:(\d*)d(\d+)(?:(kh|kl|dh|dl)(\d*))?|(\d+))/i;

export function parseNotation(input: string): ParsedNotation {
  const notation = input.trim();
  if (notation === '') {
    throw new DiceNotationError('Notação vazia.', input, 0);
  }

  const terms: Term[] = [];
  let cursor = 0;
  let sign: 1 | -1 = 1;
  let expectingTerm = true;

  while (cursor < notation.length) {
    const char = notation[cursor]!;

    if (char === ' ') {
      cursor += 1;
      continue;
    }

    if (char === '+' || char === '-') {
      if (expectingTerm && terms.length > 0) {
        throw new DiceNotationError(`Operador duplicado em "${char}".`, notation, cursor);
      }
      // Um sinal à esquerda do primeiro termo é aceito: "-2" é um modificador válido.
      sign = char === '-' ? -1 : 1;
      cursor += 1;
      expectingTerm = true;
      continue;
    }

    if (!expectingTerm) {
      throw new DiceNotationError(
        `Esperava "+" ou "-" antes de "${notation.slice(cursor)}".`,
        notation,
        cursor,
      );
    }

    const match = TERM_PATTERN.exec(notation.slice(cursor));
    if (!match) {
      throw new DiceNotationError(
        `Não entendi "${notation.slice(cursor)}".`,
        notation,
        cursor,
      );
    }

    const [source, rawCount, rawSides, rawKeepMode, rawKeepAmount, rawConstant] = match;

    if (rawConstant !== undefined) {
      terms.push({ kind: 'const', sign, value: Number(rawConstant), source });
    } else {
      const count = rawCount === '' ? 1 : Number(rawCount);
      const sides = Number(rawSides);

      if (count < 1) {
        throw new DiceNotationError('É preciso rolar ao menos um dado.', notation, cursor);
      }
      if (count > MAX_DICE_PER_TERM) {
        throw new DiceNotationError(
          `Máximo de ${MAX_DICE_PER_TERM} dados por termo.`,
          notation,
          cursor,
        );
      }
      if (sides < 1 || sides > MAX_SIDES) {
        throw new DiceNotationError(
          `Dado de ${sides} faces está fora do intervalo permitido (1–${MAX_SIDES}).`,
          notation,
          cursor,
        );
      }

      let keep: DiceTerm['keep'];
      if (rawKeepMode !== undefined) {
        const mode = rawKeepMode.toLowerCase() as KeepMode;
        const amount = rawKeepAmount === '' || rawKeepAmount === undefined ? 1 : Number(rawKeepAmount);
        if (amount < 1) {
          throw new DiceNotationError(
            `"${mode}" precisa de uma quantidade maior que zero.`,
            notation,
            cursor,
          );
        }
        // kh3 em 2d6 e dh3 em 2d6 são pedidos impossíveis — avisamos em vez de
        // silenciosamente devolver a lista inteira ou vazia.
        if ((mode === 'kh' || mode === 'kl') && amount > count) {
          throw new DiceNotationError(
            `Não dá para manter ${amount} de ${count} dados.`,
            notation,
            cursor,
          );
        }
        if ((mode === 'dh' || mode === 'dl') && amount >= count) {
          throw new DiceNotationError(
            `Descartar ${amount} de ${count} dados não deixaria nenhum.`,
            notation,
            cursor,
          );
        }
        keep = { mode, amount };
      }

      terms.push(keep ? { kind: 'dice', sign, count, sides, keep, source } : { kind: 'dice', sign, count, sides, source });
    }

    cursor += source.length;
    expectingTerm = false;
  }

  if (expectingTerm) {
    throw new DiceNotationError('A expressão termina em um operador.', notation, cursor);
  }

  return { notation, terms };
}

/** Valida sem lançar — para feedback ao vivo enquanto o usuário digita. */
export function tryParseNotation(
  input: string,
): { ok: true; parsed: ParsedNotation } | { ok: false; error: DiceNotationError } {
  try {
    return { ok: true, parsed: parseNotation(input) };
  } catch (error) {
    if (error instanceof DiceNotationError) return { ok: false, error };
    throw error;
  }
}
