import Database from 'better-sqlite3';
import { BaseSqlDriver, DatabaseError, type SqlDriver, type SqlValue } from '../driver.js';

/**
 * Driver para Node e Electron.
 *
 * O `better-sqlite3` é síncrono; embrulhamos em Promises para respeitar o
 * contrato compartilhado com os drivers do celular. É este driver que os testes
 * usam, o que significa que a lógica de persistência é exercitada de verdade —
 * não contra um dublê.
 */
export class BetterSqlite3Driver extends BaseSqlDriver implements SqlDriver {
  private readonly db: Database.Database;
  private inTransaction = false;

  constructor(filename = ':memory:', options: { readonly?: boolean } = {}) {
    super();
    this.db = new Database(filename, { readonly: options.readonly ?? false });

    // `journal_mode = WAL` é **persistente**: fica gravado nos bytes 18/19 do
    // cabeçalho do arquivo. Abrir um banco distribuível só para inspecioná-lo
    // já o converteria para WAL, e um banco WAL não pode ser aberto a partir
    // de uma imagem em memória (o arquivo `-wal` não existe) — o que derruba o
    // app no navegador com SQLITE_CANTOPEN. Por isso o modo somente-leitura
    // não toca em pragma nenhum.
    if (!options.readonly) {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
    }
  }

  async execute(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    // BEGIN/COMMIT/ROLLBACK passam direto; o resto vai como statement normal.
    try {
      this.db.prepare(sql).run(...params);
    } catch (error) {
      throw new DatabaseError(errorMessage(error), sql, error);
    }
  }

  async query<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    try {
      return this.db.prepare(sql).all(...params) as T[];
    } catch (error) {
      throw new DatabaseError(errorMessage(error), sql, error);
    }
  }

  async executeScript(sql: string): Promise<void> {
    try {
      this.db.exec(sql);
    } catch (error) {
      throw new DatabaseError(errorMessage(error), sql, error);
    }
  }

  /**
   * O `better-sqlite3` não aceita `BEGIN` via `prepare().run()` quando já há
   * uma transação aberta, então controlamos o aninhamento aqui: a transação
   * mais externa é a que comanda.
   */
  override async transaction<T>(work: (tx: SqlDriver) => Promise<T>): Promise<T> {
    if (this.inTransaction) return work(this);

    this.inTransaction = true;
    this.db.exec('BEGIN');
    try {
      const result = await work(this);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // O erro original é o que interessa.
      }
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }

  /** Anexa outro arquivo SQLite — usado para consultar `srd.db` junto. */
  async attach(filename: string, alias: string): Promise<void> {
    this.db.prepare('ATTACH DATABASE ? AS ' + quoteIdentifier(alias)).run(filename);
  }
}

function quoteIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Alias inválido para ATTACH: ${name}`);
  }
  return `"${name}"`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
