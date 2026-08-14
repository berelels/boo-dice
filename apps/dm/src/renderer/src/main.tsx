import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@dfo/ui/tokens.css';
import '@dfo/ui/styles.css';
import './app.css';
import { App } from './App.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
