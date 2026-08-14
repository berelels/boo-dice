import { cp, mkdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copia os bancos gerados pelo pipeline para `public/`, de onde o app os
 * carrega por HTTP.
 *
 * `packages/data/dist` continua sendo o lugar canônico dos artefatos; esta
 * cópia é só o caminho até o navegador. Rodar `dev` sem os bancos não é erro —
 * o app abre, avisa que o glossário está vazio, e a ficha funciona igual.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, '../../../packages/data/dist');
const TARGET = resolve(HERE, '../public/data');
const NATIVE_TARGET = resolve(HERE, '../public/assets/databases');

const FILES = ['srd.db', 'books.db', 'spell-links.json'];

await mkdir(TARGET, { recursive: true });

for (const file of FILES) {
  try {
    await access(resolve(SOURCE, file));
    await cp(resolve(SOURCE, file), resolve(TARGET, file));
    console.log(`  ${file} copiado`);
  } catch {
    console.log(`  ${file} ausente — rode "npm run data" (SRD) ou "npm run data:book <arquivo>"`);
  }
}

// O plugin nativo do Capacitor importa bancos de `public/assets/databases/`,
// e exige o sufixo `SQLite.db` no nome do arquivo. Duplicamos os acervos ali
// para que o mesmo build sirva web e nativo.
await mkdir(NATIVE_TARGET, { recursive: true });
for (const file of ['srd.db', 'books.db']) {
  try {
    await access(resolve(SOURCE, file));
    await cp(resolve(SOURCE, file), resolve(NATIVE_TARGET, `${file.replace('.db', '')}SQLite.db`));
  } catch {
    // Ausente: já reportado acima.
  }
}
