import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BetterSqlite3Driver } from '@dfo/core/db/better-sqlite3';
import { RulesSearch } from '@dfo/core';

/** Conferência rápida dos bancos gerados: `npx tsx tools/build-data/scripts/check-db.ts` */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

async function main(): Promise<void> {
  for (const name of ['srd.db', 'books.db']) {
    const path = resolve(ROOT, 'packages/data/dist', name);
    // Somente-leitura: inspecionar um artefato distribuível não pode alterá-lo.
    const driver = new BetterSqlite3Driver(path, { readonly: true });
    const search = new RulesSearch(driver);

    console.log(`\n--- ${name} ---`);
    console.log('  por tipo:', JSON.stringify(await search.countByKind()));

    for (const query of ['bola de fogo', 'conjuracao', 'goblin', 'agarrado', 'misseis magicos']) {
      const hits = await search.search(query, { limit: 2 });
      const rendered = hits.map((hit) => `${hit.title} [${hit.kind}/${hit.lang}]`).join(' | ');
      console.log(`  "${query}" -> ${rendered || '(nada)'}`);
    }

    await driver.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
