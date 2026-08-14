import { beforeEach, describe, expect, it } from 'vitest';
import { BetterSqlite3Driver } from './drivers/better-sqlite3.js';
import { MIGRATIONS, currentSchemaVersion, migrate } from './migrations.js';
import { CharacterRepository, RollLogRepository, classSummary } from './characters.js';
import { createCharacter, parseCharacter, CURRENT_SCHEMA_VERSION } from '../schema/character.js';
import { CATALOG_SCHEMA, CATALOG_REBUILD } from '../search/schema.js';
import { RulesSearch, toFtsQuery } from '../search/rules-search.js';
import type { SqlDriver } from './driver.js';

const SCORES = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };

function newCharacter(overrides: Record<string, unknown> = {}) {
  return createCharacter({
    id: crypto.randomUUID(),
    name: 'Thorin',
    classes: [{ classId: 'fighter', level: 3 }],
    abilities: SCORES,
    ...overrides,
  });
}

describe('migrações', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new BetterSqlite3Driver(':memory:');
  });

  it('aplica todas as migrações pendentes', async () => {
    // Comparado contra a lista real, e não contra números fixos: acrescentar
    // uma migração é rotina, e um teste que quebra a cada nova é ruído.
    const expected = MIGRATIONS.map((migration) => migration.version).sort((a, b) => a - b);
    expect(await migrate(driver)).toEqual(expected);
    expect(await currentSchemaVersion(driver)).toBe(expected.at(-1));
  });

  it('cria a coluna de retrato usada pela galeria', async () => {
    await migrate(driver);
    const columns = await driver.query<{ name: string }>('PRAGMA table_info(characters)');
    expect(columns.map((column) => column.name)).toContain('portrait');
  });

  it('rodar de novo não faz nada', async () => {
    await migrate(driver);
    expect(await migrate(driver)).toEqual([]);
  });

  it('cria as tabelas esperadas', async () => {
    await migrate(driver);
    const tables = await driver.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    const names = tables.map((row) => row.name);
    expect(names).toContain('characters');
    expect(names).toContain('roll_log');
    expect(names).toContain('schema_migrations');
  });

  it('reverte a transação inteira se uma migração falhar', async () => {
    await driver.executeScript(
      'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);',
    );
    await expect(
      driver.transaction(async (tx) => {
        await tx.executeScript('CREATE TABLE temporaria (id TEXT);');
        throw new Error('falha proposital');
      }),
    ).rejects.toThrow('falha proposital');

    const tables = await driver.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'temporaria'",
    );
    expect(tables).toHaveLength(0);
  });
});

