import { describe, expect, it } from 'vitest';
import {
  abilitiesAtOrAboveCap,
  abilityModifier,
  formatModifier,
  proficiencyContribution,
  SKILLS,
} from './abilities.js';
import { levelForXp, proficiencyBonus, xpToNextLevel } from './progression.js';
import { CLASS_IDS, hitDicePools, totalLevel } from './classes.js';
import { resolveClassFeatures, syncClassFeatures } from './classFeatures.js';
import { SUBCLASSES } from './subclasses.js';
import {
  multiclassCasterLevel,
  pactMagic,
  spellcastingStats,
  spellSlots,
  highestSlotLevel,
} from './spellcasting.js';
import {
  applyDamage,
  applyDeathSave,
  applyHealing,
  applyTemporaryHitPoints,
  armorClass,
  damageWhileDown,
  EMPTY_DEATH_SAVES,
  passiveScore,
  type ArmorProfile,
} from './combat.js';
import { expandConditions, exhaustionEffects } from './conditions.js';
import { carryingCapacity, encumbranceState, purseValueInGold, purseWeightKg } from './encumbrance.js';
import { deriveCharacter, suggestedMaxHitPoints } from './derived.js';
import { averageHitDieHealing, concentrationSaveDc, longRest, shortRest } from './rest.js';
import { createCharacter } from '../schema/character.js';
import { rollD20 } from '../dice/roll.js';
import { scriptedRng } from '../dice/rng.js';

const STANDARD_SCORES = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };

describe('abilityModifier', () => {
  it('segue a tabela do PHB', () => {
    const expected: Record<number, number> = {
      1: -5, 2: -4, 3: -4, 4: -3, 8: -1, 9: -1, 10: 0, 11: 0, 12: 1, 15: 2, 18: 4, 20: 5, 30: 10,
    };
    for (const [score, modifier] of Object.entries(expected)) {
      expect(abilityModifier(Number(score)), `valor ${score}`).toBe(modifier);
    }
  });

  it('arredonda para baixo também nos negativos', () => {
    // Math.trunc daria -1 aqui, e estaria errado.
    expect(abilityModifier(7)).toBe(-2);
    expect(abilityModifier(5)).toBe(-3);
  });
});

describe('abilitiesAtOrAboveCap', () => {
  it('não aponta nada dentro do array padrão', () => {
    expect(abilitiesAtOrAboveCap(STANDARD_SCORES)).toEqual([]);
  });

  it('aponta os atributos em 20 ou mais', () => {
    const scores = { ...STANDARD_SCORES, str: 20, con: 24 };
    expect(abilitiesAtOrAboveCap(scores)).toEqual(['str', 'con']);
  });

  it('aceita um teto customizado', () => {
    expect(abilitiesAtOrAboveCap(STANDARD_SCORES, 15)).toEqual(['str']);
  });
});

describe('formatModifier', () => {
  it('sempre mostra o sinal', () => {
    expect(formatModifier(3)).toBe('+3');
    expect(formatModifier(0)).toBe('+0');
    expect(formatModifier(-2)).toBe('−2');
  });
});

describe('proficiencyBonus', () => {
  it('sobe nos níveis 5, 9, 13 e 17', () => {
    const expected = [
      [1, 2], [4, 2], [5, 3], [8, 3], [9, 4], [12, 4], [13, 5], [16, 5], [17, 6], [20, 6],
    ] as const;
    for (const [level, bonus] of expected) {
      expect(proficiencyBonus(level), `nível ${level}`).toBe(bonus);
    }
  });

  it('trava nos limites em vez de extrapolar', () => {
    expect(proficiencyBonus(0)).toBe(2);
    expect(proficiencyBonus(99)).toBe(6);
  });
});

describe('proficiencyContribution', () => {
  it('dobra na especialização e reduz pela metade na proficiência parcial', () => {
    expect(proficiencyContribution(3, 'none')).toBe(0);
    expect(proficiencyContribution(3, 'half')).toBe(1); // arredonda para baixo
    expect(proficiencyContribution(3, 'proficient')).toBe(3);
    expect(proficiencyContribution(3, 'expertise')).toBe(6);
  });
});

