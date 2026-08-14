import type { ParsedSpell } from './book.js';

/**
 * Liga as magias em português do livro do usuário às magias do SRD em inglês.
 *
 * Por que isso importa: o SRD traz os números (dano por nível de espaço, tipo
 * de dano, listas de classe) que a ficha precisa, mas só em inglês. O livro
 * traz o texto em português, mas sem estrutura. Casando os dois, o glossário
 * mostra a magia em português *e* a ficha sabe que "Bola de Fogo" é `fireball`.
 *
 * Não existe campo em comum entre as duas fontes — só dá para casar pelas
 * características mecânicas, que são idênticas nas duas línguas. A combinação
 * de nível, escola, componentes, concentração, ritual e alcance é bem mais
 * discriminante do que parece: quase toda magia tem uma assinatura única.
 */

/**
 * Casamentos curados, aplicados antes de qualquer heurística.
 *
 * Existem porque algumas magias têm assinatura mecânica *idêntica* — Bênção e
 * Perdição são ambas de 1º nível, encantamento, V/S/M, 9 metros, concentração
 * de 1 minuto e 1 ação. Nenhum critério mecânico as separa, e o algoritmo se
 * recusa a chutar (o que está certo: uma ligação errada faria a ficha mostrar a
 * mecânica da magia errada). Estas entradas resolvem exatamente esse resíduo.
 *
 * Não estão aqui de propósito: "Bruxaria" (hex) e "Nuvem de Adagas" (cloud of
 * daggers) existem no livro do usuário mas **não** no SRD 5.1 — não há o que
 * ligar.
 */
const CURATED_LINKS: Record<string, string> = {
  Bênção: 'bless',
  Perdição: 'bane',
  'Riso Histérico de Tasha': 'hideous-laughter',
  'Aura Sagrada': 'holy-aura',
  'Campo Antimagia': 'antimagic-field',
  'Chama Sagrada': 'sacred-flame',
  'Raio de Fogo': 'fire-bolt',
  'Raio de Gelo': 'ray-of-frost',
  'Rajada Mística': 'eldritch-blast',
  'Detectar Pensamentos': 'detect-thoughts',
  'Localizar Objeto': 'locate-object',
  'Esfera Flamejante': 'flaming-sphere',
  Teia: 'web',
  'Esquentar Metal': 'heat-metal',
  Levitação: 'levitate',
  'Patas de Aranha': 'spider-climb',
  'Pele de Árvore': 'barkskin',
  'Aprimorar Habilidade': 'enhance-ability',
  'Forma Gasosa': 'gaseous-form',
  Velocidade: 'haste',
  Voo: 'fly',
  'Mão de Bigby': 'arcane-hand',
  'Muralha de Energia': 'wall-of-force',
  'Mãos Flamejantes': 'burning-hands',
  'Onda Trovejante': 'thunderwave',
};

const SCHOOL_PT_TO_EN: Record<string, string> = {
  abjuração: 'abjuration',
  adivinhação: 'divination',
  conjuração: 'conjuration',
  encantamento: 'enchantment',
  evocação: 'evocation',
  ilusão: 'illusion',
  necromancia: 'necromancy',
  transmutação: 'transmutation',
};

export interface SrdSpellShape {
  readonly index: string;
  readonly name: string;
  readonly level: number;
  readonly school: string;
  readonly components: readonly string[];
  readonly concentration: boolean;
  readonly ritual: boolean;
  readonly range: string;
  readonly castingTime: string;
  readonly duration: string;
}

export interface SpellLink {
  readonly ptName: string;
  readonly srdIndex: string;
  readonly enName: string;
  /** Como foi decidido — útil para auditar o resultado. */
  readonly matchedOn: 'curated' | 'full' | 'partial';
}

export interface LinkReport {
  readonly links: readonly SpellLink[];
  readonly unmatchedPt: readonly string[];
  readonly ambiguous: readonly { readonly ptName: string; readonly candidates: readonly string[] }[];
}

/**
 * Alcances em português para pés. O livro brasileiro usa a conversão do
 * próprio D&D (1,5 m = 5 pés), não a métrica exata — 18 metros são 60 pés no
 * livro, mesmo que 60 pés sejam 18,29 m de verdade.
 */
