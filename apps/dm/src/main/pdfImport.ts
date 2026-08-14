import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
// A build "legacy" é a recomendada pelo próprio pdf.js pra rodar em Node —
// a build padrão assume DOM. Sem `Worker` global (nem `workerSrc`
// configurado), o próprio pdf.js detecta o ambiente Node e roda a extração
// na mesma thread, sem precisar de nenhuma opção extra pra isso.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  buildPdfCatalogRows,
  CATALOG_REBUILD,
  CATALOG_SCHEMA,
  chunkText,
  slugifyBookId,
  type PdfCatalogRow,
} from '@dfo/core';

export { chunkText };

/**
 * Indexação de PDFs do mestre — a base de busca do Oráculo.
 *
 * Mesmo formato de catálogo do SRD/livro (`catalog`/`catalog_fts`), mas num
 * banco gravável em `userData`, nunca empacotado: cada PDF vira um lote de
 * verbetes `kind: 'rule'`, um por página (ou mais, se a página for densa
 * demais pra um verbete só), com o texto extraído localmente — nada sai da
 * máquina do mestre.
 */

export interface ImportedPdf {
  readonly id: string;
  readonly title: string;
  readonly fileName: string;
  readonly pages: number;
  readonly chunks: number;
  readonly importedAt: string;
}

export async function importPdf(catalogPath: string, filePath: string): Promise<ImportedPdf> {
  const buffer = await readFile(filePath);
  const doc = await getDocument({ data: new Uint8Array(buffer) }).promise;

  const title = basename(filePath, extname(filePath));
  const bookId = slugifyBookId(title);

  const pageTexts: string[] = [];
  for (let page = 1; page <= doc.numPages; page += 1) {
    pageTexts.push(await extractPageText(doc, page));
  }
  const entries = buildPdfCatalogRows(bookId, title, pageTexts);

  writeEntries(catalogPath, bookId, entries);

  return {
    id: bookId,
    title,
    fileName: basename(filePath),
    pages: doc.numPages,
    chunks: entries.length,
    importedAt: new Date().toISOString(),
  };
}

export function removePdf(catalogPath: string, bookId: string): void {
  if (!existsSync(catalogPath)) return;
  const db = new Database(catalogPath);
  try {
    db.prepare('DELETE FROM catalog WHERE id LIKE ?').run(`pdf:${bookId}:%`);
    db.exec(CATALOG_REBUILD);
  } finally {
    db.close();
  }
}

async function extractPageText(
  doc: Awaited<ReturnType<typeof getDocument>['promise']>,
  pageNumber: number,
): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();

  let text = '';
  for (const item of content.items) {
    if (!('str' in item)) continue; // TextMarkedContent não tem texto, só marcação de estrutura.
    text += `${item.str} `;
    if (item.hasEOL) text += '\n';
  }
  return text;
}

/**
 * Grava direto com `better-sqlite3`, sem passar pelo `CatalogWriter` do
 * pipeline de build — aquele é uma ferramenta de desenvolvedor (lê HTML,
 * roda por `npm run data:book`); isto aqui roda dentro do app empacotado, a
 * partir de um PDF que o mestre escolheu na hora.
 */
function writeEntries(catalogPath: string, bookId: string, entries: readonly PdfCatalogRow[]): void {
  const db = new Database(catalogPath);
  try {
    db.pragma('journal_mode = MEMORY');
    db.exec(CATALOG_SCHEMA);

    // Reimportar o mesmo PDF substitui as páginas antigas, não duplica.
    db.prepare('DELETE FROM catalog WHERE id LIKE ?').run(`pdf:${bookId}:%`);

    const insert = db.prepare(`
      INSERT INTO catalog (id, kind, title, subtitle, body, section, lang, data)
      VALUES (@id, @kind, @title, @subtitle, @body, @section, @lang, @data)
    `);
    const insertMany = db.transaction((rows: readonly PdfCatalogRow[]) => {
      for (const row of rows) {
        insert.run({
          id: row.id,
          kind: row.kind,
          title: row.title,
          subtitle: row.subtitle,
          body: row.body,
          section: row.section,
          lang: row.lang,
          data: JSON.stringify(row.data),
        });
      }
    });
    insertMany(entries);

    db.exec(CATALOG_REBUILD);

    // Formato de leitura, não de escrita: o resto do app abre este arquivo
    // como somente-leitura, e um cabeçalho WAL sem o `-wal` ao lado quebraria
    // essa leitura — mesma razão documentada no `CatalogWriter` do pipeline.
    db.pragma('journal_mode = DELETE');
  } finally {
    db.close();
  }
}