describe('experiência', () => {
  it('converte XP em nível', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(299)).toBe(1);
    expect(levelForXp(300)).toBe(2);
    expect(levelForXp(48_000)).toBe(9);
    expect(levelForXp(999_999)).toBe(20);
  });

  it('calcula o que falta para o próximo nível', () => {
    expect(xpToNextLevel(0)).toBe(300);
    expect(xpToNextLevel(100)).toBe(200);
    expect(xpToNextLevel(355_000)).toBeNull();
  });
});

describe('espaços de magia — classe única', () => {
  it('bate com a tabela do mago (conjurador completo)', () => {
    expect(spellSlots([{ classId: 'wizard', level: 1 }])).toEqual([2]);
    expect(spellSlots([{ classId: 'wizard', level: 5 }])).toEqual([4, 3, 2]);
    expect(spellSlots([{ classId: 'wizard', level: 11 }])).toEqual([4, 3, 3, 3, 2, 1]);
    expect(spellSlots([{ classId: 'wizard', level: 20 }])).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
  });

  it('bate com a tabela impressa do paladino (meio-conjurador)', () => {
    // Estas linhas vêm do PHB; é o teste que valida a derivação por nível efetivo.
    const printed: Record<number, number[]> = {
      1: [], 2: [2], 3: [3], 4: [3], 5: [4, 2], 6: [4, 2], 7: [4, 3], 8: [4, 3],
      9: [4, 3, 2], 10: [4, 3, 2], 11: [4, 3, 3], 12: [4, 3, 3], 13: [4, 3, 3, 1],
      14: [4, 3, 3, 1], 15: [4, 3, 3, 2], 16: [4, 3, 3, 2], 17: [4, 3, 3, 3, 1],
      18: [4, 3, 3, 3, 1], 19: [4, 3, 3, 3, 2], 20: [4, 3, 3, 3, 2],
    };
    for (const [level, slots] of Object.entries(printed)) {
      expect(spellSlots([{ classId: 'paladin', level: Number(level) }]), `paladino ${level}`).toEqual(slots);
    }
  });

  it('bate com a tabela impressa do Cavaleiro Arcano (um terço)', () => {
    const printed: Record<number, number[]> = {
      1: [], 2: [], 3: [2], 4: [3], 6: [3], 7: [4, 2], 10: [4, 3], 13: [4, 3, 2],
      16: [4, 3, 3], 19: [4, 3, 3, 1], 20: [4, 3, 3, 1],
    };
    for (const [level, slots] of Object.entries(printed)) {
      const result = spellSlots([
        { classId: 'fighter', level: Number(level), subclassId: 'eldritch-knight' },
      ]);
      expect(result, `cavaleiro arcano ${level}`).toEqual(slots);
    }
  });

  it('guerreiro sem subclasse mágica não tem espaço nenhum', () => {
    expect(spellSlots([{ classId: 'fighter', level: 20 }])).toEqual([]);
    expect(spellSlots([{ classId: 'barbarian', level: 20 }])).toEqual([]);
  });
});

describe('espaços de magia — multiclasse', () => {
  it('arredonda para baixo, ao contrário da classe única', () => {
    // Sozinho, um paladino 5 conjura como conjurador 3 (metade arredondada
    // para cima) e tem espaços de 2º nível.
    expect(spellSlots([{ classId: 'paladin', level: 5 }])).toEqual([4, 2]);

    // Paladino 5 + patrulheiro 5 são dois meio-conjuradores. Cada um contribui
    // com floor(5/2) = 2, dando conjurador 4 — e não 6, que é o que sairia se
    // o arredondamento para cima da classe única fosse aplicado aqui.
    expect(
      spellSlots([
        { classId: 'paladin', level: 5 },
        { classId: 'ranger', level: 5 },
      ]),
    ).toEqual([4, 3]);
  });

  it('classe não-conjuradora não aciona a tabela de multiclasse', () => {
    // A regra de multiclasse do PHB só vale "se você tem mais de uma classe
    // conjuradora". Um guerreiro Campeão não é uma, então o paladino continua
    // usando a tabela dele — e mantém os espaços de 2º nível.
    expect(
      spellSlots([
        { classId: 'paladin', level: 5 },
        { classId: 'fighter', level: 1 },
      ]),
    ).toEqual([4, 2]);
  });

  it('soma níveis de conjurador completo integralmente', () => {
    expect(
      multiclassCasterLevel([
        { classId: 'wizard', level: 3 },
        { classId: 'cleric', level: 2 },
      ]),
    ).toBe(5);
  });

  it('mistura completo, metade e um terço', () => {
    // Mago 4 + paladino 3 (→1) + guerreiro/CA 6 (→2) = conjurador 7
    expect(
      multiclassCasterLevel([
        { classId: 'wizard', level: 4 },
        { classId: 'paladin', level: 3 },
        { classId: 'fighter', level: 6, subclassId: 'eldritch-knight' },
      ]),
    ).toBe(7);
  });

  it('bruxo não entra na conta dos espaços normais', () => {
    expect(
      multiclassCasterLevel([
        { classId: 'warlock', level: 5 },
        { classId: 'wizard', level: 2 },
      ]),
    ).toBe(2);
  });
});

