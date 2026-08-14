import { useCallback, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { SPRING_PRESS } from '../motion/springs.js';
import { haptic } from '../haptics.js';

/**
 * Elemento tocável com retorno imediato.
 *
 * Três detalhes que separam "responde" de "parece morto":
 *
 *  1. **O destaque acende no `pointerdown`, não no clique.** Esperar o soltar
 *     para dar retorno é o suficiente para a interface parecer travada.
 *  2. **Dá para cancelar arrastando para fora** — e voltar para dentro reativa.
 *     É o comportamento que todo mundo aprendeu no iOS sem perceber.
 *  3. **Área de toque folgada.** O alvo visual pode ser pequeno; o alvo real
 *     nunca deve ser.
 */

export interface TappableProps {
  /** Opcional: alvos puramente visuais (o ponto de proficiência, um espaço de
   *  magia) são tocáveis sem conteúdo, e se identificam por `ariaLabel`. */
  readonly children?: ReactNode;
  readonly onTap?: () => void;
  readonly onLongPress?: () => void;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly style?: React.CSSProperties;
  /** Quanto o elemento encolhe ao ser pressionado. */
  readonly pressScale?: number;
  readonly hapticOnTap?: boolean;
  readonly as?: 'button' | 'div';
  readonly ariaLabel?: string;
}

const LONG_PRESS_MS = 500;
/** Margem de tolerância antes de considerar que o dedo saiu do alvo. */
const SLOP_PX = 12;

export function Tappable({
  children,
  onTap,
  onLongPress,
  disabled = false,
  className,
  style,
  pressScale = 0.97,
  hapticOnTap = false,
  as = 'button',
  ariaLabel,
}: TappableProps): JSX.Element {
  const [pressed, setPressed] = useState(false);
  const elementRef = useRef<HTMLElement | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (disabled) return;
      // Captura o ponteiro para continuar recebendo eventos mesmo se o dedo
      // sair dos limites do elemento — sem isso o cancelamento não funciona.
      // Pode lançar `NotFoundError` se o navegador já não considerar o ponteiro
      // ativo (acontece em toques muito rápidos e em alguns navegadores) — sem
      // o try/catch, a exceção interrompe o handler antes de `setPressed(true)`
      // rodar, e o toque simplesmente não registra teria acontecido.
      try {
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
        // Segue sem captura: o toque ainda funciona, só o cancelamento por
        // arrastar para fora do alvo fica menos confiável.
      }
      setPressed(true);
      longPressFired.current = false;

      if (onLongPress) {
        longPressTimer.current = window.setTimeout(() => {
          longPressFired.current = true;
          haptic('medium');
          onLongPress();
          setPressed(false);
        }, LONG_PRESS_MS);
      }
    },
    [disabled, onLongPress],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (disabled || !elementRef.current) return;
      const bounds = elementRef.current.getBoundingClientRect();
      const inside =
        event.clientX >= bounds.left - SLOP_PX &&
        event.clientX <= bounds.right + SLOP_PX &&
        event.clientY >= bounds.top - SLOP_PX &&
        event.clientY <= bounds.bottom + SLOP_PX;

      if (!inside) cancelLongPress();
      setPressed((current) => (current === inside ? current : inside));
    },
    [disabled, cancelLongPress],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent) => {
      cancelLongPress();
      if (disabled || longPressFired.current) {
        setPressed(false);
        return;
      }

      const wasPressed = pressed;
      setPressed(false);
      if (!wasPressed) return;

      // Só dispara se o dedo terminou dentro: soltar fora é cancelamento.
      const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const inside =
        event.clientX >= bounds.left - SLOP_PX &&
        event.clientX <= bounds.right + SLOP_PX &&
        event.clientY >= bounds.top - SLOP_PX &&
        event.clientY <= bounds.bottom + SLOP_PX;

      if (inside) {
        if (hapticOnTap) haptic('light');
        onTap?.();
      }
    },
    [cancelLongPress, disabled, pressed, hapticOnTap, onTap],
  );

  const handlePointerCancel = useCallback(() => {
    cancelLongPress();
    setPressed(false);
  }, [cancelLongPress]);

  const Component = as === 'button' ? motion.button : motion.div;

  return (
    <Component
      ref={elementRef as never}
      type={as === 'button' ? 'button' : undefined}
      className={className}
      style={{ touchAction: 'manipulation', ...style }}
      disabled={as === 'button' ? disabled : undefined}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      role={as === 'div' && onTap ? 'button' : undefined}
      tabIndex={as === 'div' && onTap ? 0 : undefined}
      animate={{ scale: pressed ? pressScale : 1, opacity: disabled ? 0.45 : 1 }}
      transition={SPRING_PRESS}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={(event: React.KeyboardEvent) => {
        if (as === 'div' && onTap && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onTap();
        }
      }}
    >
      {children}
    </Component>
  );
}
