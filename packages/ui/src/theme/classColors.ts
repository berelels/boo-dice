/**
 * Cor por classe de D&D.
 *
 * A cor é o que torna a galeria legível de relance: você reconhece o seu
 * bárbaro pela mancha vermelha antes de ler o nome. Fica na camada de UI, e
 * não no domínio, porque é decisão de apresentação — o `core` não deve ter
 * opinião sobre cores.
 */

export const CLASS_ACCENTS = {
  barbarian: 'barbarian',
  bard: 'bard',
  cleric: 'cleric',
  druid: 'druid',
  fighter: 'fighter',
  monk: 'monk',
  paladin: 'paladin',
  ranger: 'ranger',
  rogue: 'rogue',
  sorcerer: 'sorcerer',
  warlock: 'warlock',
  wizard: 'wizard',
} as const;

export type ClassAccent = keyof typeof CLASS_ACCENTS;

/**
 * Variáveis CSS do gradiente de uma classe, prontas para `style`.
 *
 * Devolve também `--class-shadow`, uma versão translúcida da cor base: a
 * sombra colorida sob o card faz a cor "vazar" para o fundo e é o que separa
 * um card com cor de um retângulo pintado.
 */
export function classGradientVars(accent: string | null | undefined): React.CSSProperties {
  const key = accent && accent in CLASS_ACCENTS ? accent : 'wizard';
  return {
    ['--class-base' as string]: `var(--class-${key})`,
    ['--class-tip' as string]: `var(--class-${key}-tip)`,
    ['--class-shadow' as string]: `color-mix(in srgb, var(--class-${key}) 45%, transparent)`,
  };
}
