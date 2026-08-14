import { app, BrowserWindow } from 'electron';
import { openDb } from './db.js';
import { registerIpcHandlers, stopActiveSession } from './ipc.js';
import { createMainWindow } from './window.js';

void app.whenReady().then(async () => {
  const db = await openDb();
  registerIpcHandlers(db);
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
  // Libera a porta da sessão de LAN, se houver uma ativa.
  stopActiveSession();
});