describe('Magia de Pacto', () => {
  it('segue a tabela do bruxo', () => {
    expect(pactMagic(1)).toEqual({ slots: 1, slotLevel: 1 });
    expect(pactMagic(2)).toEqual({ slots: 2, slotLevel: 1 });
    expect(pactMagic(5)).toEqual({ slots: 2, slotLevel: 3 });
    expect(pactMagic(11)).toEqual({ slots: 3, slotLevel: 5 });
    expect(pactMagic(17)).toEqual({ slots: 4, slotLevel: 5 });
    expect(pactMagic(20)).toEqual({ slots: 4, slotLevel: 5 });
  });
});

describe('spellcastingStats', () => {
  it('calcula CD e bônus de ataque', () => {
    const stats = spellcastingStats(
      { classId: 'wizard', level: 5 },
      { ...STANDARD_SCORES, int: 18 },
      3,
    );
    expect(stats).toMatchObject({ ability: 'int', saveDc: 15, attackBonus: 7 });
  });

  it('conta magias preparadas para quem prepara e devolve null para quem conhece', () => {
    const wizard = spellcastingStats({ classId: 'wizard', level: 5 }, { ...STANDARD_SCORES, int: 18 }, 3);
    expect(wizard?.preparedCount).toBe(9); // +4 de INT + 5 níveis

    const paladin = spellcastingStats({ classId: 'paladin', level: 5 }, { ...STANDARD_SCORES, cha: 16 }, 3);
    expect(paladin?.preparedCount).toBe(5); // +3 de CAR + metade de 5

    const bard = spellcastingStats({ classId: 'bard', level: 5 }, STANDARD_SCORES, 3);
    expect(bard?.preparedCount).toBeNull();
  });

  it('prepara no mínimo uma magia mesmo com habilidade péssima', () => {
    const stats = spellcastingStats({ classId: 'cleric', level: 1 }, { ...STANDARD_SCORES, wis: 6 }, 2);
    expect(stats?.preparedCount).toBe(1);
  });
});

describe('highestSlotLevel', () => {
  it('acha o maior nível com espaço disponível', () => {
    expect(highestSlotLevel([4, 3, 2])).toBe(3);
    expect(highestSlotLevel([4, 3, 0])).toBe(2);
    expect(highestSlotLevel([])).toBe(0);
  });
});