function normalizeRange(value: string): string {
  const text = value.trim().toLowerCase();

  if (/pessoal|self/.test(text)) return 'self';
  if (/toque|touch/.test(text)) return 'touch';
  if (/ilimitad|unlimited/.test(text)) return 'unlimited';
  if (/visão|sight/.test(text)) return 'sight';
  if (/especial|special/.test(text)) return 'special';

  const meters = /([\d,.]+)\s*(?:metros?|m)\b/.exec(text);
  if (meters) {
    const value = Number(meters[1]!.replace(',', '.'));
    return `${Math.round(value / 0.3)}ft`;
  }

  const feet = /([\d,.]+)\s*(?:feet|foot|ft)\b/.exec(text);
  if (feet) return `${Math.round(Number(feet[1]!.replace(',', '.')))}ft`;

  const miles = /([\d,.]+)\s*(?:mile|milha)/.exec(text);
  if (miles) return `${Number(miles[1]!.replace(',', '.'))}mi`;

  const km = /([\d,.]+)\s*(?:quil[oô]metros?|km)/.exec(text);
  if (km) return `${Number(km[1]!.replace(',', '.')) / 1.6}mi`;

  return text;
}

/**
 * `1 ação bônus` e `1 bonus action` viram o mesmo token. A ordem dos testes
 * importa: "ação bônus" precisa ser reconhecida antes de "ação", senão toda
 * ação bônus vira ação.
 */
function normalizeCastingTime(value: string): string {
  const text = value.trim().toLowerCase();

  if (/ação bônus|bonus action/.test(text)) return 'bonus';
  if (/reação|reaction/.test(text)) return 'reaction';
  if (/\bação\b|\baction\b/.test(text)) return 'action';

  const amount = /(\d+)\s*(minuto|minute|hora|hour|rodada|round|dia|day)/.exec(text);
  if (amount) return `${amount[1]}${normalizeUnit(amount[2]!)}`;

  return text;
}

function normalizeUnit(unit: string): string {
  if (/minut/.test(unit)) return 'min';
  if (/hora|hour/.test(unit)) return 'hour';
  if (/rodada|round/.test(unit)) return 'round';
  if (/dia|day/.test(unit)) return 'day';
  return unit;
}

/** `Concentração, até 1 minuto` e `Concentration, up to 1 minute` → `c1min`. */
function normalizeDuration(value: string): string {
  const text = value.trim().toLowerCase();

  if (/instant/.test(text)) return 'instant';
  if (/permanen/.test(text)) return 'permanent';
  if (/especial|special/.test(text)) return 'special';
  if (/dissipad|dispelled/.test(text)) return /disparad|triggered/.test(text) ? 'dispelled-triggered' : 'dispelled';

  const concentration = /concentra/.test(text) ? 'c' : '';
  const amount = /(\d+)\s*(minuto|minute|hora|hour|rodada|round|dia|day)/.exec(text);
  if (amount) return `${concentration}${amount[1]}${normalizeUnit(amount[2]!)}`;

  return concentration + text;
}

/** `V, S, M (uma pitada de enxofre)` → `MSV`. */
function normalizeComponents(value: string | readonly string[]): string {
  const text = Array.isArray(value) ? value.join(',') : String(value);
  const letters = new Set<string>();
  for (const letter of text.toUpperCase().replace(/\([^)]*\)/g, '').matchAll(/\b[VSM]\b/g)) {
    letters.add(letter[0]);
  }
  return [...letters].sort().join('');
}

/** Assinatura mecânica de uma magia, na forma neutra de idioma. */
interface Signature {
  readonly level: number;
  readonly school: string;
  readonly components: string;
  readonly concentration: boolean;
  readonly ritual: boolean;
  readonly range: string;
  readonly castingTime: string;
  readonly duration: string;
}

/**
 * Camadas de casamento, da mais estrita à mais frouxa. Uma magia é ligada na
 * primeira camada em que sobra exatamente um candidato ainda não reivindicado.
 *
 * O escalonamento existe porque precisão vale mais que cobertura aqui: uma
 * ligação errada faz a ficha mostrar a mecânica de outra magia, o que é pior
 * que simplesmente não ter ligação. Começar pelo estrito garante que os casos
 * fáceis sejam decididos antes de qualquer critério mais frouxo poder confundi-los.
 */
const TIERS: readonly { name: string; of: (signature: Signature) => string }[] = [
  {
    name: 'completa',
    of: (s) =>
      [s.level, s.school, s.components, s.concentration ? 'C' : '-', s.ritual ? 'R' : '-', s.range, s.castingTime, s.duration].join('|'),
  },
  {
    name: 'sem duração',
    of: (s) =>
      [s.level, s.school, s.components, s.concentration ? 'C' : '-', s.ritual ? 'R' : '-', s.range, s.castingTime].join('|'),
  },
  {
    name: 'sem tempo',
    of: (s) => [s.level, s.school, s.components, s.concentration ? 'C' : '-', s.ritual ? 'R' : '-', s.range].join('|'),
  },
  {
    name: 'parcial',
    of: (s) => [s.level, s.school, s.components, s.concentration ? 'C' : '-'].join('|'),
  },
];

