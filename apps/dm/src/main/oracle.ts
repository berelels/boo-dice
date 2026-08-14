import { createWriteStream, existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import type { CatalogEntry, RulesLibrary, SearchHit } from '@dfo/core';

/**
 * O Oráculo — perguntas ao mestre respondidas por um modelo local, ancorado
 * no que já está indexado (SRD, livro, PDFs importados). Sem servidor,
 * sem chave de API: o modelo baixa uma vez (~1GB) e roda inteiramente na
 * máquina do mestre depois disso.
 *
 * A ordem importa: busca primeiro, geração depois (RAG). Um modelo pequeno
 * como este não sabe D&D de cor — o que ele sabe fazer bem é ler um trecho
 * de verdade e responder a partir dele. Sem a busca por baixo, ele
 * alucinaria regra; com ela, só reformula o que já está indexado.
 */

const MODEL_URL =
  'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf';

const MAX_SOURCES = 4;
const MAX_SOURCE_LENGTH = 1200;
const QUOTA_PER_SESSION = 3;

export interface OracleSource {
  readonly title: string;
  readonly section: string | null;
}

export interface OracleAnswer {
  readonly answer: string;
  readonly sources: readonly OracleSource[];
}

// ---------------------------------------------------------------------------
// Cota — 3 perguntas, mas só conta enquanto uma sessão de LAN está no ar.
// Fora de sessão (testando sozinho, preparando a mesa) as perguntas são
// ilimitadas; `null` representa isso pro chamador — não "zero restantes".
// ---------------------------------------------------------------------------

let sessionActive = false;
let remainingQuestions = QUOTA_PER_SESSION;

export function setOracleSessionActive(active: boolean): void {
  sessionActive = active;
}

export function getOracleQuota(): number | null {
  return sessionActive ? remainingQuestions : null;
}

export function resetOracleQuota(): void {
  remainingQuestions = QUOTA_PER_SESSION;
}

// ---------------------------------------------------------------------------
// Modelo — baixa sob demanda, roda local depois disso.
// ---------------------------------------------------------------------------

export function isModelDownloaded(modelPath: string): boolean {
  return existsSync(modelPath);
}

/**
 * Baixa pra um `.part` e só renomeia pro nome final no fim — um download
 * interrompido no meio nunca fica parecendo um modelo utilizável.
 */
export async function downloadModel(
  modelPath: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const response = await fetch(MODEL_URL);
  if (!response.ok || !response.body) {
    throw new Error(`Falha ao baixar o modelo do Oráculo (HTTP ${response.status}).`);
  }

  const total = Number(response.headers.get('content-length') ?? 0);
  let loaded = 0;

  const tempPath = `${modelPath}.part`;
  const file = createWriteStream(tempPath);
  const reader = response.body.getReader();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await new Promise<void>((resolve, reject) => {
        file.write(value, (error) => (error ? reject(error) : resolve()));
      });
      loaded += value.length;
      if (total > 0) onProgress(loaded / total);
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      file.end((error?: Error | null) => (error ? reject(error) : resolve())),
    );
  }

  await rename(tempPath, modelPath);
}

// ---------------------------------------------------------------------------
// Geração — carrega o modelo uma vez por execução do app, uma janela de
// contexto nova a cada pergunta (são só 3 por sessão, não vale a pena reusar
// e arriscar uma pergunta "puxar" contexto da anterior).
// ---------------------------------------------------------------------------

// Tipos de `node-llama-cpp` só nomeados aqui — o import real é dinâmico logo
// abaixo, pra não puxar o binding nativo pra dentro do boot do app inteiro.
type LlamaModel = Awaited<ReturnType<Awaited<ReturnType<typeof import('node-llama-cpp').getLlama>>['loadModel']>>;

let modelInstance: LlamaModel | null = null;

async function getModel(modelPath: string): Promise<LlamaModel> {
  if (modelInstance) return modelInstance;
  const { getLlama } = await import('node-llama-cpp');
  // CPU, não GPU: o mestre que rodar isto não necessariamente tem driver
  // Vulkan/CUDA funcional, e um modelo deste tamanho já responde rápido o
  // bastante sem GPU. Preferir "funciona em qualquer máquina" a "mais rápido
  // só em algumas".
  const llama = await getLlama({ gpu: false });
  modelInstance = await llama.loadModel({ modelPath });
  return modelInstance;
}

async function generate(modelPath: string, prompt: string): Promise<string> {
  const { LlamaChatSession } = await import('node-llama-cpp');
  const model = await getModel(modelPath);
  const context = await model.createContext();
  try {
    // A instrução de "não inventar" pesa mais vindo do papel de sistema do
    // que enfiada junto do resto do texto do usuário — modelo instruído
    // segue o `systemPrompt` com prioridade mais alta que uma frase perdida
    // no meio de uma mensagem comum.
    const session = new LlamaChatSession({
      contextSequence: context.getSequence(),
      systemPrompt: ORACLE_SYSTEM_PROMPT,
    });
    return await session.prompt(prompt, {
      maxTokens: 400,
      temperature: 0.4,
      // Um modelo deste tamanho entra fácil num loop tipo "1d6 + 1d6 + 1d6 +
      // …" até estourar `maxTokens` — o DRY penalty torna literalmente
      // impossível repetir a mesma sequência de tokens verbatim.
      dryRepeatPenalty: { strength: 0.8 },
    });
  } finally {
    await context.dispose();
  }
}

// ---------------------------------------------------------------------------
// Busca — a pergunta do mestre é uma frase inteira, não os dois ou três
// termos que o resto do app manda pro FTS5. `toFtsQuery` exige que TODOS os
// termos apareçam (é um AND), então perguntar a frase inteira de uma vez
// quase sempre bate zero resultado — palavras de função ("quanto", "que",
// "pode") nunca vão aparecer juntas de nenhuma magia ou regra. A saída é
// buscar palavra relevante por palavra relevante e juntar os acertos: cada
// busca individual já é o caso que o motor sabe resolver bem.
// ---------------------------------------------------------------------------