describe('armorClass', () => {
  const chainMail: ArmorProfile = {
    id: 'chain-mail', label: 'Cota de Malha', category: 'heavy', baseAc: 16,
    stealthDisadvantage: true, strengthRequirement: 13,
  };
  const leather: ArmorProfile = {
    id: 'leather', label: 'Couro', category: 'light', baseAc: 11, stealthDisadvantage: false,
  };
  const halfPlate: ArmorProfile = {
    id: 'half-plate', label: 'Meia Armadura', category: 'medium', baseAc: 15, stealthDisadvantage: true,
  };

  it('sem armadura é 10 + Destreza', () => {
    expect(armorClass({ scores: STANDARD_SCORES }).total).toBe(12);
  });

  it('armadura pesada ignora a Destreza inteira', () => {
    const scores = { ...STANDARD_SCORES, dex: 18 };
    expect(armorClass({ scores, armor: chainMail }).total).toBe(16);
  });

  it('armadura leve soma a Destreza sem teto', () => {
    const scores = { ...STANDARD_SCORES, dex: 20 };
    expect(armorClass({ scores, armor: leather }).total).toBe(16);
  });

  it('armadura média limita a Destreza a +2', () => {
    const scores = { ...STANDARD_SCORES, dex: 20 };
    expect(armorClass({ scores, armor: halfPlate }).total).toBe(17);
  });

  it('escudo soma 2', () => {
    expect(armorClass({ scores: STANDARD_SCORES, armor: leather, shield: true }).total).toBe(15);
  });

  it('Defesa sem Armadura do bárbaro soma Constituição', () => {
    const scores = { str: 16, dex: 16, con: 16, int: 8, wis: 12, cha: 10 };
    expect(armorClass({ scores, unarmoredDefense: { kind: 'barbarian' } }).total).toBe(16);
  });

  it('Defesa sem Armadura do monge não vale com escudo', () => {
    const scores = { str: 12, dex: 16, con: 14, int: 10, wis: 16, cha: 8 };
    expect(armorClass({ scores, unarmoredDefense: { kind: 'monk' } }).total).toBe(16);
    // Com escudo cai para 10 + DES + 2, sem o bônus de Sabedoria.
    expect(armorClass({ scores, unarmoredDefense: { kind: 'monk' }, shield: true }).total).toBe(15);
  });

  it('explica de onde veio cada ponto', () => {
    const result = armorClass({ scores: STANDARD_SCORES, armor: leather, shield: true });
    expect(result.breakdown.map((part) => part.source)).toEqual(['Couro', 'Destreza', 'Escudo']);
  });
});

describe('passiveScore', () => {
  it('é 10 + modificador', () => {
    expect(passiveScore(3)).toBe(13);
  });

  it('vantagem e desvantagem valem ±5 e se anulam', () => {
    expect(passiveScore(3, { advantage: true })).toBe(18);
    expect(passiveScore(3, { disadvantage: true })).toBe(8);
    expect(passiveScore(3, { advantage: true, disadvantage: true })).toBe(13);
  });
});

describe('pontos de vida', () => {
  const hp = { current: 20, max: 30, temporary: 0 };

  it('subtrai dano', () => {
    expect(applyDamage(hp, 7).hitPoints.current).toBe(13);
  });

  it('gasta os PV temporários primeiro', () => {
    const withTemp = applyTemporaryHitPoints(hp, 5);
    const result = applyDamage(withTemp, 8);
    expect(result.absorbed).toBe(5);
    expect(result.hitPoints.temporary).toBe(0);
    expect(result.hitPoints.current).toBe(17);
  });

  it('PV temporários não acumulam — fica o maior', () => {
    const first = applyTemporaryHitPoints(hp, 8);
    expect(applyTemporaryHitPoints(first, 5).temporary).toBe(8);
    expect(applyTemporaryHitPoints(first, 12).temporary).toBe(12);
  });

  it('não passa de zero e sinaliza a queda', () => {
    const result = applyDamage(hp, 25);
    expect(result.hitPoints.current).toBe(0);
    expect(result.downed).toBe(true);
    expect(result.instantDeath).toBe(false);
  });

  it('mata na hora quando o excedente atinge o PV máximo', () => {
    // 20 atuais + 30 de máximo: precisa de 50 para morte instantânea.
    expect(applyDamage(hp, 49).instantDeath).toBe(false);
    expect(applyDamage(hp, 50).instantDeath).toBe(true);
  });

  it('cura não passa do máximo', () => {
    expect(applyHealing(hp, 100).current).toBe(30);
  });
});

