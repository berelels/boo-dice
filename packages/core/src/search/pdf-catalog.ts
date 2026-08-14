/**
 * Texto extraído de um PDF → linhas de catálogo (`kind: 'rule'`), no mesmo
 * formato que o SRD e os livros importados. Compartilhado entre o app do
 * mestre (Node/`pdfjs-dist` legacy build) e o do jogador (navegador/
 * `pdfjs-dist` build padrão) — a extração de texto por página é específica de
 * cada plataforma, mas transformar esse texto em verbetes pesquisáveis não é.
 */

const MAX_CHUNK_LENGTH = 1500;

export interface PdfCatalogRow {
  readonly id: string;
  readonly kind: 'rule';
  readonly title: string;
  readonly subtitle: string;
  readonly body: string;
  readonly section: string;
  readonly lang: 'pt';
  readonly data: { readonly source: string; readonly page: number };
}

/**
 * Agrupa parágrafos até `maxLength` — sem cabeçalho pra guiar o corte (PDF não
 * tem `<h2>`), a página é a unidade natural, e isto só existe pra não deixar
 * uma página excepcionalmente densa virar um verbete gigante.
 */
export function chunkText(pageText: string, maxLength = MAX_CHUNK_LENGTH): string[] {
  const paragraphs = pageText
    .split(/\n+/)
    .map((paragraph) => paragraph.replace(/[ \t]+/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0);

  const chunks: string[] = [];
  let buffer: string[] = [];
  let length = 0;

  for (const paragraph of paragraphs) {
    if (length > 0 && length + paragraph.length > maxLength) {
      chunks.push(buffer.join('\n\n'));
      buffer = [];
      length = 0;
    }
    buffer.push(paragraph);
    length += paragraph.length;
  }
  if (buffer.length > 0) chunks.push(buffer.join('\n\n'));

  return chunks;
}

export function slugifyBookId(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `pageTexts[i]` é o texto extraído da página `i + 1`. */
export function buildPdfCatalogRows(
  bookId: string,
  title: string,
  pageTexts: readonly string[],
): PdfCatalogRow[] {
  const rows: PdfCatalogRow[] = [];
  pageTexts.forEach((pageText, index) => {
    const page = index + 1;
    chunkText(pageText).forEach((chunk, chunkIndex) => {
      rows.push({
        id: `pdf:${bookId}:${page}-${chunkIndex}`,
        kind: 'rule',
        title: `${title} — p. ${page}`,
        subtitle: title,
        body: chunk,
        section: title,
        lang: 'pt',
        data: { source: bookId, page },
      });
    });
  });
  return rows;
}
