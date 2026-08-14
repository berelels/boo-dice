import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion, useMotionValue, animate } from 'motion/react';
import {
  DRAG_THRESHOLD_PX,
  SPRING_SHEET,
  VelocityTracker,
  clampWithRubberband,
  projectMomentum,
} from '../motion/springs.js';

/**
 * Folha inferior arrastável.
 *
 * É aqui que a maior parte do "toque Apple" acontece, e cada detalhe abaixo é
 * o que separa uma folha viva de um `<dialog>` que desliza:
 *
 *  - **Rastreio 1:1** com o dedo, respeitando o ponto onde você pegou.
 *  - **Interrompível**: pegar a folha no meio do fechamento a segura no ar, a
 *    partir da posição *de tela*, não do valor de destino.
 *  - **Velocidade entregue à mola** na soltura, sem emenda visível entre o
 *    arraste e a animação.
 *  - **Decisão pela projeção do momento**, não pela posição de soltura: um
 *    flick curto e rápido fecha, mesmo que o dedo tenha andado pouco.
 *  - **Elástico no topo**, em vez de parada dura.
 *  - **Entra e sai pelo mesmo caminho** — sobe de baixo, desce para baixo.
 */

export interface BottomSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly title?: string;
  /** Altura máxima como fração da tela. */
  readonly maxHeight?: number;
  readonly label?: string;
}

/** Fração da altura arrastada a partir da qual soltar fecha, sem velocidade. */
const DISMISS_POSITION_RATIO = 0.4;
/** Velocidade (px/s) a partir da qual um flick fecha, independente da posição. */
const DISMISS_VELOCITY = 500;

export function BottomSheet({
  open,
  onClose,
  children,
  title,
  maxHeight = 0.9,
  label,
}: BottomSheetProps): JSX.Element {
  const y = useMotionValue(0);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const tracker = useRef(new VelocityTracker());
  const dragState = useRef<{ startY: number; startOffset: number; active: boolean } | null>(null);

  useEffect(() => {
    if (open) y.set(0);
  }, [open, y]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const height = useCallback(() => sheetRef.current?.offsetHeight ?? 400, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      try {
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
        // Mesmo caso do Tappable: sem pointer ativo o navegador lança, e o
        // arraste não pode abortar por causa disso.
      }
      // Ler o valor *atual* da mola, não o alvo: é isto que permite agarrar a
      // folha em pleno voo sem que ela salte para outro lugar.
      dragState.current = { startY: event.clientY, startOffset: y.get(), active: false };
      tracker.current.reset();
      tracker.current.add(event.clientY);
    },
    [y],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      const state = dragState.current;
      if (!state) return;

      const delta = event.clientY - state.startY;
      if (!state.active) {
        // Histerese: só assume arraste depois de um deslocamento mínimo, para
        // não roubar toques de botões dentro da folha.
        if (Math.abs(delta) < DRAG_THRESHOLD_PX) return;
        state.active = true;
      }

      tracker.current.add(event.clientY);
      // Para baixo segue o dedo exatamente; para cima resiste de forma crescente.
      y.set(clampWithRubberband(state.startOffset + delta, 0, Number.POSITIVE_INFINITY, height()));
    },
    [y, height],
  );

  const handlePointerUp = useCallback(() => {
    const state = dragState.current;
    dragState.current = null;
    if (!state?.active) return;

    const velocity = tracker.current.velocity();
    const current = y.get();
    // Para onde o gesto *ia*, não onde o dedo parou.
    const projected = current + projectMomentum(velocity);

    const shouldDismiss =
      velocity > DISMISS_VELOCITY || projected > height() * DISMISS_POSITION_RATIO;

    if (shouldDismiss) {
      // A mola herda a velocidade do dedo: sem emenda entre arrastar e animar.
      // Só desmontamos quando ela termina, para a folha não sumir no meio do voo.
      void animate(y, height(), { ...SPRING_SHEET, velocity }).then(onClose);
    } else {
      void animate(y, 0, { ...SPRING_SHEET, velocity });
    }
  }, [y, height, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="dfo-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            // `onPointerUp`, não `onClick`: no toque, o navegador dispara um
            // clique de compatibilidade um instante DEPOIS do toque que abriu
            // a folha — e a essa altura o scrim já existe bem onde o dedo
            // estava. Esse clique atrasado acerta o scrim e fecha a folha na
            // hora, e a folha parece só piscar e sumir. `onPointerUp` reage
            // ao toque de verdade, e nunca é reentregue por essa folha que
            // acabou de aparecer.
            onPointerUp={onClose}
            aria-hidden="true"
          />
          <motion.div
            ref={sheetRef}
            className="dfo-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={label ?? title}
            style={{ y, maxHeight: `${maxHeight * 100}dvh` }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={SPRING_SHEET}
          >
            <div
              className="dfo-sheet__grip-area"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <div className="dfo-sheet__grip" aria-hidden="true" />
              {title && <h2 className="dfo-title dfo-sheet__title">{title}</h2>}
            </div>
            <div className="dfo-sheet__content">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