describe('testes contra a morte', () => {
  it('10 ou mais é sucesso, menos é falha', () => {
    const success = applyDeathSave(EMPTY_DEATH_SAVES, rollD20({ rng: scriptedRng([10]) }));
    expect(success.saves.successes).toBe(1);
    const failure = applyDeathSave(EMPTY_DEATH_SAVES, rollD20({ rng: scriptedRng([9]) }));
    expect(failure.saves.failures).toBe(1);
  });

  it('20 natural volta consciente e zera o placar', () => {
    const result = applyDeathSave({ successes: 1, failures: 2 }, rollD20({ rng: scriptedRng([20]) }));
    expect(result.outcome).toBe('revived');
    expect(result.saves).toEqual(EMPTY_DEATH_SAVES);
  });

  it('1 natural conta como duas falhas', () => {
    const result = applyDeathSave(EMPTY_DEATH_SAVES, rollD20({ rng: scriptedRng([1]) }));
    expect(result.saves.failures).toBe(2);
    expect(result.outcome).toBe('ongoing');
  });

  it('três falhas matam e três sucessos estabilizam', () => {
    expect(applyDeathSave({ successes: 0, failures: 2 }, rollD20({ rng: scriptedRng([5]) })).outcome).toBe('dead');
    expect(applyDeathSave({ successes: 2, failures: 0 }, rollD20({ rng: scriptedRng([15]) })).outcome).toBe('stable');
  });

  it('dano com 0 PV causa falha automática, duas se for crítico', () => {
    expect(damageWhileDown(EMPTY_DEATH_SAVES, false).saves.failures).toBe(1);
    expect(damageWhileDown(EMPTY_DEATH_SAVES, true).saves.failures).toBe(2);
    expect(damageWhileDown({ successes: 0, failures: 2 }, false).outcome).toBe('dead');
  });
});

describe('condições', () => {
  it('expande as condições implicadas', () => {
    const active = expandConditions(['unconscious']);
    expect([...active].sort()).toEqual(['incapacitated', 'prone', 'unconscious']);
  });

  it('não entra em laço com condições já presentes', () => {
    expect(expandConditions(['paralyzed', 'incapacitated']).size).toBe(2);
  });

  it('acumula os efeitos de exaustão', () => {
    expect(exhaustionEffects(0)).toEqual([]);
    expect(exhaustionEffects(3)).toHaveLength(3);
    expect(exhaustionEffects(6)).toHaveLength(6);
    expect(exhaustionEffects(99)).toHaveLength(6);
  });
});

describe('carga e moedas', () => {
  it('capacidade é 7,5 kg por ponto de Força', () => {
    const capacity = carryingCapacity({ ...STANDARD_SCORES, str: 16 });
    expect(capacity.capacityKg).toBe(120);
    expect(capacity.pushDragLiftKg).toBe(240);
  });

  it('a regra padrão só distingue dentro e fora da capacidade', () => {
    const scores = { ...STANDARD_SCORES, str: 10 };
    expect(encumbranceState(scores, 40).level).toBe('unencumbered');
    expect(encumbranceState(scores, 80).level).toBe('overloaded');
  });

  it('a variante de sobrecarga acrescenta faixas com penalidade', () => {
    const scores = { ...STANDARD_SCORES, str: 10 };
    expect(encumbranceState(scores, 20, { useVariant: true }).level).toBe('unencumbered');
    expect(encumbranceState(scores, 30, { useVariant: true }).level).toBe('encumbered');
    expect(encumbranceState(scores, 60, { useVariant: true })).toMatchObject({
      level: 'heavily-encumbered',
      speedPenaltyMeters: -6,
    });
  });

  it('converte a bolsa para ouro e calcula o peso', () => {
    expect(purseValueInGold({ cp: 0, sp: 50, ep: 0, gp: 10, pp: 1 })).toBe(25);
    expect(purseWeightKg({ cp: 100, sp: 0, ep: 0, gp: 0, pp: 0 })).toBe(1);
  });
});

