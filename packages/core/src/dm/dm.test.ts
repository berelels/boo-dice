import { beforeEach, describe, expect, it } from 'vitest';
import { BetterSqlite3Driver } from '../db/drivers/better-sqlite3.js';
import { migrate } from '../db/migrations.js';
import { DM_MIGRATIONS } from './migrations.js';
import { EncounterRepository, advanceTurn, sortByInitiative, type Combatant } from './encounters.js';
import { NotesRepository } from './notes.js';
import { parseMonsterActions } from './monsterActions.js';
import { CATALOG_SCHEMA, CATALOG_REBUILD } from '../search/schema.js';
import { RulesSearch } from '../search/rules-search.js';
import { RulesLibrary } from '../search/library.js';
import type { SqlDriver } from '../db/driver.js';

describe('migrações do mestre', () => {
  let driver: SqlDriver;

  beforeEach(() => {
    driver = new BetterSqlite3Driver(':memory:');
  });

  it('aplica todas as migrações pendentes', async () => {
    const expected = DM_MIGRATIONS.map((migration) => migration.version).sort((a, b) => a - b);
    expect(await migrate(driver, DM_MIGRATIONS)).toEqual(expected);
  });

  it('rodar de novo não faz nada', async () => {
    await migrate(driver, DM_MIGRATIONS);
    expect(await migrate(driver, DM_MIGRATIONS)).toEqual([]);
  });

  it('cria as tabelas esperadas', async () => {
    await migrate(driver, DM_MIGRATIONS);
    const tables = await driver.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    const names = tables.map((row) => row.name);
    expect(names).toContain('encounters');
    expect(names).toContain('combatants');
    expect(names).toContain('session_notes');
  });
});

describe('advanceTurn', () => {
  it('sem combatentes, não avança nada', () => {
    expect(advanceTurn([], null, 1, 'next')).toEqual({ currentCombatantId: null, round: 1 });
  });

  it('começa do topo quando ninguém está no turno', () => {
    expect(advanceTurn(['a', 'b', 'c'], null, 1, 'next')).toEqual({
      currentCombatantId: 'a',
      round: 1,
    });
  });

  it('avança pro próximo da ordem sem mudar a rodada', () => {
    expect(advanceTurn(['a', 'b', 'c'], 'a', 1, 'next')).toEqual({
      currentCombatantId: 'b',
      round: 1,
    });
  });

  it('dá a volta na ordem e incrementa a rodada', () => {
    expect(advanceTurn(['a', 'b', 'c'], 'c', 1, 'next')).toEqual({
      currentCombatantId: 'a',
      round: 2,
    });
  });

  it('um combatente só sempre volta pra ele mesmo, incrementando a rodada', () => {
    expect(advanceTurn(['a'], 'a', 3, 'next')).toEqual({ currentCombatantId: 'a', round: 4 });
  });

  it('volta pro anterior da ordem sem mudar a rodada', () => {
    expect(advanceTurn(['a', 'b', 'c'], 'c', 2, 'previous')).toEqual({
      currentCombatantId: 'b',
      round: 2,
    });
  });

  it('voltar do início da rodada retrocede a rodada, sem passar de 1', () => {
    expect(advanceTurn(['a', 'b', 'c'], 'a', 2, 'previous')).toEqual({
      currentCombatantId: 'c',
      round: 1,
    });
    expect(advanceTurn(['a', 'b', 'c'], 'a', 1, 'previous')).toEqual({
      currentCombatantId: 'c',
      round: 1,
    });
  });
});

