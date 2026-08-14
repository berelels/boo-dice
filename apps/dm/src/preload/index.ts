import { contextBridge, ipcRenderer } from 'electron';
import type { PartySnapshot } from '@dfo/core';
import { IPC, type DmApi } from '../shared/ipc.js';

/**
 * Espelha `DmApi` chamando `ipcRenderer.invoke` por trás — mesma forma que
 * `main/ipc.ts` registra do outro lado. `contextIsolation` está ligado (ver
 * `main/window.ts`), então isto é a única ponte entre o renderer e o Node: o
 * renderer nunca vê `require`, `ipcRenderer` ou o sistema de arquivos direto.
 */
const dm: DmApi = {
  encounters: {
    list: () => ipcRenderer.invoke(IPC.encountersList),
    create: (name) => ipcRenderer.invoke(IPC.encountersCreate, name),
    get: (id) => ipcRenderer.invoke(IPC.encountersGet, id),
    rename: (id, name) => ipcRenderer.invoke(IPC.encountersRename, id, name),
    delete: (id) => ipcRenderer.invoke(IPC.encountersDelete, id),
  },
  combatants: {
    add: (encounterId, input) => ipcRenderer.invoke(IPC.combatantsAdd, encounterId, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.combatantsUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC.combatantsRemove, id),
    reorder: (encounterId, orderedIds) =>
      ipcRenderer.invoke(IPC.combatantsReorder, encounterId, orderedIds),
  },
  turn: {
    advance: (encounterId, direction) =>
      ipcRenderer.invoke(IPC.turnAdvance, encounterId, direction),
  },
  notes: {
    list: () => ipcRenderer.invoke(IPC.notesList),
    get: (id) => ipcRenderer.invoke(IPC.notesGet, id),
    create: (input) => ipcRenderer.invoke(IPC.notesCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.notesUpdate, id, patch),
    delete: (id) => ipcRenderer.invoke(IPC.notesDelete, id),
  },
  library: {
    search: (query, options) => ipcRenderer.invoke(IPC.librarySearch, query, options),
    get: (id) => ipcRenderer.invoke(IPC.libraryGet, id),
    counts: () => ipcRenderer.invoke(IPC.libraryCounts),
    status: () => ipcRenderer.invoke(IPC.libraryStatus),
    listPdfs: () => ipcRenderer.invoke(IPC.libraryListPdfs),
    importPdf: () => ipcRenderer.invoke(IPC.libraryImportPdf),
    removePdf: (id) => ipcRenderer.invoke(IPC.libraryRemovePdf, id),
  },
  session: {
    start: () => ipcRenderer.invoke(IPC.sessionStart),
    stop: () => ipcRenderer.invoke(IPC.sessionStop),
    status: () => ipcRenderer.invoke(IPC.sessionStatus),
    party: () => ipcRenderer.invoke(IPC.sessionParty),
    onPartyUpdate: (callback: (party: PartySnapshot) => void) => {
      // Repassa só o payload pro renderer, nunca o `event` do IPC bruto —
      // mesma fronteira de segurança do `contextBridge` que os canais de
      // invoke já respeitam.
      const listener = (_event: Electron.IpcRendererEvent, party: PartySnapshot) => callback(party);
      ipcRenderer.on(IPC.sessionPartyUpdate, listener);
      return () => ipcRenderer.removeListener(IPC.sessionPartyUpdate, listener);
    },
  },
  settings: {
    getVaultPath: () => ipcRenderer.invoke(IPC.settingsGetVaultPath),
    chooseVaultFolder: () => ipcRenderer.invoke(IPC.settingsChooseVaultFolder),
    clearVaultPath: () => ipcRenderer.invoke(IPC.settingsClearVaultPath),
  },
  oracle: {
    status: () => ipcRenderer.invoke(IPC.oracleStatus),
    downloadModel: () => ipcRenderer.invoke(IPC.oracleDownloadModel),
    onDownloadProgress: (callback: (fraction: number) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, fraction: number) => callback(fraction);
      ipcRenderer.on(IPC.oracleDownloadProgress, listener);
      return () => ipcRenderer.removeListener(IPC.oracleDownloadProgress, listener);
    },
    ask: (question: string) => ipcRenderer.invoke(IPC.oracleAsk, question),
  },
};

contextBridge.exposeInMainWorld('dm', dm);
