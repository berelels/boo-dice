import { motion } from 'motion/react';
import type { CSSProperties, ReactNode } from 'react';
import { SPRING_DEFAULT } from '../motion/springs.js';
import { Tappable } from './Tappable.js';

/** Primitivas visuais compartilhadas entre o app do jogador e o do mestre. */

// ---------------------------------------------------------------------------

export function Screen({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return <div className={`dfo-screen ${className}`.trim()}>{children}</div>;
}

/**
 * Barra superior translúcida, com o conteúdo rolando **por baixo** — e não uma
 * faixa opaca que come um pedaço fixo da tela.
 */
export function TopBar({
  title,
  subtitle,
  leading,
  trailing,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
}): JSX.Element {
  return (
    <header className="dfo-topbar">
      <div className="dfo-topbar__side">{leading}</div>
      <div className="dfo-topbar__center">
        <div className="dfo-headline">{title}</div>
        {subtitle && <div className="dfo-caption">{subtitle}</div>}
      </div>
      <div className="dfo-topbar__side dfo-topbar__side--end">{trailing}</div>
    </header>
  );
}

// ---------------------------------------------------------------------------

export function Card({
  children,
  onTap,
  className = '',
  style,
  accent,
}: {
  children: ReactNode;
  onTap?: () => void;
  className?: string;
  style?: CSSProperties;
  accent?: string;
}): JSX.Element {
  const cardStyle: CSSProperties = accent
    ? { ...style, ['--card-accent' as string]: `var(--accent-${accent}, var(--accent))` }
    : style ?? {};

  if (!onTap) {
    return (
      <div className={`dfo-card ${className}`.trim()} style={cardStyle}>
        {children}
      </div>
    );
  }

  return (
    <Tappable as="div" onTap={onTap} className={`dfo-card dfo-card--tappable ${className}`.trim()} style={cardStyle}>
      {children}
    </Tappable>
  );
}

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="dfo-section">
      <div className="dfo-section__header">
        <h2 className="dfo-overline">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------

export function Chip({
  children,
  tone = 'neutral',
  onTap,
  onRemove,
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'danger' | 'success';
  onTap?: () => void;
  onRemove?: () => void;
  title?: string;
}): JSX.Element {
  const content = (
    <span className={`dfo-chip dfo-chip--${tone}`} title={title}>
      {children}
      {onRemove && (
        <button
          type="button"
          className="dfo-chip__remove"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          aria-label="Remover"
        >
          ×
        </button>
      )}
    </span>
  );

  return onTap ? (
    <Tappable as="div" onTap={onTap} pressScale={0.94} style={{ display: 'inline-flex' }}>
      {content}
    </Tappable>
  ) : (
    content
  );
}

export function Button({
  children,
  onTap,
  variant = 'secondary',
  disabled,
  full,
}: {
  children: ReactNode;
  onTap: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  full?: boolean;
}): JSX.Element {
  return (
    <Tappable
      onTap={onTap}
      disabled={disabled}
      hapticOnTap
      className={`dfo-button dfo-button--${variant}${full ? ' dfo-button--full' : ''}`}
    >
      {children}
    </Tappable>
  );
}

// ---------------------------------------------------------------------------

/**
 * Valor destacado da ficha. Existe em duas formas porque a ficha tem dois tipos
 * de número: os que você *rola* (perícias, resistências) e os que você apenas
 * *consulta* (CA, deslocamento). Só o primeiro tipo é tocável.
 */
export function StatTile({
  label,
  value,
  hint,
  onTap,
  size = 'md',
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  onTap?: () => void;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'accent' | 'danger' | 'success';
}): JSX.Element {
  const body = (
    <div className={`dfo-stat dfo-stat--${size}${tone ? ` dfo-stat--${tone}` : ''}`}>
      <div className="dfo-overline">{label}</div>
      <div className="dfo-stat__value dfo-numeric">{value}</div>
      {hint && <div className="dfo-stat__hint">{hint}</div>}
    </div>
  );

  return onTap ? (
    <Tappable as="div" onTap={onTap} hapticOnTap style={{ display: 'block' }}>
      {body}
    </Tappable>
  ) : (
    body
  );
}

export function Divider(): JSX.Element {
  return <hr className="dfo-divider" />;
}

/**
 * Controle segmentado com o indicador animado por `layoutId` — o retângulo
 * *desliza* de um segmento para o outro em vez de reaparecer no destino,
 * o que torna óbvio para onde você foi.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { readonly value: T; readonly label: string }[];
  value: T;
  onChange: (value: T) => void;
}): JSX.Element {
  return (
    <div className="dfo-segmented" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={`dfo-segmented__item${option.value === value ? ' is-active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.value === value && (
            <motion.span
              layoutId="dfo-segmented-indicator"
              className="dfo-segmented__indicator"
              transition={SPRING_DEFAULT}
            />
          )}
          <span className="dfo-segmented__label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}): JSX.Element {
  return (
    <label className="dfo-field">
      <span className="dfo-overline">{label}</span>
      {children}
      {hint && <span className="dfo-caption">{hint}</span>}
    </label>
  );
}

/**
 * Ajuste de um número inteiro por toque.
 *
 * Existe porque um `<input type="number">` é péssimo no celular para valores
 * que mudam de um em um — subir de nível, ajustar Força. O campo continua
 * disponível para quem quiser digitar direto, mas os botões são o caminho
 * principal, e têm alvo de toque grande.
 */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  label,
  suffix,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label?: string;
  suffix?: string;
}): JSX.Element {
  const set = (next: number): void => onChange(Math.max(min, Math.min(max, next)));

  return (
    <div className="stepper">
      {label && <span className="dfo-overline stepper__label">{label}</span>}
      <div className="stepper__control">
        <Tappable
          className="stepper__button"
          ariaLabel={`Diminuir ${label ?? ''}`.trim()}
          disabled={value <= min}
          hapticOnTap
          onTap={() => set(value - 1)}
        >
          −
        </Tappable>
        <input
          className="stepper__value dfo-numeric"
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          max={max}
          aria-label={label}
          onChange={(event) => set(Number(event.target.value) || min)}
        />
        {suffix && <span className="stepper__suffix">{suffix}</span>}
        <Tappable
          className="stepper__button"
          ariaLabel={`Aumentar ${label ?? ''}`.trim()}
          disabled={value >= max}
          hapticOnTap
          onTap={() => set(value + 1)}
        >
          +
        </Tappable>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="dfo-empty">
      <div className="dfo-title">{title}</div>
      {description && <p className="dfo-caption dfo-empty__text">{description}</p>}
      {action}
    </div>
  );
}
