import { describe, expect, it } from 'vitest';
import { DiceNotationError, parseNotation, tryParseNotation } from './notation.js';
import { combineAdvantage, roll, rollD20 } from './roll.js';
import { cryptoRng, scriptedRng, seededRng } from './rng.js';

describe('parseNotation', () => {
  it('entende um dado simples', () => {
    expect(parseNotation('1d20').terms).toEqual([
      { kind: 'dice', sign: 1, count: 1, sides: 20, source: '1d20' },
    ]);
  });

  it('assume um dado quando a quantidade é omitida', () => {
    const [term] = parseNotation('d8').terms;
    expect(term).toMatchObject({ kind: 'dice', count: 1, sides: 8 });
  });

  it('soma dados e constantes', () => {
    const parsed = parseNotation('1d8+1d6+3');
    expect(parsed.terms).toHaveLength(3);
    expect(parsed.terms[2]).toEqual({ kind: 'const', sign: 1, value: 3, source: '3' });
  });

  it('aplica sinal negativo ao termo seguinte', () => {
    const parsed = parseNotation('2d6-2');
    expect(parsed.terms[1]).toMatchObject({ kind: 'const', sign: -1, value: 2 });
  });

  it('aceita espaços em volta dos operadores', () => {
    expect(parseNotation('2d6 + 3').terms).toHaveLength(2);
  });

  it('entende seletores de manter/descartar', () => {
    expect(parseNotation('4d6kh3').terms[0]).toMatchObject({
      count: 4,
      sides: 6,
      keep: { mode: 'kh', amount: 3 },
    });
    expect(parseNotation('2d20kl').terms[0]).toMatchObject({ keep: { mode: 'kl', amount: 1 } });
  });

  it('rejeita entradas malformadas', () => {
    for (const bad of ['', '   ', '2d6+', '2d6++3', 'd', '2d6 3', 'batata']) {
      expect(() => parseNotation(bad), bad).toThrow(DiceNotationError);
    }
  });

  it('rejeita seletores impossíveis em vez de degradar em silêncio', () => {
    expect(() => parseNotation('2d6kh3')).toThrow(/manter 3 de 2/);
    expect(() => parseNotation('2d6dl2')).toThrow(/não deixaria nenhum/i);
  });

  it('impõe tetos para não travar o app com entrada absurda', () => {
    expect(() => parseNotation('999999d6')).toThrow(/Máximo de 500/);
    expect(() => parseNotation('1d99999')).toThrow(/fora do intervalo/);
  });

  it('tryParseNotation devolve o erro em vez de lançar', () => {
    const result = tryParseNotation('2d6+');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(DiceNotationError);
  });
});

describe('roll', () => {
  it('soma dados e modificadores', () => {
    // Todos os dados saem 4; 2d6+3 = 4 + 4 + 3.
    const result = roll('2d6+3', { rng: scriptedRng([4]) });
    expect(result.total).toBe(11);
    expect(result.terms[0]!.dice).toHaveLength(2);
  });

  it('subtrai termos negativos', () => {
    expect(roll('2d6-2', { rng: scriptedRng([5]) }).total).toBe(8);
  });

  it('mantém os maiores em kh e marca os descartados', () => {
    const result = roll('4d6kh3', { rng: scriptedRng([1, 6, 3, 5]) });
    expect(result.total).toBe(14); // 6 + 3 + 5, descartando o 1
    expect(result.terms[0]!.dice.map((die) => die.kept)).toEqual([false, true, true, true]);
  });

  it('mantém os menores em kl', () => {
    expect(roll('4d6kl1', { rng: scriptedRng([1, 6, 3, 5]) }).total).toBe(1);
  });

  it('preserva a ordem em que os dados saíram, não a ordenada', () => {
    const dice = roll('4d6kh3', { rng: scriptedRng([1, 6, 3, 5]) }).terms[0]!.dice;
    expect(dice.map((die) => die.value)).toEqual([1, 6, 3, 5]);
  });

  it('descarta o maior com dh e o menor com dl', () => {
    expect(roll('4d6dh1', { rng: scriptedRng([1, 6, 3, 5]) }).total).toBe(9); // tira o 6
    expect(roll('4d6dl1', { rng: scriptedRng([1, 6, 3, 5]) }).total).toBe(14); // tira o 1
  });

  it('no crítico dobra os dados mas não os modificadores', () => {
    const result = roll('2d6+3', { rng: scriptedRng([4]), critical: true });
    expect(result.terms[0]!.dice).toHaveLength(4);
    expect(result.total).toBe(19); // 4×4 dados + 3 uma vez só
  });

  it('empates em kh descartam apenas a quantidade certa', () => {
    const result = roll('4d6kh3', { rng: scriptedRng([4, 4, 4, 4]) });
    expect(result.total).toBe(12);
    expect(result.terms[0]!.dice.filter((die) => die.kept)).toHaveLength(3);
  });
});

