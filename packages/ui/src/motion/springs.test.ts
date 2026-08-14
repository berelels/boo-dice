import { describe, expect, it } from 'vitest';
import {
  SPRING_DEFAULT,
  SPRING_SHEET,
  VelocityTracker,
  clampWithRubberband,
  nearestSnapPoint,
  projectMomentum,
  rubberband,
} from './springs.js';

describe('molas', () => {
  it('o padrão é criticamente amortecido — não repica', () => {
    expect(SPRING_DEFAULT.bounce).toBe(0);
  });

  it('a folha repica um pouco, porque o gesto carrega momento', () => {
    expect(SPRING_SHEET.bounce).toBeGreaterThan(0);
    expect(SPRING_SHEET.bounce).toBeLessThan(0.3);
  });
});

describe('projectMomentum', () => {
  it('projeta mais longe quanto mais rápido o arremesso', () => {
    expect(projectMomentum(1000)).toBeGreaterThan(projectMomentum(500));
  });

  it('preserva o sinal da velocidade', () => {
    expect(projectMomentum(-800)).toBeLessThan(0);
  });

  it('não projeta nada quando o dedo parou', () => {
    expect(projectMomentum(0)).toBe(0);
  });

  it('usa decaimento exponencial, não a fórmula de física do colégio', () => {
    // v=1000 px/s com d=0.998 dá ~499 px. A fórmula v²/(2a) daria outra ordem
    // de grandeza — é justamente o erro que faz um flick parecer que não pegou.
    expect(projectMomentum(1000)).toBeCloseTo(499, 0);
  });

  it('uma taxa menor projeta menos', () => {
    expect(projectMomentum(1000, 0.99)).toBeLessThan(projectMomentum(1000, 0.998));
  });
});

describe('rubberband', () => {
  it('resiste mais quanto mais longe do limite', () => {
    const pouco = rubberband(10, 400);
    const muito = rubberband(200, 400);
    expect(muito).toBeGreaterThan(pouco);
    // Mas nunca proporcionalmente: 20× o excesso não dá 20× o deslocamento.
    expect(muito / pouco).toBeLessThan(20);
  });

  it('sempre devolve menos que o excesso pedido', () => {
    for (const overshoot of [5, 50, 500]) {
      expect(rubberband(overshoot, 400)).toBeLessThan(overshoot);
    }
  });

  it('lida com dimensão zero sem produzir NaN', () => {
    expect(rubberband(50, 0)).toBe(0);
  });
});

describe('clampWithRubberband', () => {
  it('segue 1:1 dentro do intervalo', () => {
    expect(clampWithRubberband(50, 0, 100, 400)).toBe(50);
  });

  it('resiste fora do intervalo, em vez de travar duro', () => {
    const acima = clampWithRubberband(150, 0, 100, 400);
    expect(acima).toBeGreaterThan(100);
    expect(acima).toBeLessThan(150);

    const abaixo = clampWithRubberband(-50, 0, 100, 400);
    expect(abaixo).toBeLessThan(0);
    expect(abaixo).toBeGreaterThan(-50);
  });
});

describe('nearestSnapPoint', () => {
  it('escolhe o ponto mais próximo do destino projetado', () => {
    expect(nearestSnapPoint(180, [0, 200, 400])).toBe(200);
    expect(nearestSnapPoint(90, [0, 200, 400])).toBe(0);
  });

  it('devolve o próprio valor quando não há pontos', () => {
    expect(nearestSnapPoint(123, [])).toBe(123);
  });
});

describe('VelocityTracker', () => {
  it('calcula velocidade a partir do histórico', () => {
    const tracker = new VelocityTracker();
    tracker.add(0, 0);
    tracker.add(100, 100); // 100 px em 100 ms
    expect(tracker.velocity()).toBeCloseTo(1000, 0);
  });

  it('descarta amostras fora da janela', () => {
    const tracker = new VelocityTracker(100);
    tracker.add(0, 0);
    tracker.add(1000, 50);
    // Esta amostra empurra a primeira para fora da janela de 100 ms.
    tracker.add(1010, 200);
    // Se a amostra antiga ainda contasse, a velocidade sairia enorme.
    expect(Math.abs(tracker.velocity())).toBeLessThan(200);
  });

  it('não estoura com uma amostra só', () => {
    const tracker = new VelocityTracker();
    tracker.add(50, 0);
    expect(tracker.velocity()).toBe(0);
  });

  it('não divide por zero com amostras no mesmo instante', () => {
    const tracker = new VelocityTracker();
    tracker.add(0, 10);
    tracker.add(100, 10);
    expect(tracker.velocity()).toBe(0);
  });

  it('zera ao resetar', () => {
    const tracker = new VelocityTracker();
    tracker.add(0, 0);
    tracker.add(100, 100);
    tracker.reset();
    expect(tracker.velocity()).toBe(0);
  });
});
