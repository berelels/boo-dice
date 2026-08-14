import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
// O `?url` faz o Vite tratar o worker como um asset — resolve certo tanto no
// dev quanto no build de produção (nome com hash, caminho correto no PWA
// servido de um subcaminho como o GitHub Pages).
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import {
  buildPdfCatalogRows,
  CATALOG_REBUILD,
  CATALOG_SCHEMA,
  slugifyBookId,
  type SqlDriver,
} from '@dfo/core';

/**
 * Importação de PDF pelo próprio jogador — o único jeito de ter regras em
 * português além do SRD no PWA/mobile, já que `npm run data:book` é um
 * comando de desenvolvedor que não existe pra quem só instalou o app.
 *
 * Mesmo formato de catálogo do SRD (`catalog`/`catalog_fts`), extração de
 * texto e corte em pedaços compartilhados com o app do mestre via
 * `@dfo/core` — só a gravação muda, porque aqui é `SqlDriver` (WASM no
 * navegador, nativo no Android) em vez de `better-sqlite3` direto. Tudo roda
 * no aparelho; o PDF nunca sai dele.
 */

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ImportedPdf {
  readonly id: string;
  readonly title: string;
  readonly pages: number;
  readonly chunks: number;
}

export async function importPdf(driver: SqlDriver, file: File): Promise<ImportedPdf> {
  const buffer = await file.arrayBuffer();
  const doc = await getDocument({ data: new Uint8Array(buffer) }).promise;

  const title = stripExtension(file.name);
  const bookId = slugifyBookId(title);

  const pageTexts: string[] = [];
  for (let page = 1; page <= doc.numPages; page += 1) {
    pageTexts.push(await extractPageText(doc, page));
  }
  const entries = buildPdfCatalogRows(bookId, title, pageTexts);

  await driver.executeScript(CATALOG_SCHEMA);
  await driver.transaction(async (tx) => {
    // Reimportar o mesmo PDF substitui as páginas antigas, não duplica.
    await tx.execute('DELETE FROM catalog WHERE id LIKE ?', [`pdf:${bookId}:%`]);
    for (const row of entries) {
      await tx.execute(
        `INSERT INTO catalog (id, kind, title, subtitle, body, section, lang, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.id, row.kind, row.title, row.subtitle, row.body, row.section, row.lang, JSON.stringify(row.data)],
      );
    }
  });
  await driver.executeScript(CATALOG_REBUILD);

  return { id: bookId, title, pages: doc.numPages, chunks: entries.length };
}

export async function removePdf(driver: SqlDriver, bookId: string): Promise<void> {
  await driver.execute('DELETE FROM catalog WHERE id LIKE ?', [`pdf:${bookId}:%`]);
  await driver.executeScript(CATALOG_REBUILD);
}

interface PdfCatalogQueryRow {
  readonly subtitle: string;
  readonly data: string;
}

/**
 * Deriva a lista de PDFs importados a partir do próprio catálogo — sem
 * metadado guardado à parte, então nada fica dessincronizado. Custa uma
 * varredura da tabela, mas ela só existe aqui, num banco só do jogador,
 * nunca com milhares de páginas.
 */
export async function listImportedPdfs(driver: SqlDriver): Promise<ImportedPdf[]> {
  let rows: PdfCatalogQueryRow[];
  try {
    rows = await driver.query<PdfCatalogQueryRow>(
      "SELECT subtitle, data FROM catalog WHERE id LIKE 'pdf:%'",
    );
  } catch {
    // Tabela `catalog` ainda não existe — nenhum PDF foi importado ainda.
    return [];
  }

  const bySource = new Map<string, { title: string; pages: number; chunks: number }>();
  for (const row of rows) {
    const parsed = JSON.parse(row.data) as { source: string; page: number };
    const entry = bySource.get(parsed.source) ?? { title: row.subtitle, pages: 0, chunks: 0 };
    entry.pages = Math.max(entry.pages, parsed.page);
    entry.chunks += 1;
    bySource.set(parsed.source, entry);
  }

  return [...bySource.entries()]
    .map(([id, { title, pages, chunks }]) => ({ id, title, pages, chunks }))
    .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
}

async function extractPageText(doc: PDFDocumentProxy, pageNumber: number): Promise<string> {
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

function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}
