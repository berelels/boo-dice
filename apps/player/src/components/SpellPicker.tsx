import { useEffect, useState } from 'react';
import type { SearchHit, SpellEntry } from '@dfo/core';
import { BottomSheet, Button, Chip, Tappable } from '@dfo/ui';
import { useAppData } from '../db/provider.js';
import { toSpellEntry } from './spellHelpers.js';

/**
 * Busca de magias no acervo, para adicionar à ficha.
 *
 * Reaproveita o mesmo índice FTS5 do glossário — não existe uma segunda base
 * de magias. O que muda é o destino: aqui o resultado vira uma entrada na
 * ficha, com nível e escola já preenchidos a partir dos campos estruturados
 * do catálogo.
 */

export function SpellPicker({
  open,
  onClose,
  onAdd,
  alreadyAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (spell: SpellEntry) => void;
  alreadyAdded: ReadonlySet<string>;
}): JSX.Element {
  const { library } = useAppData();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (query.trim().length === 0) {
      setHits([]);
      return;
    }

    let cancelled = false;
    setBusy(true);
    const timer = window.setTimeout(() => {
      void library.search(query, { limit: 30, kinds: ['spell'] }).then((results) => {
        if (cancelled) return;
        setHits(results);
        setBusy(false);
      });
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, library, open]);

  const add = async (hit: SearchHit): Promise<void> => {
    const entry = await library.get(hit.id);
    if (!entry) return;
    onAdd(toSpellEntry(entry));
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Adicionar magia" maxHeight={0.9}>
      <input
        type="search"
        className="dfo-input"
        value={query}
        placeholder="Bola de fogo, curar ferimentos…"
        autoComplete="off"
        spellCheck={false}
        aria-label="Buscar magia"
        onChange={(event) => setQuery(event.target.value)}
      />

      {!library.hasContent && (
        <p className="dfo-caption spell-picker__hint">
          Nenhum acervo carregado. Rode <code>npm run data</code> para o SRD, ou{' '}
          <code>npm run data:book</code> para importar seu livro em português.
        </p>
      )}

      {query.trim() === '' && library.hasContent && (
        <p className="dfo-caption spell-picker__hint">
          Digite o nome da magia. A busca ignora acentos e responde enquanto você escreve.
        </p>
      )}

      {query.trim() !== '' && hits.length === 0 && !busy && (
        <p className="dfo-caption spell-picker__hint">Nenhuma magia com esse nome.</p>
      )}

      <div className="spell-picker__list">
        {hits.map((hit) => {
          const added = alreadyAdded.has(hit.id);
          return (
            <Tappable
              as="div"
              key={hit.id}
              className={`spell-row${added ? ' spell-row--added' : ''}`}
              hapticOnTap
              onTap={() => {
                if (!added) void add(hit);
              }}
            >
              <div className="spell-row__main">
                <span className="dfo-headline">{hit.title}</span>
                <span className="dfo-caption">{hit.subtitle}</span>
              </div>
              {added ? (
                <Chip tone="success">na ficha</Chip>
              ) : (
                <span className="spell-row__add" aria-hidden="true">
                  +
                </span>
              )}
            </Tappable>
          );
        })}
      </div>

      <Button variant="secondary" full onTap={onClose}>
        Fechar
      </Button>
    </BottomSheet>
  );
}

