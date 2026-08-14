import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite';
import { BaseSqlDriver, DatabaseError, type SqlDriver, type SqlValue } from '@dfo/core';

/**
 * Driver SQLite nativo, para Android e iOS.
 *
 * Aqui o banco é um arquivo de verdade na área privada do app: não há
 * serialização para IndexedDB, não há debounce de gravação, e o SQLite grava
 * incrementalmente como faria num desktop. A ficha sobrevive a um encerramento
 * abrupto do app sem depender de nada da camada web.
 *
 * A interface é a mesma `SqlDriver` do navegador, então nenhuma tela, nenhum
 * repositório e nenhuma consulta muda entre os dois alvos.
 */
export class CapacitorSqliteDriver extends BaseSqlDriver implements SqlDriver {
  private constructor(
    private readonly connection: SQLiteDBConnection,
    private readonly name: string,
    private readonly pool: SQLiteConnection,
  ) {
    super();
  }

  static async open(name: string): Promise<CapacitorSqliteDriver> {
    const pool = new SQLiteConnection(CapacitorSQLite);

    // Uma conexão pode ter sobrevivido a um recarregamento da WebView; reusá-la
    // evita o erro de "conexão já existente" ao voltar para o app.
    const existing = await pool.isConnection(name, false);
    const connection = existing.result
      ? await pool.retrieveConnection(name, false)
      : await pool.createConnection(name, false, 'no-encryption', 1, false);

    await connection.open();
    await connection.execute('PRAGMA foreign_keys = ON');

    return new CapacitorSqliteDriver(connection, name, pool);
  }

  /**
   * Copia os acervos embarcados (`srd.db`, `books.db`) de `public/` para o
   * diretório de bancos do app, no primeiro uso, e abre em modo leitura.
   */
  static async openBundled(name: string): Promise<CapacitorSqliteDriver> {
    const pool = new SQLiteConnection(CapacitorSQLite);

    const existing = await pool.isDatabase(name);
    if (!existing.result) {
      // O plugin importa a partir de `public/assets/databases/`, seguindo a
      // convenção dele; o script de sincronização coloca os arquivos lá.
      await pool.copyFromAssets(false);
    }

    const connection = await pool.createConnection(name, false, 'no-encryption', 1, true);
    await connection.open();

    return new CapacitorSqliteDriver(connection, name, pool);
  }

  async execute(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    try {
      await this.connection.run(sql, params as SqlValue[], false);
    } catch (error) {
      throw new DatabaseError(message(error), sql, error);
    }
  }

  async query<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    try {
      const result = await this.connection.query(sql, params as SqlValue[]);
      return (result.values ?? []) as T[];
    } catch (error) {
      throw new DatabaseError(message(error), sql, error);
    }
  }

  async executeScript(sql: string): Promise<void> {
    try {
      await this.connection.execute(sql, false);
    } catch (error) {
      throw new DatabaseError(message(error), sql, error);
    }
  }

  /** No nativo o SQLite já grava em disco; não há nada pendente para descarregar. */
  async flush(): Promise<void> {
    // Intencionalmente vazio — existe para igualar a interface do driver web.
  }

  async close(): Promise<void> {
    await this.connection.close();
    await this.pool.closeConnection(this.name, false);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