describe('deriveCharacter', () => {
  const character = createCharacter({
    id: 'test-1',
    name: 'Bruenor',
    classes: [{ classId: 'fighter', level: 5 }],
    abilities: { str: 16, dex: 12, con: 16, int: 10, wis: 13, cha: 8 },
    savingThrows: { str: 'proficient', con: 'proficient' },
    skills: { athletics: 'proficient', perception: 'expertise' },
    hitPoints: { current: 44, max: 44, temporary: 0 },
    attacks: [
      { id: 'a1', label: 'Machado de Batalha', ability: 'str', proficient: true, damageDice: '1d8', damageType: 'cortante' },
    ],
  });

  const derived = deriveCharacter(character);

  it('calcula nível e bônus de proficiência', () => {
    expect(derived.totalLevel).toBe(5);
    expect(derived.proficiencyBonus).toBe(3);
  });

  it('aplica proficiência nas resistências certas', () => {
    const str = derived.savingThrows.find((save) => save.ability === 'str')!;
    const dex = derived.savingThrows.find((save) => save.ability === 'dex')!;
    expect(str.modifier).toBe(6); // +3 de FOR + 3 de proficiência
    expect(dex.modifier).toBe(1); // só o modificador
  });

  it('dobra o bônus na especialização', () => {
    const perception = derived.skills.find((skill) => skill.skill === 'perception')!;
    expect(perception.modifier).toBe(7); // +1 de SAB + 6 de especialização
    expect(derived.passivePerception).toBe(17);
  });

  it('lista as 18 perícias', () => {
    expect(derived.skills).toHaveLength(SKILLS.length);
  });

  it('monta a notação de dano com o modificador', () => {
    const attack = derived.attacks[0]!;
    expect(attack.attackBonus).toBe(6); // +3 de FOR + 3 de proficiência
    expect(attack.damageNotation).toBe('1d8+3'); // dano não leva proficiência
  });

  it('agrupa os dados de vida por faces', () => {
    expect(derived.hitDice).toEqual([{ die: 10, total: 5, spent: 0, available: 5 }]);
  });

  it('separa os pools de dados de vida em multiclasse', () => {
    const multi = createCharacter({
      id: 'test-2',
      classes: [{ classId: 'fighter', level: 5 }, { classId: 'wizard', level: 3 }],
      abilities: STANDARD_SCORES,
    });
    expect(deriveCharacter(multi).hitDice).toEqual([
      { die: 10, total: 5, spent: 0, available: 5 },
      { die: 6, total: 3, spent: 0, available: 3 },
    ]);
  });
});

describe('suggestedMaxHitPoints', () => {
  it('dá o dado cheio no 1º nível e a média depois', () => {
    // Guerreiro 1 com CON 16: 10 + 3 = 13
    expect(suggestedMaxHitPoints([{ classId: 'fighter', level: 1 }], 16)).toBe(13);
    // Guerreiro 5: 13 + 4 × (6 + 3) = 49
    expect(suggestedMaxHitPoints([{ classId: 'fighter', level: 5 }], 16)).toBe(49);
  });

  it('conta o dado cheio só da primeira classe', () => {
    // Guerreiro 1 (10+3) + mago 1 (4+3) = 20
    expect(
      suggestedMaxHitPoints([{ classId: 'fighter', level: 1 }, { classId: 'wizard', level: 1 }], 16),
    ).toBe(20);
  });

  it('garante ao menos 1 PV por nível com Constituição terrível', () => {
    expect(suggestedMaxHitPoints([{ classId: 'wizard', level: 5 }], 3)).toBe(5);
  });
});

