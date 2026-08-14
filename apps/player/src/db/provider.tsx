import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CharacterRepository,
  RollLogRepository,
  RulesSearch,
  migrate,
  type CatalogEntry,
  type SearchHit,
  type SearchOptions,
} from '@dfo/core';
import { openLibraryDatabase, openPlayerDatabase } from './open.js';

/**
 * Camada de dados do app.
 *
 * São três bancos com papéis distintos:
 *
 *  - **player.db**  os personagens e o registro de rolagens. Gravável, é a
 *                   única coisa que pertence de fato ao usuário.
 *  - **srd.db**     o SRD, somente-leitura, embarcado no app.
 *  - **books.db**   os livros que o usuário importou, somente-leitura. Pode
 *                   não existir, e o app funciona sem ele.
 */

export interface AppData {
  readonly characters: CharacterRepository;
  readonly rolls: RollLogRepository;
  readonly library: Library;
  readonly flush: () => Promise<void>;
}

/**
 * Busca sobre os dois acervos ao mesmo tempo.
 *
 * Cada acervo é uma conexão WASM separada, e `ATTACH` não atravessa conexões,
 * então a junção acontece aqui, em JavaScript. A ordenação final prefere
 * português: quem joga em
 * português quer o resultado em português primeiro, mesmo que o registro em
 * inglês tenha pontuação melhor no BM25.
 */
export class Library {
  constructor(
    private readonly srd: RulesSearch | null,
    private readonly books: RulesSearch | null,
  ) {}

  get hasContent(): boolean {
    return this.srd !== null || this.books !== null;
  }

  get hasBooks(): boolean {
    return this.books !== null;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    const limit = options.limit ?? 40;
    const results = await Promise.all([
      this.srd?.search(query, { ...options, limit }) ?? Promise.resolve([]),
      this.books?.search(query, { ...options, limit }) ?? Promise.resolve([]),
    ]);

    return results
      .flat()
      .sort((a, b) => adjustedRank(a) - adjustedRank(b))
      .slice(0, limit);
  }

  async get(id: string): Promise<CatalogEntry | null> {
    const source = id.startsWith('book:') ? this.books : this.srd;
    return (await source?.get(id)) ?? null;
  }

  async countByKind(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const source of [this.srd, this.books]) {
      if (!source) continue;
      for (const [kind, total] of Object.entries(await source.countByKind())) {
        counts[kind] = (counts[kind] ?? 0) + total;
      }
    }
    return counts;
  }
}

/**
 * Vantagem dada ao conteúdo em português na ordenação final.
 *
 * O `rank` do BM25 é negativo — quanto mais negativo, mais relevante — então
 * multiplicar por um fator maior que 1 empurra o resultado para cima.
 *
 * O valor não é arbitrário. Uma preferência *absoluta* por português (todo `pt`
 * antes de todo `en`) faz "goblin" devolver um bloco solto do capítulo de
 * criação de personagem (rank −5,6, que só menciona a palavra de passagem)
 * acima do próprio monstro Goblin (rank −11,9). Um fator nessa faixa faz o
 * português vencer entre resultados de relevância parecida, sem deixar um
 * acerto de título perder para uma menção lateral.
 */
const PORTUGUESE_BOOST = 1.4;

function adjustedRank(hit: SearchHit): number {
  return hit.lang === 'pt' ? hit.rank * PORTUGUESE_BOOST : hit.rank;
}

const AppDataContext = createContext<AppData | null>(null);

export function useAppData(): AppData {
  const data = useContext(AppDataContext);
  if (!data) throw new Error('useAppData precisa estar dentro de <AppDataProvider>.');
  return data;
}

export function AppDataProvider({ children }: { children: ReactNode }): JSX.Element {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const player = await openPlayerDatabase();
        await migrate(player);

        // Os acervos são opcionais: sem eles a ficha continua funcionando
        // inteira, só o glossário fica vazio. Falhar o app por causa de um
        // arquivo de conteúdo ausente seria desproporcional.
        const srd = await openLibrary('srd');
        const books = await openLibrary('books');

        if (cancelled) {
          // O StrictMode do React (dev only) monta, desmonta e monta este
          // efeito de novo para expor bugs de limpeza — e caiu bem aqui: a
          // primeira chamada abre um driver de verdade antes do cancelamento
          // acontecer. Sem isto, esse driver descartado continuava vivo com
          // seu próprio timer de gravação armado, e minutos depois ele grava
          // por cima do driver que o app está usando de fato — os dados
          // regridem para o estado de quando a página abriu, sem erro nenhum
          // à vista. `flush()` desarma o timer e descarta o driver na hora.
          void player.flush();
          return;
        }
        setData({
          characters: new CharacterRepository(player),
          rolls: new RollLogRepository(player),
          library: new Library(srd, books),
          flush: () => player.flush(),
        });
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Gravar antes de sair: o debounce do driver pode ter uma alteração pendente.
  useEffect(() => {
    if (!data) return;
    const save = (): void => void data.flush();
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', save);
    return () => {
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', save);
    };
  }, [data]);

  if (error) {
    return (
      <div className="app-boot">
        <p className="dfo-title">Não consegui abrir o banco de dados</p>
        <p className="dfo-caption">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="app-boot">
        <div className="app-boot__spinner" aria-hidden="true" />
        <p className="dfo-caption">Preparando os dados…</p>
      </div>
    );
  }

  return <AppDataContext.Provider value={data}>{children}</AppDataContext.Provider>;
}

async function openLibrary(name: string): Promise<RulesSearch | null> {
  try {
    const driver = await openLibraryDatabase(name);
    // Confirma que o arquivo é mesmo um catálogo antes de aceitá-lo — um 404
    // que devolve HTML vira um "banco" que só falha na primeira consulta.
    await driver.query('SELECT 1 FROM catalog LIMIT 1');
    return new RulesSearch(driver);
  } catch (error) {
    // Um acervo ausente é situação normal (o usuário pode não ter importado
    // livro nenhum), então não derruba o app. Mas engolir a causa em silêncio
    // transforma um bug de carregamento em "a busca não acha nada", que é
    // exatamente o tipo de falha que custa horas para diagnosticar.
    console.warn(`[dfo] acervo "${name}" indisponível:`, error);
    return null;
  }
}

export function useLibraryCounts(): Record<string, number> | null {
  const { library } = useAppData();
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    void library.countByKind().then(setCounts);
  }, [library]);

  return useMemo(() => counts, [counts]);
}
