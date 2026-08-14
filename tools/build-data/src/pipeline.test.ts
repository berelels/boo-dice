import { describe, expect, it } from 'vitest';
import {
  parseHtmlBlocks,
  parseRuleChunks,
  parseSpells,
  spellToCatalogEntry,
  stripTableOfContents,
  titleCasePt,
} from './book.js';
import { linkSpells, type SrdSpellShape } from './link.js';
import { formatChallenge, ordinalPt, poundsToKg } from './srd.js';
import { slugify, joinParagraphs } from './catalog.js';

/**
 * O fixture imita o formato real do extrato de PDF: entradas coladas no meio
 * do parágrafo, componentes materiais atravessando a quebra de linha, e o
 * texto de uma magia terminando dentro do parágrafo onde a próxima começa.
 * Foi exatamente esse formato que quebrou a primeira versão do parser.
 */
const FIXTURE = `<!DOCTYPE html><html><head><title>x</title></head><body>
<h2>SUMÁRIO</h2>
<h3>PREFÁCIO 4</h3>
<p>Coisas do sumário que não são regra — 12</p>
<h2>CAPÍTULO 9: COMBATE</h2>
<h3>A ORDEM DE COMBATE</h3>
<p>Um combate normal é uma disputa caótica. As regras a seguir ajudam a organizar o caos.</p>
<p>Quando o combate começa, todo participante faz um teste de Destreza para determinar a ordem.</p>
<h2>CAPÍTULO 11: MAGIAS</h2>
<h3>DESCRIÇÕES DAS MAGIAS</h3>
<p>As magias apresentadas abaixo estão em ordem alfabética. BOLA DE FOGO 3° nível de evocação Tempo de Conjuração: 1 ação Alcance: 45 metros Componentes: V, S, M (uma bolinha de guano de morcego e enxofre) Duração: Instantânea Um clarão brilhante surge de seu dedo indicador.</p>
<p>O fogo se espalha fazendo as curvas. ALTERAR FORMA 9° nível de transmutação (ritual) Tempo de Conjuração: 1 ação Alcance: Pessoal Componentes: V, S, M (uma argola de jade valendo, no</p>
<p>mínimo, 1.500 po, que você deve colocar na cabeça) Duração: Concentração, até 1 hora Você assume a forma de uma criatura diferente.</p>
<p>LUZ 0° nível de evocação Tempo de Conjuração: 1 ação Alcance: Toque Componentes: V, M (um vaga-lume) Duração: 1 hora Você toca um objeto.</p>
<p>ZOMBARIA VICIOSA Truque de encantamento Tempo de Conjuração: 1 ação Alcance: 18 metros Componentes: V Duração: Instantânea Você lança um insulto carregado de magia.</p>
</body></html>`;

describe('parseHtmlBlocks', () => {
  const document = parseHtmlBlocks(FIXTURE);

  it('extrai só o corpo, não o cabeçalho', () => {
    expect(document.blocks.some((block) => block.text.includes('<title>'))).toBe(false);
  });

  it('classifica títulos e parágrafos', () => {
    expect(document.blocks[0]).toEqual({ kind: 'h2', text: 'SUMÁRIO' });
    expect(document.blocks.filter((block) => block.kind === 'h2')).toHaveLength(3);
  });

  it('decodifica entidades HTML', () => {
    const blocks = parseHtmlBlocks('<body><p>D&amp;D &quot;cl&#225;ssico&quot;</p></body>').blocks;
    expect(blocks[0]!.text).toBe('D&D "clássico"');
  });

  it('normaliza espaços em branco', () => {
    const blocks = parseHtmlBlocks('<body><p>  muito\n\n  espaço  </p></body>').blocks;
    expect(blocks[0]!.text).toBe('muito espaço');
  });
});

describe('stripTableOfContents', () => {
  it('remove o sumário, que só polui a busca', () => {
    const stripped = stripTableOfContents(parseHtmlBlocks(FIXTURE));
    expect(stripped.blocks.some((block) => block.text.includes('não são regra'))).toBe(false);
    expect(stripped.blocks[0]).toEqual({ kind: 'h2', text: 'CAPÍTULO 9: COMBATE' });
  });

  it('não altera um documento sem sumário', () => {
    const document = parseHtmlBlocks('<body><h2>REGRAS</h2><p>texto</p></body>');
    expect(stripTableOfContents(document).blocks).toHaveLength(2);
  });
});

