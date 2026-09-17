import { app, BrowserWindow } from 'electron';
import { openDb, type DmDb } from './db.js';
import { registerIpcHandlers, stopActiveSession } from './ipc.js';
import { createMainWindow } from './window.js';

// O `before-quit` é registrado fora do `whenReady`, mas só tem o que fazer
// depois que o banco abriu — por isso a referência, em vez de mover o handler
// pra dentro do `then` (onde um erro na abertura deixaria o app sem ele).
let dbForQuit: DmDb | null = null;

void app.whenReady().then(async () => {
  const db = await openDb();
  registerIpcHandlers(db);
  dbForQuit = db;
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  // Sem a exceção de macOS do template padrão do Electron: Linux e Windows
  // são os únicos alvos deste app.
  app.quit();
});

app.on('before-quit', () => {
  // Arquiva a sessão de mesa e libera a porta da LAN, se houver uma ativa.
  if (dbForQuit) stopActiveSession(dbForQuit);
});
