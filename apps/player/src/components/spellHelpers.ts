import type { CatalogEntry, SpellEntry } from '@dfo/core';

/**
 * Conversão e agrupamento de magias — extraído de `SpellPicker.tsx`.
 *
 * Um arquivo que exporta um componente React só pode exportar mais componentes
 * sem quebrar o Fast Refresh do Vite; qualquer função ou constante "solta"
 * junto invalida o boundary inteiro. Isso já causou uma instabilidade real:
 * cada edição durante o desenvolvimento disparava uma recarga muito maior do
 * que deveria, remontando a árvore inteira em vez de só o componente tocado —
 * e nesse meio-tempo, toques podiam acabar presos num handler de uma versão
 * antiga do módulo.
 */

/**
 * Converte um registro do catálogo numa entrada de magia da ficha.
 *
 * O nível vem dos campos estruturados quando existem. Quando não — porque o
 * registro veio do livro do usuário e o campo ficou de fora — caímos no
 * subtítulo, que sempre começa com "Truque" ou "Nº nível".
 */
export function toSpellEntry(entry: CatalogEntry): SpellEntry {
  const data = entry.data ?? {};
  const level = typeof data.level === 'number' ? data.level : levelFromSubtitle(entry.subtitle);

  return {
    spellId: entry.id,
    label: entry.title,
    level,
    prepared: level === 0, // truques estão sempre prontos
    alwaysPrepared: false,
    classId: null,
  };
}

function levelFromSubtitle(subtitle: string): number {
  if (/truque/i.test(subtitle)) return 0;
  const match = /(\d)\s*[ºo°]?\s*n[íi]vel/i.exec(subtitle);
  return match ? Number(match[1]) : 1;
}

/** Agrupa por nível para a lista da ficha, com truques primeiro. */
export function groupSpellsByLevel(spells: readonly SpellEntry[]): [number, SpellEntry[]][] {
  const groups = new Map<number, SpellEntry[]>();
  for (const spell of spells) {
    const list = groups.get(spell.level);
    if (list) list.push(spell);
    else groups.set(spell.level, [spell]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([level, list]) => [level, [...list].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))]);
}
