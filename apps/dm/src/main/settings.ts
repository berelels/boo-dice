import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import type { ImportedPdf } from './pdfImport.js';

/**
 * Preferências do app que não são dado de mesa — a pasta do vault do
 * Obsidian e a lista de PDFs indexados pro Oráculo. Um JSON solto em
 * `userData` em vez de mais tabelas no `dm.db`: é configuração de app, não
 * dado de mesa, e não devia depender de migração de schema nenhuma.
 */
interface Settings {
  readonly vaultPath: string | null;
  readonly importedPdfs: readonly ImportedPdf[];
}

const DEFAULT_SETTINGS: Settings = { vaultPath: null, importedPdfs: [] };

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

function readSettings(): Settings {
  const path = settingsPath();
  if (!existsSync(path)) return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(settings: Settings): void {
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2), 'utf8');
}

export function getVaultPath(): string | null {
  return readSettings().vaultPath;
}

export function setVaultPath(path: string | null): void {
  writeSettings({ ...readSettings(), vaultPath: path });
}

export function getImportedPdfs(): readonly ImportedPdf[] {
  return readSettings().importedPdfs;
}

export function addImportedPdf(pdf: ImportedPdf): void {
  const current = readSettings();
  const withoutPrevious = current.importedPdfs.filter((entry) => entry.id !== pdf.id);
  writeSettings({ ...current, importedPdfs: [...withoutPrevious, pdf] });
}

export function removeImportedPdf(id: string): void {
  const current = readSettings();
  writeSettings({ ...current, importedPdfs: current.importedPdfs.filter((entry) => entry.id !== id) });
}