export function linkSpells(
  ptSpells: readonly ParsedSpell[],
  srdSpells: readonly SrdSpellShape[],
): LinkReport {
  const srdSignatures = new Map<string, Signature>();
  const indexes: Map<string, SrdSpellShape[]>[] = TIERS.map(() => new Map());

  for (const spell of srdSpells) {
    const signature: Signature = {
      level: spell.level,
      school: spell.school,
      components: normalizeComponents(spell.components),
      concentration: spell.concentration,
      ritual: spell.ritual,
      range: normalizeRange(spell.range),
      castingTime: normalizeCastingTime(spell.castingTime),
      duration: normalizeDuration(spell.duration),
    };
    srdSignatures.set(spell.index, signature);
    for (const [tier, index] of indexes.entries()) {
      push(index, TIERS[tier]!.of(signature), spell);
    }
  }

  const links: SpellLink[] = [];
  const claimed = new Set<string>();
  const ambiguous: { ptName: string; candidates: string[] }[] = [];

  const bySrdIndex = new Map(srdSpells.map((spell) => [spell.index, spell]));

  // Curadoria primeiro: reivindica os índices antes de qualquer heurística
  // poder atribuí-los a outra magia.
  for (const spell of ptSpells) {
    const curated = CURATED_LINKS[spell.name];
    const target = curated ? bySrdIndex.get(curated) : undefined;
    if (target) {
      claimed.add(target.index);
      links.push({
        ptName: spell.name,
        srdIndex: target.index,
        enName: target.name,
        matchedOn: 'curated',
      });
    }
  }
  const curatedNames = new Set(links.map((link) => link.ptName));

  let pending = ptSpells.filter(
    (spell) => !curatedNames.has(spell.name) && SCHOOL_PT_TO_EN[spell.school] !== undefined,
  );
  const unmatchedPt = ptSpells
    .filter((spell) => !curatedNames.has(spell.name) && SCHOOL_PT_TO_EN[spell.school] === undefined)
    .map((spell) => spell.name);

  for (const [tier, index] of indexes.entries()) {
    const stillPending: ParsedSpell[] = [];

    for (const spell of pending) {
      const key = TIERS[tier]!.of({
        level: spell.level,
        school: SCHOOL_PT_TO_EN[spell.school]!,
        components: normalizeComponents(spell.components),
        concentration: spell.concentration,
        ritual: spell.ritual,
        range: normalizeRange(spell.range),
        castingTime: normalizeCastingTime(spell.castingTime),
        duration: normalizeDuration(spell.duration),
      });

      const candidates = (index.get(key) ?? []).filter((entry) => !claimed.has(entry.index));
      if (candidates.length === 1) {
        claimed.add(candidates[0]!.index);
        links.push({
          ptName: spell.name,
          srdIndex: candidates[0]!.index,
          enName: candidates[0]!.name,
          matchedOn: tier === 0 ? 'full' : 'partial',
        });
      } else {
        stillPending.push(spell);
      }
    }

    pending = stillPending;
    if (pending.length === 0) break;
  }

  // O que sobrou: ou é magia fora do SRD (o livro do usuário é o PHB inteiro,
  // o SRD é um subconjunto), ou permaneceu ambígua até a camada mais frouxa.
  const lastIndex = indexes.at(-1)!;
  for (const spell of pending) {
    const key = TIERS.at(-1)!.of({
      level: spell.level,
      school: SCHOOL_PT_TO_EN[spell.school]!,
      components: normalizeComponents(spell.components),
      concentration: spell.concentration,
      ritual: spell.ritual,
      range: normalizeRange(spell.range),
      castingTime: normalizeCastingTime(spell.castingTime),
      duration: normalizeDuration(spell.duration),
    });
    const candidates = (lastIndex.get(key) ?? []).filter((entry) => !claimed.has(entry.index));

    if (candidates.length > 1) {
      ambiguous.push({ ptName: spell.name, candidates: candidates.map((entry) => entry.name) });
    } else {
      unmatchedPt.push(spell.name);
    }
  }

  return { links, unmatchedPt, ambiguous };
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Extrai a forma mínima que o casamento precisa a partir do JSON do SRD. */
export function toSrdSpellShape(record: Record<string, unknown>): SrdSpellShape {
  return {
    index: String(record.index),
    name: String(record.name),
    level: Number(record.level ?? 0),
    school: String((record.school as Record<string, unknown> | undefined)?.index ?? ''),
    components: (record.components as string[] | undefined) ?? [],
    concentration: record.concentration === true,
    ritual: record.ritual === true,
    range: String(record.range ?? ''),
    castingTime: String(record.casting_time ?? ''),
    duration: String(record.duration ?? ''),
  };
}
