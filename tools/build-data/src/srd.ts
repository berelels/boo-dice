import { indexByKey, type SrdData } from './fetch.js';
import { joinParagraphs, type CatalogEntryInput, type CatalogKind } from './catalog.js';

/**
 * Converte os JSONs do SRD nos registros do catálogo.
 *
 * Duas coisas acontecem em cada normalizador:
 *  1. o texto vira `title`/`subtitle`/`body`, que é o que o FTS indexa;
 *  2. os números viram `data`, que é o que a ficha e o mestre consomem.
 *
 * Onde existe tradução oficial (`pt-BR/`), ela sobrescreve `title` e `body` e o
 * registro fica marcado `lang: 'pt'`. Onde não existe, o registro entra em
 * inglês marcado `lang: 'en'` — a UI mostra um selo, e o import do livro do
 * usuário depois cobre a lacuna com o português dele.
 */

type Json = Record<string, unknown>;

const SCHOOL_PT: Record<string, string> = {
  abjuration: 'Abjuração',
  conjuration: 'Conjuração',
  divination: 'Adivinhação',
  enchantment: 'Encantamento',
  evocation: 'Evocação',
  illusion: 'Ilusão',
  necromancy: 'Necromancia',
  transmutation: 'Transmutação',
};

const SIZE_PT: Record<string, string> = {
  Tiny: 'Minúsculo',
  Small: 'Pequeno',
  Medium: 'Médio',
  Large: 'Grande',
  Huge: 'Enorme',
  Gargantuan: 'Imenso',
};

export function ordinalPt(level: number): string {
  return level === 0 ? 'Truque' : `${level}º nível`;
}

/** Nome da entrada: usa a tradução quando existe. */
function localized(en: Json, pt: Json | undefined): { title: string; body: string; lang: 'pt' | 'en' } {
  if (pt) {
    return {
      title: String(pt.name ?? en.name ?? ''),
      body: joinParagraphs(pt.desc ?? en.desc),
      lang: 'pt',
    };
  }
  return { title: String(en.name ?? ''), body: joinParagraphs(en.desc), lang: 'en' };
}

// ---------------------------------------------------------------------------

export function buildSrdEntries(data: SrdData): CatalogEntryInput[] {
  const entries: CatalogEntryInput[] = [];

  entries.push(...spells(data));
  entries.push(...monsters(data));
  entries.push(...equipment(data));
  entries.push(...magicItems(data));
  entries.push(...simpleKind(data, 'Conditions', 'condition', 'Condição'));
  entries.push(...simpleKind(data, 'Races', 'race', 'Raça'));
  entries.push(...simpleKind(data, 'Backgrounds', 'background', 'Antecedente'));
  entries.push(...simpleKind(data, 'Feats', 'feat', 'Talento'));
  entries.push(...simpleKind(data, 'Rules', 'rule', 'Regra'));
  entries.push(...ruleSections(data));
  entries.push(...features(data));

  return entries;
}

