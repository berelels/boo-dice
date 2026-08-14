/**
 * Estrutura do `srd.db` — o banco somente-leitura que vem embutido no app.
 *
 * O DDL mora aqui, e não dentro do pipeline, porque duas coisas dependem dele:
 * o pipeline que *escreve* o arquivo e a busca que o *lê*. Uma definição só
 * significa que um `snippet(catalog_fts, 2, …)` nunca vai apontar para a coluna
 * errada porque alguém reordenou o `CREATE TABLE` de um lado só.
 */

export const CATALOG_SCHEMA = `
  CREATE TABLE IF NOT EXISTS catalog (
    rowid    INTEGER PRIMARY KEY,
    id       TEXT NOT NULL UNIQUE,
    kind     TEXT NOT NULL,
    title    TEXT NOT NULL,
    subtitle TEXT NOT NULL DEFAULT '',
    body     TEXT NOT NULL DEFAULT '',
    section  TEXT,
    lang     TEXT NOT NULL DEFAULT 'pt',
    -- Campos estruturados do SRD em JSON: nível e componentes de uma magia,
    -- CA e ND de um monstro, dano de uma arma.
    data     TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_catalog_kind ON catalog (kind, title);

  -- Índice externo (content=catalog): o texto não é duplicado, o FTS só guarda
  -- o índice invertido. Economiza metade do tamanho do arquivo embarcado.
  --
  -- 'remove_diacritics 2' é o que faz "conjuracao" encontrar "conjuração" e
  -- "area" encontrar "área" — indispensável em português, onde ninguém digita
  -- acento na caixa de busca.
  CREATE VIRTUAL TABLE IF NOT EXISTS catalog_fts USING fts5(
    title,
    subtitle,
    body,
    content='catalog',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  );
`;

/** Índice das colunas em `catalog_fts`, para o `snippet()` apontar certo. */
export const FTS_COLUMN = { title: 0, subtitle: 1, body: 2 } as const;

/** Reconstrói o índice a partir da tabela de conteúdo. */
export const CATALOG_REBUILD = `INSERT INTO catalog_fts(catalog_fts) VALUES('rebuild');`;

/** Compacta e otimiza — roda uma vez, no fim do pipeline. */
export const CATALOG_OPTIMIZE = `
  INSERT INTO catalog_fts(catalog_fts) VALUES('optimize');
  VACUUM;
`;
