import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  applyDamage,
  applyHealingWithRecovery,
  applyTemporaryHitPoints,
  serverMessageSchema,
  type Character,
  type ConditionId,
  type PartyMember,
  type SupportEffect,
} from '@dfo/core';
import { useAppData } from '../db/provider.js';

/**
 * Conexão com a sessão de LAN do Mestre.
 *
 * A ficha completa sobe do jogador pro Mestre. E o Mestre também pode
 * empurrar coisa de volta: um ataque de monstro já resolvido (acerto, dano,
 * condições), ou a ajuda de outro jogador (cura, PV temporários, condição que
 * sai) — aplicados aqui com as mesmas funções puras que a própria ficha usa
 * (`applyDamage`, `applyHealingWithRecovery`), nunca uma conta paralela. Fica montado ao lado do
 * `AppDataProvider`, não numa tela — assim a conexão sobrevive à navegação: o
 * jogador entra na sessão uma vez e continua sincronizando enquanto joga
 * normalmente, sem precisar voltar pra uma tela de "sessão" a cada dano
 * tomado ou recebido.
 */

export type SessionConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface JoinSessionInput {
  readonly host: string;
  readonly port: number;
  readonly code: string;
  readonly playerName: string;
  readonly characterIds: readonly string[];
}

/** Um ataque já resolvido, recém-aplicado a um personagem trazido pra sessão. */
export interface AttackEvent {
  readonly kind: 'attack';
  readonly character: Character;
  readonly source: string;
  readonly hit: boolean;
  readonly damage: number;
  /** Só o que *este* ataque aplicou — não o conjunto todo que o personagem carrega. */
  readonly conditions: readonly ConditionId[];
}

/** Ajuda de outro jogador, já aplicada à ficha. */
export interface SupportEvent {
  readonly kind: 'support';
  readonly character: Character;
  /** Nome do personagem que ajudou. */
  readonly source: string;
  /** O que ele usou: "Palavra Curativa". */
  readonly label: string;
  readonly effect: SupportEffect;
  /** Das condições pedidas, as que o personagem de fato tinha. */
  readonly conditionsRemoved: readonly ConditionId[];
}

/** Qualquer coisa que a sessão empurrou pra este aparelho e já foi aplicada. */
export type SessionEvent = AttackEvent | SupportEvent;

/** O que um jogador manda pra ajudar outro. */
export interface SupportInput {
  readonly fromCharacterId: string;
  readonly targetCharacterId: string;
  readonly label: string;
  readonly effect: SupportEffect;
}

interface SessionApi {
  readonly status: SessionConnectionStatus;
  readonly error: string | null;
  readonly connect: (input: JoinSessionInput) => Promise<void>;
  readonly disconnect: () => void;
  /** No-op se não conectado ou se o personagem não foi trazido pra sessão — quem chama não precisa checar. */
  readonly reportCharacter: (character: Character) => void;
  /**
   * Quem mais está na sessão — só nome, nunca ficha alheia. Vazio fora de
   * sessão. Inclui os personagens deste próprio aparelho: quem filtra é a
   * tela, que é quem sabe qual ficha está aberta.
   */
  readonly party: readonly PartyMember[];
  /** Manda ajuda pra outro jogador. No-op se não conectado. */
  readonly sendSupport: (input: SupportInput) => void;
  /** Assina o que a sessão empurrou pra cá, já aplicado e gravado. Devolve a função de cancelar. */
  readonly onSessionEvent: (callback: (event: SessionEvent) => void) => () => void;
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
  const [party, setParty] = useState<readonly PartyMember[]>([]);

  const socketRef = useRef<WebSocket | null>(null);
  const lastJoin = useRef<JoinSessionInput | null>(null);
  const broughtIds = useRef<Set<string>>(new Set());
  const explicitDisconnect = useRef(false);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<number | null>(null);
  const eventListeners = useRef<Set<(event: SessionEvent) => void>>(new Set());

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

