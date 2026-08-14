import type { DmApi } from '../../../shared/ipc.js';

/**
 * `window.dm` já está pronto quando o renderer começa a rodar — o preload
 * expõe via `contextBridge` antes de qualquer script da página executar, sem
 * a corrida do `AppDataProvider` do jogador (que abre um banco assíncrono no
 * próprio processo). Por isso não precisa de contexto React nem estado de
 * carregamento: é só um atalho de nome.
 */
export function useDmApi(): DmApi {
  return window.dm;
}
