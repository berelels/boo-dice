/**
 * Habilidades e perícias.
 *
 * As chaves são em inglês de propósito: elas casam com os IDs do dataset SRD
 * (5e-bits/5e-database), o que deixa os `join`s triviais e estáveis. Os rótulos
 * em PT-BR ficam nas tabelas de exibição abaixo — texto é apresentação, chave é
 * identidade.
 */

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type Ability = (typeof ABILITIES)[number];

export type AbilityScores = Readonly<Record<Ability, number>>;

export const ABILITY_LABELS: Readonly<Record<Ability, string>> = {
  str: 'Força',
  dex: 'Destreza',
  con: 'Constituição',
  int: 'Inteligência',
  wis: 'Sabedoria',
  cha: 'Carisma',
};

export const ABILITY_ABBREVIATIONS: Readonly<Record<Ability, string>> = {
  str: 'FOR',
  dex: 'DES',
  con: 'CON',
  int: 'INT',
  wis: 'SAB',
  cha: 'CAR',
};

/** Limites do PHB: 1 é o mínimo de uma criatura, 20 o teto sem magia/artefato. */
export const MIN_ABILITY_SCORE = 1;
export const MAX_ABILITY_SCORE = 30;
export const DEFAULT_ABILITY_CAP = 20;

/**
 * Atributos no ou acima do teto sem magia — aviso, não bloqueio.
 *
 * A ficha guarda o valor final de cada atributo, sem separar base de bônus
 * racial, então não dá pra validar point buy/array direito (quanto foi
 * escolhido na criação vs. ganho depois). O que dá pra avisar com segurança é
 * o teto conhecido do PHB: sem item mágico ou efeito especial, 20 é o máximo
 * que build nenhuma alcança, de nenhuma classe — daí o aviso valer igual para
 * todas.
 */
export function abilitiesAtOrAboveCap(
  abilities: AbilityScores,
  cap: number = DEFAULT_ABILITY_CAP,
): Ability[] {
  return ABILITIES.filter((ability) => abilities[ability] >= cap);
}

/**
 * O modificador arredonda para baixo, inclusive nos negativos: um valor 7 dá
 * −2, não −1. `Math.floor` faz isso certo; `Math.trunc` não faria.
 */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Formata com sinal explícito, como aparece na ficha: `+3`, `−1`, `+0`. */
export function formatModifier(modifier: number): string {
  return modifier >= 0 ? `+${modifier}` : `−${Math.abs(modifier)}`;
}

// ---------------------------------------------------------------------------
// Perícias
// ---------------------------------------------------------------------------

export const SKILLS = [
  'acrobatics',
  'animal-handling',
  'arcana',
  'athletics',
  'deception',
  'history',
  'insight',
  'intimidation',
  'investigation',
  'medicine',
  'nature',
  'perception',
  'performance',
  'persuasion',
  'religion',
  'sleight-of-hand',
  'stealth',
  'survival',
] as const;
export type Skill = (typeof SKILLS)[number];

export interface SkillDefinition {
  readonly ability: Ability;
  readonly label: string;
}

export const SKILL_DEFINITIONS: Readonly<Record<Skill, SkillDefinition>> = {
  acrobatics: { ability: 'dex', label: 'Acrobacia' },
  'animal-handling': { ability: 'wis', label: 'Adestrar Animais' },
  arcana: { ability: 'int', label: 'Arcanismo' },
  athletics: { ability: 'str', label: 'Atletismo' },
  deception: { ability: 'cha', label: 'Enganação' },
  history: { ability: 'int', label: 'História' },
  insight: { ability: 'wis', label: 'Intuição' },
  intimidation: { ability: 'cha', label: 'Intimidação' },
  investigation: { ability: 'int', label: 'Investigação' },
  medicine: { ability: 'wis', label: 'Medicina' },
  nature: { ability: 'int', label: 'Natureza' },
  perception: { ability: 'wis', label: 'Percepção' },
  performance: { ability: 'cha', label: 'Atuação' },
  persuasion: { ability: 'cha', label: 'Persuasão' },
  religion: { ability: 'int', label: 'Religião' },
  'sleight-of-hand': { ability: 'dex', label: 'Prestidigitação' },
  stealth: { ability: 'dex', label: 'Furtividade' },
  survival: { ability: 'wis', label: 'Sobrevivência' },
};

/** Perícias em ordem alfabética de PT-BR — a ordem em que a ficha as lista. */
export const SKILLS_SORTED_PT: readonly Skill[] = [...SKILLS].sort((a, b) =>
  SKILL_DEFINITIONS[a].label.localeCompare(SKILL_DEFINITIONS[b].label, 'pt-BR'),
);

/**
 * Nível de treino numa perícia ou resistência.
 * `expertise` dobra o bônus de proficiência (ladino, bardo, algumas raças).
 */
export type ProficiencyLevel = 'none' | 'half' | 'proficient' | 'expertise';

export const PROFICIENCY_MULTIPLIERS: Readonly<Record<ProficiencyLevel, number>> = {
  none: 0,
  half: 0.5,
  proficient: 1,
  expertise: 2,
};

/**
 * Bônus de proficiência aplicado. A proficiência parcial (Perito Vagabundo do
 * bardo, Jack of All Trades) arredonda para baixo — como toda divisão em 5e.
 */
export function proficiencyContribution(
  proficiencyBonus: number,
  level: ProficiencyLevel,
): number {
  return Math.floor(proficiencyBonus * PROFICIENCY_MULTIPLIERS[level]);
}
