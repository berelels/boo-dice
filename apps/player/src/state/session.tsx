import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { serverMessageSchema, type Character } from '@dfo/core';
import { useAppData } from '../db/provider.js';

/**
 * Conexão com a sessão de LAN do Mestre.
 *
 * Direção única: o jogador manda a ficha completa, o Mestre só confirma ou
 * rejeita a entrada — não existe resumo à parte, o Mestre vê tudo. Fica
 * montado ao lado do `AppDataProvider`, não numa tela — assim a conexão
 * sobrevive à navegação: o jogador entra na sessão uma vez e continua
 * sincronizando enquanto joga normalmente, sem precisar voltar pra uma tela
 * de "sessão" a cada dano tomado.
 */

export type SessionConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface JoinSessionInput {
  readonly host: string;
  readonly port: number;
  readonly code: string;
  readonly playerName: string;
  readonly characterIds: readonly string[];
}

interface SessionApi {
  readonly status: SessionConnectionStatus;
  readonly error: string | null;
  readonly connect: (input: JoinSessionInput) => Promise<void>;
  readonly disconnect: () => void;
  /** No-op se não conectado ou se o personagem não foi trazido pra sessão — quem chama não precisa checar. */
  readonly reportCharacter: (character: Character) => void;
}

const SessionContext = createContext<SessionApi | null>(null);

export function useSession(): SessionApi {
  const api = useContext(SessionContext);
  if (!api) throw new Error('useSession precisa estar dentro de <SessionProvider>.');
  return api;
}

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const { characters } = useAppData();
  const [status, setStatus] = useState<SessionConnectionStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const lastJoin = useRef<JoinSessionInput | null>(null);
  const broughtIds = useRef<Set<string>>(new Set());
  const explicitDisconnect = useRef(false);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<number | null>(null);

  const clearReconnectTimer = (): void => {
    if (reconnectTimer.current !== null) {
      window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  };

  const openSocket = useCallback(
    (input: JoinSessionInput) => {
      setStatus('connecting');
      setError(null);

      const socket = new WebSocket(`ws://${input.host}:${input.port}`);
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        void (async () => {
          const brought: Character[] = [];
          for (const id of input.characterIds) {
            const character = await characters.get(id);
            if (character) brought.push(character);
          }
          if (brought.length === 0) {
            setStatus('error');
            setError('Nenhum personagem válido pra trazer.');
            socket.close();
            return;
          }
          broughtIds.current = new Set(brought.map((character) => character.id));
          socket.send(
            JSON.stringify({
              type: 'hello',
              code: input.code,
              playerName: input.playerName,
              characters: brought,
            }),
          );
        })();
      });

      socket.addEventListener('message', (event) => {
        const parsed = serverMessageSchema.safeParse(JSON.parse(String(event.data)));
        if (!parsed.success) return;
        const message = parsed.data;

        if (message.type === 'welcome') {
          reconnectAttempts.current = 0;
          setStatus('connected');
        } else if (message.type === 'error') {
          setStatus('error');
          setError(message.reason === 'wrong-code' ? 'Código incorreto.' : 'O Mestre rejeitou a conexão.');
          socket.close();
        }
      });

      socket.addEventListener('close', () => {
        socketRef.current = null;

        if (explicitDisconnect.current) {
          setStatus('idle');
          return;
        }
        if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
          setStatus('error');
          setError('Conexão perdida com o Mestre.');
          return;
        }

        reconnectAttempts.current += 1;
        setStatus('connecting');
        reconnectTimer.current = window.setTimeout(() => {
          if (lastJoin.current) openSocket(lastJoin.current);
        }, RECONNECT_DELAY_MS);
      });
    },
    [characters],
  );

  const connect = useCallback(
    async (input: JoinSessionInput) => {
      explicitDisconnect.current = false;
      reconnectAttempts.current = 0;
      clearReconnectTimer();
      lastJoin.current = input;
      openSocket(input);
    },
    [openSocket],
  );

  const disconnect = useCallback(() => {
    explicitDisconnect.current = true;
    clearReconnectTimer();
    lastJoin.current = null;
    broughtIds.current = new Set();

    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'leave' }));
    socket?.close();
    socketRef.current = null;

    setStatus('idle');
    setError(null);
  }, []);

  const reportCharacter = useCallback((character: Character) => {
    if (!broughtIds.current.has(character.id)) return;
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'characterUpdate', character }));
  }, []);

  useEffect(
    () => () => {
      clearReconnectTimer();
      socketRef.current?.close();
    },
    [],
  );

  return (
    <SessionContext.Provider value={{ status, error, connect, disconnect, reportCharacter }}>
      {children}
    </SessionContext.Provider>
  );
}
