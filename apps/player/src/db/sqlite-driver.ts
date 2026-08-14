import sqlite3InitModule, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { BaseSqlDriver, DatabaseError, type SqlDriver, type SqlValue } from '@dfo/core';

/**
 * Driver SQLite para o navegador, sobre o build WASM **oficial** do SQLite.
 *
 * A primeira versão disto usava `sql.js`, e caiu na primeira busca do
 * glossário com `no such module: fts5`: o build publicado do sql.js é
 * compilado sem FTS5. Como o glossário inteiro é construído sobre FTS5 — e os
 * testes em Node passavam, porque o `better-sqlite3` traz FTS5 — o problema só
 * apareceu no navegador. O build oficial do projeto SQLite traz FTS5 de
 * fábrica, além de ser mantido pelos próprios autores do SQLite.
 *
 * O banco vive em memória e é persistido inteiro no IndexedDB, com debounce.
 * Para o volume em jogo — algumas fichas e um registro de rolagens — isso é
 * barato e, principalmente, previsível: dispensa OPFS e os cabeçalhos
 * COOP/COEP que ele exigiria do servidor.
 *
 * No Android e no iOS quem assume é `@capacitor-community/sqlite`, com arquivo
 * de verdade. Como os dois falam a mesma interface `SqlDriver`, nada acima
 * desta camada precisa saber onde está rodando.
 */

let runtime: Promise<Sqlite3Static> | null = null;

function sqliteRuntime(): Promise<Sqlite3Static> {
  // Ao inicializar, o módulo avisa no console que rodar na thread principal
  // impede o OPFS. O aviso é esperado e inofensivo aqui: a persistência é no
  // IndexedDB, por decisão, e não no OPFS.
  runtime ??= sqlite3InitModule();
  return runtime;
}

const IDB_NAME = 'dfo';
const IDB_STORE = 'databases';
const SAVE_DEBOUNCE_MS = 400;

let idb: Promise<IDBDatabase> | null = null;

/**
 * Uma única conexão, reaberta nunca.
 *
 * Cada personagem editado agenda um `idbPut` (o debounce do `scheduleSave`), e
 * uma sessão de edição de verdade dispara dezenas deles. Abrir uma conexão
 * nova do IndexedDB a cada leitura ou escrita — como esta função fazia antes —
 * empilha uma conexão nunca fechada por chamada. Isso não trava na hora; o
 * app vai ficando mais pesado a cada gravação até travar de vez, exatamente o
 * tipo de bug que só aparece "depois de um tempo" de uso e exige limpar o
 * IndexedDB pra sumir. Uma conexão só, guardada aqui e reaproveitada, elimina
 * o vazamento.
 */
function openIdb(): Promise<IDBDatabase> {
  idb ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(IDB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return idb;
}

async function idbGet(key: string): Promise<Uint8Array | null> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
    request.onsuccess = () => resolve((request.result as Uint8Array | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function idbPut(key: string, value: Uint8Array): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IDB_STORE, 'readwrite');
    transaction.objectStore(IDB_STORE).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export class SqliteWasmDriver extends BaseSqlDriver implements SqlDriver {
  private saveTimer: number | null = null;

  private constructor(
    private readonly sqlite3: Sqlite3Static,
    private readonly db: Database,
    /** `null` para bancos somente-leitura, que não precisam ser persistidos. */
    private readonly persistKey: string | null,
  ) {
    super();
  }

  /** Abre (ou cria) um banco persistido no IndexedDB. */
  static async open(persistKey: string): Promise<SqliteWasmDriver> {
    const sqlite3 = await sqliteRuntime();
    const saved = await idbGet(persistKey);
    const db = new sqlite3.oo1.DB();

    if (saved && saved.byteLength > 0) deserializeInto(sqlite3, db, saved);
    db.exec('PRAGMA foreign_keys = ON');

    return new SqliteWasmDriver(sqlite3, db, persistKey);
  }

  /** Abre um banco somente-leitura a partir de uma URL (os acervos embarcados). */
  static async openFromUrl(url: string): Promise<SqliteWasmDriver> {
    const sqlite3 = await sqliteRuntime();
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Não consegui carregar ${url}: HTTP ${response.status}`);

    const bytes = new Uint8Array(await response.arrayBuffer());
    const db = new sqlite3.oo1.DB();
    deserializeInto(sqlite3, db, bytes);

    return new SqliteWasmDriver(sqlite3, db, null);
  }

  async execute(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    try {
      this.db.exec({ sql, bind: params as SqlValue[] });
    } catch (error) {
      throw new DatabaseError(message(error), sql, error);
    }
    this.scheduleSave();
  }

  async query<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    try {
      return this.db.exec({
        sql,
        bind: params as SqlValue[],
        rowMode: 'object',
        returnValue: 'resultRows',
      }) as T[];
    } catch (error) {
      throw new DatabaseError(message(error), sql, error);
    }
  }

  async executeScript(sql: string): Promise<void> {
    try {
      this.db.exec(sql);
    } catch (error) {
      throw new DatabaseError(message(error), sql, error);
    }
    this.scheduleSave();
  }

  /**
   * Persistir a cada escrita seria desperdício: uma edição na ficha dispara
   * várias. O debounce agrupa a rajada, e `flush()` garante a gravação nos
   * momentos críticos (fechar a tela, sair do app).
   */
  private scheduleSave(): void {
    if (this.persistKey === null) return;
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flush(), SAVE_DEBOUNCE_MS);
  }

  async flush(): Promise<void> {
    if (this.persistKey === null) return;
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await idbPut(this.persistKey, this.sqlite3.capi.sqlite3_js_db_export(this.db));
  }

  async close(): Promise<void> {
    await this.flush();
    this.db.close();
  }
}

/**
 * Carrega bytes de um arquivo SQLite dentro de uma conexão já aberta.
 *
 * `FREEONCLOSE` entrega a posse do buffer WASM ao SQLite, para ele liberar a
 * memória ao fechar; `RESIZEABLE` permite que o banco cresça depois — sem essa
 * flag, a primeira escrita num banco carregado falharia por falta de espaço.
 */
function deserializeInto(sqlite3: Sqlite3Static, db: Database, bytes: Uint8Array): void {
  const pointer = sqlite3.wasm.allocFromTypedArray(bytes);
  const rc = sqlite3.capi.sqlite3_deserialize(
    db.pointer!,
    'main',
    pointer,
    bytes.byteLength,
    bytes.byteLength,
    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
  );
  db.checkRc(rc);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