      /**
       * Devolve pro Mestre a ficha já alterada por algo que veio dele ou de
       * outro jogador.
       *
       * Sem isto o painel do Mestre continuaria mostrando o estado anterior
       * até o jogador mexer em alguma coisa na ficha — ele veria o aliado
       * caído um turno depois de já terem curado. `reportCharacter` não serve
       * aqui porque depende do `useCharacter`, que só existe com a ficha
       * aberta, e um ataque chega em qualquer tela.
       */
      const pushBack = (character: Character): void => {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ type: 'characterUpdate', character }));
      };

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
        } else if (message.type === 'attack') {
          // Só aplica em personagem que este aparelho de fato trouxe — igual
          // ao guard de `reportCharacter`, um ataque não é motivo pra
          // confiar cegamente num id que não reconhecemos.
          if (!broughtIds.current.has(message.characterId)) return;
          void (async () => {
            const character = await characters.get(message.characterId);
            if (!character) return;

            const result = applyDamage(character.hitPoints, message.damage);
            const conditions =
              message.conditions.length > 0
                ? [...new Set([...character.conditions, ...message.conditions])]
                : character.conditions;
            const patched: Character = {
              ...character,
              hitPoints: result.hitPoints,
              conditions,
              updatedAt: new Date().toISOString(),
            };
            await characters.save(patched);
            pushBack(patched);

            const event: AttackEvent = {
              kind: 'attack',
              character: patched,
              source: message.source,
              hit: message.hit,
              damage: message.damage,
              conditions: message.conditions,
            };
            for (const listener of eventListeners.current) listener(event);
          })();
        } else if (message.type === 'party') {
          setParty(message.members);
        } else if (message.type === 'support') {
          // Mesmo guard do ataque: ajuda também é mensagem de fora, e um id
          // que este aparelho não trouxe não vira escrita em ficha nenhuma.
          if (!broughtIds.current.has(message.characterId)) return;
          void (async () => {
            const character = await characters.get(message.characterId);
            if (!character) return;

            const healed = applyHealingWithRecovery(
              character.hitPoints,
              character.deathSaves,
              message.effect.healing,
            );
            const hitPoints =
              message.effect.temporaryHp > 0
                ? applyTemporaryHitPoints(healed.hitPoints, message.effect.temporaryHp)
                : healed.hitPoints;

            // Só o que ele de fato tinha — o aviso não pode dizer "tirou
            // Envenenado" de quem nunca esteve envenenado.
            const conditionsRemoved = character.conditions.filter((condition) =>
              message.effect.conditionsRemoved.includes(condition),
            );
            const patched: Character = {
              ...character,
              hitPoints,
              deathSaves: healed.deathSaves,
              conditions: character.conditions.filter(
                (condition) => !conditionsRemoved.includes(condition),
              ),
              updatedAt: new Date().toISOString(),
            };
            await characters.save(patched);
            pushBack(patched);

            const event: SupportEvent = {
              kind: 'support',
              character: patched,
              source: message.source,
              label: message.label,
              effect: message.effect,
              conditionsRemoved,
            };
            for (const listener of eventListeners.current) listener(event);
          })();
        }
      });

      socket.addEventListener('close', () => {
        socketRef.current = null;

        setParty([]);

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
    setParty([]);

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

  const sendSupport = useCallback((input: SupportInput) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return;
    if (!broughtIds.current.has(input.fromCharacterId)) return;
    socket.send(
      JSON.stringify({
        type: 'support',
        fromCharacterId: input.fromCharacterId,
        targetCharacterId: input.targetCharacterId,
        label: input.label,
        effect: input.effect,
      }),
    );
  }, []);

  const onSessionEvent = useCallback((callback: (event: SessionEvent) => void) => {
    eventListeners.current.add(callback);
    return () => {
      eventListeners.current.delete(callback);
    };
  }, []);

  useEffect(
    () => () => {
      clearReconnectTimer();
      socketRef.current?.close();
    },
    [],
  );

  return (
    <SessionContext.Provider
      value={{
        status,
        error,
        connect,
        disconnect,
        reportCharacter,
        party,
        sendSupport,
        onSessionEvent,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
