import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  DM_MIGRATIONS,
  EncounterRepository,
  NotesRepository,
  RulesLibrary,
  RulesSearch,
  migrate,
  type SessionNote,
} from '@dfo/core';
import { BetterSqlite3Driver } from '@dfo/core/db/better-sqlite3';
import { resolveResourceDataDir, resolveUserDataDbPath, resolveUserPdfCatalogPath } from './paths.js';
import { getVaultPath } from './settings.js';
import { VaultNotesRepository } from './vaultNotes.js';

/** Mesma forma pública de `NotesRepository` — quem consome não sabe se são arquivos ou SQLite. */
export interface NotesApi {
  list(): Promise<SessionNote[]>;
  get(id: string): Promise<SessionNote | null>;
  create(input: { title?: string; body?: string }): Promise<SessionNote>;
  update(id: string, patch: { title?: string; body?: string }): Promise<SessionNote>;
  delete(id: string): Promise<void>;
}

/** Os repositórios que o resto do processo main precisa — sem expor o driver cru. */
export interface DmDb {
  readonly encounters: EncounterRepository;
  /** Não é `readonly`: `refreshNotes` troca a instância ao vivo, sem reiniciar o app. */
  notes: NotesApi;
  readonly library: RulesLibrary;
  /** Reabre a fonte de notas (vault ou SQLite) depois de mudar a configuração do vault. */
  refreshNotes(): Promise<void>;
  /** Reabre o catálogo de PDFs depois de importar ou remover um. */
  refreshPdfs(): Promise<void>;
}

export async function openDb(): Promise<DmDb> {
  const driver = new BetterSqlite3Driver(resolveUserDataDbPath());
  await migrate(driver, DM_MIGRATIONS);

  const dataDir = resolveResourceDataDir();
  const srd = openCatalog(join(dataDir, 'srd.db'));
  const books = openCatalog(join(dataDir, 'books.db'));
  // PDFs do mestre: gravável, em `userData` — só existe depois da primeira
  // importação, por isso passa pelo mesmo "ausência não é erro" do resto.
  const library = new RulesLibrary(srd, books, openCatalog(resolveUserPdfCatalogPath()));

  // `app.relaunch()` parecia mais simples que trocar a fonte viva, mas
  // provou ser frágil demais: em `electron-vite dev` o processo relançado às
  // vezes não reconecta ao servidor de desenvolvimento e a janela fica em
  // branco (bug relatado ao vivo). Reabrir a fonte no próprio processo é
  // mais código, mas nunca depende de o app conseguir se relançar sozinho.
  const db: DmDb = {
    encounters: new EncounterRepository(driver),
    notes: await resolveNotes(new NotesRepository(driver)),
    library,
    async refreshNotes() {
      db.notes = await resolveNotes(new NotesRepository(driver));
    },
    async refreshPdfs() {
      await library.setPdfs(openCatalog(resolveUserPdfCatalogPath()));
    },
  };

  return db;
}

/**
 * Sem vault configurado, as notas continuam no `dm.db`, como sempre foi.
 *
 * Ao apontar pra um vault pela primeira vez — pasta "Boo & Dice" ainda
 * inexistente lá dentro —, as notas que já existiam no SQLite são
 * exportadas pra lá, uma vez só: escolher o vault não pode ser a forma de
 * perder o que já tinha sido anotado antes de ter Obsidian no meio.
 */
async function resolveNotes(sqliteNotes: NotesRepository): Promise<NotesApi> {
  const vaultPath = getVaultPath();
  if (!vaultPath) return sqliteNotes;

  const notesFolder = join(vaultPath, 'Boo & Dice');
  const vaultNotes = new VaultNotesRepository(notesFolder);

  if (!existsSync(notesFolder)) {
    const legacy = await sqliteNotes.list();
    for (const note of legacy) {
      await vaultNotes.create({ title: note.title, body: note.body });
    }
  }

  return vaultNotes;
}

/** Um acervo ausente não é erro — o bestiário fica vazio até `npm run data`. */
function openCatalog(path: string): RulesSearch | null {
  if (!existsSync(path)) return null;
  return new RulesSearch(new BetterSqlite3Driver(path, { readonly: true }));
}
