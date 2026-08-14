import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CatalogWriter } from './catalog.js';
import { ATTRIBUTION, fetchAllSrd } from './fetch.js';
import { buildSrdEntries } from './srd.js';
import {
  parseHtmlBlocks,
  parseRuleChunks,
  parseSpells,
  spellToCatalogEntry,
  stripTableOfContents,
} from './book.js';
import { linkSpells, toSrdSpellShape } from './link.js';

/**
 * CLI do pipeline de dados.
 *
 *   dfo-data srd              monta packages/data/dist/srd.db (distribuível)
 *   dfo-data book <arquivo>   importa um livro local para books.db (local)
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const CACHE_DIR = resolve(HERE, '../.cache');
const DATA_DIR = resolve(REPO_ROOT, 'packages/data/dist');

async function buildSrd(refresh: boolean): Promise<void> {
  console.log('Baixando o SRD 5.1 (CC-BY-4.0) de 5e-bits/5e-database…\n');
  const data = await fetchAllSrd({ cacheDir: CACHE_DIR, refresh });

  console.log('\nNormalizando…');
  const entries = buildSrdEntries(data);

  const target = resolve(DATA_DIR, 'srd.db');
  const writer = new CatalogWriter(target);
  writer.setMeta('attribution', ATTRIBUTION);
  writer.setMeta('built_at', new Date().toISOString());
  writer.setMeta('source', '5e-bits/5e-database (SRD 5.1)');
  writer.addMany(entries);

  const summary = writer.summary();
  writer.finalize();

  console.log(`\n${target}`);
  for (const [kind, count] of Object.entries(summary)) {
    console.log(`  ${kind.padEnd(12)} ${String(count).padStart(5)}`);
  }
  console.log(`  ${'TOTAL'.padEnd(12)} ${String(entries.length).padStart(5)}`);

  const translated = entries.filter((entry) => entry.lang === 'pt').length;
  console.log(
    `\n  em português: ${translated} · em inglês: ${entries.length - translated}` +
      `\n  (magias, monstros e equipamento não têm tradução oficial no dataset;` +
      `\n   importe seu livro com "npm run data:book" para cobri-los)`,
  );
}

async function importBook(path: string): Promise<void> {
  const source = resolve(process.cwd(), path);
  console.log(`Lendo ${source}…`);

  const html = await readFile(source, 'utf8');
  const document = stripTableOfContents(parseHtmlBlocks(html));
  console.log(`  ${document.blocks.length} blocos de texto`);

  const spells = parseSpells(document);
  const chunks = parseRuleChunks(document, 'livro-de-regras');
  console.log(`  ${spells.length} magias · ${chunks.length} blocos de regra`);

  const target = resolve(DATA_DIR, 'books.db');
  const writer = new CatalogWriter(target);
  writer.setMeta('source', source);
  writer.setMeta('imported_at', new Date().toISOString());
  writer.setMeta(
    'notice',
    'Conteúdo importado dos livros do próprio usuário. Este arquivo é local e não deve ser distribuído.',
  );
  writer.addMany(spells.map((spell) => spellToCatalogEntry(spell, 'livro-de-regras')));
  writer.addMany(chunks);
  writer.finalize();

  // Casa as magias em português com os índices do SRD, para a ficha saber que
  // "Bola de Fogo" e `fireball` são a mesma coisa.
  try {
    const srdSpells = JSON.parse(
      await readFile(resolve(CACHE_DIR, 'en/5e-SRD-Spells.json'), 'utf8'),
    ) as Record<string, unknown>[];

    const report = linkSpells(spells, srdSpells.map(toSrdSpellShape));
    const mapPath = resolve(DATA_DIR, 'spell-links.json');
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(
      mapPath,
      JSON.stringify(
        Object.fromEntries(report.links.map((link) => [link.ptName, link.srdIndex])),
        null,
        2,
      ),
      'utf8',
    );

    const byMethod = { curated: 0, full: 0, partial: 0 };
    for (const link of report.links) byMethod[link.matchedOn] += 1;
    console.log(
      `\n  ligação PT↔SRD: ${report.links.length}/${srdSpells.length} magias do SRD` +
        `\n    ${byMethod.full} por assinatura completa · ${byMethod.partial} por parcial · ${byMethod.curated} curadas`,
    );
    console.log(`  ambíguas: ${report.ambiguous.length} · fora do SRD: ${report.unmatchedPt.length}`);
    console.log(`  ${mapPath}`);
  } catch {
    console.log('\n  (rode "npm run data" antes para poder ligar as magias ao SRD)');
  }

  console.log(`\n${target}`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'srd':
      await buildSrd(args.includes('--refresh'));
      break;
    case 'book': {
      const path = args.find((arg) => !arg.startsWith('--'));
      if (!path) {
        console.error('Uso: dfo-data book <caminho-do-livro.html>');
        process.exitCode = 1;
        return;
      }
      await importBook(path);
      break;
    }
    default:
      console.error('Uso: dfo-data <srd | book <arquivo>> [--refresh]');
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
