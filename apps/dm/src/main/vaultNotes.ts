import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionNote } from '@dfo/core';

/**
 * Notas de sessão como arquivos `.md` de verdade numa pasta — pensado pra
 * apontar direto pra dentro de um vault do Obsidian.
 *
 * Sem banco, sem front matter, sem nada que o Obsidian não entenda: o título
 * é o nome do arquivo (a mesma convenção do próprio Obsidian) e as datas vêm
 * do sistema de arquivos (`birthtime`/`mtime`), não de um campo que só o
 * Boo & Dice saberia ler. Um arquivo `.md` criado à mão no Obsidian aparece
 * na lista igual a um criado por aqui — a pasta é a fonte da verdade, o app
 * só reflete o que está nela.
 */
export class VaultNotesRepository {
  constructor(private readonly folder: string) {}

  async list(): Promise<SessionNote[]> {
    await mkdir(this.folder, { recursive: true });
    const entries = await readdir(this.folder, { withFileTypes: true });
    const notes = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
        .map((entry) => this.readNote(entry.name.slice(0, -3))),
    );
    return notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<SessionNote | null> {
    try {
      return await this.readNote(id);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async create(input: { title?: string; body?: string } = {}): Promise<SessionNote> {
    await mkdir(this.folder, { recursive: true });
    const slug = this.uniqueSlug(sanitizeTitle(input.title || 'Sem título'));
    await writeFile(this.pathFor(slug), input.body ?? '', 'utf8');
    return this.readNote(slug);
  }

  async update(id: string, patch: { title?: string; body?: string }): Promise<SessionNote> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Nota "${id}" não encontrada.`);

    let slug = id;
    if (patch.title !== undefined) {
      const desired = sanitizeTitle(patch.title);
      if (desired !== id) {
        slug = this.uniqueSlug(desired);
        await rename(this.pathFor(id), this.pathFor(slug));
      }
    }

    if (patch.body !== undefined) {
      await writeFile(this.pathFor(slug), patch.body, 'utf8');
    } else if (slug !== id) {
      // Só o título mudou: o `rename` não garante que o mtime avance, e é o
      // mtime que vira `updatedAt` — sem isso a nota renomeada não subiria
      // pro topo da lista.
      const now = new Date();
      await utimes(this.pathFor(slug), now, now);
    }

    return this.readNote(slug);
  }

  async delete(id: string): Promise<void> {
    await rm(this.pathFor(id), { force: true });
  }

  private pathFor(slug: string): string {
    return join(this.folder, `${slug}.md`);
  }

  private async readNote(slug: string): Promise<SessionNote> {
    const path = this.pathFor(slug);
    const [body, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    const createdAt = info.birthtimeMs > 0 ? info.birthtime : info.mtime;
    return {
      id: slug,
      title: slug,
      body,
      createdAt: createdAt.toISOString(),
      updatedAt: info.mtime.toISOString(),
    };
  }

  /** Igual à convenção do Obsidian pra nomes repetidos: acrescenta "(2)", "(3)"… */
  private uniqueSlug(base: string): string {
    if (!existsSync(this.pathFor(base))) return base;
    let attempt = 2;
    while (existsSync(this.pathFor(`${base} (${attempt})`))) attempt += 1;
    return `${base} (${attempt})`;
  }
}

/** Caracteres inválidos em nome de arquivo no Windows — o app roda nos dois SOs. */
const FORBIDDEN_FILENAME_CHARS = /[\\/:*?"<>|]/g;

export function sanitizeTitle(title: string): string {
  const cleaned = title
    .replace(FORBIDDEN_FILENAME_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '');
  return cleaned.slice(0, 120) || 'Sem título';
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
