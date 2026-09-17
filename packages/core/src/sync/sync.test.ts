import { describe, expect, it } from 'vitest';
import { createCharacter } from '../schema/character.js';
import { clientMessageSchema, generateJoinCode, serverMessageSchema } from './protocol.js';

function buildCharacter() {
  return createCharacter({
    name: 'Thorin',
    classes: [{ classId: 'fighter', level: 3 }],
    abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
    hitPoints: { current: 18, max: 24, temporary: 0 },
  });
}

describe('generateJoinCode', () => {
  it('sempre gera 6 caracteres do alfabeto sem ambiguidade visual', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateJoinCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
      expect(code).not.toMatch(/[0O1I]/);
    }
  });
});

describe('clientMessageSchema', () => {
  it('aceita hello com ao menos um personagem completo', () => {
    const message = { type: 'hello', code: 'BXQP7M', playerName: 'Ana', characters: [buildCharacter()] };
    expect(clientMessageSchema.safeParse(message).success).toBe(true);
  });

  it('rejeita hello sem personagens', () => {
    const message = { type: 'hello', code: 'BXQP7M', playerName: 'Ana', characters: [] };
    expect(clientMessageSchema.safeParse(message).success).toBe(false);
  });

  it('rejeita hello com código de tamanho errado', () => {
    const message = { type: 'hello', code: 'CURTO', playerName: 'Ana', characters: [buildCharacter()] };
    expect(clientMessageSchema.safeParse(message).success).toBe(false);
  });

  it('rejeita hello com um personagem malformado (sem classe)', () => {
    const malformed = { ...buildCharacter(), classes: [] };
    const message = { type: 'hello', code: 'BXQP7M', playerName: 'Ana', characters: [malformed] };
    expect(clientMessageSchema.safeParse(message).success).toBe(false);
  });

  it('aceita characterUpdate com a ficha completa', () => {
    const message = { type: 'characterUpdate', character: buildCharacter() };
    expect(clientMessageSchema.safeParse(message).success).toBe(true);
  });

  it('rejeita characterUpdate com PV corrente não inteiro', () => {
    const character = { ...buildCharacter(), hitPoints: { current: 1.5, max: 24, temporary: 0 } };
    const message = { type: 'characterUpdate', character };
    expect(clientMessageSchema.safeParse(message).success).toBe(false);
  });

  it('aceita leave', () => {
    expect(clientMessageSchema.safeParse({ type: 'leave' }).success).toBe(true);
  });

  it('rejeita tipo desconhecido', () => {
    expect(clientMessageSchema.safeParse({ type: 'ping' }).success).toBe(false);
  });
});

describe('serverMessageSchema', () => {
  it('aceita welcome', () => {
    expect(serverMessageSchema.safeParse({ type: 'welcome' }).success).toBe(true);
  });

  it('aceita error com motivo conhecido', () => {
    expect(serverMessageSchema.safeParse({ type: 'error', reason: 'wrong-code' }).success).toBe(true);
  });

  it('rejeita error com motivo desconhecido', () => {
    expect(serverMessageSchema.safeParse({ type: 'error', reason: 'boom' }).success).toBe(false);
  });

  it('aceita attack com dano e sem condições', () => {
    const result = serverMessageSchema.safeParse({
      type: 'attack',
      characterId: 'c1',
      source: 'Goblin',
      hit: true,
      damage: 5,
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'attack') {
      expect(result.data.conditions).toEqual([]);
    }
  });

  it('aceita attack que erra, com condições aplicadas', () => {
    expect(
      serverMessageSchema.safeParse({
        type: 'attack',
        characterId: 'c1',
        source: 'Goblin',
        hit: false,
        damage: 0,
        conditions: ['prone'],
      }).success,
    ).toBe(true);
  });

  it('rejeita attack com dano negativo', () => {
    expect(
      serverMessageSchema.safeParse({
        type: 'attack',
        characterId: 'c1',
        source: 'Goblin',
        hit: true,
        damage: -1,
      }).success,
    ).toBe(false);
  });
});

describe('ajuda entre jogadores', () => {
  const effect = { healing: 7, temporaryHp: 0, conditionsRemoved: ['poisoned'] };

  it('aceita support com quem ajuda, quem recebe e o que faz', () => {
    expect(
      clientMessageSchema.safeParse({
        type: 'support',
        fromCharacterId: 'c1',
        targetCharacterId: 'c2',
        label: 'Palavra Curativa',
        effect,
      }).success,
    ).toBe(true);
  });

  it('os números da ajuda são opcionais e valem zero', () => {
    const parsed = clientMessageSchema.safeParse({
      type: 'support',
      fromCharacterId: 'c1',
      targetCharacterId: 'c2',
      label: 'Restauração Menor',
      effect: { conditionsRemoved: ['poisoned'] },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === 'support') {
      expect(parsed.data.effect.healing).toBe(0);
      expect(parsed.data.effect.temporaryHp).toBe(0);
    }
  });

  it('rejeita cura negativa — ajuda não machuca', () => {
    expect(
      clientMessageSchema.safeParse({
        type: 'support',
        fromCharacterId: 'c1',
        targetCharacterId: 'c2',
        label: 'Golpe',
        effect: { healing: -5, temporaryHp: 0, conditionsRemoved: [] },
      }).success,
    ).toBe(false);
  });

  it('rejeita support sem dizer o que foi usado', () => {
    expect(
      clientMessageSchema.safeParse({
        type: 'support',
        fromCharacterId: 'c1',
        targetCharacterId: 'c2',
        label: '',
        effect,
      }).success,
    ).toBe(false);
  });

  it('rejeita condição que não existe', () => {
    expect(
      clientMessageSchema.safeParse({
        type: 'support',
        fromCharacterId: 'c1',
        targetCharacterId: 'c2',
        label: 'Bênção',
        effect: { healing: 0, temporaryHp: 0, conditionsRemoved: ['abençoado'] },
      }).success,
    ).toBe(false);
  });

  it('o grupo que desce pro jogador leva só nomes, nunca fichas', () => {
    const parsed = serverMessageSchema.safeParse({
      type: 'party',
      members: [{ characterId: 'c2', characterName: 'Wessil', playerName: 'Gabriel' }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === 'party') {
      expect(Object.keys(parsed.data.members[0]!).sort()).toEqual([
        'characterId',
        'characterName',
        'playerName',
      ]);
    }
  });

  it('aceita o support repassado pelo Mestre', () => {
    expect(
      serverMessageSchema.safeParse({
        type: 'support',
        characterId: 'c2',
        source: 'Wessil',
        label: 'Palavra Curativa',
        effect,
      }).success,
    ).toBe(true);
  });
});
