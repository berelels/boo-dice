import { describe, expect, it } from 'vitest';
import { CATALOG_REBUILD, CATALOG_SCHEMA, RulesLibrary, RulesSearch } from '@dfo/core';
import { BetterSqlite3Driver } from '@dfo/core/db/better-sqlite3';
import {
  askOracle,
  buildOraclePrompt,
  extractKeywords,
  getOracleQuota,
  NOT_FOUND_ANSWER,
  ORACLE_SYSTEM_PROMPT,
  resetOracleQuota,
  setOracleSessionActive,
} from './oracle.js';

/**
 * Só a parte pura: montagem de prompt e contagem de cota. `askOracle` de
 * verdade precisa do modelo (~1GB) e de rede — verificado manualmente, não
 * aqui, mesmo critério já usado pra `session.ts`/Electron neste app.
 */

describe('buildOraclePrompt', () => {
  it('inclui a pergunta e as fontes numeradas', () => {
    const prompt = buildOraclePrompt('Quanto de dano causa a Bola de Fogo?', [
      { title: 'Bola de Fogo', body: 'Causa 8d6 de dano de fogo.' },
      { title: 'Regras de Magia', body: 'Magias de evocação manipulam energia.' },
    ]);

    expect(prompt).toContain('Pergunta do mestre: Quanto de dano causa a Bola de Fogo?');
    expect(prompt).toContain('[Fonte 1: Bola de Fogo]');
    expect(prompt).toContain('Causa 8d6 de dano de fogo.');
    expect(prompt).toContain('[Fonte 2: Regras de Magia]');
  });

  it('avisa que não achou fonte quando a busca não retorna nada', () => {
    const prompt = buildOraclePrompt('Pergunta qualquer', []);
    expect(prompt).toContain('nenhuma fonte encontrada no acervo indexado');
  });

  it('repete o lembrete de só usar as fontes perto da pergunta', () => {
    const prompt = buildOraclePrompt('X', [{ title: 'Y', body: 'Z' }]);
    expect(prompt).toMatch(/só com base nas fontes/i);
  });
});

describe('ORACLE_SYSTEM_PROMPT', () => {
  it('instrui o modelo a não inventar regra fora das fontes', () => {
    expect(ORACLE_SYSTEM_PROMPT).toMatch(/exclusivamente as fontes/i);
    expect(ORACLE_SYSTEM_PROMPT).toMatch(/nunca invente regra/i);
  });
});

describe('extractKeywords', () => {
  it('remove palavras de função, mantendo os termos de conteúdo', () => {
    const keywords = extractKeywords('Quanto de dano de fogo a magia Bola de Fogo causa?');
    expect(keywords).not.toContain('de');
    expect(keywords).not.toContain('a');
    expect(keywords).toContain('dano');
    expect(keywords).toContain('fogo');
    expect(keywords).toContain('magia');
    expect(keywords).toContain('bola');
    expect(keywords).toContain('causa');
  });

  it('não repete a mesma palavra duas vezes', () => {
    // "fogo" aparece duas vezes em "Bola de Fogo" / "dano de fogo"
    const keywords = extractKeywords('Quanto de dano de fogo a magia Bola de Fogo causa?');
    expect(keywords.filter((word) => word === 'fogo')).toHaveLength(1);
  });

  it('fica vazio quando a pergunta é só palavra de função', () => {
    expect(extractKeywords('a que é')).toEqual([]);
  });

  it('reconhece palavra de função mesmo sem acento', () => {
    // "sao"/"está" sem acento escapavam do filtro e viravam busca ruim —
    // ver o bug relatado ao vivo: "Quais sao os perigos de X" trazia fonte
    // nenhuma a ver, só porque "sao" (de "são") passou como palavra de conteúdo.
    const keywords = extractKeywords('Quais sao os perigos de nevenunca?');
    expect(keywords).not.toContain('sao');
    expect(keywords).toEqual(['perigos', 'nevenunca']);
  });
});

describe('cota do Oráculo', () => {
  it('é ilimitada (null) sem sessão de LAN ativa', () => {
    setOracleSessionActive(false);
    expect(getOracleQuota()).toBeNull();
  });

  it('começa e reseta em 3 perguntas quando a sessão está ativa', () => {
    setOracleSessionActive(true);
    resetOracleQuota();
    expect(getOracleQuota()).toBe(3);
    setOracleSessionActive(false);
  });
});

describe('askOracle sem nenhuma fonte encontrada', () => {
  it('responde direto que não encontrou, sem chamar o modelo', async () => {
    setOracleSessionActive(false); // ilimitado, não polui a cota de outros testes
    const library = new RulesLibrary(null, null, null); // sem acervo nenhum: toda busca dá zero
    const result = await askOracle(library, '/caminho/que/nao/existe.gguf', 'Qualquer pergunta aqui');

    expect(result).toEqual({ answer: NOT_FOUND_ANSWER, sources: [] });
  });

  it('não confunde palavra genérica em comum com o assunto de verdade da pergunta', async () => {
    // Reproduz o bug relatado ao vivo: "Quais sao os perigos de nevenunca?"
    // achava fonte só porque "perigos" aparece no texto da Exaustão — mesmo
    // "nevenunca" (o assunto de verdade, inventado) não batendo em nada.
    setOracleSessionActive(false);

    const driver = new BetterSqlite3Driver(':memory:');
    await driver.executeScript(CATALOG_SCHEMA);
    await driver.execute(
      `INSERT INTO catalog (id, kind, title, subtitle, body, section, lang) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        'condition:exhaustion',
        'condition',
        'Exaustão',
        'Condição',
        'Vários efeitos, alguns mágicos, podem infligir um tipo especial de perigo chamado exaustão.',
        'Condição',
        'pt',
      ],
    );
    await driver.executeScript(CATALOG_REBUILD);

    const library = new RulesLibrary(new RulesSearch(driver), null, null);
    const result = await askOracle(library, '/caminho/que/nao/existe.gguf', 'Quais sao os perigos de nevenunca?');

    expect(result).toEqual({ answer: NOT_FOUND_ANSWER, sources: [] });
  });
});
