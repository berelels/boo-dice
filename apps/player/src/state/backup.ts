import { Capacitor } from '@capacitor/core';
import { safeParseCharacter, type Character, type CharacterRepository } from '@dfo/core';

/**
 * Backup de fichas — exportar/importar um arquivo, e uma cópia automática
 * quando a plataforma permite.
 *
 * Isto existe por uma razão específica do app rodar como PWA no iOS (ver
 * `SettingsScreen`): sem loja de apps nem sincronização com nuvem, a ficha
 * mora só dentro do armazenamento do Safari, e o próprio iOS pode limpar
 * esse espaço se o app passar muito tempo sem ser aberto. Um backup exportado
 * é a única cópia que sobrevive a isso.
 *
 * No Android nativo (Capacitor) o risco é bem menor — o banco é um arquivo de
 * verdade —, mas o backup continua útil como proteção contra trocar de
 * aparelho ou desinstalar o app sem querer.
 */

export const BACKUP_FORMAT = 'boo-dice-backup';
export const BACKUP_VERSION = 1;

/** Intervalo sugerido ao jogador para exportar um backup manual. */
export const BACKUP_REMINDER_DAYS = 14;

export interface BackupFile {
  readonly format: typeof BACKUP_FORMAT;
  readonly version: typeof BACKUP_VERSION;
  readonly exportedAt: string;
  readonly characters: Character[];
}

export function buildBackupPayload(characters: readonly Character[]): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    characters: [...characters],
  };
}

export type ParsedBackup = { readonly characters: Character[]; readonly skipped: number };
export type ParseBackupResult = ParsedBackup | { readonly error: string };

/**
 * Aceita tanto o formato próprio (`{ format, characters }`) quanto uma lista
 * crua de fichas — um jogador pode ter editado o JSON à mão, ou o arquivo
 * pode vir de uma versão futura que só mudou campos extras, não a essência.
 * Cada ficha é validada por `safeParseCharacter`; as que não passam são
 * contadas em `skipped` em vez de derrubar o import inteiro.
 */
export function parseBackupFile(raw: unknown): ParseBackupResult {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null && Array.isArray((raw as { characters?: unknown }).characters)
      ? (raw as { characters: unknown[] }).characters
      : null;

  if (list === null) {
    return { error: 'Este arquivo não parece ser um backup do Boo & Dice.' };
  }

  const characters: Character[] = [];
  let skipped = 0;
  for (const item of list) {
    const result = safeParseCharacter(item);
    if (result.ok) characters.push(result.character);
    else skipped++;
  }

  return { characters, skipped };
}

export async function importBackupFile(file: File): Promise<ParseBackupResult> {
  const text = await file.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: 'O arquivo não é um JSON válido.' };
  }
  return parseBackupFile(raw);
}

// ------------------------------------------------------------ exportar ----

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}
interface FileSystemWritableFileStreamLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}
interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableFileStreamLike>;
}
declare global {
  interface Window {
    /** File System Access API — Chrome/Edge (desktop e Android). Ausente no Safari. */
    showSaveFilePicker?: (options: SaveFilePickerOptions) => Promise<FileSystemFileHandleLike>;
  }
}

function backupFilename(exportedAt: string): string {
  return `boo-dice-backup-${exportedAt.slice(0, 10)}.json`;
}

/** Salva o backup — nativo (Android) compartilha o arquivo; web deixa o navegador decidir onde. */
export async function exportBackup(characters: readonly Character[]): Promise<void> {
  const payload = buildBackupPayload(characters);
  const json = JSON.stringify(payload, null, 2);
  const filename = backupFilename(payload.exportedAt);

  if (Capacitor.isNativePlatform()) {
    await exportNative(filename, json);
  } else {
    await exportWeb(filename, json);
  }
  setLastBackupAt(payload.exportedAt);
}

async function exportNative(filename: string, json: string): Promise<void> {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');

  const written = await Filesystem.writeFile({
    path: filename,
    data: json,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  // O compartilhamento nativo é o "escolher onde salvar" do Android — Drive,
  // Arquivos, e-mail, o que o jogador tiver instalado.
  await Share.share({ title: 'Backup do Boo & Dice', url: written.uri });
}

async function exportWeb(filename: string, json: string): Promise<void> {
  const blob = new Blob([json], { type: 'application/json' });

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'Backup do Boo & Dice', accept: { 'application/json': ['.json'] } }],
      });
      const stream = await handle.createWritable();
      await stream.write(blob);
      await stream.close();
      return;
    } catch (error) {
      // O jogador cancelou o seletor — desistir do export, não é uma falha.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      throw error;
    }
  }

  // Safari/iOS não tem File System Access API: o download padrão do
  // navegador é o único caminho. Para onde ele vai depende da configuração
  // de Downloads do Safari ("Perguntar onde salvar cada download").
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------- lembrete manual -----

const LAST_BACKUP_KEY = 'dfo:lastBackupAt';

export function getLastBackupAt(): string | null {
  try {
    return window.localStorage.getItem(LAST_BACKUP_KEY);
  } catch {
    return null;
  }
}

function setLastBackupAt(iso: string): void {
  try {
    window.localStorage.setItem(LAST_BACKUP_KEY, iso);
  } catch {
    // Sem acesso ao localStorage (aba privada, cota cheia): o backup já
    // aconteceu, só o lembrete perde a memória de quando foi o último.
  }
}

export function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000)));
}

export function shouldRemindBackup(lastBackupAt: string | null, hasCharacters: boolean): boolean {
  if (!hasCharacters) return false;
  if (lastBackupAt === null) return true;
  return daysSince(lastBackupAt) >= BACKUP_REMINDER_DAYS;
}

// -------------------------------------------------- automático (nativo) ---

const AUTO_BACKUP_MIN_INTERVAL_MS = 5 * 60 * 1000;
const AUTO_BACKUP_FILENAME = 'boo-dice-backup-automatico.json';

let lastAutoBackupAttempt = 0;

/**
 * Cópia silenciosa, só no Android nativo — lá gravar em disco não pede
 * escolher pasta nem confirmação a cada vez, então dá pra manter automático
 * de verdade. No PWA (iOS/web) isso não é possível sem um gesto do jogador a
 * cada vez — é o navegador que decide, por segurança —, por isso lá o app só
 * lembra (ver `shouldRemindBackup`), nunca salva sozinho.
 *
 * Best-effort: chamado depois de qualquer gravação de ficha, mas raramente
 * faz algo — a checagem de intervalo faz a maior parte das chamadas retornar
 * na hora.
 */
export async function autoBackupIfNative(characters: CharacterRepository): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const now = Date.now();
  if (now - lastAutoBackupAttempt < AUTO_BACKUP_MIN_INTERVAL_MS) return;
  lastAutoBackupAttempt = now;

  try {
    const summaries = await characters.list();
    const full = await Promise.all(summaries.map((summary) => characters.get(summary.id)));
    const payload = buildBackupPayload(full.filter((character): character is Character => character !== null));

    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    await Filesystem.writeFile({
      path: AUTO_BACKUP_FILENAME,
      data: JSON.stringify(payload, null, 2),
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
  } catch {
    // Sem espaço, sem permissão — o app segue normal, o backup manual
    // continua disponível como rede de segurança.
  }
}
