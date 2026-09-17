import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CONDITION_DEFINITIONS } from '@dfo/core';
import { SPRING_DEFAULT, haptic } from '@dfo/ui';
import { useSession, type SessionEvent } from '../state/session.js';

const AUTO_DISMISS_MS = 4500;

/**
 * Flash de "algo aconteceu com você", visível em qualquer tela do app.
 *
 * Fica montado ao lado do `SessionProvider`, não dentro da pilha de telas —
 * um ataque ou uma cura podem chegar com o jogador em qualquer lugar
 * (Glossário, Ajustes...), e ele precisa saber na hora, não só se estiver com
 * a ficha aberta.
 *
 * Um banner só pros dois tipos de evento, e não um por tipo: são avisos
 * flutuantes no mesmo canto da tela, e dois componentes se sobreporiam
 * justamente no momento mais movimentado da mesa.
 */
export function SessionBanner(): JSX.Element | null {
  const session = useSession();
  const [event, setEvent] = useState<SessionEvent | null>(null);

  useEffect(
    () =>
      session.onSessionEvent((next) => {
        haptic(bannerHaptic(next));
        setEvent(next);
      }),
    [session],
  );

  useEffect(() => {
    if (!event) return;
    const timer = window.setTimeout(() => setEvent(null), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [event]);

  return (
    <div className="attack-banner-slot">
      <AnimatePresence>
        {event && (
          <motion.div
            className={`attack-banner${bannerModifier(event)}`}
            initial={{ opacity: 0, y: -24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -24 }}
            transition={SPRING_DEFAULT}
            onClick={() => setEvent(null)}
          >
            <span className="dfo-headline">{headline(event)}</span>
            <span className="dfo-body">{body(event)}</span>
            {detail(event) && <span className="dfo-caption">{detail(event)}</span>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function bannerHaptic(event: SessionEvent): 'heavy' | 'light' | 'success' {
  if (event.kind === 'support') return 'success';
  return event.hit ? 'heavy' : 'light';
}

function bannerModifier(event: SessionEvent): string {
  if (event.kind === 'support') return ' attack-banner--support';
  return event.hit ? '' : ' attack-banner--miss';
}

function headline(event: SessionEvent): string {
  return event.kind === 'support' ? `${event.source} — ${event.label}` : event.source;
}

function body(event: SessionEvent): string {
  if (event.kind === 'attack') {
    return event.hit
      ? `atacou ${event.character.name} — ${event.damage} PV`
      : `errou o ataque em ${event.character.name}`;
  }

  const parts: string[] = [];
  if (event.effect.healing > 0) parts.push(`+${event.effect.healing} PV`);
  if (event.effect.temporaryHp > 0) parts.push(`${event.effect.temporaryHp} PV temporários`);
  if (event.conditionsRemoved.length > 0) {
    parts.push(
      `sem ${event.conditionsRemoved.map((id) => CONDITION_DEFINITIONS[id].label).join(', ')}`,
    );
  }
  // Ajuda que não mudou nada (curar quem já estava cheio) ainda vale o aviso:
  // o aliado gastou o recurso dele e precisa saber que chegou.
  return parts.length > 0 ? `ajudou você: ${parts.join(', ')}` : 'ajudou você';
}

function detail(event: SessionEvent): string | null {
  if (event.kind === 'support') {
    return `PV ${event.character.hitPoints.current}/${event.character.hitPoints.max}`;
  }
  if (event.conditions.length === 0) return null;
  return `Você está: ${event.conditions.map((id) => CONDITION_DEFINITIONS[id].label).join(', ')}`;
}
