import { z } from 'zod';
import { CONDITIONS, expandConditions, type ConditionId } from '../rules/conditions.js';

/**
 * Prazo de validade de uma condição, em rodadas do encontro.
 *
 * Guardamos a rodada em que a condição *acaba*, não quantas faltam. Contador
 * regressivo daria na mesma enquanto o combate só anda pra frente — mas o
 * botão "Anterior" existe, e é justamente pra desfazer o clique errado. Com um
 * número absoluto, voltar uma rodada devolve a condição sozinho, sem nenhum
 * estado a restaurar: o que falta é sempre derivado da rodada atual, nunca
 * gravado. Efeito colateral bom: fechar e reabrir o app não adianta nem atrasa
 * nada.
 */
export interface ConditionTimer {
  readonly id: ConditionId;
  /** Última rodada em que a condição ainda vale. Depois dela, sai sozinha. */
  readonly endsAfterRound: number;
}

/** Quantas rodadas ainda faltam, contando a atual. Zero ou menos = já acabou. */
export function roundsLeft(timer: ConditionTimer, round: number): number {
  return timer.endsAfterRound - round + 1;
}

/**
 * Marca "dura N rodadas a partir de agora".
 *
 * `rounds = 1` significa "até o fim desta rodada": vale na rodada atual e some
 * na seguinte.
 */
export function timerFor(id: ConditionId, rounds: number, round: number): ConditionTimer {
  return { id, endsAfterRound: round + Math.max(1, Math.trunc(rounds)) - 1 };
}

const conditionTimerSchema = z.object({
  id: z.enum(CONDITIONS),
  endsAfterRound: z.number().int(),
});

/**
 * Lê os prazos gravados num combatente.
 *
 * Mesma postura de `parseStoredAttacks`: é JSON do banco, não de código. Um
 * encontro salvo por uma versão antiga, ou mexido na mão, vira lista vazia —
 * as condições ficam valendo até o mestre tirar, que é o comportamento de
 * antes desta funcionalidade existir.
 */
export function parseStoredTimers(json: string | null): ConditionTimer[] {
  if (!json) return [];
  try {
    const parsed = z.array(conditionTimerSchema).safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export interface ExpiredConditions {
  readonly conditions: readonly ConditionId[];
  readonly timers: readonly ConditionTimer[];
}

/**
 * Tira do combatente o que já venceu na rodada `round`.
 *
 * Também limpa as condições que só estavam ali por implicação da que venceu:
 * "Inconsciente" acende "Incapacitado" e "Caído" (ver `expandConditions`), e
 * seria estranho o inconsciente acordar continuando caído. Os dois só ficam se
 * alguma condição que sobrou também os implicar — um monstro paralisado *e*
 * inconsciente continua incapacitado quando a inconsciência passa.
 *
 * O preço disso é um caso raro: se o mestre marcou "Caído" na mão e depois
 * "Inconsciente" com prazo, o fim da inconsciência leva o "Caído" junto. Não
 * dá pra distinguir os dois — nada grava quem foi marcado à mão — e errar pra
 * esse lado custa um clique, enquanto o contrário deixa condição fantasma na
 * mesa.
 */
export function expireConditions(
  conditions: readonly ConditionId[],
  timers: readonly ConditionTimer[],
  round: number,
): ExpiredConditions {
  // Prazo de condição que o mestre já tirou na mão não interessa mais.
  const live = timers.filter((timer) => conditions.includes(timer.id));
  const expired = new Set(
    live.filter((timer) => roundsLeft(timer, round) <= 0).map((timer) => timer.id),
  );

  if (expired.size === 0) {
    return { conditions, timers: live.length === timers.length ? timers : live };
  }

  const kept = conditions.filter((id) => !expired.has(id));

  const impliedByExpired = new Set<ConditionId>();
  for (const id of expired) {
    for (const implied of expandConditions([id])) {
      if (implied !== id) impliedByExpired.add(implied);
    }
  }

  // Quem sobrou também implica coisa. Só olhamos as condições que não estão
  // elas mesmas de saída — senão uma condição indo embora sustentaria a
  // seguinte na cadeia.
  const stillImplied = new Set<ConditionId>();
  for (const id of kept) {
    if (impliedByExpired.has(id)) continue;
    for (const implied of expandConditions([id])) {
      if (implied !== id) stillImplied.add(implied);
    }
  }

  const remaining = kept.filter((id) => !impliedByExpired.has(id) || stillImplied.has(id));
  return {
    conditions: remaining,
    timers: live.filter((timer) => remaining.includes(timer.id)),
  };
}
