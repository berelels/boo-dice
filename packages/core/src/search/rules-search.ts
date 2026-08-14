import type { SqlDriver } from '../db/driver.js';

/**
 * Busca no glossário, sobre o índice FTS5 montado pelo pipeline de dados.
 *
 * O acervo é dividido em duas fontes:
 *  - `catalog`      registros estruturados do SRD (magias, itens, monstros…)
 *  - `rules_chunks` trechos do livro de regras, para o texto corrido
 *
 * Os dois vivem em `srd.db`, um arquivo somente-leitura que vem embutido no
 * app e é substituído inteiro quando o conteúdo muda.
 */

export type CatalogKind =
  | 'spell'
  | 'monster'
  | 'equipment'
  | 'magic-item'
  | 'condition'
  | 'feature'
  | 'class'
  | 'race'
  | 'background'
  | 'feat'
  | 'rule';

export const CATALOG_KIND_LABELS: Readonly<Record<CatalogKind, string>> = {
  spell: 'Magia',
  monster: 'Monstro',
  equipment: 'Equipamento',
  'magic-item': 'Item mágico',
  condition: 'Condição',
  feature: 'Característica',
  class: 'Classe',
  race: 'Raça',
  background: 'Antecedente',
  feat: 'Talento',
  rule: 'Regra',
};

export interface SearchHit {
  readonly id: string;
  readonly kind: CatalogKind;
  readonly title: string;
  /** Subtítulo curto: "Magia de 3º nível — Evocação", "Monstro ND 5". */
  readonly subtitle: string;
  /** Trecho com os termos marcados por `[[` e `]]`. */
  readonly snippet: string;
  /** Capítulo/seção de origem, quando vem do livro. */
  readonly section: string | null;
  /** Menor é melhor — é o `rank` do FTS5 (BM25). */
  readonly rank: number;
  /** `pt` ou `en`, para a UI sinalizar conteúdo ainda não traduzido. */
  readonly lang: string;
}

export interface SearchOptions {
  readonly limit?: number;
  readonly kinds?: readonly CatalogKind[];
}

/**
 * Traduz o que o usuário digitou para a sintaxe do FTS5.
 *
 * Isto não é opcional: `magia "de` ou `NEAR(` digitados na caixa de busca
 * derrubariam a consulta com erro de sintaxe. Cada termo vira uma string
 * entre aspas (neutralizando qualquer operador), unidos por AND, e o último
 * ganha `*` para que a busca responda enquanto ainda se digita.
 */
export function toFtsQuery(input: string): string | null {
  const terms = input
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 0);

  if (terms.length === 0) return null;

  return terms
    .map((term, index) => {
      const quoted = `"${term.replace(/"/g, '""')}"`;
      return index === terms.length - 1 ? `${quoted}*` : quoted;
    })
    .join(' AND ');
}

/**
 * Pesos por coluna no BM25 (`title`, `subtitle`, `body`).
 *
 * Sem isso, procurar "bola de fogo" devolve um bloco de 1.200 caracteres do
 * capítulo de magias *acima* da magia Bola de Fogo, porque o BM25 puro não
 * distingue um acerto no título de um acerto no meio do texto. Quem digita o
 * nome de uma coisa quer aquela coisa.
 */
const BM25_WEIGHTS = { title: 12, subtitle: 3, body: 1 } as const;

interface RawHit {
  id: string;
  kind: string;
  title: string;
  subtitle: string;
  snippet: string;
  section: string | null;
  rank: number;
  lang: string;
}

export class RulesSearch {
  constructor(private readonly driver: SqlDriver) {}

  async search(input: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    const query = toFtsQuery(input);
    if (query === null) return [];

    const limit = options.limit ?? 40;
    const kinds = options.kinds ?? [];

    // O filtro por tipo entra como placeholders para não concatenar entrada do
    // usuário no SQL, mesmo vindo de uma lista fechada.
    const kindFilter =
      kinds.length > 0 ? `AND c.kind IN (${kinds.map(() => '?').join(', ')})` : '';

    const rows = await this.driver.query<RawHit>(
      `SELECT
         c.id       AS id,
         c.kind     AS kind,
         c.title    AS title,
         c.subtitle AS subtitle,
         snippet(catalog_fts, 2, '[[', ']]', ' … ', 24) AS snippet,
         c.section  AS section,
         bm25(catalog_fts, ${BM25_WEIGHTS.title}, ${BM25_WEIGHTS.subtitle}, ${BM25_WEIGHTS.body}) AS rank,
         c.lang     AS lang
       FROM catalog_fts
       JOIN catalog c ON c.rowid = catalog_fts.rowid
       WHERE catalog_fts MATCH ?
       ${kindFilter}
       ORDER BY rank
       LIMIT ?`,
      [query, ...kinds, limit],
    );

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as CatalogKind,
      title: row.title,
      subtitle: row.subtitle,
      snippet: row.snippet,
      section: row.section,
      rank: row.rank,
      lang: row.lang,
    }));
  }

  /** Um registro inteiro do catálogo, para a tela de detalhe. */
  async get(id: string): Promise<CatalogEntry | null> {
    const row = await this.driver.queryOne<{
      id: string;
      kind: string;
      title: string;
      subtitle: string;
      body: string;
      section: string | null;
      lang: string;
      data: string | null;
    }>('SELECT id, kind, title, subtitle, body, section, lang, data FROM catalog WHERE id = ?', [id]);

    if (!row) return null;
    return {
      id: row.id,
      kind: row.kind as CatalogKind,
      title: row.title,
      subtitle: row.subtitle,
      body: row.body,
      section: row.section,
      lang: row.lang,
      data: row.data ? (JSON.parse(row.data) as Record<string, unknown>) : null,
    };
  }

  /** Lista um tipo inteiro, em ordem alfabética — para as abas de navegação. */
  async listByKind(kind: CatalogKind, limit = 500): Promise<CatalogEntry[]> {
    const rows = await this.driver.query<{
      id: string;
      kind: string;
      title: string;
      subtitle: string;
      body: string;
      section: string | null;
      lang: string;
      data: string | null;
    }>(
      `SELECT id, kind, title, subtitle, body, section, lang, data
       FROM catalog WHERE kind = ? ORDER BY title COLLATE NOCASE LIMIT ?`,
      [kind, limit],
    );

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as CatalogKind,
      title: row.title,
      subtitle: row.subtitle,
      body: row.body,
      section: row.section,
      lang: row.lang,
      data: row.data ? (JSON.parse(row.data) as Record<string, unknown>) : null,
    }));
  }

  async countByKind(): Promise<Record<string, number>> {
    const rows = await this.driver.query<{ kind: string; total: number }>(
      'SELECT kind, COUNT(*) AS total FROM catalog GROUP BY kind',
    );
    return Object.fromEntries(rows.map((row) => [row.kind, row.total]));
  }

  /** Fecha a conexão — usar ao trocar por uma fonte mais nova, pra não vazar o arquivo aberto. */
  async close(): Promise<void> {
    await this.driver.close();
  }
}

export interface CatalogEntry {
  readonly id: string;
  readonly kind: CatalogKind;
  readonly title: string;
  readonly subtitle: string;
  readonly body: string;
  readonly section: string | null;
  readonly lang: string;
  /** Campos estruturados do SRD (nível, componentes, CA, ND…), quando houver. */
  readonly data: Record<string, unknown> | null;
}