describe('descansos', () => {
  const base = createCharacter({
    id: 'rest-1',
    classes: [{ classId: 'warlock', level: 6 }],
    abilities: STANDARD_SCORES,
    hitPoints: { current: 10, max: 40, temporary: 4 },
    hitDiceSpent: { '8': 4 },
    exhaustion: 2,
    spellcasting: { slotsUsed: [2, 1, 0, 0, 0, 0, 0, 0, 0], pactSlotsUsed: 2, spells: [], concentratingOn: 'fireball' },
    features: [
      { id: 'f1', label: 'Recuperação Arcana', source: 'Bruxo', description: '', resource: { id: 'r1', label: 'Usos', max: 1, spent: 1, recharge: 'short' } },
      { id: 'f2', label: 'Selo Diabólico', source: 'Bruxo', description: '', resource: { id: 'r2', label: 'Usos', max: 1, spent: 1, recharge: 'long' } },
    ],
  });

  it('descanso curto devolve a Magia de Pacto e os recursos de descanso curto', () => {
    const { character } = shortRest(base);
    expect(character.spellcasting.pactSlotsUsed).toBe(0);
    expect(character.features[0]!.resource!.spent).toBe(0);
    // Recurso de descanso longo continua gasto.
    expect(character.features[1]!.resource!.spent).toBe(1);
    // Espaços normais não voltam no descanso curto.
    expect(character.spellcasting.slotsUsed[0]).toBe(2);
  });

  it('descanso curto gasta dados de vida e cura', () => {
    const { character } = shortRest(base, { hitDiceSpent: { 8: 2 }, healed: 12 });
    expect(character.hitDiceSpent['8']).toBe(6);
    expect(character.hitPoints.current).toBe(22);
  });

  it('descanso curto não gasta mais dados do que existem', () => {
    // Bruxo 6 tem 6d8, dos quais 4 já foram gastos: sobram 2.
    const { character } = shortRest(base, { hitDiceSpent: { 8: 10 } });
    expect(character.hitDiceSpent['8']).toBe(6);
  });

  it('descanso longo restaura PV, espaços e tira um nível de exaustão', () => {
    const { character } = longRest(base);
    expect(character.hitPoints.current).toBe(40);
    expect(character.hitPoints.temporary).toBe(0);
    expect(character.spellcasting.slotsUsed).toEqual(new Array(9).fill(0));
    expect(character.spellcasting.concentratingOn).toBeNull();
    expect(character.exhaustion).toBe(1);
    expect(character.features.every((feature) => feature.resource?.spent === 0)).toBe(true);
  });

  it('descanso longo devolve metade dos dados de vida, não todos', () => {
    // 6d8 no total → devolve 3. Estavam 4 gastos, sobram 1.
    const { character } = longRest(base);
    expect(character.hitDiceSpent['8']).toBe(1);
  });

  it('descanso longo devolve ao menos um dado de vida', () => {
    const level1 = createCharacter({
      id: 'rest-2',
      classes: [{ classId: 'wizard', level: 1 }],
      abilities: STANDARD_SCORES,
      hitDiceSpent: { '6': 1 },
    });
    expect(longRest(level1).character.hitDiceSpent['6']).toBe(0);
  });
});

describe('utilidades de descanso', () => {
  it('média de cura de um dado de vida', () => {
    expect(averageHitDieHealing(10, 16)).toBe(9); // 6 de média + 3 de CON
    expect(averageHitDieHealing(6, 6)).toBe(2); // 4 de média − 2, mínimo respeitado
  });

  it('CD de concentração é 10 ou metade do dano', () => {
    expect(concentrationSaveDc(10)).toBe(10);
    expect(concentrationSaveDc(19)).toBe(10);
    expect(concentrationSaveDc(30)).toBe(15);
  });
});

describe('classes', () => {
  it('soma os níveis das classes', () => {
    expect(totalLevel([{ classId: 'fighter', level: 5 }, { classId: 'wizard', level: 3 }])).toBe(8);
  });

  it('agrupa dados de vida iguais no mesmo pool', () => {
    const pools = hitDicePools([
      { classId: 'cleric', level: 2 },
      { classId: 'rogue', level: 3 },
    ]);
    expect(pools.get(8)).toBe(5);
  });
});

