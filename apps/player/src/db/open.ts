import { Capacitor } from '@capacitor/core';
import type { SqlDriver } from '@dfo/core';
import { SqliteWasmDriver } from './sqlite-driver.js';

/**
 * Escolhe o driver conforme o alvo.
 *
 * No Android e no iOS, o plugin nativo grava num arquivo de verdade. No
 * navegador, o SQLite WASM com persistência em IndexedDB. Os dois implementam
 * `SqlDriver`, então esta função é o único lugar do app que sabe da diferença.
 *
 * O driver nativo entra por `import()` dinâmico de propósito: importá-lo no
 * topo arrastaria o plugin inteiro para dentro do bundle web, onde ele nunca
 * roda.
 */

export interface PersistentDriver extends SqlDriver {
  /** Garante que alterações pendentes chegaram ao armazenamento. */
  flush(): Promise<void>;
}

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export async function openPlayerDatabase(): Promise<PersistentDriver> {
  if (isNative()) {
    const { CapacitorSqliteDriver } = await import('./capacitor-driver.js');
    return CapacitorSqliteDriver.open('player');
  }
  return SqliteWasmDriver.open('player.db');
}

/**
 * Banco gravável dos PDFs que o próprio jogador importou — sem `npm run
 * data:book`, ele não tem como gerar `books.db`, então isto é o único jeito
 * de ter regras em português além do SRD no PWA/mobile. Cria vazio na
 * primeira vez; quem decide se tem conteúdo de verdade é `pdfImport.ts`.
 */
export async function openPdfLibraryDatabase(): Promise<PersistentDriver> {
  if (isNative()) {
    const { CapacitorSqliteDriver } = await import('./capacitor-driver.js');
    return CapacitorSqliteDriver.open('pdf-library');
  }
  return SqliteWasmDriver.open('pdf-library.db');
}

/**
 * Abre um acervo somente-leitura. No navegador vem por HTTP; no nativo, do
 * arquivo copiado dos assets do app na primeira execução.
 */
export async function openLibraryDatabase(name: string): Promise<SqlDriver> {
  if (isNative()) {
    const { CapacitorSqliteDriver } = await import('./capacitor-driver.js');
    return CapacitorSqliteDriver.openBundled(name);
  }
  return SqliteWasmDriver.openFromUrl(`/data/${name}.db`);
}
