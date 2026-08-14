/**
 * Contrato de acesso ao SQLite.
 *
 * A mesma lógica precisa rodar em três lugares diferentes:
 *
 *  - `better-sqlite3`              — Node (testes) e Electron (app do mestre)
 *  - `@capacitor-community/sqlite` — Android e iOS
 *  - `wa-sqlite` + OPFS           — navegador, durante o desenvolvimento
 *
 * A interface é assíncrona porque duas das três implementações são. O
 * `better-sqlite3` é síncrono e só embrulha o retorno numa Promise já
 * resolvida — pagar essa taxa mínima em Node é bem mais barato que manter duas
 * versões de cada consulta.
 */

export type SqlValue = string | number | null | Uint8Array;

export interface SqlDriver {
  /** Comando sem retorno: INSERT, UPDATE, DELETE, DDL. */
  execute(sql: string, params?: readonly SqlValue[]): Promise<void>;

  /** Consulta com retorno de linhas. */
  query<T = Record<string, SqlValue>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;

  /** Primeira linha, ou `null` se não houver nenhuma. */
  queryOne<T = Record<string, SqlValue>>(
    sql: string,
    params?: readonly SqlValue[],
  ): Promise<T | null>;

  /**
   * Executa dentro de uma transação, revertendo tudo se a função lançar.
   * Não aninhe: quem já está dentro de uma transação recebe o mesmo driver.
   */
  transaction<T>(work: (tx: SqlDriver) => Promise<T>): Promise<T>;

  /** Executa um script com vários comandos separados por `;`. */
  executeScript(sql: string): Promise<void>;

  close(): Promise<void>;
}

/**
 * Base compartilhada: `queryOne` e `transaction` têm a mesma forma em todos os
 * drivers, então cada implementação só precisa de `execute`, `query`,
 * `executeScript` e `close`.
 */
export abstract class BaseSqlDriver implements SqlDriver {
  abstract execute(sql: string, params?: readonly SqlValue[]): Promise<void>;
  abstract query<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  abstract executeScript(sql: string): Promise<void>;
  abstract close(): Promise<void>;

  async queryOne<T>(sql: string, params?: readonly SqlValue[]): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async transaction<T>(work: (tx: SqlDriver) => Promise<T>): Promise<T> {
    await this.execute('BEGIN');
    try {
      const result = await work(this);
      await this.execute('COMMIT');
      return result;
    } catch (error) {
      // Se o próprio ROLLBACK falhar, o erro original é o que importa — ele é
      // que explica o que deu errado.
      await this.execute('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }
}

export class DatabaseError extends Error {
  constructor(
    message: string,
    readonly sql: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}