function spells(data: SrdData): CatalogEntryInput[] {
  const list = (data.en.get('Spells') ?? []) as Json[];

  return list.map((spell) => {
    const level = Number(spell.level ?? 0);
    const school = (spell.school as Json | undefined)?.index as string | undefined;
    const schoolPt = school ? (SCHOOL_PT[school] ?? school) : '';
    const ritual = spell.ritual === true;

    const parts = [ordinalPt(level), schoolPt].filter(Boolean).join(' — ');
    const subtitle = ritual ? `${parts} (ritual)` : parts;

    const body = [
      joinParagraphs(spell.desc),
      spell.higher_level ? `Em Níveis Superiores. ${joinParagraphs(spell.higher_level)}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    return {
      id: `srd:spell:${spell.index}`,
      kind: 'spell' as const,
      title: String(spell.name),
      subtitle,
      body,
      section: 'Magias',
      lang: 'en' as const,
      data: {
        srdIndex: spell.index,
        level,
        school,
        ritual,
        concentration: spell.concentration === true,
        castingTime: spell.casting_time,
        range: spell.range,
        components: spell.components,
        material: spell.material ?? null,
        duration: spell.duration,
        damage: spell.damage ?? null,
        dc: spell.dc ?? null,
        attackType: spell.attack_type ?? null,
        classes: ((spell.classes as Json[] | undefined) ?? []).map((entry) => entry.index),
      },
    };
  });
}

function monsters(data: SrdData): CatalogEntryInput[] {
  const list = (data.en.get('Monsters') ?? []) as Json[];

  return list.map((monster) => {
    const cr = monster.challenge_rating as number;
    const size = SIZE_PT[String(monster.size)] ?? String(monster.size);
    const ac = ((monster.armor_class as Json[] | undefined) ?? [])[0]?.value ?? 10;

    const abilities = ((monster.special_abilities as Json[] | undefined) ?? [])
      .map((ability) => `${ability.name}. ${ability.desc}`)
      .join('\n\n');
    const actions = ((monster.actions as Json[] | undefined) ?? [])
      .map((action) => `${action.name}. ${action.desc}`)
      .join('\n\n');

    return {
      id: `srd:monster:${monster.index}`,
      kind: 'monster' as const,
      title: String(monster.name),
      subtitle: `${size} ${monster.type} — ND ${formatChallenge(cr)}`,
      body: [abilities, actions].filter(Boolean).join('\n\n'),
      section: 'Bestiário',
      lang: 'en' as const,
      data: {
        srdIndex: monster.index,
        size: monster.size,
        type: monster.type,
        alignment: monster.alignment,
        armorClass: ac,
        hitPoints: monster.hit_points,
        hitDice: monster.hit_dice,
        speed: monster.speed,
        abilities: {
          str: monster.strength,
          dex: monster.dexterity,
          con: monster.constitution,
          int: monster.intelligence,
          wis: monster.wisdom,
          cha: monster.charisma,
        },
        challengeRating: cr,
        xp: monster.xp,
        proficiencyBonus: monster.proficiency_bonus,
        senses: monster.senses,
        languages: monster.languages,
        damageResistances: monster.damage_resistances,
        damageImmunities: monster.damage_immunities,
        damageVulnerabilities: monster.damage_vulnerabilities,
        conditionImmunities: ((monster.condition_immunities as Json[] | undefined) ?? []).map(
          (entry) => entry.index,
        ),
        proficiencies: monster.proficiencies,
        specialAbilities: monster.special_abilities ?? [],
        actions: monster.actions ?? [],
        legendaryActions: monster.legendary_actions ?? [],
      },
    };
  });
}

/** ND fracionário aparece como 1/8, 1/4, 1/2 — e não como 0.125. */
export function formatChallenge(cr: number): string {
  if (cr === 0.125) return '1/8';
  if (cr === 0.25) return '1/4';
  if (cr === 0.5) return '1/2';
  return String(cr);
}

function equipment(data: SrdData): CatalogEntryInput[] {
  const list = (data.en.get('Equipment') ?? []) as Json[];

  return list.map((item) => {
    const category = (item.equipment_category as Json | undefined)?.index as string | undefined;
    const cost = item.cost as Json | undefined;
    const costLabel = cost ? `${cost.quantity} ${String(cost.unit).toUpperCase()}` : '';
    const weight = typeof item.weight === 'number' ? `${poundsToKg(item.weight)} kg` : '';

    const damage = item.damage as Json | undefined;
    const armorClass = item.armor_class as Json | undefined;

    const descriptors: string[] = [];
    if (damage) {
      descriptors.push(
        `${damage.damage_dice} de dano ${String((damage.damage_type as Json | undefined)?.name ?? '')}`.trim(),
      );
    }
    if (armorClass) {
      descriptors.push(`CA ${armorClass.base}${armorClass.dex_bonus ? ' + Des' : ''}`);
    }

    return {
      id: `srd:equipment:${item.index}`,
      kind: 'equipment' as const,
      title: String(item.name),
      subtitle: [costLabel, weight, ...descriptors].filter(Boolean).join(' · '),
      body: joinParagraphs(item.desc ?? item.special),
      section: 'Equipamento',
      lang: 'en' as const,
      data: {
        srdIndex: item.index,
        category,
        weaponCategory: item.weapon_category ?? null,
        weaponRange: item.weapon_range ?? null,
        armorCategory: item.armor_category ?? null,
        armorClass: armorClass ?? null,
        strMinimum: item.str_minimum ?? null,
        stealthDisadvantage: item.stealth_disadvantage ?? false,
        damage: damage ?? null,
        twoHandedDamage: item.two_handed_damage ?? null,
        range: item.range ?? null,
        properties: ((item.properties as Json[] | undefined) ?? []).map((entry) => entry.index),
        cost: cost ?? null,
        weightKg: typeof item.weight === 'number' ? poundsToKg(item.weight) : null,
      },
    };
  });
}

/** O SRD está em libras; o livro brasileiro, em quilos. Convertemos na carga. */
export function poundsToKg(pounds: number): number {
  return Math.round(pounds * 0.45359237 * 100) / 100;
}

function magicItems(data: SrdData): CatalogEntryInput[] {
  const list = (data.en.get('Magic-Items') ?? []) as Json[];

  return list.map((item) => ({
    id: `srd:magic-item:${item.index}`,
    kind: 'magic-item' as const,
    title: String(item.name),
    subtitle: String((item.equipment_category as Json | undefined)?.name ?? 'Item mágico'),
    body: joinParagraphs(item.desc),
    section: 'Itens mágicos',
    lang: 'en' as const,
    data: { srdIndex: item.index, rarity: item.rarity ?? null, variants: item.variants ?? [] },
  }));
}

/**
 * Tipos cujo formato é sempre `{ index, name, desc }` — a maioria dos arquivos
 * pequenos, e justamente os que têm tradução oficial.
 */
function simpleKind(
  data: SrdData,
  file: string,
  kind: CatalogKind,
  sectionLabel: string,
): CatalogEntryInput[] {
  const list = (data.en.get(file) ?? []) as Json[];
  const translations = indexByKey(data.pt.get(file) ?? []);

  return list.map((record) => {
    const pt = translations.get(String(record.index));
    const { title, body, lang } = localized(record, pt);

    return {
      id: `srd:${kind}:${record.index}`,
      kind,
      title,
      subtitle: sectionLabel,
      body,
      section: sectionLabel,
      lang,
      data: { srdIndex: record.index, ...extractStructured(kind, record) },
    };
  });
}

function extractStructured(kind: CatalogKind, record: Json): Json {
  if (kind === 'race') {
    return {
      speed: record.speed,
      abilityBonuses: record.ability_bonuses,
      size: record.size,
      languages: record.languages,
      traits: record.traits,
      subraces: record.subraces,
    };
  }
  if (kind === 'background') {
    return {
      startingProficiencies: record.starting_proficiencies,
      startingEquipment: record.starting_equipment,
      feature: record.feature,
    };
  }
  return {};
}

function ruleSections(data: SrdData): CatalogEntryInput[] {
  const list = (data.en.get('Rule-Sections') ?? []) as Json[];

  return list.map((section) => ({
    id: `srd:rule:${section.index}`,
    kind: 'rule' as const,
    title: String(section.name),
    subtitle: 'Regra',
    body: joinParagraphs(section.desc),
    section: 'Regras',
    lang: 'en' as const,
    data: { srdIndex: section.index },
  }));
}

function features(data: SrdData): CatalogEntryInput[] {
  const list = (data.en.get('Features') ?? []) as Json[];

  return list.map((feature) => {
    const className = (feature.class as Json | undefined)?.name;
    const subclassName = (feature.subclass as Json | undefined)?.name;
    const level = feature.level;

    return {
      id: `srd:feature:${feature.index}`,
      kind: 'feature' as const,
      title: String(feature.name),
      subtitle: [className, subclassName, level ? `nível ${level}` : '']
        .filter(Boolean)
        .join(' — '),
      body: joinParagraphs(feature.desc),
      section: 'Características',
      lang: 'en' as const,
      data: {
        srdIndex: feature.index,
        classIndex: (feature.class as Json | undefined)?.index ?? null,
        subclassIndex: (feature.subclass as Json | undefined)?.index ?? null,
        level: level ?? null,
      },
    };
  });
}
