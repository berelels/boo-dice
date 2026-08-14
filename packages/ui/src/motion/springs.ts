/**
 * Molas e física de gesto.
 *
 * Os valores vêm da fala "Designing Fluid Interfaces" (WWDC 2018) da Apple, que
 * troca o trio massa/rigidez/amortecimento por dois parâmetros que um designer
 * consegue raciocinar:
 *
 *  - **amortecimento** controla o repique. `1.0` assenta sem passar do ponto.
 *  - **resposta** é a rapidez com que o valor alcança o alvo, em segundos.
 *    Não é "duração": uma mola não tem duração fixa.
 *
 * A regra de bolso: `1.0` em tudo por padrão, e repique **só** onde o gesto
 * carregou momento. Repique num menu que apenas apareceu parece defeito;
 * repique num card que você arremessou parece física.
 */

export interface SpringConfig {
  readonly type: 'spring';
  readonly bounce: number;
  readonly duration: number;
}

/** No `motion`, `bounce: 0` equivale ao criticamente amortecido da Apple. */
function spring(damping: number, response: number): SpringConfig {
  return { type: 'spring', bounce: Math.max(0, 1 - damping), duration: response };
}

/** Padrão de tudo que não é gesto: aparecer, trocar de aba, revelar detalhe. */
export const SPRING_DEFAULT = spring(1.0, 0.35);

/** Reposicionar algo na tela — mover um card, encaixar um item na lista. */
export const SPRING_MOVE = spring(1.0, 0.4);

/** Folha/gaveta arrastável. Repica porque o dedo dá momento a ela. */
export const SPRING_SHEET = spring(0.8, 0.3);

/** Solto após arremesso. O repique aqui é a continuação do gesto. */
export const SPRING_FLICK = spring(0.8, 0.4);

/** Feedback de toque: precisa ser quase instantâneo para não parecer atraso. */
export const SPRING_PRESS = spring(1.0, 0.2);

/**
 * Onde um arremesso pararia, se desacelerasse sozinho.
 *
 * É a função exata do código de exemplo da Apple — decaimento exponencial, e
 * **não** o `v²/(2a)` do livro de física. Usar o ponto de soltura em vez da
 * projeção é o que faz um flick parecer que "não pegou".
 */
export function projectMomentum(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * Resistência elástica no limite. Parar duro lê como "travou"; resistir de
 * forma crescente lê como "responde, mas acabou aqui".
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** Aplica resistência apenas fora do intervalo; dentro, segue 1:1 com o dedo. */
export function clampWithRubberband(
  value: number,
  min: number,
  max: number,
  dimension: number,
): number {
  if (value < min) return min - rubberband(min - value, dimension);
  if (value > max) return max + rubberband(value - max, dimension);
  return value;
}

/** Ponto de encaixe mais próximo do destino projetado — não da soltura. */
export function nearestSnapPoint(projected: number, points: readonly number[]): number {
  if (points.length === 0) return projected;
  return points.reduce((best, point) =>
    Math.abs(point - projected) < Math.abs(best - projected) ? point : best,
  );
}

/**
 * Rastreador de velocidade.
 *
 * A velocidade precisa vir de um histórico curto, não do último par de eventos:
 * um único `pointermove` com 2 ms de intervalo produz números absurdos, e o
 * arremesso sai errado. A janela de 100 ms suaviza sem introduzir atraso
 * perceptível.
 */
export class VelocityTracker {
  private readonly samples: { value: number; time: number }[] = [];

  constructor(private readonly windowMs = 100) {}

  add(value: number, time = performance.now()): void {
    this.samples.push({ value, time });
    while (this.samples.length > 1 && time - this.samples[0]!.time > this.windowMs) {
      this.samples.shift();
    }
  }

  /** Velocidade em unidades por segundo. */
  velocity(): number {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0]!;
    const last = this.samples.at(-1)!;
    const elapsed = last.time - first.time;
    if (elapsed <= 0) return 0;
    return ((last.value - first.value) / elapsed) * 1000;
  }

  reset(): void {
    this.samples.length = 0;
  }
}

/** Distância mínima antes de assumir que o gesto é um arraste, e não um toque. */
export const DRAG_THRESHOLD_PX = 10;
