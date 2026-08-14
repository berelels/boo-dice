/**
 * Condições do SRD e os níveis de exaustão.
 *
 * O texto aqui é um resumo curto para o chip na ficha — a descrição completa
 * vem do glossário (tabela `rules_chunks`). A ideia é que o jogador veja o
 * essencial sem sair da ficha, e toque para ler a regra inteira.
 */

export const CONDITIONS = [
  'blinded',
  'charmed',
  'deafened',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
] as const;
export type ConditionId = (typeof CONDITIONS)[number];

export interface ConditionDefinition {
  readonly id: ConditionId;
  readonly label: string;
  readonly summary: string;
  /** Condições que esta acarreta automaticamente. */
  readonly implies: readonly ConditionId[];
}

export const CONDITION_DEFINITIONS: Readonly<Record<ConditionId, ConditionDefinition>> = {
  blinded: {
    id: 'blinded',
    label: 'Cego',
    summary:
      'Não enxerga e falha automaticamente em testes que exijam visão. Ataques contra você têm vantagem; os seus, desvantagem.',
    implies: [],
  },
  charmed: {
    id: 'charmed',
    label: 'Enfeitiçado',
    summary:
      'Não pode atacar quem o enfeitiçou nem escolhê-lo como alvo de efeito nocivo. Quem o enfeitiçou tem vantagem em testes de interação social com você.',
    implies: [],
  },
  deafened: {
    id: 'deafened',
    label: 'Surdo',
    summary: 'Não escuta e falha automaticamente em testes que exijam audição.',
    implies: [],
  },
  frightened: {
    id: 'frightened',
    label: 'Amedrontado',
    summary:
      'Desvantagem em testes e ataques enquanto a fonte do medo estiver à vista. Não pode se aproximar dela voluntariamente.',
    implies: [],
  },
  grappled: {
    id: 'grappled',
    label: 'Agarrado',
    summary:
      'Seu deslocamento é 0 e não se beneficia de bônus de deslocamento. Termina se quem agarrou ficar incapacitado.',
    implies: [],
  },
  incapacitated: {
    id: 'incapacitated',
    label: 'Incapacitado',
    summary: 'Não pode realizar ações nem reações.',
    implies: [],
  },
  invisible: {
    id: 'invisible',
    label: 'Invisível',
    summary:
      'Impossível de ver sem magia ou sentido especial; conta como muito obscurecido. Ataques contra você têm desvantagem; os seus, vantagem.',
    implies: [],
  },
  paralyzed: {
    id: 'paralyzed',
    label: 'Paralisado',
    summary:
      'Incapacitado, não fala e não se move. Falha automaticamente em resistências de Força e Destreza; ataques contra você têm vantagem e qualquer acerto a até 1,5 m é crítico.',
    implies: ['incapacitated'],
  },
  petrified: {
    id: 'petrified',
    label: 'Petrificado',
    summary:
      'Transformado em substância sólida junto com o que veste. Incapacitado, resistência a todo dano, imune a veneno e doença.',
    implies: ['incapacitated'],
  },
  poisoned: {
    id: 'poisoned',
    label: 'Envenenado',
    summary: 'Desvantagem em jogadas de ataque e testes de habilidade.',
    implies: [],
  },
  prone: {
    id: 'prone',
    label: 'Caído',
    summary:
      'Só pode se arrastar (custa metade do deslocamento para levantar). Desvantagem nos seus ataques; ataques contra você têm vantagem a até 1,5 m e desvantagem além disso.',
    implies: [],
  },
  restrained: {
    id: 'restrained',
    label: 'Impedido',
    summary:
      'Deslocamento 0. Ataques contra você têm vantagem; os seus, desvantagem. Desvantagem em resistências de Destreza.',
    implies: [],
  },
  stunned: {
    id: 'stunned',
    label: 'Atordoado',
    summary:
      'Incapacitado, não se move e fala com dificuldade. Falha automaticamente em resistências de Força e Destreza; ataques contra você têm vantagem.',
    implies: ['incapacitated'],
  },
  unconscious: {
    id: 'unconscious',
    label: 'Inconsciente',
    summary:
      'Incapacitado e caído, sem perceber o ambiente e largando o que segura. Falha automaticamente em resistências de Força e Destreza; ataques contra você têm vantagem e acertos a até 1,5 m são críticos.',
    implies: ['incapacitated', 'prone'],
  },
};

/**
 * Expande as condições implicadas. Marcar "Inconsciente" na ficha deve acender
 * "Incapacitado" e "Caído" junto — quem esquece disso erra a regra na mesa.
 */
export function expandConditions(active: Iterable<ConditionId>): Set<ConditionId> {
  const result = new Set<ConditionId>();
  const queue = [...active];
  while (queue.length > 0) {
    const condition = queue.pop()!;
    if (result.has(condition)) continue;
    result.add(condition);
    queue.push(...CONDITION_DEFINITIONS[condition].implies);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Exaustão
// ---------------------------------------------------------------------------

export const MAX_EXHAUSTION = 6;

/** Índice = nível de exaustão. O nível 0 é "sem exaustão". */
export const EXHAUSTION_EFFECTS: readonly string[] = [
  'Sem exaustão.',
  'Desvantagem em testes de habilidade.',
  'Deslocamento reduzido à metade.',
  'Desvantagem em jogadas de ataque e testes de resistência.',
  'Máximo de pontos de vida reduzido à metade.',
  'Deslocamento reduzido a 0.',
  'Morte.',
];

/**
 * Os efeitos são cumulativos: no nível 3 você tem também os do 1 e do 2.
 * Devolve a lista inteira do que está valendo.
 */
export function exhaustionEffects(level: number): readonly string[] {
  const clamped = Math.min(MAX_EXHAUSTION, Math.max(0, Math.floor(level)));
  if (clamped === 0) return [];
  return EXHAUSTION_EFFECTS.slice(1, clamped + 1);
}
