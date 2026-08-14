import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '@dfo/ui/tokens.css';
import '@dfo/ui/styles.css';
import './app.css';
import { App } from './App.js';
import { initTheme } from './state/theme.js';

// Antes de montar: evita um quadro pintado com o tema errado.
initTheme();

// `autoUpdate` (ver vite.config.ts): a cada visita com internet, o service
// worker novo assume sozinho e recarrega — sem prompt de "nova versão
// disponível" para não interromper uma sessão de jogo em andamento.
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
