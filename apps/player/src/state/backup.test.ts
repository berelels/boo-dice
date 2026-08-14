import { describe, expect, it } from 'vitest';
import { createCharacter } from '@dfo/core';
import {
  BACKUP_FORMAT,
  BACKUP_REMINDER_DAYS,
  buildBackupPayload,
  daysSince,
  parseBackupFile,
  shouldRemindBackup,
} from './backup.js';

const SCORES = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };

function newCharacter(name = 'Thorin') {
  return createCharacter({
    id: crypto.randomUUID(),
    name,
    classes: [{ classId: 'fighter', level: 3 }],
    abilities: SCORES,
  });
}

describe('buildBackupPayload / parseBackupFile', () => {
  it('produz um arquivo que ele mesmo consegue ler de volta', () => {
    const characters = [newCharacter('Thorin'), newCharacter('Elara')];
    const payload = buildBackupPayload(characters);

    expect(payload.format).toBe(BACKUP_FORMAT);

    const parsed = parseBackupFile(payload);
    if ('error' in parsed) throw new Error('não deveria falhar');
    expect(parsed.characters.map((c) => c.name).sort()).toEqual(['Elara', 'Thorin']);
    expect(parsed.skipped).toBe(0);
  });

  it('aceita também uma lista crua de fichas, sem o envelope', () => {
    const characters = [newCharacter('Solo')];
    const parsed = parseBackupFile(characters);
    if ('error' in parsed) throw new Error('não deveria falhar');
    expect(parsed.characters).toHaveLength(1);
  });

  it('ignora fichas corrompidas em vez de derrubar o import inteiro', () => {
    const good = newCharacter('Bem-formada');
    const parsed = parseBackupFile({ characters: [good, { not: 'a character' }, null] });
    if ('error' in parsed) throw new Error('não deveria falhar');
    expect(parsed.characters).toHaveLength(1);
    expect(parsed.skipped).toBe(2);
  });

  it('rejeita um arquivo que não tem cara de backup', () => {
    const parsed = parseBackupFile({ hello: 'world' });
    expect('error' in parsed).toBe(true);
  });

  it('rejeita JSON válido mas de tipo errado (string, número)', () => {
    expect('error' in parseBackupFile('oi')).toBe(true);
    expect('error' in parseBackupFile(42)).toBe(true);
  });
});

describe('shouldRemindBackup', () => {
  it('nunca lembra se não há personagem nenhum', () => {
    expect(shouldRemindBackup(null, false)).toBe(false);
    expect(shouldRemindBackup(new Date().toISOString(), false)).toBe(false);
  });

  it('lembra se há personagens e nunca houve backup', () => {
    expect(shouldRemindBackup(null, true)).toBe(true);
  });

  it('não lembra logo depois de um backup recente', () => {
    expect(shouldRemindBackup(new Date().toISOString(), true)).toBe(false);
  });

  it(`lembra quando o último backup passou de ${BACKUP_REMINDER_DAYS} dias`, () => {
    const old = new Date(Date.now() - (BACKUP_REMINDER_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldRemindBackup(old, true)).toBe(true);
  });

  it(`não lembra um dia antes do prazo de ${BACKUP_REMINDER_DAYS} dias`, () => {
    const almost = new Date(Date.now() - (BACKUP_REMINDER_DAYS - 1) * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldRemindBackup(almost, true)).toBe(false);
  });
});

describe('daysSince', () => {
  it('conta dias inteiros corridos', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(daysSince(threeDaysAgo)).toBe(3);
  });

  it('nunca devolve um número negativo para datas no futuro', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(daysSince(future)).toBe(0);
  });
});
