/**
 * Fonte de aleatoriedade para rolagens.
 *
 * `Math.random()` não serve: os motores de JS não garantem qualidade nem
 * imprevisibilidade, e uma mesa de RPG merece dados honestos. Usamos
 * `crypto.getRandomValues`, disponível em todos os alvos (browser, Capacitor
 * WebView, Electron e Node ≥ 19 via `globalThis.crypto`).
 */

export interface Rng {
  /** Inteiro uniforme em [1, sides]. */
  rollDie(sides: number): number;
}

const UINT32_RANGE = 0x1_0000_0000;

/**
 * `x % sides` sozinho enviesa o resultado a favor dos primeiros valores sempre
 * que `sides` não divide 2³² — num d20 isso é pequeno, mas é um viés real e
 * sistemático. Descartamos a cauda que causa o desbalanço antes do módulo.
 */
export const cryptoRng: Rng = {
  rollDie(sides: number): number {
    if (!Number.isInteger(sides) || sides < 1) {
      throw new RangeError(`Número de faces inválido: ${sides}`);
    }
    if (sides === 1) return 1;

    const limit = Math.floor(UINT32_RANGE / sides) * sides;
    const buffer = new Uint32Array(1);
    let value: number;
    do {
      globalThis.crypto.getRandomValues(buffer);
      value = buffer[0]!;
    } while (value >= limit);

    return (value % sides) + 1;
  },
};

/**
 * RNG determinístico para testes. Implementa mulberry32 — rápido, sem
 * dependências e com período suficiente para uma suíte de testes.
 */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    rollDie(sides: number): number {
      if (!Number.isInteger(sides) || sides < 1) {
        throw new RangeError(`Número de faces inválido: ${sides}`);
      }
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const unit = ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
      return Math.floor(unit * sides) + 1;
    },
  };
}

/** Sequência fixa de resultados — para testar caminhos específicos (crítico, morte). */
export function scriptedRng(values: readonly number[]): Rng {
  let index = 0;
  return {
    rollDie(): number {
      const value = values[index % values.length]!;
      index += 1;
      return value;
    },
  };
}
