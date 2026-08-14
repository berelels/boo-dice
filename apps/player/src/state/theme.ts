import { useCallback, useEffect, useState } from 'react';

/**
 * Tema claro/escuro.
 *
 * O padrão segue o sistema — é o comportamento acessível e o que o usuário
 * espera. Mas a escolha precisa existir: uma mesa de RPG à noite quer escuro,
 * e a mesma pessoa de dia quer claro, e o sistema operacional não sabe disso.
 *
 * A preferência fica no `localStorage`, e não no banco: é ajuste do aparelho,
 * não do personagem, e precisa ser lida antes de qualquer coisa assíncrona
 * abrir — esperar o SQLite para saber a cor de fundo causaria um flash.
 */

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'dfo:theme';

function read(): ThemePreference {
  // Em aba privada do Safari com "Bloquear todos os cookies" ativo,
  // `localStorage` lança `SecurityError` até em leitura — e isto roda antes
  // do React montar (ver `initTheme`), então sem o try/catch a exceção
  // impede a própria montagem: tela preta, sem nenhum erro visível ao
  // usuário.
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function apply(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
}

/** Aplica antes do React montar, para não haver um quadro com a cor errada. */
export function initTheme(): void {
  apply(read());
}

export function useTheme(): {
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
  /** O tema em vigor agora, já resolvendo `system`. */
  resolved: 'light' | 'dark';
} {
  const [preference, setState] = useState<ThemePreference>(read);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setState(next);
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Sem acesso ao localStorage: o tema muda na tela igual, só não
      // sobrevive a um recarregamento.
    }
    apply(next);
  }, []);

  return {
    preference,
    setPreference,
    resolved: preference === 'system' ? (systemDark ? 'dark' : 'light') : preference,
  };
}
