import { useCallback, useEffect, useRef, useState } from 'react';
import type { Character } from '@dfo/core';
import { useAppData } from '../db/provider.js';
import { useSession } from './session.js';
import { autoBackupIfNative } from './backup.js';

/**
 * Carrega uma ficha e mantém a gravação em dia.
 *
 * A atualização é otimista: o estado em memória muda na hora e a gravação
 * acontece depois. Numa ficha de RPG isso não é atalho, é requisito — marcar
 * dano no meio de um combate não pode esperar disco.
 *
 * As mudanças chegam em rajada (arrastar o marcador de PV dispara dezenas por
 * segundo), então a gravação é agrupada.
 */

const SAVE_DEBOUNCE_MS = 300;

export interface CharacterState {
  readonly character: Character | null;
  readonly error: string | null;
  /** Aplica uma transformação na ficha e agenda a gravação. */
  readonly update: (change: (current: Character) => Character) => void;
  /** Grava agora, sem esperar o debounce. */
  readonly saveNow: () => Promise<void>;
  /**
   * Cancela qualquer gravação pendente, sem gravar. Chamar antes de excluir a
   * ficha — sem isto, a gravação ao desmontar (a linha logo abaixo) recriaria
   * o personagem que acabou de ser apagado.
   */
  readonly discardPendingSave: () => void;
}

export function useCharacter(characterId: string): CharacterState {
  const { characters } = useAppData();
  const session = useSession();
  const [character, setCharacter] = useState<Character | null>(null);
  const [error, setError] = useState<string | null>(null);

  const timer = useRef<number | null>(null);
  const latest = useRef<Character | null>(null);

  useEffect(() => {
    let cancelled = false;

    void characters.getSafe(characterId).then((result) => {
      if (cancelled) return;
      if (result === null) setError('Personagem não encontrado.');
      else if (!result.ok) setError(`A ficha está corrompida: ${result.reason}`);
      else {
        latest.current = result.character;
        setCharacter(result.character);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [characters, characterId]);

  const saveNow = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (latest.current) {
      await characters.save(latest.current);
      session.reportCharacter(latest.current);
      void autoBackupIfNative(characters);
    }
  }, [characters, session]);

  const update = useCallback(
    (change: (current: Character) => Character) => {
      setCharacter((current) => {
        if (!current) return current;
        const next = change(current);
        latest.current = next;

        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          timer.current = null;
          void characters.save(next);
          // Mesmo debounce da gravação: se há sessão ativa e o personagem foi
          // trazido, o Mestre vê a ficha atualizada na mesma janela de 300ms.
          session.reportCharacter(next);
          void autoBackupIfNative(characters);
        }, SAVE_DEBOUNCE_MS);

        return next;
      });
    },
    [characters, session],
  );

  const discardPendingSave = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    latest.current = null;
  }, []);

  // Sair da tela com uma gravação pendente perderia a última alteração.
  useEffect(() => () => void saveNow(), [saveNow]);

  return { character, error, update, saveNow, discardPendingSave };
}
