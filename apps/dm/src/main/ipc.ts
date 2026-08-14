import { BrowserWindow, dialog, ipcMain } from 'electron';
import type { CombatantPatch, NewCombatantInput, SearchOptions } from '@dfo/core';
import { IPC, type SessionStatus } from '../shared/ipc.js';
import type { DmDb } from './db.js';
import {
  askOracle,
  downloadModel,
  getOracleQuota,
  isModelDownloaded,
  resetOracleQuota,
  setOracleSessionActive,
} from './oracle.js';
import { resolveOracleModelPath, resolveUserPdfCatalogPath } from './paths.js';
import { importPdf, removePdf } from './pdfImport.js';
import {
  addImportedPdf,
  getImportedPdfs,
  getVaultPath,
  removeImportedPdf,
  setVaultPath,
} from './settings.js';
import { startSession, type SessionHandle } from './session.js';

/**
 * Um `ipcMain.handle` por canal, puro repasse para o repositório certo —
 * nenhuma regra de negócio mora aqui. Se `db.ts` já resolve a operação
 * sozinho, este arquivo só está conectando os fios.
 */
export function registerIpcHandlers(db: DmDb): void {
  ipcMain.handle(IPC.encountersList, () => db.encounters.list());
  ipcMain.handle(IPC.encountersCreate, (_event, name: string) => db.encounters.create(name));
  ipcMain.handle(IPC.encountersGet, (_event, id: string) => db.encounters.get(id));
  ipcMain.handle(IPC.encountersRename, (_event, id: string, name: string) =>
    db.encounters.rename(id, name),
  );
  ipcMain.handle(IPC.encountersDelete, (_event, id: string) => db.encounters.delete(id));

  ipcMain.handle(
    IPC.combatantsAdd,
    (_event, encounterId: string, input: NewCombatantInput) =>
      db.encounters.addCombatant(encounterId, input),
  );
  ipcMain.handle(IPC.combatantsUpdate, (_event, id: string, patch: CombatantPatch) =>
    db.encounters.updateCombatant(id, patch),
  );
  ipcMain.handle(IPC.combatantsRemove, (_event, id: string) => db.encounters.removeCombatant(id));
  ipcMain.handle(
    IPC.combatantsReorder,
    (_event, encounterId: string, orderedIds: string[]) =>
      db.encounters.reorderCombatants(encounterId, orderedIds),
  );

  ipcMain.handle(IPC.turnAdvance, (_event, encounterId: string, direction: 'next' | 'previous') =>
    db.encounters.advance(encounterId, direction),
  );

  ipcMain.handle(IPC.notesList, () => db.notes.list());
  ipcMain.handle(IPC.notesGet, (_event, id: string) => db.notes.get(id));
  ipcMain.handle(IPC.notesCreate, (_event, input: { title?: string; body?: string }) =>
    db.notes.create(input),
  );
  ipcMain.handle(
    IPC.notesUpdate,
    (_event, id: string, patch: { title?: string; body?: string }) => db.notes.update(id, patch),
  );
  ipcMain.handle(IPC.notesDelete, (_event, id: string) => db.notes.delete(id));

  ipcMain.handle(IPC.librarySearch, (_event, query: string, options?: SearchOptions) =>
    db.library.search(query, options),
  );
  ipcMain.handle(IPC.libraryGet, (_event, id: string) => db.library.get(id));
  ipcMain.handle(IPC.libraryCounts, () => db.library.countByKind());
  ipcMain.handle(IPC.libraryStatus, () => ({
    hasContent: db.library.hasContent,
    hasBooks: db.library.hasBooks,
    hasPdfs: db.library.hasPdfs,
  }));
  ipcMain.handle(IPC.libraryListPdfs, () => getImportedPdfs());
  ipcMain.handle(IPC.libraryImportPdf, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const filters = [{ name: 'PDF', extensions: ['pdf'] }];
    const result = window
      ? await dialog.showOpenDialog(window, { properties: ['openFile'], filters })
      : await dialog.showOpenDialog({ properties: ['openFile'], filters });
    if (result.canceled || result.filePaths.length === 0) return null;

    const imported = await importPdf(resolveUserPdfCatalogPath(), result.filePaths[0]!);
    addImportedPdf(imported);
    await db.refreshPdfs();
    return imported;
  });
  ipcMain.handle(IPC.libraryRemovePdf, async (_event, id: string) => {
    removePdf(resolveUserPdfCatalogPath(), id);
    removeImportedPdf(id);
    await db.refreshPdfs();
  });

  registerSessionHandlers();
  registerSettingsHandlers(db);
  registerOracleHandlers(db);
}

function registerOracleHandlers(db: DmDb): void {
  const modelPath = resolveOracleModelPath();

  ipcMain.handle(IPC.oracleStatus, () => ({
    remaining: getOracleQuota(),
    modelReady: isModelDownloaded(modelPath),
  }));

  ipcMain.handle(IPC.oracleDownloadModel, async (event) => {
    if (isModelDownloaded(modelPath)) return;
    const sender = event.sender;
    await downloadModel(modelPath, (fraction) => {
      if (!sender.isDestroyed()) sender.send(IPC.oracleDownloadProgress, fraction);
    });
  });

  ipcMain.handle(IPC.oracleAsk, (_event, question: string) => askOracle(db.library, modelPath, question));
}

function registerSettingsHandlers(db: DmDb): void {
  ipcMain.handle(IPC.settingsGetVaultPath, () => getVaultPath());

  ipcMain.handle(IPC.settingsChooseVaultFolder, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = window
      ? await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;

    const [path] = result.filePaths;
    setVaultPath(path!);
    await db.refreshNotes();
    return path!;
  });

  ipcMain.handle(IPC.settingsClearVaultPath, async () => {
    setVaultPath(null);
    await db.refreshNotes();
  });
}

/**
 * A sessão de LAN não faz parte de `DmDb` — é hospedagem em memória, não
 * persistência — por isso mora numa variável de módulo à parte, iniciada e
 * parada sob comando do renderer, nunca no boot do app.
 */
let activeSession: SessionHandle | null = null;

function toStatus(session: SessionHandle): SessionStatus {
  return { code: session.code, port: session.port, addresses: session.addresses };
}

function registerSessionHandlers(): void {
  ipcMain.handle(IPC.sessionStart, async () => {
    if (activeSession) return toStatus(activeSession);

    activeSession = await startSession((party) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC.sessionPartyUpdate, party);
      }
    });
    // Nova sessão de mesa, cota do Oráculo renovada — 3 perguntas de novo.
    // Fora de sessão o Oráculo fica ilimitado (ver `oracle.ts`).
    resetOracleQuota();
    setOracleSessionActive(true);
    return toStatus(activeSession);
  });

  ipcMain.handle(IPC.sessionStop, () => {
    activeSession?.stop();
    activeSession = null;
    setOracleSessionActive(false);
  });

  ipcMain.handle(IPC.sessionStatus, () => (activeSession ? toStatus(activeSession) : null));

  ipcMain.handle(IPC.sessionParty, () => (activeSession ? activeSession.getParty() : null));
}

/** Fecha a sessão ativa, se houver — usado no `before-quit` do app. */
export function stopActiveSession(): void {
  activeSession?.stop();
  activeSession = null;
}
