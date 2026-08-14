import { abilityModifier } from './abilities.js';
import { hitDicePools } from './classes.js';
import { EMPTY_DEATH_SAVES } from './combat.js';
import { MAX_EXHAUSTION } from './conditions.js';
import type { Character } from '../schema/character.js';

/**
 * Descansos.
 *
 * As funções devolvem uma ficha nova em vez de mutar a existente — o estado do
 * app é imutável, e "desfazer um descanso longo por engano" precisa ser
 * possível.
 */

export interface RestResult {
  readonly character: Character;
  /** Resumo do que voltou, para mostrar na confirmação. */
  readonly summary: readonly string[];
}

/**
 * Descanso curto (1 hora).
 *
 * Não cura sozinho: o personagem escolhe quantos dados de vida gastar, e cada
 * um rola o dado + modificador de Constituição. Aqui recebemos o total já
 * rolado — quem rola é a UI, com dados de verdade e animação, porque essa
 * rolagem é parte da diversão.
 */
export function shortRest(
  character: Character,
  options: {
    /** Dados gastos por faces: `{ 10: 2 }` gasta dois d10. */
    readonly hitDiceSpent?: Readonly<Record<number, number>>;
    /** Total já rolado (dados + CON por dado). */
    readonly healed?: number;
  } = {},
): RestResult {
  const summary: string[] = [];

  const hitDiceSpent = { ...character.hitDiceSpent };
  const pools = hitDicePools(character.classes);
  let diceUsed = 0;

  for (const [dieText, count] of Object.entries(options.hitDiceSpent ?? {})) {
    if (count <= 0) continue;
    const die = Number(dieText);
    const available = (pools.get(die) ?? 0) - (hitDiceSpent[dieText] ?? 0);
    const used = Math.min(count, Math.max(0, available));
    if (used > 0) {
      hitDiceSpent[dieText] = (hitDiceSpent[dieText] ?? 0) + used;
      diceUsed += used;
    }
  }
  if (diceUsed > 0) summary.push(`${diceUsed} dado(s) de vida gasto(s)`);

  const healed = Math.max(0, options.healed ?? 0);
  const current = Math.min(character.hitPoints.max, character.hitPoints.current + healed);
  if (healed > 0) summary.push(`${current - character.hitPoints.current} PV recuperados`);

  // Magia de Pacto volta no descanso curto — é o traço que define o bruxo.
  const pactRestored = character.spellcasting.pactSlotsUsed > 0;
  if (pactRestored) summary.push('Espaços de Magia de Pacto restaurados');

  const features = character.features.map((feature) => {
    if (!feature.resource || feature.resource.recharge !== 'short') return feature;
    if (feature.resource.spent === 0) return feature;
    summary.push(`${feature.label} restaurado`);
    return { ...feature, resource: { ...feature.resource, spent: 0 } };
  });

  return {
    character: {
      ...character,
      hitPoints: { ...character.hitPoints, current },
      hitDiceSpent,
      spellcasting: { ...character.spellcasting, pactSlotsUsed: 0 },
      features,
      updatedAt: new Date().toISOString(),
    },
    summary,
  };
}

/**
 * Descanso longo (8 horas).
 *
 * Recupera todos os PV e todos os espaços de magia, zera os recursos de
 * descanso curto e longo, tira um nível de exaustão e devolve **metade** dos
 * dados de vida totais (mínimo 1) — não todos, que é o erro comum.
 */
export function longRest(character: Character): RestResult {
  const summary: string[] = [];

  const pools = hitDicePools(character.classes);
  const totalDice = [...pools.values()].reduce((sum, count) => sum + count, 0);
  const recovery = Math.max(1, Math.floor(totalDice / 2));

  // Devolve os dados começando pelos maiores — são os mais valiosos numa cura,
  // e é o que um jogador escolheria se o app perguntasse.
  const hitDiceSpent = { ...character.hitDiceSpent };
  let remaining = recovery;
  for (const die of [...pools.keys()].sort((a, b) => b - a)) {
    if (remaining <= 0) break;
    const key = String(die);
    const spent = hitDiceSpent[key] ?? 0;
    const returned = Math.min(spent, remaining);
    if (returned > 0) {
      hitDiceSpent[key] = spent - returned;
      remaining -= returned;
    }
  }
  const diceReturned = recovery - remaining;
  if (diceReturned > 0) summary.push(`${diceReturned} dado(s) de vida recuperado(s)`);

  if (character.hitPoints.current < character.hitPoints.max) {
    summary.push(`PV restaurados para ${character.hitPoints.max}`);
  }

  const hadSlots =
    character.spellcasting.slotsUsed.some((used) => used > 0) ||
    character.spellcasting.pactSlotsUsed > 0;
  if (hadSlots) summary.push('Todos os espaços de magia restaurados');

  const features = character.features.map((feature) => {
    if (!feature.resource || feature.resource.recharge === 'none') return feature;
    if (feature.resource.spent === 0) return feature;
    summary.push(`${feature.label} restaurado`);
    return { ...feature, resource: { ...feature.resource, spent: 0 } };
  });

  const exhaustion = Math.max(0, Math.min(MAX_EXHAUSTION, character.exhaustion) - 1);
  if (exhaustion < character.exhaustion) summary.push('Um nível de exaustão removido');

  return {
    character: {
      ...character,
      hitPoints: { ...character.hitPoints, current: character.hitPoints.max, temporary: 0 },
      hitDiceSpent,
      deathSaves: EMPTY_DEATH_SAVES,
      spellcasting: {
        ...character.spellcasting,
        slotsUsed: new Array(9).fill(0),
        pactSlotsUsed: 0,
        // A concentração não sobrevive a oito horas de sono.
        concentratingOn: null,
      },
      features,
      exhaustion,
      updatedAt: new Date().toISOString(),
    },
    summary,
  };
}

/** Quanto um dado de vida cura, em média — para a UI sugerir antes de rolar. */
export function averageHitDieHealing(die: number, constitutionScore: number): number {
  return Math.max(1, Math.floor(die / 2) + 1 + abilityModifier(constitutionScore));
}

/**
 * CD do teste de Constituição para manter a concentração: 10 ou metade do dano
 * sofrido, o que for maior.
 */
export function concentrationSaveDc(damageTaken: number): number {
  return Math.max(10, Math.floor(damageTaken / 2));
}
