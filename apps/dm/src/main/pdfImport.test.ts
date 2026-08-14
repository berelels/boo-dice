import Database from 'better-sqlite3';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RulesSearch } from '@dfo/core';
import { BetterSqlite3Driver } from '@dfo/core/db/better-sqlite3';
import { chunkText, importPdf, removePdf } from './pdfImport.js';

// PDF mínimo válido de uma página, gerado à mão (sem depender de nenhuma
// ferramenta externa no ambiente de teste): duas linhas de texto simples,
// suficiente pra provar que a extração real do pdf.js funciona ponta a ponta.
const MINIMAL_PDF = Buffer.from(
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length 90>>
stream
BT /F1 12 Tf 10 150 Td (Bola de Fogo Sinistra causa dano de fogo.) Tj ET
BT /F1 12 Tf 10 120 Td (Corvo das Sombras tem voo.) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f
trailer<</Size 6/Root 1 0 R>>
startxref
0
%%EOF`,
  'utf8',
);

describe('chunkText', () => {
  it('mantém um parágrafo só como um chunk', () => {
    expect(chunkText('Uma frase qualquer.')).toEqual(['Uma frase qualquer.']);
  });

  it('agrupa parágrafos curtos no mesmo chunk', () => {
    const text = 'Primeiro parágrafo.\nSegundo parágrafo.\n\nTerceiro parágrafo.';
    expect(chunkText(text, 1000)).toEqual([
      'Primeiro parágrafo.\n\nSegundo parágrafo.\n\nTerceiro parágrafo.',
    ]);
  });

  it('corta em novo chunk quando passaria do limite', () => {
    const a = 'a'.repeat(40);
    const b = 'b'.repeat(40);
    const chunks = chunkText(`${a}\n\n${b}`, 50);
    expect(chunks).toEqual([a, b]);
  });

  it('ignora linhas em branco', () => {
    expect(chunkText('  \n\n  \n')).toEqual([]);
  });
});

describe('importPdf / removePdf', () => {
  let dir: string;
  let catalogPath: string;
  let pdfPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dfo-pdf-import-'));
    catalogPath = join(dir, 'pdf-library.db');
    pdfPath = join(dir, 'Xanathar Guia de Tudo.pdf');
    await writeFile(pdfPath, MINIMAL_PDF);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('extrai o texto real do PDF e indexa como catálogo pesquisável', async () => {
    const result = await importPdf(catalogPath, pdfPath);

    expect(result.id).toBe('xanathar-guia-de-tudo');
    expect(result.title).toBe('Xanathar Guia de Tudo');
    expect(result.pages).toBe(1);
    expect(result.chunks).toBeGreaterThan(0);

    const driver = new BetterSqlite3Driver(catalogPath, { readonly: true });
    const search = new RulesSearch(driver);

    const hits = await search.search('bola de fogo');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.id).toMatch(/^pdf:xanathar-guia-de-tudo:1-/);
    expect(hits[0]!.subtitle).toBe('Xanathar Guia de Tudo');

    const corvo = await search.search('corvo sombras voo');
    expect(corvo.length).toBeGreaterThan(0);
  });

  it('reimportar o mesmo arquivo substitui as páginas antigas, não duplica', async () => {
    await importPdf(catalogPath, pdfPath);
    await importPdf(catalogPath, pdfPath);

    const db = new Database(catalogPath, { readonly: true });
    const rows = db.prepare("SELECT COUNT(*) AS total FROM catalog WHERE id LIKE 'pdf:xanathar-guia-de-tudo:%'").get() as {
      total: number;
    };
    db.close();

    expect(rows.total).toBeGreaterThan(0);
    expect(rows.total).toBeLessThan(3); // não dobrou em relação a uma importação só
  });

  it('remove só as páginas do PDF apagado', async () => {
    await importPdf(catalogPath, pdfPath);

    const otherPdfPath = join(dir, 'Outro Livro.pdf');
    await writeFile(otherPdfPath, MINIMAL_PDF);
    await importPdf(catalogPath, otherPdfPath);

    removePdf(catalogPath, 'xanathar-guia-de-tudo');

    const db = new Database(catalogPath, { readonly: true });
    const remaining = db.prepare('SELECT id FROM catalog').all() as { id: string }[];
    db.close();

    expect(remaining.every((row) => !row.id.startsWith('pdf:xanathar-guia-de-tudo:'))).toBe(true);
    expect(remaining.some((row) => row.id.startsWith('pdf:outro-livro:'))).toBe(true);
  });

  it('remover um PDF nunca importado não quebra nada', () => {
    expect(() => removePdf(catalogPath, 'nao-existe')).not.toThrow();
  });
});
