import type {
  CatalogEntry,
  Combatant,
  CombatantPatch,
  ConditionId,
  Encounter,
  EncounterWithCombatants,
  NewCombatantInput,
  PartySnapshot,
  SearchHit,
  SearchOptions,
  SessionNote,
} from '@dfo/core';
import type { ImportedPdf } from '../main/pdfImport.js';
import type { OracleAnswer } from '../main/oracle.js';

/**
 * Contrato único entre o processo main e o renderer.
 *
 * `IPC` são os nomes de canal usados nos dois lados (`ipcMain.handle` /
 * `ipcRenderer.invoke`); `DmApi` é a forma exposta em `window.dm` pelo
 * preload. Nenhum DTO é duplicado — os tipos vêm direto de `@dfo/core`, os
 * mesmos que os repositórios já usam.
 */

export const IPC = {
  encountersList: 'encounters:list',
  encountersCreate: 'encounters:create',
  encountersGet: 'encounters:get',
  encountersRename: 'encounters:rename',
  encountersDelete: 'encounters:delete',
  combatantsAdd: 'combatants:add',
  combatantsUpdate: 'combatants:update',
  combatantsRemove: 'combatants:remove',
  combatantsReorder: 'combatants:reorder',
  turnAdvance: 'turn:advance',
  notesList: 'notes:list',
  notesGet: 'notes:get',
  notesCreate: 'notes:create',
  notesUpdate: 'notes:update',
  notesDelete: 'notes:delete',
  librarySearch: 'library:search',
  libraryGet: 'library:get',
  libraryCounts: 'library:counts',
  libraryStatus: 'library:status',
  libraryImportPdf: 'library:import-pdf',
  libraryListPdfs: 'library:list-pdfs',
  libraryRemovePdf: 'library:remove-pdf',
  sessionStart: 'session:start',
  sessionStop: 'session:stop',
  sessionStatus: 'session:status',
  sessionParty: 'session:party',
  /** Canal de push (main -> renderer), não de invoke — ver `DmApi.session.onPartyUpdate`. */
  sessionPartyUpdate: 'session:party-update',
  sessionAttack: 'session:attack',
  settingsGetVaultPath: 'settings:get-vault-path',
  settingsChooseVaultFolder: 'settings:choose-vault-folder',
  settingsClearVaultPath: 'settings:clear-vault-path',
  oracleStatus: 'oracle:status',
  oracleDownloadModel: 'oracle:download-model',
  /** Canal de push (main -> renderer): progresso do download, 0 a 1. */
  oracleDownloadProgress: 'oracle:download-progress',
  oracleAsk: 'oracle:ask',
} as const;

/** Estado público da sessão de LAN hospedada — não confundir com `SessionNote`, a nota de sessão de mesa. */
export interface SessionStatus {
  readonly code: string;
  readonly port: number;
  readonly addresses: readonly string[];
}

/** Resultado de um ataque já resolvido do lado do Mestre — o jogador só aplica. */
export interface AttackPayload {
  readonly source: string;
  readonly hit: boolean;
  readonly damage: number;
  readonly conditions?: readonly ConditionId[];
}

export interface DmApi {
  readonly encounters: {
    list(): Promise<Encounter[]>;
    create(name: string): Promise<Encounter>;
    get(id: string): Promise<EncounterWithCombatants | null>;
    rename(id: string, name: string): Promise<void>;
    delete(id: string): Promise<void>;
  };
  readonly combatants: {
    add(encounterId: string, input: NewCombatantInput): Promise<Combatant>;
    update(id: string, patch: CombatantPatch): Promise<Combatant>;
    remove(id: string): Promise<void>;
    reorder(encounterId: string, orderedIds: string[]): Promise<void>;
  };
  readonly turn: {
    advance(
      encounterId: string,
      direction: 'next' | 'previous',
    ): Promise<{ currentCombatantId: string | null; round: number }>;
  };
  readonly notes: {
    list(): Promise<SessionNote[]>;
    get(id: string): Promise<SessionNote | null>;
    create(input: { title?: string; body?: string }): Promise<SessionNote>;
    update(id: string, patch: { title?: string; body?: string }): Promise<SessionNote>;
    delete(id: string): Promise<void>;
  };
  readonly library: {
    search(query: string, options?: SearchOptions): Promise<SearchHit[]>;
    get(id: string): Promise<CatalogEntry | null>;
    counts(): Promise<Record<string, number>>;
    /** `hasContent`/`hasBooks`/`hasPdfs` são getters síncronos no processo main — isto os cruza pro IPC. */
    status(): Promise<{ hasContent: boolean; hasBooks: boolean; hasPdfs: boolean }>;
    /** Lista dos PDFs já indexados — base do Oráculo. */
    listPdfs(): Promise<readonly ImportedPdf[]>;
    /**
     * Abre o seletor nativo de arquivo (.pdf), extrai e indexa o texto.
     * `null` se o mestre cancelar. A busca já sai com o conteúdo novo, sem
     * precisar reiniciar o app.
     */
    importPdf(): Promise<ImportedPdf | null>;
    /** Remove um PDF do índice, na hora. */
    removePdf(id: string): Promise<void>;
  };
  readonly session: {
    start(): Promise<SessionStatus>;
    stop(): Promise<void>;
    status(): Promise<SessionStatus | null>;
    /** Estado do grupo agora — chamar ao montar a tela, antes do próximo push chegar. */
    party(): Promise<PartySnapshot | null>;
    /** Único canal de push do app: assina o grupo ao vivo, retorna a função de cancelar. */
    onPartyUpdate(callback: (party: PartySnapshot) => void): () => void;
    /** Empurra um ataque já resolvido pro dispositivo que trouxe este personagem. `false` se ninguém estiver conectado com ele. */
    attack(characterId: string, payload: AttackPayload): Promise<boolean>;
  };
  readonly settings: {
    getVaultPath(): Promise<string | null>;
    /** Abre o seletor nativo de pasta; `null` se o mestre cancelar. As notas trocam de lugar na hora. */
    chooseVaultFolder(): Promise<string | null>;
    /** Volta as notas para o armazenamento local do app, na hora. */
    clearVaultPath(): Promise<void>;
  };
  readonly oracle: {
    /** `remaining: null` = sem sessão de LAN ativa, perguntas ilimitadas. */
    status(): Promise<{ remaining: number | null; modelReady: boolean }>;
    /** Baixa o modelo (~1GB) uma vez; sem efeito se já estiver baixado. */
    downloadModel(): Promise<void>;
    /** Progresso do download em andamento, de 0 a 1. */
    onDownloadProgress(callback: (fraction: number) => void): () => void;
    ask(question: string): Promise<OracleAnswer>;
  };
}
