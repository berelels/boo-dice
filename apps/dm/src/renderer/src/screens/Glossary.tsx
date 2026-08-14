import { useEffect, useMemo, useRef, useState } from 'react';
import { CATALOG_KIND_LABELS, type CatalogEntry, type CatalogKind, type SearchHit } from '@dfo/core';
import { BottomSheet, Button, Card, Chip, EmptyState, Tappable } from '@dfo/ui';
import { useDmApi } from '../db/useDmApi.js';
import type { ImportedPdf } from '../../../main/pdfImport.js';

/**
 * Bestiário — busca única sobre regras, magias, monstros, itens e condições,
 * offline, contra o índice FTS5. Porta quase literal de
 * `apps/player/src/screens/Glossary.tsx`: mesma UI, mesmo texto — só troca
 * `useAppData()`/`useLibraryCounts()` (contexto React) por `useDmApi()`
 * (IPC), já que aqui o banco vive no processo main, não no renderer.
 */

const FILTERS: readonly { readonly value: CatalogKind | 'all'; readonly label: string }[] = [
  { value: 'all', label: 'Tudo' },
  { value: 'spell', label: 'Magias' },
  { value: 'monster', label: 'Monstros' },
  { value: 'equipment', label: 'Equipamento' },
  { value: 'magic-item', label: 'Itens mágicos' },
  { value: 'condition', label: 'Condições' },
  { value: 'rule', label: 'Regras' },
  { value: 'feature', label: 'Características' },
];

