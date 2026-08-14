/// <reference types="vite/client" />

import type { DmApi } from '../../shared/ipc.js';

declare global {
  interface Window {
    readonly dm: DmApi;
  }
}
