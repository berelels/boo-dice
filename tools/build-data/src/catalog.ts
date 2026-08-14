import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CATALOG_SCHEMA, CATALOG_REBUILD, CATALOG_OPTIMIZE } from '@dfo/core';

/**
 * Escritor do catálogo. É o único ponto que grava em `srd.db` e `books.db`, e
 * usa exatamente o mesmo DDL que a busca lê (importado do core), de modo que
 * as duas pontas não podem divergir.
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

export interface CatalogEntryInput {
  readonly id: string;
  readonly kind: CatalogKind;
  readonly title: string;
  readonly subtitle?: string;
  readonly body?: string;
  readonly section?: string | null;
  readonly lang?: 'pt' | 'en';
  readonly data?: unknown;
}

export class CatalogWriter {
  private readonly db: Database.Database;
  private readonly insert: Database.Statement;
  private readonly counts = new Map<string, number>();

  constructor(filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    this.db.pragma('journal_mode = MEMORY');
    this.db.exec(CATALOG_SCHEMA);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS catalog_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // ON CONFLICT REPLACE: reconstruir o banco do zero é a operação normal, e
    // um id repetido entre fontes deve ser sobrescrito, não abortar o build.
    this.insert = this.db.prepare(`
      INSERT INTO catalog (id, kind, title, subtitle, body, section, lang, data)
      VALUES (@id, @kind, @title, @subtitle, @body, @section, @lang, @data)
      ON CONFLICT (id) DO UPDATE SET
        kind = excluded.kind, title = excluded.title, subtitle = excluded.subtitle,
        body = excluded.body, section = excluded.section, lang = excluded.lang,
        data = excluded.data
    `);
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO catalog_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  add(entry: CatalogEntryInput): void {
    this.insert.run({
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      subtitle: entry.subtitle ?? '',
      body: entry.body ?? '',
      section: entry.section ?? null,
      lang: entry.lang ?? 'pt',
      data: entry.data === undefined ? null : JSON.stringify(entry.data),
    });
    this.counts.set(entry.kind, (this.counts.get(entry.kind) ?? 0) + 1);
  }

  addMany(entries: Iterable<CatalogEntryInput>): void {
    const run = this.db.transaction((items: CatalogEntryInput[]) => {
      for (const item of items) this.add(item);
    });
    run([...entries]);
  }

  summary(): Record<string, number> {
    return Object.fromEntries([...this.counts].sort(([a], [b]) => a.localeCompare(b)));
  }

  /**
   * Reconstrói o índice FTS a partir da tabela de conteúdo e compacta.
   *
   * O `rebuild` roda no fim, e não a cada inserção: indexar 2.000 registros de
   * uma vez é ordens de grandeza mais rápido que manter gatilhos ativos
   * durante a carga.
   */
  finalize(): void {
    this.db.exec(CATALOG_REBUILD);
    this.db.exec(CATALOG_OPTIMIZE);

    // O artefato precisa sair em modo rollback, nunca em WAL. O navegador
    // carrega este arquivo como uma imagem em memória, e um banco marcado como
    // WAL no cabeçalho exige um arquivo `-wal` que não existe ali — o SQLite
    // recusa com SQLITE_CANTOPEN. `journal_mode` é persistente, então esta
    // linha é o que garante que o arquivo distribuído abra no navegador.
    this.db.pragma('journal_mode = DELETE');
    this.db.close();
  }
}

/** Normaliza texto vindo dos JSONs: array de parágrafos vira um bloco só. */
export function joinParagraphs(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
      .join('\n\n')
      .trim();
  }
  return '';
}

/** Slug estável para IDs: minúsculas, sem acento, hifenizado. */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
