import { slugify, type CatalogEntryInput } from './catalog.js';

/**
 * Importa um livro de regras em HTML (o dump de texto gerado a partir do PDF)
 * para o catálogo, em português.
 *
 * Este caminho roda **na máquina do usuário**, sobre os livros que ele já
 * possui, e escreve num `books.db` que não é versionado nem embarcado no app.
 * O `srd.db` distribuível continua contendo só o SRD, que é aberto. É essa
 * separação que mantém o app distribuível sem carregar conteúdo licenciado.
 *
 * O HTML é um extrato achatado de PDF: sem tabelas, e com as entradas correndo
 * coladas no meio dos parágrafos. Duas estratégias diferentes lidam com isso:
 *
 *  - **magias** têm um cabeçalho rígido (`NOME`, nível, escola, e os quatro
 *    campos sempre na mesma ordem), então dá para recortá-las com precisão;
 *  - **o resto do texto** vira blocos ancorados nos títulos, que é o formato
 *    certo para busca, mesmo sem estrutura fina.
 */

export interface ParsedDocument {
  readonly blocks: readonly TextBlock[];
}

export interface TextBlock {
  readonly kind: 'h2' | 'h3' | 'p';
  readonly text: string;
}

/**
 * Extrai os blocos de texto do HTML.
 *
 * Um parser de DOM completo seria exagero: o arquivo tem exatamente três tipos
 * de tag no corpo (`h2`, `h3`, `p`), gerados por uma ferramenta, sem aninhamento.
 */
export function parseHtmlBlocks(html: string): ParsedDocument {
  const bodyStart = html.indexOf('<body>');
  const body = bodyStart === -1 ? html : html.slice(bodyStart + 6);

  const blocks: TextBlock[] = [];
  const pattern = /<(h2|h3|p)\b[^>]*>([\s\S]*?)<\/\1>/g;

  for (const match of body.matchAll(pattern)) {
    const text = decodeEntities(match[2]!.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (text.length > 0) {
      blocks.push({ kind: match[1] as TextBlock['kind'], text });
    }
  }

  return { blocks };
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&[a-z]+;|&#\d+;/gi, (entity) => {
      if (entity in ENTITIES) return ENTITIES[entity]!;
      const numeric = /^&#(\d+);$/.exec(entity);
      return numeric ? String.fromCodePoint(Number(numeric[1])) : entity;
    });
}

// ---------------------------------------------------------------------------
// Magias
// ---------------------------------------------------------------------------

export interface ParsedSpell {
  readonly name: string;
  readonly level: number;
  readonly school: string;
  readonly ritual: boolean;
  readonly castingTime: string;
  readonly range: string;
  readonly components: string;
  readonly duration: string;
  readonly description: string;
  readonly concentration: boolean;
}

/**
 * Cabeçalho de magia: NOME EM MAIÚSCULAS, seguido de nível e escola (ou
 * "Truque de escola"), opcionalmente "(ritual)", e então o primeiro campo.
 * A âncora é `Tempo de Conjuração:`, que só aparece em magias.
 */
