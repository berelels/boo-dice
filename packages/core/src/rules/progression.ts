/**
 * Progressão de nível: bônus de proficiência e a tabela de experiência.
 */

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 20;

/**
 * Tabela de XP do PHB. O índice do array é `nível − 1`, então
 * `XP_THRESHOLDS[0]` é o XP necessário para ser nível 1 (zero).
 */
export const XP_THRESHOLDS: readonly number[] = [
  0, 300, 900, 2_700, 6_500, 14_000, 23_000, 34_000, 48_000, 64_000, 85_000, 100_000, 120_000,
  140_000, 165_000, 195_000, 225_000, 265_000, 305_000, 355_000,
];

/**
 * +2 no nível 1, subindo de 1 a cada quatro níveis (5, 9, 13, 17).
 * Vale para o nível *total* do personagem, não por classe — é o erro clássico
 * de quem monta multiclasse na mão.
 */
export function proficiencyBonus(totalLevel: number): number {
  const level = clampLevel(totalLevel);
  return 2 + Math.floor((level - 1) / 4);
}

export function levelForXp(xp: number): number {
  if (xp < 0) return MIN_LEVEL;
  let level = MIN_LEVEL;
  for (let index = 0; index < XP_THRESHOLDS.length; index += 1) {
    if (xp >= XP_THRESHOLDS[index]!) level = index + 1;
    else break;
  }
  return level;
}

export function xpForLevel(level: number): number {
  return XP_THRESHOLDS[clampLevel(level) - 1]!;
}

/** XP que ainda falta para o próximo nível, ou `null` se já está no 20. */
export function xpToNextLevel(xp: number): number | null {
  const level = levelForXp(xp);
  if (level >= MAX_LEVEL) return null;
  return XP_THRESHOLDS[level]! - xp;
}

export function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return MIN_LEVEL;
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.floor(level)));
}
