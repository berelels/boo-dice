import type { CSSProperties, ReactNode } from 'react';
import { classGradientVars } from '../theme/classColors.js';
import { Tappable } from './Tappable.js';

/**
 * O bloco colorido que carrega a identidade de um personagem.
 *
 * É a peça central do redesenho: em vez de uma lista de retângulos cinzentos,
 * cada personagem ocupa um card grande com o gradiente da sua classe, nome em
 * tipografia display e sombra colorida. A cor faz o trabalho que o texto
 * sozinho não faz — reconhecer o personagem antes de ler.
 *
 * As manchas orgânicas (`hero__blob`) existem para o gradiente não parecer um
 * degradê de banco de dados: elas quebram a linearidade e dão a textura macia
 * das referências.
 */

export interface HeroCardProps {
  readonly accent: string | null | undefined;
  readonly eyebrow?: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly level?: number;
  readonly portrait?: string | null;
  readonly onTap?: () => void;
  readonly footer?: ReactNode;
  readonly compact?: boolean;
  readonly style?: CSSProperties;
}

export function HeroCard({
  accent,
  eyebrow,
  title,
  subtitle,
  level,
  portrait,
  onTap,
  footer,
  compact = false,
  style,
}: HeroCardProps): JSX.Element {
  const content = (
    <div
      className={`hero${compact ? ' hero--compact' : ''}`}
      style={{ ...classGradientVars(accent), ...style }}
    >
      <div className="hero__blob hero__blob--a" aria-hidden="true" />
      <div className="hero__blob hero__blob--b" aria-hidden="true" />

      <div className="hero__body">
        <div className="hero__text">
          {eyebrow && <div className="hero__eyebrow">{eyebrow}</div>}
          <div className={compact ? 'dfo-title hero__title' : 'dfo-display hero__title'}>{title}</div>
          {subtitle && <div className="hero__subtitle">{subtitle}</div>}
        </div>

        <div className="hero__side">
          {portrait ? (
            <img className="hero__portrait" src={portrait} alt="" />
          ) : (
            level !== undefined && (
              <div className="hero__level">
                <span className="hero__level-number dfo-numeric">{level}</span>
                <span className="hero__level-label">nível</span>
              </div>
            )
          )}
        </div>
      </div>

      {footer && <div className="hero__footer">{footer}</div>}
    </div>
  );

  if (!onTap) return content;

  return (
    <Tappable as="div" onTap={onTap} pressScale={0.975} style={{ display: 'block', width: '100%' }}>
      {content}
    </Tappable>
  );
}

/**
 * Retrato circular com borda. Sem foto, mostra a inicial sobre a cor da
 * classe — um espaço vazio no lugar de um rosto faz a ficha parecer incompleta.
 */
export function Avatar({
  src,
  name,
  accent,
  size = 56,
  onTap,
}: {
  src?: string | null;
  name: string;
  accent?: string | null;
  size?: number;
  onTap?: () => void;
}): JSX.Element {
  const initial = name.trim().charAt(0).toLocaleUpperCase('pt-BR') || '?';
  const body = (
    <div
      className="avatar"
      style={{ ...classGradientVars(accent), width: size, height: size, fontSize: size * 0.4 }}
    >
      {src ? <img src={src} alt="" className="avatar__img" /> : <span>{initial}</span>}
    </div>
  );

  return onTap ? (
    <Tappable as="div" onTap={onTap} pressScale={0.92} ariaLabel="Trocar foto">
      {body}
    </Tappable>
  ) : (
    body
  );
}
