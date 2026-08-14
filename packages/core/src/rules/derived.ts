import {
  abilityModifier,
  proficiencyContribution,
  SKILL_DEFINITIONS,
  SKILLS,
  ABILITIES,
  type Ability,
  type ProficiencyLevel,
  type Skill,
} from './abilities.js';
import { armorClass, initiativeModifier, passiveScore, type ArmorClassResult, type ArmorProfile } from './combat.js';
import { CLASSES, hitDicePools, totalLevel, type ClassLevel } from './classes.js';
import { expandConditions, type ConditionId } from './conditions.js';
import {
  encumbranceState,
  purseWeightKg,
  type CreatureSize,
  type EncumbranceState,
} from './encumbrance.js';
import { proficiencyBonus } from './progression.js';
import {
  pactMagic,
  spellcastingStats,
  spellSlots,
  type PactMagic,
  type SpellcastingStats,
  type SpellSlots,
} from './spellcasting.js';
import type { Attack, Character } from '../schema/character.js';

/**
 * Tudo que a ficha *mostra* mas não *guarda*.
 *
 * A regra é simples e vale para o app inteiro: se um número pode ser calculado
 * a partir de outro, ele não é salvo. Um bônus de proficiência gravado no
 * banco é um bônus de proficiência que vai ficar desatualizado na primeira
 * subida de nível.
 */

export interface DerivedSkill {
  readonly skill: Skill;
  readonly ability: Ability;
  readonly label: string;
  readonly proficiency: ProficiencyLevel;
  readonly modifier: number;
}

export interface DerivedSave {
  readonly ability: Ability;
  readonly proficiency: ProficiencyLevel;
  readonly modifier: number;
}

export interface DerivedAttack {
  readonly attack: Attack;
  readonly attackBonus: number;
  /** Notação pronta para rolar, já com modificador: `1d8+3`. */
  readonly damageNotation: string;
  readonly damageBonus: number;
}

export interface DerivedHitDice {
  readonly die: number;
  readonly total: number;
  readonly spent: number;
  readonly available: number;
}

export interface DerivedCharacter {
  readonly totalLevel: number;
  readonly proficiencyBonus: number;
  readonly abilityModifiers: Readonly<Record<Ability, number>>;
  readonly savingThrows: readonly DerivedSave[];
  readonly skills: readonly DerivedSkill[];
  readonly passivePerception: number;
  readonly passiveInvestigation: number;
  readonly passiveInsight: number;
  readonly armorClass: ArmorClassResult;
  readonly initiative: number;
  readonly spellSlots: SpellSlots;
  readonly pactMagic: PactMagic | null;
  readonly spellcasting: readonly SpellcastingStats[];
  readonly hitDice: readonly DerivedHitDice[];
  readonly attacks: readonly DerivedAttack[];
  readonly carriedKg: number;
  readonly encumbrance: EncumbranceState;
  readonly activeConditions: ReadonlySet<ConditionId>;
}

export interface DeriveOptions {
  /**
   * A armadura equipada, já resolvida a partir do catálogo do SRD. O core não
   * conhece o banco de dados de propósito — quem chama resolve o `armorId`.
   */
  readonly armor?: ArmorProfile | null;
  readonly size?: CreatureSize;
  readonly useEncumbranceVariant?: boolean;
}

