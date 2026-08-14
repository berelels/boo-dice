import { app } from 'electron';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/**
 * Dois lugares diferentes para dois tipos de dado.
 *
 * Os catálogos (`srd.db`/`books.db`) são somente-leitura e vêm empacotados
 * com o app — em desenvolvimento, a cópia local feita por `scripts/sync-
 * data.mjs`; empacotado, os `extraResources` do electron-builder, servidos a
 * partir de `process.resourcesPath`. O `dm.db` é gravável e é o único banco
 * que pertence de fato ao usuário — sempre em `userData`, nunca dentro do
 * pacote do app (que é somente-leitura depois de instalado).
 */

export function resolveResourceDataDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'data')
    : resolve(HERE, '../../resources/data');
}

export function resolveUserDataDbPath(): string {
  return join(app.getPath('userData'), 'dm.db');
}

/** Acervo gravável dos PDFs que o próprio mestre importa — nunca empacotado, sempre local. */
export function resolveUserPdfCatalogPath(): string {
  return join(app.getPath('userData'), 'pdf-library.db');
}

/**
 * O modelo do Oráculo não vem empacotado — baixa uma vez, na primeira
 * pergunta, e fica em `userData` pra sempre. Empacotar ~1GB no instalador
 * penalizaria todo mundo que nunca vai usar o Oráculo; baixar sob demanda só
 * pesa pra quem realmente pede a primeira pergunta.
 */
export function resolveOracleModelPath(): string {
  return join(app.getPath('userData'), 'oracle-model.gguf');
}
