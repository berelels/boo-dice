import { abilityModifier, type Ability, type AbilityScores } from './abilities.js';
import {
  CLASSES,
  effectiveCasterType,
  effectiveSpellcastingAbility,
  type CasterType,
  type ClassId,
  type ClassLevel,
} from './classes.js';

export const MAX_SPELL_LEVEL = 9;

/** Espaços por nível de magia, do 1º ao 9º. Índice 0 = magias de 1º nível. */
export type SpellSlots = readonly number[];

/**
 * Tabela de espaços do conjurador completo (PHB, tabela de classe de mago).
 * Índice do array = nível de conjurador − 1.
 *
 * Meio-conjuradores e conjuradores de um terço usam *esta mesma* tabela, só que
 * indexada por um nível efetivo menor — é assim que o PHB as constrói, e manter
 * uma tabela só elimina três oportunidades de errar um número na digitação.
 * Os testes conferem as linhas derivadas contra as tabelas impressas de
 * paladino e Cavaleiro Arcano.
 */
const FULL_CASTER_SLOTS: readonly SpellSlots[] = [
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/**
 * Converte o nível numa classe para o nível na tabela de conjurador completo.
 *
 * Repare no arredondamento **para cima** aqui: um paladino de nível 5 conjura
 * como um conjurador completo de nível 3. Isso é diferente do arredondamento
 * da multiclasse (`multiclassCasterLevel`), que é para baixo. Confundir os dois
 * é o erro mais comum ao implementar conjuração em 5e.
 */
function singleClassCasterLevel(casterType: CasterType, level: number): number {
  switch (casterType) {
    case 'full':
      return level;
    case 'half':
      // Paladino e patrulheiro só ganham magias no 2º nível.
      return level < 2 ? 0 : Math.ceil(level / 2);
    case 'third':
      // Cavaleiro Arcano e Trapaceiro Arcano só existem a partir do 3º nível.
      return level < 3 ? 0 : Math.ceil(level / 3);
    case 'pact':
    case 'none':
      return 0;
  }
}

function slotsForCasterLevel(casterLevel: number): SpellSlots {
  if (casterLevel < 1) return [];
  return FULL_CASTER_SLOTS[Math.min(casterLevel, FULL_CASTER_SLOTS.length) - 1]!;
}

/**
 * Nível de conjurador da multiclasse (PHB, "Espaços de Magia" em Multiclasse):
 * soma integral dos níveis de conjurador completo, **metade** dos de
 * meio-conjurador e **um terço** dos de um terço — todos arredondados para
 * baixo, e cada classe arredondada por si.
 */
export function multiclassCasterLevel(classes: readonly ClassLevel[]): number {
  let level = 0;
  for (const entry of classes) {
    switch (effectiveCasterType(entry)) {
      case 'full':
        level += entry.level;
        break;
      case 'half':
        level += Math.floor(entry.level / 2);
        break;
      case 'third':
        level += Math.floor(entry.level / 3);
        break;
      case 'pact':
      case 'none':
        break;
    }
  }
  return level;
}

/**
 * Espaços de magia normais (não inclui Magia de Pacto do bruxo, que tem pool
 * próprio — ver `pactMagic`).
 */
export function spellSlots(classes: readonly ClassLevel[]): SpellSlots {
  const casting = classes.filter((entry) => {
    const type = effectiveCasterType(entry);
    return type === 'full' || type === 'half' || type === 'third';
  });

  if (casting.length === 0) return [];

  // Classe única usa a tabela da própria classe (arredondando para cima);
  // multiclasse usa a tabela combinada (arredondando para baixo). Um paladino
  // 5 puro tem espaços de 2º nível; um paladino 5 / guerreiro 1 também, mas um
  // paladino 1 / clérigo 1 conjura como clérigo 1, não como conjurador 2.
  if (casting.length === 1) {
    const entry = casting[0]!;
    return slotsForCasterLevel(singleClassCasterLevel(effectiveCasterType(entry), entry.level));
  }

  return slotsForCasterLevel(multiclassCasterLevel(casting));
}

// ---------------------------------------------------------------------------
// Magia de Pacto (bruxo)
// ---------------------------------------------------------------------------

export interface PactMagic {
  /** Quantidade de espaços. */
  readonly slots: number;
  /** Todos os espaços saem no mesmo nível — este. */
  readonly slotLevel: number;
}

/**
 * O bruxo tem poucos espaços, todos no nível máximo que ele alcança, e os
 * recupera em **descanso curto**. Por isso são um pool à parte na ficha.
 */
export function pactMagic(warlockLevel: number): PactMagic | null {
  if (warlockLevel < 1) return null;
  const level = Math.min(warlockLevel, 20);

  const slots = level >= 17 ? 4 : level >= 11 ? 3 : level >= 2 ? 2 : 1;
  const slotLevel = level >= 9 ? 5 : level >= 7 ? 4 : level >= 5 ? 3 : level >= 3 ? 2 : 1;

  return { slots, slotLevel };
}

// ---------------------------------------------------------------------------
// CD, bônus de ataque e magias preparadas
// ---------------------------------------------------------------------------

export interface SpellcastingStats {
  readonly classId: ClassId;
  readonly ability: Ability;
  /** CD do teste de resistência contra suas magias. */
  readonly saveDc: number;
  readonly attackBonus: number;
  /** Quantas magias pode preparar, ou `null` se a classe conhece magias fixas. */
  readonly preparedCount: number | null;
}

export function spellcastingStats(
  entry: ClassLevel,
  scores: AbilityScores,
  proficiencyBonus: number,
): SpellcastingStats | null {
  const ability = effectiveSpellcastingAbility(entry);
  if (ability === null) return null;

  const modifier = abilityModifier(scores[ability]);
  return {
    classId: entry.classId,
    ability,
    saveDc: 8 + proficiencyBonus + modifier,
    attackBonus: proficiencyBonus + modifier,
    preparedCount: preparedSpellCount(entry, modifier),
  };
}

/**
 * Classes que *preparam* magias (clérigo, druida, paladino, mago) escolhem a
 * lista a cada descanso longo; as que *conhecem* (bardo, feiticeiro, bruxo,
 * patrulheiro) têm uma lista fixa por nível. O mínimo é sempre 1 — um clérigo
 * com Sabedoria 8 ainda prepara uma magia.
 */
function preparedSpellCount(entry: ClassLevel, abilityModifierValue: number): number | null {
  switch (entry.classId) {
    case 'cleric':
    case 'druid':
    case 'wizard':
      return Math.max(1, abilityModifierValue + entry.level);
    case 'paladin':
      return Math.max(1, abilityModifierValue + Math.floor(entry.level / 2));
    default:
      return null;
  }
}

/** O maior nível de magia que o personagem consegue conjurar hoje. */
export function highestSlotLevel(slots: SpellSlots): number {
  for (let level = slots.length; level >= 1; level -= 1) {
    if ((slots[level - 1] ?? 0) > 0) return level;
  }
  return 0;
}

/** Rótulo do nível de magia como aparece no livro: "Truque", "3º nível". */
export function spellLevelLabel(level: number): string {
  return level === 0 ? 'Truque' : `${level}º nível`;
}

export function isPactCaster(classes: readonly ClassLevel[]): boolean {
  return classes.some((entry) => CLASSES[entry.classId].casterType === 'pact');
}