/** "são"/"sao", "está"/"esta" — quem digita rápido nem sempre acentua. */
function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Normalizadas sem acento na própria definição: a comparação em
// `extractKeywords` também despe acento da palavra digitada, então as duas
// pontas precisam falar a mesma forma — "são" aqui dentro nunca bateria com
// o "sao" que alguém realmente digita.
const STOPWORDS_PT = new Set(
  [
    'a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'é', 'em', 'um', 'uma', 'uns', 'umas',
    'que', 'com', 'para', 'por', 'no', 'na', 'nos', 'nas', 'se', 'sem', 'sobre', 'como', 'mais',
    'mas', 'ou', 'ao', 'aos', 'à', 'às', 'pode', 'podem', 'ser', 'qual', 'quais', 'quanto', 'quantos',
    'quanta', 'quantas', 'tem', 'têm', 'vai', 'vou', 'foi', 'são', 'está', 'estão', 'isso', 'isto',
    'este', 'esta', 'esse', 'essa', 'num', 'numa', 'entre', 'até', 'também', 'já', 'me', 'meu', 'minha',
  ].map(stripDiacritics),
);

export function extractKeywords(question: string): string[] {
  const words = question
    .split(/[^\p{L}\p{N}]+/u)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 3 && !STOPWORDS_PT.has(stripDiacritics(word)));
  return [...new Set(words)];
}

async function retrieveSources(library: RulesLibrary, question: string): Promise<CatalogEntry[]> {
  const keywords = extractKeywords(question);
  const queries = keywords.length > 0 ? keywords : [question];

  const hitLists = await Promise.all(queries.map((word) => library.search(word, { limit: MAX_SOURCES })));

  // A palavra mais longa costuma ser o assunto de verdade da pergunta ("Bola
  // de Fogo", "nevenunca"), as mais curtas tendem a ser genéricas ("perigos",
  // "dano"). Se o termo mais específico não bateu em nada, as outras palavras
  // que bateram sozinhas são ruído — melhor admitir que não achou do que
  // responder sobre um assunto só parecido com o que foi perguntado.
  if (queries.length > 1) {
    const longestIndex = queries.reduce(
      (best, word, index) => (word.length > queries[best]!.length ? index : best),
      0,
    );
    if (hitLists[longestIndex]!.length === 0) return [];
  }

  const bestById = new Map<string, SearchHit>();
  for (const hits of hitLists) {
    for (const hit of hits) {
      const current = bestById.get(hit.id);
      if (!current || hit.rank < current.rank) bestById.set(hit.id, hit); // rank do BM25: mais negativo é melhor.
    }
  }

  const topHits = [...bestById.values()].sort((a, b) => a.rank - b.rank).slice(0, MAX_SOURCES);
  const entries = await Promise.all(topHits.map((hit) => library.get(hit.id)));
  return entries.filter((entry): entry is CatalogEntry => entry !== null);
}

// ---------------------------------------------------------------------------
// Prompt — a parte pura e testável sem tocar no modelo de verdade.
// ---------------------------------------------------------------------------

/** Não vai dentro do prompt do usuário: no papel de sistema, a instrução pesa mais pro modelo. */
export const ORACLE_SYSTEM_PROMPT = [
  'Você é o Oráculo, assistente de mestre de RPG para D&D 5e. Responda sempre em português, de forma direta e objetiva.',
  'Use exclusivamente as fontes fornecidas na mensagem do usuário — nunca invente regra, número ou nome que não esteja nelas.',
  'Se as fontes não tiverem informação suficiente para responder, diga exatamente: "Não encontrei isso no material indexado." e nada mais.',
].join(' ');

export const NOT_FOUND_ANSWER = 'Não encontrei isso no material indexado.';

export function buildOraclePrompt(
  question: string,
  sources: readonly { readonly title: string; readonly body: string }[],
): string {
  const context = sources
    .map((source, index) => `[Fonte ${index + 1}: ${source.title}]\n${source.body.slice(0, MAX_SOURCE_LENGTH)}`)
    .join('\n\n');

  return [
    context || '(nenhuma fonte encontrada no acervo indexado)',
    '',
    `Pergunta do mestre: ${question}`,
    '',
    'Lembrete: responda só com base nas fontes acima. Se elas não bastarem, diga que não encontrou isso no material indexado.',
  ].join('\n');
}

export async function askOracle(
  library: RulesLibrary,
  modelPath: string,
  question: string,
): Promise<OracleAnswer> {
  if (sessionActive && remainingQuestions <= 0) {
    throw new Error('O Oráculo já respondeu 3 perguntas nesta sessão. Inicie uma nova sessão para perguntar de novo.');
  }

  const found = await retrieveSources(library, question);

  // Zero fonte encontrada é um caso que dá pra responder com certeza, sem
  // gastar uma chamada ao modelo nem correr risco de alucinação — um modelo
  // pequeno tende a tentar "ajudar" mesmo sem contexto nenhum.
  if (found.length === 0) {
    if (sessionActive) remainingQuestions -= 1;
    return { answer: NOT_FOUND_ANSWER, sources: [] };
  }

  const prompt = buildOraclePrompt(
    question,
    found.map((entry) => ({ title: entry.title, body: entry.body })),
  );
  const answer = await generate(modelPath, prompt);

  if (sessionActive) remainingQuestions -= 1;

  return {
    answer: answer.trim(),
    sources: found.map((entry) => ({ title: entry.title, section: entry.section })),
  };
}
