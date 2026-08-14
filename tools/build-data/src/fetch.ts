import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Baixa os arquivos do SRD do repositório `5e-bits/5e-database`.
 *
 * O conteúdo é o SRD 5.1 da Wizards of the Coast, sob CC-BY-4.0 — pode ser
 * embarcado e distribuído, desde que a atribuição venha junto (ver
 * `ATTRIBUTION`, gravado dentro do próprio banco).
 *
 * Tudo fica em cache no disco: o pipeline roda várias vezes durante o
 * desenvolvimento, e não faz sentido buscar 2 MB de JSON a cada execução.
 */

const BASE_URL = 'https://raw.githubusercontent.com/5e-bits/5e-database/main/src/2014';

/** Arquivos que só existem em inglês. */
export const EN_FILES = [
  'Spells',
  'Monsters',
  'Equipment',
  'Magic-Items',
  'Classes',
  'Subclasses',
  'Features',
  'Races',
  'Subraces',
  'Traits',
  'Backgrounds',
  'Conditions',
  'Feats',
  'Rules',
  'Rule-Sections',
  'Skills',
  'Languages',
  'Damage-Types',
  'Magic-Schools',
  'Weapon-Properties',
  'Alignments',
] as const;

/**
 * Arquivos com tradução oficial no repositório. Repare no que **não** está
 * aqui: magias, monstros, equipamento e itens mágicos. O português desses vem
 * do livro do usuário, importado localmente — ver `book.ts`.
 */
export const PT_FILES = [
  'Conditions',
  'Races',
  'Backgrounds',
  'Feats',
  'Rules',
  'Skills',
  'Languages',
  'Damage-Types',
  'Magic-Schools',
  'Weapon-Properties',
  'Alignments',
  'Ability-Scores',
] as const;

export const ATTRIBUTION =
  'Conteúdo do SRD 5.1 © Wizards of the Coast LLC, sob licença Creative Commons Attribution 4.0 International (CC-BY-4.0). Dados estruturados de 5e-bits/5e-database (MIT).';

export interface FetchOptions {
  readonly cacheDir: string;
  /** Ignora o cache e baixa tudo de novo. */
  readonly refresh?: boolean;
}

export async function fetchSrdFile(
  language: 'en' | 'pt-BR',
  name: string,
  options: FetchOptions,
): Promise<unknown[]> {
  const fileName = `5e-SRD-${name}.json`;
  const cachePath = join(options.cacheDir, language, fileName);

  if (!options.refresh && existsSync(cachePath)) {
    return JSON.parse(await readFile(cachePath, 'utf8')) as unknown[];
  }

  const url = `${BASE_URL}/${language}/${fileName}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha ao baixar ${url}: HTTP ${response.status}`);
  }

  const text = await response.text();
  await mkdir(join(options.cacheDir, language), { recursive: true });
  await writeFile(cachePath, text, 'utf8');

  return JSON.parse(text) as unknown[];
}

export interface SrdData {
  readonly en: Map<string, unknown[]>;
  readonly pt: Map<string, unknown[]>;
}

export async function fetchAllSrd(options: FetchOptions): Promise<SrdData> {
  const en = new Map<string, unknown[]>();
  const pt = new Map<string, unknown[]>();

  // Sequencial de propósito: são ~25 arquivos, e disparar tudo em paralelo
  // contra o raw.githubusercontent rende 429 com facilidade.
  for (const name of EN_FILES) {
    process.stdout.write(`  en/${name}… `);
    en.set(name, await fetchSrdFile('en', name, options));
    process.stdout.write(`${en.get(name)!.length} registros\n`);
  }

  for (const name of PT_FILES) {
    process.stdout.write(`  pt-BR/${name}… `);
    try {
      pt.set(name, await fetchSrdFile('pt-BR', name, options));
      process.stdout.write(`${pt.get(name)!.length} registros\n`);
    } catch (error) {
      // Uma tradução que sumiu do repositório não deve derrubar o build —
      // o registro simplesmente fica em inglês, marcado como tal.
      process.stdout.write(`indisponível (${(error as Error).message})\n`);
    }
  }

  return { en, pt };
}

/** Índice `index → registro` para sobrepor a tradução ao registro em inglês. */
export function indexByKey(records: readonly unknown[]): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const record of records) {
    const entry = record as Record<string, unknown>;
    if (typeof entry.index === 'string') map.set(entry.index, entry);
  }
  return map;
}
