import { useEffect, useMemo, useRef, useState } from 'react';
import { CATALOG_KIND_LABELS, type CatalogEntry, type CatalogKind, type SearchHit } from '@dfo/core';
import { BottomSheet, Button, Card, Chip, EmptyState, Screen, Tappable, TopBar } from '@dfo/ui';
import { useAppData, useLibraryCounts } from '../db/provider.js';
import type { ImportedPdf } from '../state/pdfImport.js';

/**
 * Glossário.
 *
 * Busca única sobre tudo — regras, magias, monstros, itens, condições —
 * inteiramente offline, contra o índice FTS5. Ela responde enquanto se digita
 * porque a última palavra da consulta vira busca por prefixo, e ignora acento
 * porque ninguém digita acento numa caixa de busca.
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

export function GlossaryScreen({ onBack }: { onBack: () => void }): JSX.Element {
  const { library, pdfs } = useAppData();
  const counts = useLibraryCounts();

  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<CatalogKind | 'all'>('all');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [selected, setSelected] = useState<CatalogEntry | null>(null);
  const [searching, setSearching] = useState(false);
  const [pdfList, setPdfList] = useState<readonly ImportedPdf[] | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMessage, setPdfMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshPdfs = (): void => {
    void pdfs.list().then(setPdfList);
  };

  useEffect(refreshPdfs, [pdfs]);

  const importPdf = async (file: File): Promise<void> => {
    setPdfBusy(true);
    setPdfMessage(null);
    try {
      await pdfs.import(file);
      refreshPdfs();
    } catch (error) {
      setPdfMessage(error instanceof Error ? error.message : 'Não consegui importar esse PDF.');
    } finally {
      setPdfBusy(false);
    }
  };

  const removePdf = async (id: string): Promise<void> => {
    setPdfBusy(true);
    try {
      await pdfs.remove(id);
      refreshPdfs();
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
      void library
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
  }, [query, kind, library]);

  return (
    <Screen>
      <TopBar
        title="Glossário"
        subtitle={total > 0 ? `${total} verbetes, offline` : undefined}
        leading={
          <Tappable onTap={onBack} className="icon-button" ariaLabel="Voltar">
            <span aria-hidden="true">←</span>
          </Tappable>
        }
      />

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
      </div>

      <Card className="glossary__pdfs">
        {pdfBusy ? (
          <p className="dfo-caption">Processando…</p>
        ) : (
          <>
            {pdfList && pdfList.length > 0 && (
              <ul className="glossary__pdf-list">
                {pdfList.map((pdf) => (
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
              Importe o PDF do seu livro pra ter as regras completas em português — tudo
              processado no aparelho, nada é enviado pra lugar nenhum.
            </p>
            <Button variant="ghost" onTap={() => fileInputRef.current?.click()}>
              Importar PDF
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="file-input--hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void importPdf(file);
              }}
            />
          </>
        )}
        {pdfMessage && <p className="dfo-caption form-message form-message--error">{pdfMessage}</p>}
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

      {!library.hasContent && (
        <EmptyState
          title="Nenhum acervo carregado"
          description="Algo deu errado ao carregar o SRD embutido no app. Tente reabrir o app; se persistir, reinstale."
        />
      )}

      {library.hasContent && query.trim() === '' && (
        <EmptyState
          title="Busque qualquer coisa"
          description={
            library.hasBooks || (pdfList && pdfList.length > 0)
              ? 'Regras, magias, monstros, itens e condições — em português, sem internet.'
              : 'Só o SRD está carregado (em inglês). Importe o PDF do seu livro, ali em cima, para ter os verbetes em português.'
          }
        />
      )}

      {query.trim() !== '' && hits.length === 0 && !searching && (
        <EmptyState title="Nada encontrado" description={`Nenhum verbete para “${query}”.`} />
      )}

      <div className="glossary__results">
        {hits.map((hit) => (
          <Card key={hit.id} onTap={() => void library.get(hit.id).then(setSelected)}>
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
    </Screen>
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
