import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CharacterRepository,
  RollLogRepository,
  RulesLibrary,
  RulesSearch,
  migrate,
} from '@dfo/core';
import { openLibraryDatabase, openPdfLibraryDatabase, openPlayerDatabase, type PersistentDriver } from './open.js';
import { importPdf as importPdfFile, listImportedPdfs, removePdf as removePdfFile, type ImportedPdf } from '../state/pdfImport.js';

/**
 * Camada de dados do app.
 *
 * São quatro bancos com papéis distintos:
 *
 *  - **player.db**      os personagens e o registro de rolagens. Gravável, é
 *                       a única coisa que pertence de fato ao usuário.
 *  - **srd.db**         o SRD, somente-leitura, embarcado no app.
 *  - **books.db**       o livro que veio com o app (se algum foi embutido no
 *                       build), somente-leitura.
 *  - **pdf-library.db** os PDFs que o próprio jogador importou. Gravável —
 *                       é o único acervo extra possível no PWA/mobile, já que
 *                       não existe `npm run data:book` fora de um ambiente
 *                       de desenvolvimento.
 */

export interface AppData {
  readonly characters: CharacterRepository;
  readonly rolls: RollLogRepository;
  readonly library: RulesLibrary;
  readonly flush: () => Promise<void>;
  readonly pdfs: {
    list(): Promise<ImportedPdf[]>;
    import(file: File): Promise<ImportedPdf>;
    remove(id: string): Promise<void>;
  };
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
  const pdfDriverRef = useRef<PersistentDriver | null>(null);

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
        const pdfDriver = await openPdfLibraryDatabase();
        const pdfs = await openPdfSearch(pdfDriver);

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
          void pdfDriver.flush();
          return;
        }

        pdfDriverRef.current = pdfDriver;
        const library = new RulesLibrary(srd, books, pdfs);
        // `pdfDriver` é uma conexão só, reaproveitada pra ler e escrever a
        // vida toda da sessão — diferente do mestre, que abre uma conexão
        // nova por PDF. `RulesLibrary.setPdfs()` fecha a fonte anterior antes
        // de trocar, então só pode ser chamada quando ainda não há nenhuma
        // (isto é, uma vez, na primeira importação): chamar de novo fecharia
        // o próprio `pdfDriver` que continuamos usando pra gravar.
        let pdfsAttached = pdfs !== null;

        setData({
          characters: new CharacterRepository(player),
          rolls: new RollLogRepository(player),
          library,
          flush: () => player.flush(),
          pdfs: {
            list: () => listImportedPdfs(pdfDriver),
            import: async (file: File) => {
              const imported = await importPdfFile(pdfDriver, file);
              if (!pdfsAttached) {
                await library.setPdfs(new RulesSearch(pdfDriver));
                pdfsAttached = true;
              }
              setData((current) => (current ? { ...current } : current));
              return imported;
            },
            remove: async (id: string) => {
              await removePdfFile(pdfDriver, id);
              // Não desliga a fonte mesmo se o último PDF acabou de sair — a
              // busca simplesmente passa a não achar nada vindo de lá, e
              // `pdfs.list()` (não `library.hasPdfs`) é quem manda na UI.
              setData((current) => (current ? { ...current } : current));
            },
          },
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
    const save = (): void => {
      void data.flush();
      void pdfDriverRef.current?.flush();
    };
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

/** Como `openLibrary`, mas sobre um driver gravável já aberto (não somente-leitura). */
async function openPdfSearch(driver: PersistentDriver): Promise<RulesSearch | null> {
  try {
    await driver.query("SELECT 1 FROM catalog WHERE id LIKE 'pdf:%' LIMIT 1");
    return new RulesSearch(driver);
  } catch {
    // Tabela ainda não existe (nenhum PDF importado) — normal, não é erro.
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