describe('classFeatures', () => {
  it('bardo 5 tem Inspiração de Bardo com recarga curta e usos = mod. de CAR', () => {
    const features = resolveClassFeatures({
      classes: [{ classId: 'bard', level: 5 }],
      abilities: { ...STANDARD_SCORES, cha: 16 },
    });
    const inspiration = features.find((f) => f.id === 'class:bard:bardic-inspiration')!;
    expect(inspiration.resource).toEqual({
      id: 'class:bard:bardic-inspiration',
      label: 'Inspiração de Bardo',
      max: 3,
      spent: 0,
      recharge: 'short', // Fonte de Inspiração já valeu no nível 5.
    });
  });

  it('guerreiro 1 tem Segundo Fôlego mas ainda não tem Surto de Ação', () => {
    const features = resolveClassFeatures({
      classes: [{ classId: 'fighter', level: 1 }],
      abilities: STANDARD_SCORES,
    });
    expect(features.some((f) => f.id === 'class:fighter:second-wind')).toBe(true);
    expect(features.some((f) => f.id === 'class:fighter:action-surge')).toBe(false);
  });

  it('multiclasse guerreiro 4 / mago 4 ganha duas Melhorias de Atributo', () => {
    const features = resolveClassFeatures({
      classes: [{ classId: 'fighter', level: 4 }, { classId: 'wizard', level: 4 }],
      abilities: STANDARD_SCORES,
    });
    expect(features.some((f) => f.id === 'class:fighter:asi:4')).toBe(true);
    expect(features.some((f) => f.id === 'class:wizard:asi:4')).toBe(true);
  });

  it('syncClassFeatures preserva usos gastos e limita ao novo máximo', () => {
    const character = createCharacter({
      id: 'sync-1',
      classes: [{ classId: 'fighter', level: 9 }], // Indomável, 1 uso
      abilities: STANDARD_SCORES,
      features: [
        {
          id: 'class:fighter:indomitable',
          label: 'Indomável',
          source: 'Guerreiro',
          description: '',
          resource: { id: 'class:fighter:indomitable', label: 'Indomável', max: 5, spent: 5, recharge: 'long' },
        },
      ],
    });

    const synced = syncClassFeatures(character);
    const indomitable = synced.features.find((f) => f.id === 'class:fighter:indomitable')!;
    // O nível 9 só dá 1 uso — o "spent: 5" fabricado no fixture é limitado ao novo máximo.
    expect(indomitable.resource).toMatchObject({ max: 1, spent: 1 });
  });

  it('syncClassFeatures remove características da classe removida e preserva as caseiras', () => {
    const character = createCharacter({
      id: 'sync-2',
      classes: [{ classId: 'fighter', level: 4 }, { classId: 'wizard', level: 2 }],
      abilities: STANDARD_SCORES,
      features: [{ id: 'homebrew:dark-vision', label: 'Visão no Escuro (dádiva)', source: 'Casa', description: '' }],
    });

    const withFighter = syncClassFeatures(character);
    expect(withFighter.features.some((f) => f.id.startsWith('class:fighter:'))).toBe(true);

    const withoutFighter = syncClassFeatures({
      ...withFighter,
      classes: withFighter.classes.filter((entry) => entry.classId !== 'fighter'),
    });

    expect(withoutFighter.features.some((f) => f.id.startsWith('class:fighter:'))).toBe(false);
    expect(withoutFighter.features.some((f) => f.id === 'homebrew:dark-vision')).toBe(true);
  });

  it('syncClassFeatures é idempotente — sem mudança de classe, devolve a mesma referência', () => {
    const character = createCharacter({
      id: 'sync-3',
      classes: [{ classId: 'bard', level: 5 }],
      abilities: STANDARD_SCORES,
    });

    const once = syncClassFeatures(character);
    const twice = syncClassFeatures(once);
    expect(twice).toBe(once);
  });

  it('trocar de trilha troca as características da subclasse sem quebrar', () => {
    const character = createCharacter({
      id: 'sync-4',
      classes: [{ classId: 'bard', level: 6, subclassId: 'lore' }],
      abilities: STANDARD_SCORES,
    });

    const withLore = syncClassFeatures(character);
    expect(withLore.features.some((f) => f.id === 'class:bard:lore-bonus-proficiencies')).toBe(true);

    const withoutSubclass = syncClassFeatures({
      ...withLore,
      classes: [{ classId: 'bard', level: 6 }],
    });

    expect(withoutSubclass.features.some((f) => f.id === 'class:bard:lore-bonus-proficiencies')).toBe(false);
    // Características da classe base (sem subclasse) continuam.
    expect(withoutSubclass.features.some((f) => f.id === 'class:bard:bardic-inspiration')).toBe(true);
  });

  it('todas as 12 classes têm conteúdo de características além da Melhoria de Atributo', () => {
    for (const classId of CLASS_IDS) {
      const subclassId = SUBCLASSES[classId][0]?.id;
      const features = resolveClassFeatures({
        classes: [{ classId, level: 20, subclassId }],
        abilities: STANDARD_SCORES,
      });
      const beyondAsi = features.filter((f) => !f.id.includes(':asi:'));
      expect(beyondAsi.length, `${classId} não tem características cadastradas`).toBeGreaterThan(0);
    }
  });
});
