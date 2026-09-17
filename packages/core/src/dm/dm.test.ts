import { beforeEach, describe, expect, it } from 'vitest';
import { BetterSqlite3Driver } from '../db/drivers/better-sqlite3.js';
import { migrate } from '../db/migrations.js';
import { DM_MIGRATIONS } from './migrations.js';
import { EncounterRepository, advanceTurn, sortByInitiative, type Combatant } from './encounters.js';
import { NotesRepository } from './notes.js';
import { parseMonsterActions } from './monsterActions.js';
import {
  expireConditions,
  parseStoredTimers,
  roundsLeft,
  timerFor,
} from './conditionTimers.js';
import {
  SessionLogRepository,
  archiveCharacter,
  parseArchivedCharacters,
} from './sessionLog.js';
import { createCharacter } from '../schema/character.js';
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
    expect(names).toContain('session_log');
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

  it('guarda a lista de ataques de um monstro, e persiste vazia pros demais', async () => {
    const encounter = await repo.create('Combate');
    const dragao = await repo.addCombatant(encounter.id, {
      name: 'Dragão vermelho jovem',
      kind: 'monster',
      initiative: 12,
      hpMax: 178,
      attacks: [
        { name: 'Mordida', attackBonus: 10, damageDice: '2d10+6' },
        { name: 'Garra', attackBonus: 10, damageDice: '2d6+6' },
      ],
    });
    const hero = await repo.addCombatant(encounter.id, { name: 'Thorin', kind: 'pc', initiative: 18 });

    expect(dragao.attacks).toHaveLength(2);
    expect(hero.attacks).toEqual([]);

    const loaded = await repo.get(encounter.id);
    const loadedDragao = loaded?.combatants.find((c) => c.id === dragao.id);
    expect(loadedDragao?.attacks).toEqual([
      { name: 'Mordida', attackBonus: 10, damageDice: '2d10+6' },
      { name: 'Garra', attackBonus: 10, damageDice: '2d6+6' },
    ]);

    const updated = await repo.updateCombatant(dragao.id, {
      attacks: [{ name: 'Cauda', attackBonus: 10, damageDice: '2d8+6' }],
    });
    expect(updated.attacks).toEqual([{ name: 'Cauda', attackBonus: 10, damageDice: '2d8+6' }]);
  });

  it('conta o prazo da condição a partir da rodada do encontro', async () => {
    const encounter = await repo.create('Combate');
    const goblin = await repo.addCombatant(encounter.id, {
      name: 'Goblin', kind: 'monster', initiative: 12, hpMax: 7,
    });
    await repo.addCombatant(encounter.id, { name: 'Thorin', kind: 'pc', initiative: 18 });

    // Rodada 1: envenenado por 2 rodadas, e amedrontado sem prazo nenhum.
    const poisoned = await repo.updateCombatant(goblin.id, {
      conditions: ['poisoned', 'frightened'],
      timers: [timerFor('poisoned', 2, 1)],
    });
    expect(new Set(poisoned.conditions)).toEqual(new Set(['poisoned', 'frightened']));

    const roundOf = async (): Promise<number> => (await repo.get(encounter.id))!.round;
    const goblinNow = async (): Promise<Combatant> => {
      const loaded = await repo.get(encounter.id);
      return loaded!.combatants.find((c) => c.id === goblin.id)!;
    };

    // Uma volta inteira na ordem de iniciativa é o que vira a rodada.
    await repo.advance(encounter.id, 'next');
    await repo.advance(encounter.id, 'next');
    await repo.advance(encounter.id, 'next');
    expect(await roundOf()).toBe(2);

    const onRoundTwo = await goblinNow();
    expect(new Set(onRoundTwo.conditions)).toEqual(new Set(['poisoned', 'frightened']));
    expect(roundsLeft(onRoundTwo.timers[0]!, 2)).toBe(1);

    await repo.advance(encounter.id, 'next');
    await repo.advance(encounter.id, 'next');
    expect(await roundOf()).toBe(3);

    // Venceu: sai sozinho. O que não tinha prazo fica.
    const onRoundThree = await goblinNow();
    expect(onRoundThree.conditions).toEqual(['frightened']);
    expect(onRoundThree.timers).toEqual([]);
  });

  it('voltar a rodada devolve a condição que tinha acabado', async () => {
    const encounter = await repo.create('Combate');
    const goblin = await repo.addCombatant(encounter.id, {
      name: 'Goblin', kind: 'monster', initiative: 12, hpMax: 7,
    });
    await repo.updateCombatant(goblin.id, {
      conditions: ['poisoned'],
      timers: [timerFor('poisoned', 1, 1)],
    });

    await repo.advance(encounter.id, 'next');
    await repo.advance(encounter.id, 'next');
    expect((await repo.get(encounter.id))?.round).toBe(2);
    expect((await repo.get(encounter.id))?.combatants[0]?.conditions).toEqual([]);

    // "Anterior" é o desfazer do clique errado — e desfaz a expiração junto,
    // porque nada foi apagado: o prazo é uma rodada absoluta.
    await repo.advance(encounter.id, 'previous');
    const back = await repo.get(encounter.id);
    expect(back?.round).toBe(1);
    expect(back?.combatants[0]?.conditions).toEqual(['poisoned']);
  });

  it('condição sem prazo continua valendo rodada após rodada', async () => {
    const encounter = await repo.create('Combate');
    const goblin = await repo.addCombatant(encounter.id, {
      name: 'Goblin', kind: 'monster', initiative: 12, hpMax: 7,
    });
    await repo.updateCombatant(goblin.id, { conditions: ['grappled'] });

    for (let i = 0; i < 20; i += 1) await repo.advance(encounter.id, 'next');

    const loaded = await repo.get(encounter.id);
    expect(loaded?.round).toBeGreaterThan(5);
    expect(loaded?.combatants[0]?.conditions).toEqual(['grappled']);
  });

  it('tirar a condição na mão descarta o prazo dela', async () => {
    const encounter = await repo.create('Combate');
    const goblin = await repo.addCombatant(encounter.id, {
      name: 'Goblin', kind: 'monster', initiative: 12, hpMax: 7,
    });
    await repo.updateCombatant(goblin.id, {
      conditions: ['poisoned'],
      timers: [timerFor('poisoned', 5, 1)],
    });

    const cleared = await repo.updateCombatant(goblin.id, { conditions: [] });
    expect(cleared.conditions).toEqual([]);
    expect(cleared.timers).toEqual([]);
  });

  it('lê sem prazo nenhum um combatente salvo antes da v4', async () => {
    const encounter = await repo.create('Combate antigo');
    const goblin = await repo.addCombatant(encounter.id, {
      name: 'Goblin', kind: 'monster', initiative: 12, hpMax: 7,
    });
    await repo.updateCombatant(goblin.id, { conditions: ['poisoned'] });

    // Como a v3 gravava: condições sim, coluna de prazos inexistente.
    await driver.execute('UPDATE combatants SET condition_timers = NULL WHERE id = ?', [goblin.id]);

    for (let i = 0; i < 10; i += 1) await repo.advance(encounter.id, 'next');

    const loaded = await repo.get(encounter.id);
    expect(loaded?.combatants[0]?.conditions).toEqual(['poisoned']);
    expect(loaded?.combatants[0]?.timers).toEqual([]);
  });

  it('lê como lista de um item o ataque de um encontro salvo antes da v3', async () => {
    const encounter = await repo.create('Combate antigo');
    const goblin = await repo.addCombatant(encounter.id, {
      name: 'Goblin',
      kind: 'monster',
      initiative: 12,
      hpMax: 7,
    });

    // Simula a linha como a v2 a gravava: colunas soltas preenchidas, lista nula.
    await driver.execute(
      'UPDATE combatants SET attacks = NULL, attack_bonus = ?, damage_dice = ? WHERE id = ?',
      [4, '1d6+2', goblin.id],
    );

    const loaded = await repo.get(encounter.id);
    expect(loaded?.combatants[0]?.attacks).toEqual([
      { name: 'Ataque', attackBonus: 4, damageDice: '1d6+2' },
    ]);
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

describe('prazo das condições', () => {
  it('conta a rodada atual como uma das que faltam', () => {
    const timer = timerFor('poisoned', 3, 5);
    expect(timer).toEqual({ id: 'poisoned', endsAfterRound: 7 });
    expect(roundsLeft(timer, 5)).toBe(3);
    expect(roundsLeft(timer, 7)).toBe(1);
    expect(roundsLeft(timer, 8)).toBe(0);
  });

  it('"1 rodada" vale na rodada em que foi marcada e some na seguinte', () => {
    const timer = timerFor('prone', 1, 4);
    expect(expireConditions(['prone'], [timer], 4).conditions).toEqual(['prone']);
    expect(expireConditions(['prone'], [timer], 5).conditions).toEqual([]);
  });

  it('a condição que vence leva junto as que só existiam por causa dela', () => {
    // "Inconsciente" acende "Incapacitado" e "Caído"; acordar devolve os três.
    const timer = timerFor('unconscious', 1, 1);
    const result = expireConditions(
      ['unconscious', 'incapacitated', 'prone'],
      [timer],
      2,
    );
    expect(result.conditions).toEqual([]);
    expect(result.timers).toEqual([]);
  });

  it('mas não leva o que outra condição ativa ainda implica', () => {
    // Paralisado também implica incapacitado — esse fica; caído, não.
    const result = expireConditions(
      ['unconscious', 'paralyzed', 'incapacitated', 'prone'],
      [timerFor('unconscious', 1, 1)],
      2,
    );
    expect(new Set(result.conditions)).toEqual(new Set(['paralyzed', 'incapacitated']));
  });

  it('descarta prazo de condição que não está mais ativa', () => {
    const result = expireConditions(['poisoned'], [timerFor('blinded', 5, 1)], 1);
    expect(result.conditions).toEqual(['poisoned']);
    expect(result.timers).toEqual([]);
  });

  it('lê o que está gravado e ignora lixo', () => {
    expect(parseStoredTimers(null)).toEqual([]);
    expect(parseStoredTimers('[]')).toEqual([]);
    expect(parseStoredTimers('{isso não é json')).toEqual([]);
    expect(parseStoredTimers('[{"id":"inventada","endsAfterRound":3}]')).toEqual([]);
    expect(parseStoredTimers('[{"id":"poisoned"}]')).toEqual([]);
    expect(parseStoredTimers('[{"id":"poisoned","endsAfterRound":3}]')).toEqual([
      { id: 'poisoned', endsAfterRound: 3 },
    ]);
  });
});

describe('arquivo de sessões', () => {
  const SCORES = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };

  let driver: SqlDriver;
  let repo: SessionLogRepository;

  beforeEach(async () => {
    driver = new BetterSqlite3Driver(':memory:');
    await migrate(driver, DM_MIGRATIONS);
    repo = new SessionLogRepository(driver);
  });

  function wessil() {
    const character = createCharacter({
      id: crypto.randomUUID(),
      name: 'Wessil',
      classes: [{ classId: 'bard', level: 5 }],
      abilities: SCORES,
    });
    return {
      ...character,
      hitPoints: { current: 12, max: 38, temporary: 0 },
      conditions: ['poisoned' as const],
      spellcasting: {
        ...character.spellcasting,
        slotsUsed: [2, 1, 0, 0, 0, 0, 0, 0, 0],
        pactSlotsUsed: 0,
      },
    };
  }

  it('guarda só o resumo da ficha, não a ficha inteira', () => {
    const archived = archiveCharacter('Gabriel', wessil());
    expect(archived).toEqual({
      playerName: 'Gabriel',
      name: 'Wessil',
      classes: 'Bardo 5',
      hitPoints: { current: 12, max: 38, temporary: 0 },
      conditions: ['poisoned'],
      slotsUsed: [2, 1, 0, 0, 0, 0, 0, 0, 0],
      pactSlotsUsed: 0,
    });
  });

  it('arquiva uma sessão e lê de volta como estava', async () => {
    const recorded = await repo.record({
      startedAt: '2026-09-17T22:00:00.000Z',
      endedAt: '2026-09-18T02:30:00.000Z',
      characters: [archiveCharacter('Gabriel', wessil())],
    });
    expect(recorded).not.toBeNull();

    const [listed] = await repo.list();
    expect(listed?.startedAt).toBe('2026-09-17T22:00:00.000Z');
    expect(listed?.notes).toBe('');
    expect(listed?.characters[0]?.name).toBe('Wessil');
    // O que o mestre perde hoje ao fechar o app: onde cada um parou.
    expect(listed?.characters[0]?.hitPoints.current).toBe(12);
    expect(listed?.characters[0]?.slotsUsed).toEqual([2, 1, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('sessão sem ninguém não vira registro', async () => {
    const recorded = await repo.record({
      startedAt: '2026-09-17T22:00:00.000Z',
      endedAt: '2026-09-17T22:00:30.000Z',
      characters: [],
    });
    expect(recorded).toBeNull();
    expect(await repo.list()).toEqual([]);
  });

  it('a anotação é escrita depois, sem tocar no resto', async () => {
    const recorded = await repo.record({
      startedAt: '2026-09-17T22:00:00.000Z',
      endedAt: '2026-09-18T02:30:00.000Z',
      characters: [archiveCharacter('Gabriel', wessil())],
    });

    const noted = await repo.setNotes(recorded!.id, 'Fugiram do templo sem a relíquia.');
    expect(noted.notes).toBe('Fugiram do templo sem a relíquia.');
    expect(noted.characters).toEqual(recorded!.characters);

    const reloaded = await repo.get(recorded!.id);
    expect(reloaded?.notes).toBe('Fugiram do templo sem a relíquia.');
  });

  it('lista da mais recente pra mais antiga', async () => {
    const characters = [archiveCharacter('Gabriel', wessil())];
    await repo.record({ startedAt: '2026-09-01T22:00:00.000Z', endedAt: '2026-09-02T01:00:00.000Z', characters });
    await repo.record({ startedAt: '2026-09-15T22:00:00.000Z', endedAt: '2026-09-16T01:00:00.000Z', characters });
    await repo.record({ startedAt: '2026-09-08T22:00:00.000Z', endedAt: '2026-09-09T01:00:00.000Z', characters });

    expect((await repo.list()).map((session) => session.endedAt)).toEqual([
      '2026-09-16T01:00:00.000Z',
      '2026-09-09T01:00:00.000Z',
      '2026-09-02T01:00:00.000Z',
    ]);
  });

  it('apaga uma sessão sem levar as outras', async () => {
    const characters = [archiveCharacter('Gabriel', wessil())];
    const first = await repo.record({ startedAt: 'a', endedAt: '2026-09-02T01:00:00.000Z', characters });
    await repo.record({ startedAt: 'b', endedAt: '2026-09-09T01:00:00.000Z', characters });

    await repo.delete(first!.id);
    expect(await repo.list()).toHaveLength(1);
    expect(await repo.get(first!.id)).toBeNull();
  });

  it('grupo ilegível vira sessão sem ninguém, não quebra a lista', async () => {
    const recorded = await repo.record({
      startedAt: 'a',
      endedAt: 'b',
      characters: [archiveCharacter('Gabriel', wessil())],
    });
    await driver.execute('UPDATE session_log SET characters = ? WHERE id = ?', [
      '{isso não é uma lista',
      recorded!.id,
    ]);

    const [listed] = await repo.list();
    expect(listed?.id).toBe(recorded!.id);
    expect(listed?.characters).toEqual([]);
  });

  it('descarta personagem fora do formato sem descartar a sessão', () => {
    expect(parseArchivedCharacters('[]')).toEqual([]);
    expect(parseArchivedCharacters('não é json')).toEqual([]);
    expect(parseArchivedCharacters('[{"name":"Sem os outros campos"}]')).toEqual([]);
  });
});