export function deriveCharacter(
  character: Character,
  options: DeriveOptions = {},
): DerivedCharacter {
  const classes: ClassLevel[] = character.classes;
  const level = totalLevel(classes);
  const profBonus = proficiencyBonus(level);
  const scores = character.abilities;

  const abilityModifiers = Object.fromEntries(
    ABILITIES.map((ability) => [ability, abilityModifier(scores[ability])]),
  ) as Record<Ability, number>;

  const savingThrows: DerivedSave[] = ABILITIES.map((ability) => {
    const proficiency = character.savingThrows[ability] ?? 'none';
    return {
      ability,
      proficiency,
      modifier: abilityModifiers[ability] + proficiencyContribution(profBonus, proficiency),
    };
  });

  const skills: DerivedSkill[] = SKILLS.map((skill) => {
    const definition = SKILL_DEFINITIONS[skill];
    const proficiency = character.skills[skill] ?? 'none';
    return {
      skill,
      ability: definition.ability,
      label: definition.label,
      proficiency,
      modifier:
        abilityModifiers[definition.ability] + proficiencyContribution(profBonus, proficiency),
    };
  });

  const skillModifier = (skill: Skill): number =>
    skills.find((entry) => entry.skill === skill)!.modifier;

  const ac = armorClass({
    scores,
    armor: options.armor ?? null,
    shield: character.armor.shield,
    unarmoredDefense: character.armor.unarmoredDefense
      ? { kind: character.armor.unarmoredDefense }
      : null,
    bonuses: character.armor.bonuses,
  });

  const carriedKg =
    character.inventory.reduce((sum, item) => sum + item.weightKg * item.quantity, 0) +
    purseWeightKg(character.purse);

  const warlockLevel = classes.find((entry) => entry.classId === 'warlock')?.level ?? 0;

  const hitDice: DerivedHitDice[] = [...hitDicePools(classes)]
    .sort(([a], [b]) => b - a)
    .map(([die, total]) => {
      const spent = character.hitDiceSpent[String(die)] ?? 0;
      return { die, total, spent, available: Math.max(0, total - spent) };
    });

  return {
    totalLevel: level,
    proficiencyBonus: profBonus,
    abilityModifiers,
    savingThrows,
    skills,
    passivePerception: passiveScore(skillModifier('perception')),
    passiveInvestigation: passiveScore(skillModifier('investigation')),
    passiveInsight: passiveScore(skillModifier('insight')),
    armorClass: ac,
    initiative: initiativeModifier(scores, character.initiativeBonus),
    spellSlots: spellSlots(classes),
    pactMagic: warlockLevel > 0 ? pactMagic(warlockLevel) : null,
    spellcasting: classes
      .map((entry) => spellcastingStats(entry, scores, profBonus))
      .filter((stats): stats is SpellcastingStats => stats !== null),
    hitDice,
    attacks: character.attacks.map((attack) =>
      deriveAttack(attack, abilityModifiers, profBonus),
    ),
    carriedKg,
    encumbrance: encumbranceState(scores, carriedKg, {
      size: options.size ?? 'medium',
      useVariant: options.useEncumbranceVariant ?? false,
    }),
    activeConditions: expandConditions(character.conditions),
  };
}

function deriveAttack(
  attack: Attack,
  abilityModifiers: Readonly<Record<Ability, number>>,
  profBonus: number,
): DerivedAttack {
  const abilityMod = abilityModifiers[attack.ability];
  const damageBonus = abilityMod + attack.magicBonus;

  const attackBonus =
    attack.attackBonusOverride ??
    abilityMod + attack.magicBonus + (attack.proficient ? profBonus : 0);

  // O dano nunca leva o bônus de proficiência — só o modificador de habilidade
  // e o bônus mágico da arma.
  const damageNotation =
    damageBonus === 0
      ? attack.damageDice
      : `${attack.damageDice}${damageBonus > 0 ? '+' : '-'}${Math.abs(damageBonus)}`;

  return { attack, attackBonus, damageNotation, damageBonus };
}

/**
 * PV máximo sugerido. O PHB dá duas opções ao subir de nível: rolar o dado ou
 * pegar a média fixa. A média é `(faces / 2) + 1`, e o 1º nível sempre recebe o
 * valor cheio do dado da primeira classe.
 */
export function suggestedMaxHitPoints(
  classes: readonly ClassLevel[],
  constitutionScore: number,
): number {
  if (classes.length === 0) return 0;
  const conMod = abilityModifier(constitutionScore);

  const firstClass = classes[0]!;
  let total = CLASSES[firstClass.classId].hitDie + conMod;

  for (const [index, entry] of classes.entries()) {
    const die = CLASSES[entry.classId].hitDie;
    // O primeiro nível da primeira classe já foi contado com o dado cheio.
    const levelsToAverage = index === 0 ? entry.level - 1 : entry.level;
    total += levelsToAverage * (Math.floor(die / 2) + 1 + conMod);
  }

  // Constituição muito baixa não leva o total a zero: cada nível dá ao menos 1.
  return Math.max(totalLevel(classes), total);
}
