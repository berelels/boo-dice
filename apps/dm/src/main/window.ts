import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/**
 * `contextIsolation`/`nodeIntegration`/`sandbox` não são ajustáveis — é código
 * novo, sem motivo pra abrir mão do padrão seguro do Electron. O renderer só
 * fala com o processo main através do que `preload/index.ts` expõe.
 */
export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(HERE, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(HERE, '../renderer/index.html'));
  }

  return window;
}