describe('parseSpells', () => {
  const spells = parseSpells(stripTableOfContents(parseHtmlBlocks(FIXTURE)));

  it('encontra todas as magias, inclusive as que atravessam parágrafos', () => {
    expect(spells.map((spell) => spell.name)).toEqual([
      'Bola de Fogo',
      'Alterar Forma',
      'Luz',
      'Zombaria Viciosa',
    ]);
  });

  it('extrai nível e escola', () => {
    expect(spells[0]).toMatchObject({ level: 3, school: 'evocação' });
    expect(spells[1]).toMatchObject({ level: 9, school: 'transmutação', ritual: true });
  });

  it('trata "Truque de escola" como nível 0', () => {
    expect(spells[3]).toMatchObject({ level: 0, school: 'encantamento' });
  });

  it('lê componente material que quebra linha no PDF', () => {
    // Esta é a regressão que derrubou 137 das 361 magias na primeira versão.
    expect(spells[1]!.components).toBe(
      'V, S, M (uma argola de jade valendo, no mínimo, 1.500 po, que você deve colocar na cabeça)',
    );
  });

  it('separa a duração da descrição, que vem colada logo depois', () => {
    expect(spells[0]!.duration).toBe('Instantânea');
    expect(spells[0]!.description).toMatch(/^Um clarão brilhante surge de seu dedo indicador\./);
  });

  it('continua a descrição pelos parágrafos seguintes até a próxima magia', () => {
    // A descrição de Bola de Fogo atravessa a quebra de parágrafo e termina
    // exatamente onde o cabeçalho de Alterar Forma começa.
    expect(spells[0]!.description).toBe(
      'Um clarão brilhante surge de seu dedo indicador. O fogo se espalha fazendo as curvas.',
    );
  });

  it('detecta concentração pela duração', () => {
    expect(spells[1]!.duration).toBe('Concentração, até 1 hora');
    expect(spells[1]!.concentration).toBe(true);
    expect(spells[0]!.concentration).toBe(false);
  });

  it('não deixa a descrição de uma magia vazar para a seguinte', () => {
    expect(spells[0]!.description).not.toContain('ALTERAR FORMA');
    expect(spells[1]!.description).toContain('forma de uma criatura diferente');
  });

  it('devolve vazio quando o documento não tem capítulo de magias', () => {
    expect(parseSpells(parseHtmlBlocks('<body><p>nada aqui</p></body>'))).toEqual([]);
  });
});

describe('spellToCatalogEntry', () => {
  const spells = parseSpells(stripTableOfContents(parseHtmlBlocks(FIXTURE)));

  it('monta um registro em português com os campos estruturados', () => {
    const entry = spellToCatalogEntry(spells[0]!, 'teste');
    expect(entry.id).toBe('book:spell:bola-de-fogo');
    expect(entry.lang).toBe('pt');
    expect(entry.subtitle).toBe('3º nível — Evocação');
    expect(entry.body).toContain('Alcance: 45 metros');
    expect(entry.data).toMatchObject({ level: 3, concentration: false });
  });

  it('marca ritual no subtítulo', () => {
    expect(spellToCatalogEntry(spells[1]!, 'teste').subtitle).toContain('(ritual)');
  });
});

describe('titleCasePt', () => {
  it('mantém preposições em minúscula, como o livro imprime', () => {
    expect(titleCasePt('BOLA DE FOGO')).toBe('Bola de Fogo');
    expect(titleCasePt('MÃOS FLAMEJANTES')).toBe('Mãos Flamejantes');
    expect(titleCasePt('RAIO DO ENFRAQUECIMENTO')).toBe('Raio do Enfraquecimento');
  });

  it('capitaliza a primeira palavra mesmo sendo preposição', () => {
    expect(titleCasePt('A CARGA')).toBe('A Carga');
  });
});

describe('parseRuleChunks', () => {
  const chunks = parseRuleChunks(stripTableOfContents(parseHtmlBlocks(FIXTURE)), 'teste');

  it('ancora cada bloco no título da seção', () => {
    const combate = chunks.find((chunk) => chunk.title === 'A ORDEM DE COMBATE');
    expect(combate).toBeDefined();
    expect(combate!.section).toBe('CAPÍTULO 9: COMBATE');
    expect(combate!.body).toContain('disputa caótica');
  });

  it('gera ids únicos', () => {
    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(chunks.length);
  });

  it('marca tudo como português', () => {
    expect(chunks.every((chunk) => chunk.lang === 'pt')).toBe(true);
  });
});

