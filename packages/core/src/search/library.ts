import { RulesSearch, type CatalogEntry, type SearchHit, type SearchOptions } from './rules-search.js';

/**
 * Busca sobre os acervos disponíveis ao mesmo tempo: SRD, livro importado e
 * PDFs que o mestre trouxe (base do Oráculo).
 *
 * Porta de `apps/player/src/db/provider.tsx` — a mesma lógica serve o
 * glossário do jogador e o bestiário do mestre, cada um com seu próprio
 * conjunto de conexões `RulesSearch` (bancos diferentes, processos
 * diferentes). O app do jogador mantém sua cópia local; esta é a versão
 * compartilhada para quem não precisa do resto do `provider.tsx` (React,
 * IndexedDB, StrictMode). `pdfs` é opcional e só existe do lado do mestre —
 * o jogador nunca importa PDF.
 */
export class RulesLibrary {
  constructor(
    private readonly srd: RulesSearch | null,
    private readonly books: RulesSearch | null,
    private pdfs: RulesSearch | null = null,
  ) {}

  /**
   * Troca a fonte de PDFs em tempo real — depois de importar ou remover um,
   * sem precisar reiniciar o app pra busca refletir o acervo novo. Fecha a
   * conexão anterior, se houver, pra não vazar o arquivo aberto.
   */
  async setPdfs(pdfs: RulesSearch | null): Promise<void> {
    await this.pdfs?.close();
    this.pdfs = pdfs;
  }

  get hasContent(): boolean {
    return this.srd !== null || this.books !== null || this.pdfs !== null;
  }

  get hasBooks(): boolean {
    return this.books !== null;
  }

  get hasPdfs(): boolean {
    return this.pdfs !== null;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    const limit = options.limit ?? 40;
    const [srdHits, bookHits, pdfHits] = await Promise.all([
      this.srd?.search(query, { ...options, limit }) ?? Promise.resolve([]),
      this.books?.search(query, { ...options, limit }) ?? Promise.resolve([]),
      this.pdfs?.search(query, { ...options, limit }) ?? Promise.resolve([]),
    ]);

    // O subtítulo das magias do SRD já sai em português ("Truque — Evocação"),
    // mesmo nas que ficam marcadas `lang: 'en'` por título/descrição não
    // traduzidos. Isso faz uma busca em português acertar as duas fontes ao
    // mesmo tempo — e, quando existe livro importado, a duplicata do SRD só
    // aparece pra confundir com texto em inglês no meio de um resultado que
    // parece todo traduzido. Com o livro presente, ele já cobre a magia.
    const srdSpellsToShow = this.books
      ? srdHits.filter((hit) => hit.kind !== 'spell' || hit.lang !== 'en')
      : srdHits;

    return [...srdSpellsToShow, ...bookHits, ...pdfHits]
      .sort((a, b) => adjustedRank(a) - adjustedRank(b))
      .slice(0, limit);
  }

  async get(id: string): Promise<CatalogEntry | null> {
    const source = id.startsWith('book:') ? this.books : id.startsWith('pdf:') ? this.pdfs : this.srd;
    return (await source?.get(id)) ?? null;
  }

  async countByKind(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const source of [this.srd, this.books, this.pdfs]) {
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
 * multiplicar por um fator maior que 1 empurra o resultado para cima. Ver o
 * comentário original em `apps/player/src/db/provider.tsx` para o raciocínio
 * completo por trás do valor.
 */
const PORTUGUESE_BOOST = 1.4;

function adjustedRank(hit: SearchHit): number {
  return hit.lang === 'pt' ? hit.rank * PORTUGUESE_BOOST : hit.rank;
}