const SPELL_HEADER =
  /([A-ZÁÂÃÀÉÊÍÓÔÕÚÜÇ][A-ZÁÂÃÀÉÊÍÓÔÕÚÜÇ'\s/-]{2,60}?)\s+(?:(\d)[°º]\s+nível\s+de\s+(\S+)|Truque\s+de\s+(\S+))\s*(\(ritual\))?\s+Tempo de Conjuração:/g;

/**
 * Durações possíveis em 5e. A lista explícita existe porque a duração é o
 * único campo sem um rótulo depois dele para servir de fronteira — logo após
 * vem a descrição, sem separador nenhum. Adivinhar onde ela termina por
 * heurística de maiúscula erra em magias cuja descrição começa com "O alvo…".
 */
const DURATION =
  /Duração:\s*(Instantânea|Especial|Permanente|Até ser dissipada(?: ou disparada)?|Concentração,\s*até\s+\d+\s*\S+|até\s+\d+\s*\S+|\d+\s*\S+)/i;

export function parseSpells(document: ParsedDocument): ParsedSpell[] {
  // As magias vivem num trecho contínuo do capítulo 11; juntamos os parágrafos
  // a partir do título das descrições porque uma magia atravessa vários deles.
  const startIndex = document.blocks.findIndex(
    (block) => block.kind === 'h3' && block.text.toUpperCase().includes('DESCRIÇÕES DAS MAGIAS'),
  );
  if (startIndex === -1) return [];

  const text = document.blocks
    .slice(startIndex)
    .map((block) => block.text)
    .join('\n');

  const headers = [...text.matchAll(SPELL_HEADER)];
  const spells: ParsedSpell[] = [];

  for (const [position, header] of headers.entries()) {
    const bodyStart = header.index! + header[0].length;
    const bodyEnd = headers[position + 1]?.index ?? text.length;
    const raw = text.slice(bodyStart, bodyEnd);

    // A flag `s` não é detalhe: no extrato do PDF um componente material longo
    // ("uma argola de jade valendo, no mínimo, 1.500 po…") atravessa a quebra
    // de parágrafo, e sem ela o campo simplesmente não casa. Cada regex está
    // limitada ao trecho de uma magia só, então o `.` guloso não vaza para a
    // magia seguinte.
    const castingTime = between(raw, /^\s*(.+?)\s*Alcance:/s);
    const range = between(raw, /Alcance:\s*(.+?)\s*Componentes:/s);
    const components = between(raw, /Componentes:\s*(.+?)\s*Duração:/s);

    const durationMatch = DURATION.exec(raw);
    if (castingTime === null || range === null || components === null || durationMatch === null) {
      // Uma magia que não casa com o formato é pulada, não gravada pela metade —
      // meia magia no glossário é pior que magia nenhuma.
      continue;
    }

    const duration = durationMatch[1]!.trim();
    const description = raw
      .slice(durationMatch.index + durationMatch[0].length)
      .replace(/\s*\n\s*/g, ' ')
      .trim();

    spells.push({
      name: titleCasePt(header[1]!.trim()),
      level: header[2] ? Number(header[2]) : 0,
      school: (header[3] ?? header[4] ?? '').replace(/[.,]$/, '').toLowerCase(),
      ritual: header[5] !== undefined,
      castingTime,
      range,
      components,
      duration,
      concentration: /concentração/i.test(duration),
      description,
    });
  }

  return spells;
}

function between(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  return match ? match[1]!.replace(/\s*\n\s*/g, ' ').trim() : null;
}

/**
 * `BOLA DE FOGO` → `Bola de Fogo`. As preposições ficam em minúscula, como o
 * livro imprime — e é assim que o jogador procura.
 */
const LOWERCASE_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o', 'na', 'no', 'com', 'contra', 'para', 'sem']);

export function titleCasePt(value: string): string {
  const words = value.toLowerCase().split(/\s+/);
  return words
    .map((word, index) =>
      index > 0 && LOWERCASE_WORDS.has(word)
        ? word
        : word.replace(/^(\p{L})/u, (letter) => letter.toLocaleUpperCase('pt-BR')),
    )
    .join(' ');
}

export function spellToCatalogEntry(spell: ParsedSpell, source: string): CatalogEntryInput {
  const levelLabel = spell.level === 0 ? 'Truque' : `${spell.level}º nível`;
  const schoolLabel = spell.school.charAt(0).toLocaleUpperCase('pt-BR') + spell.school.slice(1);

  return {
    id: `book:spell:${slugify(spell.name)}`,
    kind: 'spell',
    title: spell.name,
    subtitle: `${levelLabel} — ${schoolLabel}${spell.ritual ? ' (ritual)' : ''}`,
    body: [
      `Tempo de Conjuração: ${spell.castingTime}`,
      `Alcance: ${spell.range}`,
      `Componentes: ${spell.components}`,
      `Duração: ${spell.duration}`,
      '',
      spell.description,
    ].join('\n'),
    section: 'Magias',
    lang: 'pt',
    data: {
      level: spell.level,
      school: spell.school,
      ritual: spell.ritual,
      concentration: spell.concentration,
      castingTime: spell.castingTime,
      range: spell.range,
      components: spell.components,
      duration: spell.duration,
      source,
    },
  };
}

// ---------------------------------------------------------------------------
// Blocos de regras para busca
// ---------------------------------------------------------------------------

/**
 * Tamanho alvo de cada bloco. Grande o bastante para o trecho fazer sentido
 * sozinho na tela de resultados, pequeno o bastante para o destaque do FTS
 * apontar para o lugar certo.
 */
const CHUNK_TARGET_CHARS = 1200;

export function parseRuleChunks(document: ParsedDocument, source: string): CatalogEntryInput[] {
  const entries: CatalogEntryInput[] = [];

  let chapter = '';
  let section = '';
  let buffer: string[] = [];
  let bufferLength = 0;
  let ordinal = 0;

  const flush = (): void => {
    if (buffer.length === 0) return;
    ordinal += 1;
    const title = section || chapter || 'Regras';
    entries.push({
      id: `book:rule:${slugify(`${source}-${title}-${ordinal}`)}`,
      kind: 'rule',
      title,
      subtitle: chapter && chapter !== title ? chapter : 'Regra',
      body: buffer.join('\n\n'),
      section: chapter || null,
      lang: 'pt',
      data: { source, ordinal },
    });
    buffer = [];
    bufferLength = 0;
  };

  for (const block of document.blocks) {
    if (block.kind === 'h2') {
      flush();
      chapter = block.text;
      section = '';
      continue;
    }
    if (block.kind === 'h3') {
      flush();
      section = block.text;
      continue;
    }

    buffer.push(block.text);
    bufferLength += block.text.length;
    if (bufferLength >= CHUNK_TARGET_CHARS) flush();
  }

  flush();
  return entries;
}

/** O sumário do começo do livro só polui a busca — nada ali é regra. */
export function stripTableOfContents(document: ParsedDocument): ParsedDocument {
  const start = document.blocks.findIndex(
    (block) => block.kind === 'h2' && /SUMÁRIO/i.test(block.text),
  );
  if (start === -1) return document;

  const end = document.blocks.findIndex(
    (block, index) => index > start && block.kind === 'h2' && !/SUMÁRIO/i.test(block.text),
  );
  if (end === -1) return document;

  return { blocks: [...document.blocks.slice(0, start), ...document.blocks.slice(end)] };
}