export function GlossaryScreen(): JSX.Element {
  const dm = useDmApi();

  const [status, setStatus] = useState<{ hasContent: boolean; hasBooks: boolean; hasPdfs: boolean } | null>(
    null,
  );
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<CatalogKind | 'all'>('all');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [selected, setSelected] = useState<CatalogEntry | null>(null);
  const [searching, setSearching] = useState(false);
  const [pdfs, setPdfs] = useState<readonly ImportedPdf[] | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const refreshLibrary = (): void => {
    void dm.library.status().then(setStatus);
    void dm.library.counts().then(setCounts);
    void dm.library.listPdfs().then(setPdfs);
  };

  useEffect(refreshLibrary, [dm]);

  const importPdf = async (): Promise<void> => {
    setPdfBusy(true);
    try {
      await dm.library.importPdf();
      refreshLibrary();
    } finally {
      setPdfBusy(false);
    }
  };

  const removePdf = async (id: string): Promise<void> => {
    setPdfBusy(true);
    try {
      await dm.library.removePdf(id);
      refreshLibrary();
    } finally {
      setPdfBusy(false);
    }
  };

  const total = useMemo(
    () => (counts ? Object.values(counts).reduce((sum, value) => sum + value, 0) : 0),
    [counts],
  );

  useEffect(() => {
    if (query.trim().length === 0) {
      setHits([]);
      return;
    }

    // Debounce curto: rápido o bastante para parecer instantâneo, longo o
    // bastante para não disparar uma consulta por tecla digitada.
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void dm.library
        .search(query, { limit: 40, ...(kind === 'all' ? {} : { kinds: [kind] }) })
        .then((results) => {
          if (cancelled) return;
          setHits(results);
          setSearching(false);
        });
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, kind, dm]);

  return (
    <>
      <div className="glossary__search">
        <input
          ref={inputRef}
          type="search"
          className="dfo-input"
          value={query}
          placeholder="Bola de fogo, agarrado, goblin…"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Buscar nas regras"
        />
        {total > 0 && <p className="dfo-caption glossary__total">{total} verbetes, offline</p>}
      </div>

      <Card className="glossary__pdfs">
        {pdfBusy ? (
          <p className="dfo-caption">Processando…</p>
        ) : (
          <>
            {pdfs && pdfs.length > 0 && (
              <ul className="glossary__pdf-list">
                {pdfs.map((pdf) => (
                  <li key={pdf.id} className="glossary__pdf-row">
                    <div>
                      <div className="dfo-headline">{pdf.title}</div>
                      <span className="dfo-caption">
                        {pdf.pages} {pdf.pages === 1 ? 'página' : 'páginas'} · {pdf.chunks}{' '}
                        {pdf.chunks === 1 ? 'verbete' : 'verbetes'}
                      </span>
                    </div>
                    <Button variant="ghost" onTap={() => void removePdf(pdf.id)}>
                      Remover
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="dfo-caption">
              PDFs que você importar entram na busca acima e alimentam o Oráculo — tudo processado
              localmente, nada sai desta máquina.
            </p>
            <Button variant="ghost" onTap={() => void importPdf()}>
              Importar PDF
            </Button>
          </>
        )}
      </Card>

      <div className="dfo-scroll-x glossary__filters">
        {FILTERS.map((filter) => (
          <Tappable
            key={filter.value}
            onTap={() => setKind(filter.value)}
            className={`chip-button${kind === filter.value ? ' is-active' : ''}`}
            pressScale={0.94}
          >
            {filter.label}
          </Tappable>
        ))}
      </div>

      {status && !status.hasContent && (
        <EmptyState
          title="Nenhum acervo carregado"
          description="Rode “npm run data” na raiz para baixar o SRD, e “npm run data:book <arquivo>” para importar seus próprios livros."
        />
      )}

      {status?.hasContent && query.trim() === '' && (
        <EmptyState
          title="Busque qualquer coisa"
          description={
            status.hasBooks
              ? 'Regras, magias, monstros, itens e condições — em português, sem internet.'
              : 'Só o SRD está carregado. Importe seu livro para ter os verbetes em português.'
          }
        />
      )}

      {query.trim() !== '' && hits.length === 0 && !searching && (
        <EmptyState title="Nada encontrado" description={`Nenhum verbete para “${query}”.`} />
      )}

      <div className="glossary__results">
        {hits.map((hit) => (
          <Card key={hit.id} onTap={() => void dm.library.get(hit.id).then(setSelected)}>
            <div className="glossary__hit-head">
              <span className="dfo-headline">{hit.title}</span>
              <Chip tone={hit.lang === 'pt' ? 'neutral' : 'accent'}>
                {hit.lang === 'pt' ? CATALOG_KIND_LABELS[hit.kind] : 'EN'}
              </Chip>
            </div>
            {hit.subtitle && <div className="dfo-caption">{hit.subtitle}</div>}
            <p className="glossary__snippet dfo-caption">{highlight(hit.snippet)}</p>
          </Card>
        ))}
      </div>

      <BottomSheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.title}
        maxHeight={0.88}
      >
        {selected && (
          <article className="entry">
            <div className="entry__meta">
              <Chip tone="accent">{CATALOG_KIND_LABELS[selected.kind]}</Chip>
              {selected.subtitle && <span className="dfo-caption">{selected.subtitle}</span>}
              {selected.lang === 'en' && (
                <Chip title="Este verbete ainda não tem tradução no acervo carregado.">
                  em inglês
                </Chip>
              )}
            </div>
            {selected.body.split('\n').map((paragraph, index) =>
              paragraph.trim() === '' ? null : (
                <p key={index} className="dfo-body entry__paragraph">
                  {paragraph}
                </p>
              ),
            )}
            {selected.section && <div className="dfo-caption entry__source">{selected.section}</div>}
          </article>
        )}
      </BottomSheet>
    </>
  );
}

/**
 * O FTS devolve os termos cercados por `[[` e `]]`. Convertemos para elementos
 * em vez de injetar HTML — o texto vem de um arquivo de dados, e montar HTML a
 * partir dele seria abrir uma porta sem nenhuma necessidade.
 */
function highlight(snippet: string): JSX.Element[] {
  return snippet.split(/(\[\[.*?\]\])/g).map((part, index) =>
    part.startsWith('[[') && part.endsWith(']]') ? (
      <mark key={index} className="glossary__mark">
        {part.slice(2, -2)}
      </mark>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}
