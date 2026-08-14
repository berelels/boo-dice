/**
 * Retorno tátil.
 *
 * Três regras, da fala "Designing Audio-Haptic Experiences":
 *
 *  - **Causalidade** — dispare no evento que realmente causou a coisa (o dado
 *    parando, o PV mudando), não num instante aproximado.
 *  - **Harmonia** — o toque, o som e o movimento têm que cair no mesmo quadro.
 *  - **Utilidade** — só onde ganha. Vibrar em tudo ensina o usuário a ignorar
 *    a vibração, e aí ela não serve para nada quando importa.
 *
 * No Capacitor o plugin nativo assume; no navegador, a Vibration API é o que
 * existe. Em iOS Safari não há vibração nenhuma — a função simplesmente não faz
 * nada, e nunca lança.
 */

export type HapticStyle = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

/** Padrões em milissegundos. Curto é o ponto: haptic longo irrita. */
const PATTERNS: Record<HapticStyle, number | number[]> = {
  light: 8,
  medium: 16,
  heavy: 28,
  success: [12, 60, 24],
  warning: [20, 80, 20],
  error: [30, 60, 30, 60, 30],
};

type CapacitorHaptics = {
  impact?: (options: { style: string }) => Promise<void>;
  notification?: (options: { type: string }) => Promise<void>;
};

function nativeHaptics(): CapacitorHaptics | null {
  const capacitor = (globalThis as { Capacitor?: { Plugins?: { Haptics?: CapacitorHaptics } } })
    .Capacitor;
  return capacitor?.Plugins?.Haptics ?? null;
}

let enabled = true;

/** Permite ao usuário desligar tudo nas configurações. */
export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

export function haptic(style: HapticStyle = 'light'): void {
  if (!enabled) return;

  const native = nativeHaptics();
  if (native) {
    const promise =
      style === 'success' || style === 'warning' || style === 'error'
        ? native.notification?.({ type: style.toUpperCase() })
        : native.impact?.({ style: style.toUpperCase() });
    // Se o plugin falhar, o toque não acontece — não é motivo para quebrar a UI.
    void promise?.catch(() => undefined);
    return;
  }

  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(PATTERNS[style]);
    } catch {
      // Alguns navegadores lançam se a página não teve interação ainda.
    }
  }
}
