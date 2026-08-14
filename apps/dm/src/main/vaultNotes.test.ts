import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sanitizeTitle, VaultNotesRepository } from './vaultNotes.js';

describe('VaultNotesRepository', () => {
  let dir: string;
  let repo: VaultNotesRepository;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dfo-vault-notes-'));
    repo = new VaultNotesRepository(join(dir, 'Boo & Dice'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('cria a pasta sozinha e começa vazio', async () => {
    expect(await repo.list()).toEqual([]);
  });

  it('cria, lista e edita uma nota como arquivo .md real', async () => {
    const note = await repo.create({ title: 'Gancho', body: 'O barão sumiu.' });
    expect(note.title).toBe('Gancho');
    expect(note.id).toBe('Gancho');

    const onDisk = await readFile(join(dir, 'Boo & Dice', 'Gancho.md'), 'utf8');
    expect(onDisk).toBe('O barão sumiu.');

    const [listed] = await repo.list();
    expect(listed?.title).toBe('Gancho');
    expect(listed?.body).toBe('O barão sumiu.');

    const updated = await repo.update(note.id, { body: 'O barão sumiu com o mapa.' });
    expect(updated.body).toBe('O barão sumiu com o mapa.');
  });

  it('renomear o título renomeia o arquivo e muda o id', async () => {
    const note = await repo.create({ title: 'Rascunho', body: 'texto' });
    const renamed = await repo.update(note.id, { title: 'Gancho da Baronesa' });

    expect(renamed.id).toBe('Gancho da Baronesa');
    expect(await repo.get(note.id)).toBeNull();
    expect((await repo.get('Gancho da Baronesa'))?.body).toBe('texto');
  });

  it('evita colisão de nome anexando (2), (3)…', async () => {
    const first = await repo.create({ title: 'Sessão 1' });
    const second = await repo.create({ title: 'Sessão 1' });
    const third = await repo.create({ title: 'Sessão 1' });

    expect([first.id, second.id, third.id]).toEqual(['Sessão 1', 'Sessão 1 (2)', 'Sessão 1 (3)']);
  });

  it('apaga o arquivo', async () => {
    const note = await repo.create({ title: 'Descartável' });
    await repo.delete(note.id);
    expect(await repo.get(note.id)).toBeNull();
  });

  it('lista arquivos .md criados direto no Obsidian, sem passar pelo app', async () => {
    await repo.list(); // garante a pasta antes de escrever um arquivo "estrangeiro" nela
    await writeFile(join(dir, 'Boo & Dice', 'Anotado no Obsidian.md'), 'conteúdo direto do vault', 'utf8');

    const notes = await repo.list();
    expect(notes.map((n) => n.title)).toContain('Anotado no Obsidian');
  });

  it('ignora arquivos que não são .md', async () => {
    await repo.list(); // garante a pasta
    await writeFile(join(dir, 'Boo & Dice', 'imagem.png'), 'não é nota', 'utf8');

    expect(await repo.list()).toEqual([]);
  });
});

describe('sanitizeTitle', () => {
  it('remove caracteres inválidos em nome de arquivo no Windows', () => {
    expect(sanitizeTitle('O que: aconteceu? "Ontem" <hoje>')).toBe('O que aconteceu Ontem hoje');
  });

  it('cai para "Sem título" quando fica vazio', () => {
    expect(sanitizeTitle('???')).toBe('Sem título');
    expect(sanitizeTitle('   ')).toBe('Sem título');
  });

  it('colapsa espaços e tira pontos no fim', () => {
    expect(sanitizeTitle('Muitos   espaços...')).toBe('Muitos espaços');
  });
});
