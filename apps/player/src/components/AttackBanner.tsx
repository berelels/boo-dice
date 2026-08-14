import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { SPRING_DEFAULT, haptic } from '@dfo/ui';
import { useSession, type AttackEvent } from '../state/session.js';

const AUTO_DISMISS_MS = 4500;

/**
 * Flash de "você foi atacado", visível em qualquer tela do app.
 *
 * Fica montado ao lado do `SessionProvider`, não dentro da pilha de telas —
 * um ataque pode chegar com o jogador em qualquer lugar (Glossário,
 * Ajustes...), e ele precisa saber na hora, não só se estiver com a ficha
 * aberta.
 */
export function AttackBanner(): JSX.Element | null {
  const session = useSession();
  const [event, setEvent] = useState<AttackEvent | null>(null);

  useEffect(
    () =>
      session.onAttack((next) => {
        haptic(next.hit ? 'heavy' : 'light');
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
            className={`attack-banner${event.hit ? '' : ' attack-banner--miss'}`}
            initial={{ opacity: 0, y: -24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -24 }}
            transition={SPRING_DEFAULT}
            onClick={() => setEvent(null)}
          >
            <span className="dfo-headline">{event.source}</span>
            <span className="dfo-body">
              {event.hit ? `atacou ${event.character.name} — ${event.damage} PV` : `errou o ataque em ${event.character.name}`}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
