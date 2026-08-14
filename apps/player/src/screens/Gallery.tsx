import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Button, EmptyState, HeroCard, Screen, SPRING_DEFAULT, Tappable } from '@dfo/ui';
import type { CharacterSummary } from '@dfo/core';
import { useAppData } from '../db/provider.js';
import { useTheme } from '../state/theme.js';
import { useSession } from '../state/session.js';
import { getLastBackupAt, shouldRemindBackup } from '../state/backup.js';

/**
 * Galeria de personagens.
 *
 * Cada personagem ocupa um card grande com o gradiente da sua classe. A versão
 * anterior era uma lista de retângulos cinzentos onde todo personagem parecia
 * igual; aqui a cor faz o reconhecimento antes da leitura.
 *
 * A tela mostra *vários* personagens de propósito: é dessa coleção que o
 * jogador escolherá quais levar quando entrar numa sessão do mestre.
 */

export function GalleryScreen({
  onCreate,
  onOpen,
  onGlossary,
  onJoinSession,
  onSettings,
}: {
  onCreate: () => void;
  onOpen: (characterId: string) => void;
  onGlossary: () => void;
  onJoinSession: () => void;
  onSettings: () => void;
}): JSX.Element {
  const { characters } = useAppData();
  const { resolved, setPreference } = useTheme();
  const session = useSession();
  const [list, setList] = useState<CharacterSummary[] | null>(null);

  const refresh = useCallback(() => {
    void characters.list().then(setList);
  }, [characters]);

  useEffect(refresh, [refresh]);

  return (
    <Screen>
      <header className="gallery__head">
        <div className="gallery__head-info">
          <div className="dfo-overline gallery__brand">
            <img src="/favicon.svg" alt="" className="gallery__brand-icon" aria-hidden="true" />
            Boo &amp; Dice
          </div>
          <h1 className="dfo-display gallery__title">
            Seus
            <br />
            personagens
          </h1>
        </div>
        <div className="gallery__head-actions">
          <Tappable
            onTap={() => setPreference(resolved === 'dark' ? 'light' : 'dark')}
            className="icon-button"
            ariaLabel={resolved === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
          >
            <span aria-hidden="true">{resolved === 'dark' ? '☀' : '☾'}</span>
          </Tappable>
          <Tappable
            onTap={onJoinSession}
            className={`icon-button${session.status === 'connected' ? ' icon-button--active' : ''}`}
            ariaLabel={session.status === 'connected' ? 'Sessão ativa' : 'Entrar em sessão'}
          >
            <SessionIcon />
          </Tappable>
          <Tappable onTap={onGlossary} className="icon-button" ariaLabel="Abrir o glossário">
            <BookIcon />
          </Tappable>
          <Tappable onTap={onSettings} className="icon-button" ariaLabel="Ajustes">
            <GearIcon />
          </Tappable>
        </div>
      </header>

      {session.status === 'connected' && (
        <div className="gallery__session-badge dfo-caption">Sessão ativa — sincronizando com o Mestre</div>
      )}

      {list !== null && shouldRemindBackup(getLastBackupAt(), list.length > 0) && (
        <Tappable onTap={onSettings} className="gallery__backup-banner">
          <span className="dfo-caption">
            {getLastBackupAt() === null
              ? 'Você ainda não fez backup dos seus personagens — toque aqui.'
              : 'Faz tempo que você não faz backup dos seus personagens — toque aqui.'}
          </span>
        </Tappable>
      )}

      {list === null && <div className="gallery__loading dfo-caption">Carregando…</div>}

      {list?.length === 0 && (
        <EmptyState
          title="Nenhum personagem ainda"
          description="Crie o primeiro. Ele fica salvo no aparelho e funciona sem internet."
          action={
            <Button variant="primary" onTap={onCreate}>
              Criar personagem
            </Button>
          }
        />
      )}

      {list && list.length > 0 && (
        <div className="gallery">
          {list.map((summary, index) => (
            <motion.div
              key={summary.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              // Escalonamento curto: sugere que a lista chegou, sem virar
              // espera. Trava em 6 para uma lista longa não demorar a aparecer.
              transition={{ ...SPRING_DEFAULT, delay: Math.min(index, 6) * 0.05 }}
            >
              <HeroCard
                accent={summary.accent}
                eyebrow={summary.classSummary || 'Sem classe'}
                title={summary.name}
                level={summary.totalLevel}
                portrait={summary.portrait}
                onTap={() => onOpen(summary.id)}
                footer={
                  <span className="hero__chip">
                    editado {formatWhen(summary.updatedAt)}
                  </span>
                }
              />
            </motion.div>
          ))}

          <div className="gallery__actions">
            <Button variant="primary" full onTap={onCreate}>
              Novo personagem
            </Button>
          </div>
        </div>
      )}
    </Screen>
  );
}

/** "há 5 min", "ontem", "12 de mar" — datas absolutas só quando já é passado. */
function formatWhen(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'agora';

  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  if (hours < 48) return 'ontem';

  return new Date(then).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
}

function SessionIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="12" rx="2" strokeLinejoin="round" />
      <path d="M8 20h8M12 17v3" strokeLinecap="round" />
    </svg>
  );
}

function GearIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3.2" />
      <path
        d="M12 4.5v1.6M12 17.9v1.6M19.5 12h-1.6M6.1 12H4.5M17.3 6.7l-1.1 1.1M7.8 16.2l-1.1 1.1M17.3 17.3l-1.1-1.1M7.8 7.8 6.7 6.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BookIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z" strokeLinejoin="round" />
      <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5A2.5 2.5 0 0 1 4 20.5z" strokeLinejoin="round" />
    </svg>
  );
}