describe('linkSpells', () => {
  const srd: SrdSpellShape[] = [
    { index: 'fireball', name: 'Fireball', level: 3, school: 'evocation', components: ['V', 'S', 'M'], concentration: false, ritual: false, range: '150 feet', castingTime: '1 action', duration: 'Instantaneous' },
    { index: 'bless', name: 'Bless', level: 1, school: 'enchantment', components: ['V', 'S', 'M'], concentration: true, ritual: false, range: '30 feet', castingTime: '1 action', duration: 'Concentration, up to 1 minute' },
    { index: 'bane', name: 'Bane', level: 1, school: 'enchantment', components: ['V', 'S', 'M'], concentration: true, ritual: false, range: '30 feet', castingTime: '1 action', duration: 'Concentration, up to 1 minute' },
    { index: 'light', name: 'Light', level: 0, school: 'evocation', components: ['V', 'M'], concentration: false, ritual: false, range: 'Touch', castingTime: '1 action', duration: '1 hour' },
  ];

  const pt = (overrides: Partial<Parameters<typeof linkSpells>[0][number]>) => ({
    name: 'X', level: 1, school: 'evocação', ritual: false, castingTime: '1 ação',
    range: '9 metros', components: 'V, S', duration: 'Instantânea', concentration: false,
    description: '', ...overrides,
  });

  it('casa pela assinatura mecânica, convertendo metros para pés', () => {
    const report = linkSpells(
      [pt({ name: 'Bola de Fogo', level: 3, school: 'evocação', range: '45 metros', components: 'V, S, M (guano)' })],
      srd,
    );
    expect(report.links).toEqual([
      { ptName: 'Bola de Fogo', srdIndex: 'fireball', enName: 'Fireball', matchedOn: 'full' },
    ]);
  });

  it('resolve colisões de assinatura pela curadoria, sem chutar', () => {
    // Bênção e Perdição têm mecânica idêntica; só o nome as separa.
    const report = linkSpells(
      [
        pt({ name: 'Bênção', school: 'encantamento', components: 'V, S, M (água benta)', duration: 'Concentração, até 1 minuto', concentration: true }),
        pt({ name: 'Perdição', school: 'encantamento', components: 'V, S, M (gota de sangue)', duration: 'Concentração, até 1 minuto', concentration: true }),
      ],
      srd,
    );

    const byName = Object.fromEntries(report.links.map((link) => [link.ptName, link.srdIndex]));
    expect(byName).toEqual({ Bênção: 'bless', Perdição: 'bane' });
    expect(report.links.every((link) => link.matchedOn === 'curated')).toBe(true);
    expect(report.ambiguous).toEqual([]);
  });

  it('prefere não casar a casar errado', () => {
    // Duas magias idênticas e sem curadoria: nenhuma é ligada.
    const report = linkSpells(
      [pt({ name: 'Desconhecida A', school: 'encantamento', components: 'V, S, M', duration: 'Concentração, até 1 minuto', concentration: true, range: '9 metros' })],
      srd,
    );
    expect(report.links).toEqual([]);
    expect(report.ambiguous).toHaveLength(1);
    expect([...report.ambiguous[0]!.candidates].sort()).toEqual(['Bane', 'Bless']);
  });

  it('nunca reivindica o mesmo índice do SRD duas vezes', () => {
    const report = linkSpells(
      [
        pt({ name: 'Bola de Fogo', level: 3, range: '45 metros', components: 'V, S, M' }),
        pt({ name: 'Outra Bola', level: 3, range: '45 metros', components: 'V, S, M' }),
      ],
      srd,
    );
    const indexes = report.links.map((link) => link.srdIndex);
    expect(new Set(indexes).size).toBe(indexes.length);
  });

  it('reporta como fora do SRD o que não tem candidato', () => {
    const report = linkSpells([pt({ name: 'Magia Caseira', level: 7, school: 'ilusão' })], srd);
    expect(report.unmatchedPt).toEqual(['Magia Caseira']);
  });

  it('normaliza componentes ignorando o texto do material', () => {
    const report = linkSpells(
      [pt({ name: 'Luz', level: 0, school: 'evocação', range: 'Toque', components: 'V, M (um vaga-lume)', duration: '1 hora' })],
      srd,
    );
    expect(report.links[0]!.srdIndex).toBe('light');
  });
});

describe('utilidades do SRD', () => {
  it('formata ND fracionário como o livro imprime', () => {
    expect(formatChallenge(0.125)).toBe('1/8');
    expect(formatChallenge(0.25)).toBe('1/4');
    expect(formatChallenge(0.5)).toBe('1/2');
    expect(formatChallenge(10)).toBe('10');
  });

  it('converte libras em quilos', () => {
    expect(poundsToKg(2)).toBe(0.91);
    expect(poundsToKg(0)).toBe(0);
  });

  it('rotula nível de magia em português', () => {
    expect(ordinalPt(0)).toBe('Truque');
    expect(ordinalPt(3)).toBe('3º nível');
  });
});

describe('utilidades do catálogo', () => {
  it('gera slugs sem acento', () => {
    expect(slugify('Bola de Fogo')).toBe('bola-de-fogo');
    expect(slugify('Mísseis Mágicos')).toBe('misseis-magicos');
    expect(slugify('  Riso Histérico de Tasha  ')).toBe('riso-histerico-de-tasha');
  });

  it('junta arrays de parágrafos', () => {
    expect(joinParagraphs(['um', 'dois'])).toBe('um\n\ndois');
    expect(joinParagraphs('texto')).toBe('texto');
    expect(joinParagraphs(undefined)).toBe('');
  });
});
