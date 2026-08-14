import type { Ability } from './abilities.js';

/**
 * As 12 classes do SRD. Chaves em inglês para casar com o dataset SRD;
 * rótulos em PT-BR para a tela.
 *
 * `casterType` descreve o *progresso* de conjuração da classe base:
 *  - `full`    bardo, clérigo, druida, feiticeiro, mago
 *  - `half`    paladino, patrulheiro
 *  - `pact`    bruxo (Magia de Pacto — tabela própria, recupera em descanso curto)
 *  - `none`    bárbaro, monge, e guerreiro/ladino nas subclasses não-mágicas
 *
 * Guerreiro e ladino viram `third` só através de Cavaleiro Arcano e Trapaceiro
 * Arcano — por isso a subclasse pode sobrescrever o tipo, via `SUBCLASS_CASTING`.
 */

export const CLASS_IDS = [
  'barbarian',
  'bard',
  'cleric',
  'druid',
  'fighter',
  'monk',
  'paladin',
  'ranger',
  'rogue',
  'sorcerer',
  'warlock',
  'wizard',
] as const;
export type ClassId = (typeof CLASS_IDS)[number];

export type CasterType = 'none' | 'third' | 'half' | 'full' | 'pact';

export interface ClassDefinition {
  readonly id: ClassId;
  readonly label: string;
  /** Faces do dado de vida: 6, 8, 10 ou 12. */
  readonly hitDie: number;
  readonly casterType: CasterType;
  /** `null` quando a classe base não conjura. */
  readonly spellcastingAbility: Ability | null;
  /** As duas resistências com proficiência ao começar por esta classe. */
  readonly savingThrows: readonly [Ability, Ability];
  /** Quantas perícias escolher ao começar por esta classe. */
  readonly skillChoices: number;
}

export const CLASSES: Readonly<Record<ClassId, ClassDefinition>> = {
  barbarian: {
    id: 'barbarian',
    label: 'Bárbaro',
    hitDie: 12,
    casterType: 'none',
    spellcastingAbility: null,
    savingThrows: ['str', 'con'],
    skillChoices: 2,
  },
  bard: {
    id: 'bard',
    label: 'Bardo',
    hitDie: 8,
    casterType: 'full',
    spellcastingAbility: 'cha',
    savingThrows: ['dex', 'cha'],
    skillChoices: 3,
  },
  cleric: {
    id: 'cleric',
    label: 'Clérigo',
    hitDie: 8,
    casterType: 'full',
    spellcastingAbility: 'wis',
    savingThrows: ['wis', 'cha'],
    skillChoices: 2,
  },
  druid: {
    id: 'druid',
    label: 'Druida',
    hitDie: 8,
    casterType: 'full',
    spellcastingAbility: 'wis',
    savingThrows: ['int', 'wis'],
    skillChoices: 2,
  },
  fighter: {
    id: 'fighter',
    label: 'Guerreiro',
    hitDie: 10,
    casterType: 'none',
    spellcastingAbility: null,
    savingThrows: ['str', 'con'],
    skillChoices: 2,
  },
  monk: {
    id: 'monk',
    label: 'Monge',
    hitDie: 8,
    casterType: 'none',
    spellcastingAbility: null,
    savingThrows: ['str', 'dex'],
    skillChoices: 2,
  },
  paladin: {
    id: 'paladin',
    label: 'Paladino',
    hitDie: 10,
    casterType: 'half',
    spellcastingAbility: 'cha',
    savingThrows: ['wis', 'cha'],
    skillChoices: 2,
  },
  ranger: {
    id: 'ranger',
    label: 'Patrulheiro',
    hitDie: 10,
    casterType: 'half',
    spellcastingAbility: 'wis',
    savingThrows: ['str', 'dex'],
    skillChoices: 3,
  },
  rogue: {
    id: 'rogue',
    label: 'Ladino',
    hitDie: 8,
    casterType: 'none',
    spellcastingAbility: null,
    savingThrows: ['dex', 'int'],
    skillChoices: 4,
  },
  sorcerer: {
    id: 'sorcerer',
    label: 'Feiticeiro',
    hitDie: 6,
    casterType: 'full',
    spellcastingAbility: 'cha',
    savingThrows: ['con', 'cha'],
    skillChoices: 2,
  },
  warlock: {
    id: 'warlock',
    label: 'Bruxo',
    hitDie: 8,
    casterType: 'pact',
    spellcastingAbility: 'cha',
    savingThrows: ['wis', 'cha'],
    skillChoices: 2,
  },
  wizard: {
    id: 'wizard',
    label: 'Mago',
    hitDie: 6,
    casterType: 'full',
    spellcastingAbility: 'int',
    savingThrows: ['int', 'wis'],
    skillChoices: 2,
  },
};

/**
 * Subclasses que dão conjuração a uma classe que não tinha. São só estas duas
 * no SRD, mas o mapa deixa a regra explícita em vez de espalhada em `if`s.
 */
export const SUBCLASS_CASTING: Readonly<
  Record<string, { readonly casterType: CasterType; readonly spellcastingAbility: Ability }>
> = {
  'eldritch-knight': { casterType: 'third', spellcastingAbility: 'int' },
  'arcane-trickster': { casterType: 'third', spellcastingAbility: 'int' },
};

/** Uma entrada de classe na ficha — uma só, ou várias em multiclasse. */
export interface ClassLevel {
  readonly classId: ClassId;
  readonly level: number;
  readonly subclassId?: string;
}

/** O tipo de conjurador efetivo, já considerando a subclasse. */
export function effectiveCasterType(entry: ClassLevel): CasterType {
  const override = entry.subclassId ? SUBCLASS_CASTING[entry.subclassId] : undefined;
  return override?.casterType ?? CLASSES[entry.classId].casterType;
}

export function effectiveSpellcastingAbility(entry: ClassLevel): Ability | null {
  const override = entry.subclassId ? SUBCLASS_CASTING[entry.subclassId] : undefined;
  return override?.spellcastingAbility ?? CLASSES[entry.classId].spellcastingAbility;
}

export function totalLevel(classes: readonly ClassLevel[]): number {
  return classes.reduce((sum, entry) => sum + entry.level, 0);
}

/**
 * Dados de vida disponíveis, agrupados por face. Um Guerreiro 5 / Mago 3 tem
 * 5d10 e 3d6, e gasta cada pool separadamente no descanso curto.
 */
export function hitDicePools(classes: readonly ClassLevel[]): Map<number, number> {
  const pools = new Map<number, number>();
  for (const entry of classes) {
    const die = CLASSES[entry.classId].hitDie;
    pools.set(die, (pools.get(die) ?? 0) + entry.level);
  }
  return pools;
}