describe('CharacterRepository', () => {
  let driver: SqlDriver;
  let repo: CharacterRepository;

  beforeEach(async () => {
    driver = new BetterSqlite3Driver(':memory:');
    await migrate(driver);
    repo = new CharacterRepository(driver);
  });

  it('salva e lê de volta sem perder nada', async () => {
    const character = newCharacter({
      skills: { athletics: 'expertise' },
      purse: { gp: 120, sp: 5, cp: 0, ep: 0, pp: 0 },
      personality: { traits: 'Fala pouco', ideals: 'Honra', bonds: '', flaws: '' },
    });
    await repo.save(character);

    const loaded = await repo.get(character.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe('Thorin');
    expect(loaded!.skills.athletics).toBe('expertise');
    expect(loaded!.purse.gp).toBe(120);
    expect(loaded!.personality.traits).toBe('Fala pouco');
  });

  it('sobrescreve ao salvar de novo, sem duplicar', async () => {
    const character = newCharacter();
    await repo.save(character);
    await repo.save({ ...character, name: 'Thorin Escudo-de-Carvalho' });

    expect(await repo.count()).toBe(1);
    expect((await repo.get(character.id))!.name).toBe('Thorin Escudo-de-Carvalho');
  });

  it('atualiza o carimbo de tempo a cada gravação', async () => {
    const character = newCharacter({ updatedAt: '2020-01-01T00:00:00.000Z' });
    const saved = await repo.save(character);
    expect(saved.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
  });

  it('lista resumos ordenados pela edição mais recente', async () => {
    const first = await repo.save(newCharacter({ name: 'Primeiro' }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await repo.save(newCharacter({ name: 'Segundo' }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await repo.save({ ...(await repo.get(first.id))!, name: 'Primeiro editado' });

    const list = await repo.list();
    expect(list.map((entry) => entry.name)).toEqual(['Primeiro editado', 'Segundo']);
  });

  it('guarda o resumo de classes para a galeria não precisar abrir a ficha', async () => {
    const character = newCharacter({
      classes: [{ classId: 'fighter', level: 5 }, { classId: 'wizard', level: 3 }],
    });
    await repo.save(character);

    const [summary] = await repo.list();
    expect(summary!.classSummary).toBe('Guerreiro 5 / Mago 3');
    expect(summary!.totalLevel).toBe(8);
  });

  it('apaga', async () => {
    const character = await repo.save(newCharacter());
    await repo.delete(character.id);
    expect(await repo.get(character.id)).toBeNull();
    expect(await repo.count()).toBe(0);
  });

  it('duplica com um id novo', async () => {
    const original = await repo.save(newCharacter({ name: 'Original' }));
    const copy = await repo.duplicate(original.id);

    expect(copy!.id).not.toBe(original.id);
    expect(copy!.name).toBe('Original (cópia)');
    expect(await repo.count()).toBe(2);
  });

  it('sobrevive a uma ficha corrompida sem derrubar as outras', async () => {
    const good = await repo.save(newCharacter({ name: 'Íntegro' }));
    await driver.execute(
      `INSERT INTO characters (id, name, class_summary, total_level, accent, data, created_at, updated_at)
       VALUES ('quebrado', 'Quebrado', '', 1, 'amber', '{ não é json', '2024-01-01', '2024-01-01')`,
    );

    // A galeria continua listando os dois — ela lê só as colunas espelhadas.
    expect(await repo.list()).toHaveLength(2);
    expect((await repo.get(good.id))!.name).toBe('Íntegro');

    const result = await repo.getSafe('quebrado');
    expect(result).toMatchObject({ ok: false });
  });

  it('sinaliza ficha que não passa na validação', async () => {
    await driver.execute(
      `INSERT INTO characters (id, name, class_summary, total_level, accent, data, created_at, updated_at)
       VALUES ('invalido', 'Inválido', '', 1, 'amber', '{"id":"invalido","classes":[]}', '2024-01-01', '2024-01-01')`,
    );
    const result = await repo.getSafe('invalido');
    expect(result).toMatchObject({ ok: false });
  });

  it('devolve null para quem não existe', async () => {
    expect(await repo.get('não-existe')).toBeNull();
    expect(await repo.getSafe('não-existe')).toBeNull();
  });
});

describe('classSummary', () => {
  it('usa os rótulos em português', () => {
    expect(classSummary(newCharacter({ classes: [{ classId: 'rogue', level: 4 }] }))).toBe('Ladino 4');
  });
});

describe('RollLogRepository', () => {
  let driver: SqlDriver;
  let log: RollLogRepository;
  let characterId: string;

  beforeEach(async () => {
    driver = new BetterSqlite3Driver(':memory:');
    await migrate(driver);
    const character = await new CharacterRepository(driver).save(newCharacter());
    characterId = character.id;
    log = new RollLogRepository(driver);
  });

  it('registra e lê as rolagens mais recentes primeiro', async () => {
    await log.append({ characterId, label: 'Atletismo', notation: '1d20+5', total: 18, detail: 'd20: 13 +5' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await log.append({ characterId, label: 'Iniciativa', notation: '1d20+2', total: 9, detail: 'd20: 7 +2' });

    const recent = await log.recent();
    expect(recent.map((entry) => entry.label)).toEqual(['Iniciativa', 'Atletismo']);
  });

  it('filtra por personagem', async () => {
    await log.append({ characterId, label: 'Meu', notation: '1d20', total: 10, detail: '' });
    await log.append({ characterId: null, label: 'Avulso', notation: '1d20', total: 10, detail: '' });

    expect(await log.recent(50, characterId)).toHaveLength(1);
    expect(await log.recent(50)).toHaveLength(2);
  });

  it('some junto com o personagem apagado (ON DELETE CASCADE)', async () => {
    await log.append({ characterId, label: 'Atletismo', notation: '1d20', total: 10, detail: '' });
    await new CharacterRepository(driver).delete(characterId);
    expect(await log.recent()).toHaveLength(0);
  });

  it('limpa o registro', async () => {
    await log.append({ characterId, label: 'X', notation: '1d20', total: 1, detail: '' });
    await log.clear();
    expect(await log.recent()).toHaveLength(0);
  });
});

describe('toFtsQuery', () => {
  it('transforma os termos em busca com prefixo no último', () => {
    expect(toFtsQuery('bola de fogo')).toBe('"bola" AND "de" AND "fogo"*');
  });

  it('devolve null para entrada sem termo útil', () => {
    expect(toFtsQuery('')).toBeNull();
    expect(toFtsQuery('   ')).toBeNull();
    expect(toFtsQuery('!!! ???')).toBeNull();
  });

  it('neutraliza a sintaxe do FTS5 em vez de deixar quebrar a consulta', () => {
    // Sem as aspas, cada um destes derrubaria a consulta com erro de sintaxe.
    for (const input of ['magia "de', 'NEAR(a b)', 'fogo OR NOT', 'a* AND (']) {
      const query = toFtsQuery(input);
      expect(query, input).not.toBeNull();
      expect(query!, input).not.toMatch(/(?<!")\bNEAR\b(?!")/);
    }
  });

  it('preserva acentos e números', () => {
    expect(toFtsQuery('mísseis mágicos 3')).toBe('"mísseis" AND "mágicos" AND "3"*');
  });
});

describe('RulesSearch', () => {
  let driver: SqlDriver;
  let search: RulesSearch;

  beforeEach(async () => {
    driver = new BetterSqlite3Driver(':memory:');
    await driver.executeScript(CATALOG_SCHEMA);

    const entries = [
      ['spell-fireball', 'spell', 'Bola de Fogo', 'Magia de 3º nível — Evocação',
        'Um clarão brilhante surge de seu dedo indicador em um ponto escolhido dentro do alcance e explode em chamas com um estrondo grave.', 'CAPÍTULO 11: MAGIAS', 'pt'],
      ['spell-magic-missile', 'spell', 'Mísseis Mágicos', 'Magia de 1º nível — Evocação',
        'Você cria três dardos brilhantes de força mágica. Cada dardo atinge uma criatura à sua escolha.', 'CAPÍTULO 11: MAGIAS', 'pt'],
      ['condition-prone', 'condition', 'Caído', 'Condição',
        'Uma criatura caída só pode se arrastar, a menos que se levante. Ataques contra ela têm vantagem a até 1,5 metro.', 'APÊNDICE A: CONDIÇÕES', 'pt'],
      ['monster-goblin', 'monster', 'Goblin', 'Monstro — ND 1/4',
        'Humanoide pequeno, geralmente neutro e mau. Classe de Armadura 15, 7 pontos de vida.', 'APÊNDICE D', 'pt'],
      ['spell-shield', 'spell', 'Escudo', 'Magia de 1º nível — Abjuração',
        'Uma barreira invisível de força mágica surge e protege você.', 'CAPÍTULO 11: MAGIAS', 'en'],
    ];

    for (const [id, kind, title, subtitle, body, section, lang] of entries) {
      await driver.execute(
        'INSERT INTO catalog (id, kind, title, subtitle, body, section, lang) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id!, kind!, title!, subtitle!, body!, section!, lang!],
      );
    }
    await driver.executeScript(CATALOG_REBUILD);
    search = new RulesSearch(driver);
  });

  it('acha pelo título', async () => {
    const hits = await search.search('bola de fogo');
    expect(hits[0]!.id).toBe('spell-fireball');
  });

  it('acha por palavra do corpo do texto', async () => {
    const hits = await search.search('dardos brilhantes');
    expect(hits.map((hit) => hit.id)).toContain('spell-magic-missile');
  });

  it('ignora acentos — ninguém digita acento na busca', async () => {
    const comAcento = await search.search('mísseis mágicos');
    const semAcento = await search.search('misseis magicos');
    expect(semAcento.map((hit) => hit.id)).toEqual(comAcento.map((hit) => hit.id));
    expect(semAcento[0]!.id).toBe('spell-magic-missile');
  });

  it('busca por prefixo responde antes de terminar de digitar', async () => {
    const hits = await search.search('gobli');
    expect(hits[0]!.id).toBe('monster-goblin');
  });

  it('acerto no título vence acerto no corpo do texto', async () => {
    // Sem peso por coluna, um bloco longo que apenas menciona "bola de fogo"
    // aparece acima da própria magia Bola de Fogo. Quem digita o nome de uma
    // coisa quer aquela coisa.
    await driver.execute(
      'INSERT INTO catalog (id, kind, title, subtitle, body, section, lang) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        'rule-magic-chapter',
        'rule',
        'CAPÍTULO 11: MAGIAS',
        'Regra',
        'Este capítulo trata de bola de fogo, mísseis mágicos e dezenas de outras magias. ' +
          'A bola de fogo é o exemplo clássico de magia de área, e mísseis mágicos de dano garantido.',
        'Regras',
        'pt',
      ],
    );
    await driver.executeScript(CATALOG_REBUILD);

    const hits = await search.search('bola de fogo');
    expect(hits[0]!.id).toBe('spell-fireball');
  });

  it('destaca os termos no trecho', async () => {
    const hits = await search.search('dardos');
    expect(hits[0]!.snippet).toContain('[[');
    expect(hits[0]!.snippet).toContain(']]');
  });

  it('filtra por tipo', async () => {
    const todos = await search.search('escudo');
    expect(todos.length).toBeGreaterThan(0);

    const soCondicoes = await search.search('escudo', { kinds: ['condition'] });
    expect(soCondicoes).toHaveLength(0);
  });

  it('devolve vazio em vez de estourar com busca sem termos', async () => {
    expect(await search.search('   ')).toEqual([]);
    expect(await search.search('!@#$')).toEqual([]);
  });

  it('não quebra com sintaxe de FTS5 digitada na caixa', async () => {
    await expect(search.search('NEAR(bola fogo)')).resolves.toBeInstanceOf(Array);
    await expect(search.search('bola "de')).resolves.toBeInstanceOf(Array);
    await expect(search.search('a* AND (')).resolves.toBeInstanceOf(Array);
  });

  it('marca o idioma para a UI sinalizar o que ainda não foi traduzido', async () => {
    const hits = await search.search('barreira invisível');
    expect(hits[0]!.lang).toBe('en');
  });

  it('lê um registro inteiro e lista por tipo', async () => {
    expect((await search.get('condition-prone'))!.title).toBe('Caído');
    expect(await search.get('não-existe')).toBeNull();

    const spells = await search.listByKind('spell');
    expect(spells.map((entry) => entry.title)).toEqual(['Bola de Fogo', 'Escudo', 'Mísseis Mágicos']);
  });

  it('conta por tipo', async () => {
    expect(await search.countByKind()).toMatchObject({ spell: 3, condition: 1, monster: 1 });
  });
});

describe('migração de ficha', () => {
  it('carimba a versão atual numa ficha antiga sem versão', () => {
    const legacy = {
      id: 'antigo',
      name: 'Velho',
      classes: [{ classId: 'cleric', level: 2 }],
      abilities: SCORES,
    };
    expect(parseCharacter(legacy).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('recusa ficha gravada por uma versão futura do app', () => {
    expect(() =>
      parseCharacter({
        id: 'futuro',
        schemaVersion: 999,
        classes: [{ classId: 'cleric', level: 2 }],
        abilities: SCORES,
      }),
    ).toThrow(/Atualize o app/);
  });

  it('aplica os padrões do schema em campos ausentes', () => {
    const character = parseCharacter({
      id: 'minimo',
      classes: [{ classId: 'monk', level: 1 }],
      abilities: SCORES,
    });
    expect(character.spellcasting.slotsUsed).toEqual(new Array(9).fill(0));
    expect(character.purse.gp).toBe(0);
    expect(character.conditions).toEqual([]);
    expect(character.exhaustion).toBe(0);
  });
});