describe('rollD20', () => {
  it('rola um único dado sem vantagem', () => {
    const result = rollD20({ rng: scriptedRng([12]), modifier: 5 });
    expect(result.rolls).toEqual([12]);
    expect(result.total).toBe(17);
    expect(result.critical).toBeNull();
  });

  it('com vantagem usa o maior dos dois', () => {
    const result = rollD20({ rng: scriptedRng([7, 18]), advantage: 'advantage', modifier: 2 });
    expect(result.rolls).toEqual([7, 18]);
    expect(result.natural).toBe(18);
    expect(result.usedIndex).toBe(1);
    expect(result.total).toBe(20);
  });

  it('com desvantagem usa o menor dos dois', () => {
    const result = rollD20({ rng: scriptedRng([7, 18]), advantage: 'disadvantage' });
    expect(result.natural).toBe(7);
    expect(result.usedIndex).toBe(0);
  });

  it('sinaliza natural 20 e natural 1', () => {
    expect(rollD20({ rng: scriptedRng([20]) }).critical).toBe('success');
    expect(rollD20({ rng: scriptedRng([1]) }).critical).toBe('failure');
  });

  it('o crítico olha o dado natural, não o total', () => {
    // 1 natural com +15 dá 16, e ainda assim é falha crítica num ataque.
    const result = rollD20({ rng: scriptedRng([1]), modifier: 15 });
    expect(result.total).toBe(16);
    expect(result.critical).toBe('failure');
  });
});

describe('combineAdvantage', () => {
  it('vantagem e desvantagem juntas se anulam', () => {
    expect(combineAdvantage(true, true)).toBe('normal');
    expect(combineAdvantage(false, false)).toBe('normal');
    expect(combineAdvantage(true, false)).toBe('advantage');
    expect(combineAdvantage(false, true)).toBe('disadvantage');
  });
});

describe('cryptoRng', () => {
  it('fica dentro do intervalo e cobre todas as faces', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 4000; i += 1) {
      const value = cryptoRng.rollDie(20);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(20);
      seen.add(value);
    }
    expect(seen.size).toBe(20);
  });

  it('distribui de forma aproximadamente uniforme', () => {
    const counts = new Array<number>(6).fill(0);
    const trials = 60_000;
    for (let i = 0; i < trials; i += 1) counts[cryptoRng.rollDie(6) - 1]! += 1;

    // Esperado 10.000 por face; ±5% é folgado o bastante para não dar flake e
    // apertado o bastante para pegar um viés de módulo real.
    for (const count of counts) {
      expect(count).toBeGreaterThan(trials / 6 - trials / 6 * 0.05);
      expect(count).toBeLessThan(trials / 6 + trials / 6 * 0.05);
    }
  });

  it('rejeita números de faces inválidos', () => {
    expect(() => cryptoRng.rollDie(0)).toThrow(RangeError);
    expect(() => cryptoRng.rollDie(2.5)).toThrow(RangeError);
  });
});

describe('seededRng', () => {
  it('é determinístico para a mesma semente', () => {
    const a = seededRng(42);
    const b = seededRng(42);
    const sequenceA = Array.from({ length: 20 }, () => a.rollDie(20));
    const sequenceB = Array.from({ length: 20 }, () => b.rollDie(20));
    expect(sequenceA).toEqual(sequenceB);
  });

  it('respeita o intervalo do dado', () => {
    const rng = seededRng(7);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.rollDie(8);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(8);
    }
  });
});
