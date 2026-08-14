import { cp, mkdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copia os catálogos gerados pelo pipeline para `resources/data/`, de onde o
 * processo main os abre direto com `better-sqlite3` (sem servidor, sem
 * `fetch`) e de onde o electron-builder os embarca como `extraResources`.
 *
 * Rodar sem os bancos não é erro — o app abre, e o bestiário fica vazio até
 * `npm run data` (na raiz) gerar `packages/data/dist/*.db`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, '../../../packages/data/dist');
const TARGET = resolve(HERE, '../resources/data');

await mkdir(TARGET, { recursive: true });

for (const file of ['srd.db', 'books.db']) {
  try {
    await access(resolve(SOURCE, file));
    await cp(resolve(SOURCE, file), resolve(TARGET, file));
    console.log(`  ${file} copiado`);
  } catch {
    console.log(`  ${file} ausente — rode "npm run data" (SRD) ou "npm run data:book <arquivo>" na raiz`);
  }
}