describe('sortByInitiative', () => {
  it('ordena por iniciativa decrescente, empate pela ordem manual', () => {
    const combatants = [
      { id: 'a', initiative: 10, sortOrder: 1 },
      { id: 'b', initiative: 15, sortOrder: 0 },
      { id: 'c', initiative: 10, sortOrder: 0 },
    ] as Combatant[];
    expect(sortByInitiative(combatants).map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('EncounterRepository', () => {
  let driver: SqlDriver;
  let repo: EncounterRepository;

  beforeEach(async () => {
    driver = new BetterSqlite3Driver(':memory:');
    await migrate(driver, DM_MIGRATIONS);
    repo = new EncounterRepository(driver);
  });

  it('cria, lista e busca um encontro', async () => {
    const encounter = await repo.create('Emboscada na estrada');
    expect(await repo.list()).toHaveLength(1);

    const loaded = await repo.get(encounter.id);
    expect(loaded?.name).toBe('Emboscada na estrada');
    expect(loaded?.combatants).toEqual([]);
  });

  it('adiciona combatentes com PV cheio e ordem de inserção crescente', async () => {
    const encounter = await repo.create('Combate');
    const goblin = await repo.addCombatant(encounter.id, {
      name: 'Goblin', kind: 'monster', initiative: 12, hpMax: 7,
    });
    const hero = await repo.addCombatant(encounter.id, {
      name: 'Thorin', kind: 'pc', initiative: 18, hpMax: 30,
    });

    expect(goblin.sortOrder).toBe(0);
    expect(hero.sortOrder).toBe(1);
    expect(goblin.hp).toEqual({ current: 7, max: 7, temporary: 0 });

    const loaded = await repo.get(encounter.id);
    expect(loaded?.combatants.map((c) => c.name)).toEqual(['Goblin', 'Thorin']);
  });

  it('aplica dano, cura e condições através de updateCombatant', async () => {
    const encounter = await repo.create('Combate');
    const goblin = await repo.addCombatant(encounter.id, {
      name: 'Goblin', kind: 'monster', initiative: 12, hpMax: 7,
    });

    const damaged = await repo.updateCombatant(goblin.id, { damage: 5 });
    expect(damaged.hp.current).toBe(2);

    const healed = await repo.updateCombatant(goblin.id, { heal: 2 });
    expect(healed.hp.current).toBe(4);

    // "Inconsciente" acende junto "Incapacitado" e "Caído" — a mesma regra
    // de rules/conditions.ts vale pro mestre.
    const unconscious = await repo.updateCombatant(goblin.id, { conditions: ['unconscious'] });
    expect(new Set(unconscious.conditions)).toEqual(
      new Set(['unconscious', 'incapacitated', 'prone']),
    );
  });

  it('avança o turno e persiste rodada/combatente atual', async () => {
    const encounter = await repo.create('Combate');
    const a = await repo.addCombatant(encounter.id, { name: 'A', initiative: 20 });
    const b = await repo.addCombatant(encounter.id, { name: 'B', initiative: 10 });

    const first = await repo.advance(encounter.id, 'next');
    expect(first).toEqual({ currentCombatantId: a.id, round: 1 });

    const second = await repo.advance(encounter.id, 'next');
    expect(second).toEqual({ currentCombatantId: b.id, round: 1 });

    const wrapped = await repo.advance(encounter.id, 'next');
    expect(wrapped).toEqual({ currentCombatantId: a.id, round: 2 });
  });

  it('remover o combatente do turno atual limpa o turno', async () => {
    const encounter = await repo.create('Combate');
    const a = await repo.addCombatant(encounter.id, { name: 'A', initiative: 20 });
    await repo.advance(encounter.id, 'next');

    await repo.removeCombatant(a.id);

    const loaded = await repo.get(encounter.id);
    expect(loaded?.currentCombatantId).toBeNull();
    expect(loaded?.combatants).toEqual([]);
  });

  it('guarda bônus de acerto e dado de dano de um monstro, e persiste sem eles pros demais', async () => {
    const encounter = await repo.create('Combate');
    const goblin = await repo.addCombatant(encounter.id, {
      name: 'Goblin',
      kind: 'monster',
      initiative: 12,
      hpMax: 7,
      attackBonus: 4,
      damageDice: '1d6+2',
    });
    const hero = await repo.addCombatant(encounter.id, { name: 'Thorin', kind: 'pc', initiative: 18 });

    expect(goblin.attackBonus).toBe(4);
    expect(goblin.damageDice).toBe('1d6+2');
    expect(hero.attackBonus).toBeNull();
    expect(hero.damageDice).toBeNull();

    const loaded = await repo.get(encounter.id);
    const loadedGoblin = loaded?.combatants.find((c) => c.id === goblin.id);
    expect(loadedGoblin?.attackBonus).toBe(4);
    expect(loadedGoblin?.damageDice).toBe('1d6+2');

    const updated = await repo.updateCombatant(goblin.id, { attackBonus: 5, damageDice: '2d6' });
    expect(updated.attackBonus).toBe(5);
    expect(updated.damageDice).toBe('2d6');
  });

  it('reordena combatentes explicitamente', async () => {
    const encounter = await repo.create('Combate');
    const a = await repo.addCombatant(encounter.id, { name: 'A', initiative: 5 });
    const b = await repo.addCombatant(encounter.id, { name: 'B', initiative: 20 });

    await repo.reorderCombatants(encounter.id, [b.id, a.id]);

    const loaded = await repo.get(encounter.id);
    expect(loaded?.combatants.map((c) => c.id)).toEqual([b.id, a.id]);
  });
});

describe('NotesRepository', () => {
  let driver: SqlDriver;
  let repo: NotesRepository;

  beforeEach(async () => {
    driver = new BetterSqlite3Driver(':memory:');
    await migrate(driver, DM_MIGRATIONS);
    repo = new NotesRepository(driver);
  });

  it('cria, edita e apaga uma nota', async () => {
    const note = await repo.create({ title: 'Gancho', body: 'O barão sumiu.' });
    expect(await repo.list()).toHaveLength(1);

    const updated = await repo.update(note.id, { body: 'O barão sumiu com o mapa.' });
    expect(updated.body).toBe('O barão sumiu com o mapa.');
    expect(updated.title).toBe('Gancho');

    await repo.delete(note.id);
    expect(await repo.get(note.id)).toBeNull();
  });
});

describe('parseMonsterActions', () => {
  it('extrai bônus de acerto e dado de dano de um goblin de verdade', () => {
    const data = {
      actions: [
        {
          name: 'Cimitarra',
          desc: 'Ataque com arma corpo a corpo: +4 para acertar...',
          attack_bonus: 4,
          damage: [{ damage_dice: '1d6+2', damage_type: { index: 'slashing' } }],
        },
        {
          name: 'Arco Curto',
          attack_bonus: 4,
          damage: [{ damage_dice: '1d6+2', damage_type: { index: 'piercing' } }],
        },
      ],
    };

    expect(parseMonsterActions(data)).toEqual([
      { name: 'Cimitarra', attackBonus: 4, damageDice: '1d6+2' },
      { name: 'Arco Curto', attackBonus: 4, damageDice: '1d6+2' },
    ]);
  });

  it('ignora ações sem bônus de acerto ou dado de dano (efeitos especiais)', () => {
    const data = { actions: [{ name: 'Multiattack', desc: 'Faz dois ataques.' }] };
    expect(parseMonsterActions(data)).toEqual([]);
  });

  it('devolve lista vazia pra data nulo, sem actions, ou mal formado', () => {
    expect(parseMonsterActions(null)).toEqual([]);
    expect(parseMonsterActions({})).toEqual([]);
    expect(parseMonsterActions({ actions: 'não é uma lista' })).toEqual([]);
  });
});

describe('RulesLibrary', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new BetterSqlite3Driver(':memory:');
    await driver.executeScript(CATALOG_SCHEMA);
    await driver.execute(
      `INSERT INTO catalog (id, kind, title, subtitle, body, lang) VALUES (?, ?, ?, ?, ?, ?)`,
      ['spell:goblin-slayer', 'spell', 'Flecha Ácida de Melf', '2º nível — Evocação', 'Dispara uma flecha de ácido crepitante.', 'pt'],
    );
    await driver.execute(
      `INSERT INTO catalog (id, kind, title, subtitle, body, lang) VALUES (?, ?, ?, ?, ?, ?)`,
      ['monster:goblin', 'monster', 'Goblin', 'Monstro ND 1/4', 'Um humanoide pequeno e covarde.', 'pt'],
    );
    await driver.executeScript(CATALOG_REBUILD);
  });

  it('reporta ausência de conteúdo quando os dois acervos faltam', () => {
    const library = new RulesLibrary(null, null);
    expect(library.hasContent).toBe(false);
    expect(library.hasBooks).toBe(false);
  });

  it('busca sobre o acervo do SRD', async () => {
    const library = new RulesLibrary(new RulesSearch(driver), null);
    expect(library.hasContent).toBe(true);

    const hits = await library.search('goblin');
    expect(hits.map((hit) => hit.id)).toContain('monster:goblin');
  });

  it('soma as contagens dos dois acervos', async () => {
    const library = new RulesLibrary(new RulesSearch(driver), new RulesSearch(driver));
    const counts = await library.countByKind();
    expect(counts.spell).toBe(2); // mesmo banco usado nos dois lados, de propósito
    expect(counts.monster).toBe(2);
  });

  it('inclui os PDFs importados como terceiro acervo, opcional', async () => {
    const pdfDriver = new BetterSqlite3Driver(':memory:');
    await pdfDriver.executeScript(CATALOG_SCHEMA);
    await pdfDriver.execute(
      `INSERT INTO catalog (id, kind, title, subtitle, body, section, lang) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        'pdf:xanathar-guia-de-tudo:47-0',
        'rule',
        'Xanathar, Guia de Tudo — p. 47',
        'Xanathar, Guia de Tudo',
        'Regras de download de personagem.',
        'Xanathar, Guia de Tudo',
        'pt',
      ],
    );
    await pdfDriver.executeScript(CATALOG_REBUILD);

    const withoutPdfs = new RulesLibrary(new RulesSearch(driver), null);
    expect(withoutPdfs.hasPdfs).toBe(false);

    const library = new RulesLibrary(new RulesSearch(driver), null, new RulesSearch(pdfDriver));
    expect(library.hasContent).toBe(true);
    expect(library.hasPdfs).toBe(true);

    const hits = await library.search('download de personagem');
    expect(hits.map((hit) => hit.id)).toContain('pdf:xanathar-guia-de-tudo:47-0');

    const entry = await library.get('pdf:xanathar-guia-de-tudo:47-0');
    expect(entry?.title).toBe('Xanathar, Guia de Tudo — p. 47');

    const counts = await library.countByKind();
    expect(counts.rule).toBe(1);
  });

  it('troca a fonte de PDFs em tempo real, sem precisar recriar a biblioteca', async () => {
    // É exatamente isto que substitui o `app.relaunch()` depois de importar
    // ou remover um PDF: a busca reflete o acervo novo no mesmo processo.
    const library = new RulesLibrary(null, null, null);
    expect(library.hasPdfs).toBe(false);
    expect((await library.search('bola de fogo')).map((hit) => hit.id)).not.toContain(
      'pdf:teste:1-0',
    );

    const pdfDriver = new BetterSqlite3Driver(':memory:');
    await pdfDriver.executeScript(CATALOG_SCHEMA);
    await pdfDriver.execute(
      `INSERT INTO catalog (id, kind, title, subtitle, body, lang) VALUES (?, ?, ?, ?, ?, ?)`,
      ['pdf:teste:1-0', 'rule', 'Teste — p. 1', 'Teste', 'Bola de fogo causa dano de fogo.', 'pt'],
    );
    await pdfDriver.executeScript(CATALOG_REBUILD);

    await library.setPdfs(new RulesSearch(pdfDriver));
    expect(library.hasPdfs).toBe(true);
    expect((await library.search('bola de fogo')).map((hit) => hit.id)).toContain('pdf:teste:1-0');

    await library.setPdfs(null);
    expect(library.hasPdfs).toBe(false);
    expect((await library.search('bola de fogo')).map((hit) => hit.id)).not.toContain(
      'pdf:teste:1-0',
    );
  });

  it('esconde a duplicata do SRD em inglês quando o livro já cobre a magia', async () => {
    // srd.db e book.db são arquivos separados de verdade — dois drivers aqui,
    // não o mesmo banco dos testes acima, pra reproduzir a duplicata real.
    const srdDriver = new BetterSqlite3Driver(':memory:');
    await srdDriver.executeScript(CATALOG_SCHEMA);
    await srdDriver.execute(
      `INSERT INTO catalog (id, kind, title, subtitle, body, lang) VALUES (?, ?, ?, ?, ?, ?)`,
      // Subtítulo do SRD já sai em português mesmo na magia marcada `en` —
      // é essa colisão que fazia "truque" acertar a versão não traduzida.
      ['srd:spell:fire-bolt', 'spell', 'Fire Bolt', 'Truque — Evocação', 'You hurl a mote of fire.', 'en'],
    );
    await srdDriver.executeScript(CATALOG_REBUILD);

    const bookDriver = new BetterSqlite3Driver(':memory:');
    await bookDriver.executeScript(CATALOG_SCHEMA);
    await bookDriver.execute(
      `INSERT INTO catalog (id, kind, title, subtitle, body, lang) VALUES (?, ?, ?, ?, ?, ?)`,
      ['book:spell:raio-de-fogo', 'spell', 'Raio de Fogo', 'Truque — Evocação', 'Você arremessa um fragmento de fogo.', 'pt'],
    );
    await bookDriver.executeScript(CATALOG_REBUILD);

    const withoutBook = new RulesLibrary(new RulesSearch(srdDriver), null);
    expect((await withoutBook.search('truque')).map((hit) => hit.id)).toContain('srd:spell:fire-bolt');

    const withBook = new RulesLibrary(new RulesSearch(srdDriver), new RulesSearch(bookDriver));
    const hits = await withBook.search('truque');
    expect(hits.map((hit) => hit.id)).not.toContain('srd:spell:fire-bolt');
    expect(hits.map((hit) => hit.id)).toContain('book:spell:raio-de-fogo');
  });
});
