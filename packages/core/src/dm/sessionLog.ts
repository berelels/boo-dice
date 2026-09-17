import { z } from 'zod';
import { classSummary } from '../db/characters.js';
import { CONDITIONS, type ConditionId } from '../rules/conditions.js';
import type { HitPoints } from '../rules/combat.js';
import type { Character } from '../schema/character.js';
import type { SqlDriver } from '../db/driver.js';

/**
 * Arquivo das sessões de mesa.
 *
 * O grupo conectado vive só na memória do processo main (ver
 * `apps/dm/src/main/session.ts`): é estado ao vivo, e faz sentido que seja.
 * O problema é que ao fechar o app some junto a única resposta pra "onde a
 * gente parou?" — quantos PV cada um tinha, quais espaços de magia já foram
 * gastos, quem estava com qual condição. Na sessão seguinte o mestre
 * pergunta na mesa e acredita na resposta.
 *
 * Aqui fica o registro do que terminou: quem jogou, como cada ficha estava no
 * fim, e o espaço pro mestre anotar o que aconteceu.
 *
 * Guardamos um **resumo** da ficha, não a ficha inteira. A ficha completa é do
 * jogador, no aparelho dele; copiá-la por sessão encheria o `dm.db` de cópias
 * que envelhecem e passariam a competir com o original sobre qual é a verdade.
 */

/** Como uma ficha estava quando a sessão acabou. */
export interface ArchivedCharacter {
  readonly playerName: string;
  readonly name: string;
  /** "Bardo 5", "Guerreiro 3 / Ladino 2". */
  readonly classes: string;
  readonly hitPoints: HitPoints;
  readonly conditions: readonly ConditionId[];
  /** Espaços gastos por nível de magia; índice 0 = 1º nível. */
  readonly slotsUsed: readonly number[];
  /** Magia de Pacto do bruxo, que tem pool próprio. */
  readonly pactSlotsUsed: number;
}

export interface ArchivedSession {
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt: string;
  /** Anotação livre do mestre sobre a sessão, escrita depois. */
  readonly notes: string;
  readonly characters: readonly ArchivedCharacter[];
}

/** Reduz uma ficha inteira ao que o mestre precisa rever na sessão seguinte. */
export function archiveCharacter(playerName: string, character: Character): ArchivedCharacter {
  return {
    playerName,
    name: character.name,
    classes: classSummary(character),
    hitPoints: character.hitPoints,
    conditions: character.conditions,
    slotsUsed: character.spellcasting.slotsUsed,
    pactSlotsUsed: character.spellcasting.pactSlotsUsed,
  };
}

const archivedCharacterSchema = z.object({
  playerName: z.string(),
  name: z.string(),
  classes: z.string(),
  hitPoints: z.object({
    current: z.number().int(),
    max: z.number().int(),
    temporary: z.number().int(),
  }),
  conditions: z.array(z.enum(CONDITIONS)),
  slotsUsed: z.array(z.number().int()),
  pactSlotsUsed: z.number().int(),
});

/**
 * Lê o grupo gravado numa sessão arquivada.
 *
 * Mesma postura do resto do `dm.db`: é JSON vindo do banco, não de código. Uma
 * sessão gravada por outra versão, ou mexida na mão, vira grupo vazio — a tela
 * mostra a sessão sem ninguém em vez de quebrar a lista inteira.
 */
export function parseArchivedCharacters(json: string): ArchivedCharacter[] {
  try {
    const parsed = z.array(archivedCharacterSchema).safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export interface RecordSessionInput {
  readonly startedAt: string;
  readonly endedAt: string;
  readonly characters: readonly ArchivedCharacter[];
}

interface SessionLogRow {
  id: string;
  started_at: string;
  ended_at: string;
  notes: string;
  characters: string;
}

function toArchived(row: SessionLogRow): ArchivedSession {
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    notes: row.notes,
    characters: parseArchivedCharacters(row.characters),
  };
}

export class SessionLogRepository {
  constructor(private readonly driver: SqlDriver) {}

  async list(): Promise<ArchivedSession[]> {
    const rows = await this.driver.query<SessionLogRow>(
      'SELECT * FROM session_log ORDER BY ended_at DESC',
    );
    return rows.map(toArchived);
  }

  async get(id: string): Promise<ArchivedSession | null> {
    const row = await this.driver.queryOne<SessionLogRow>('SELECT * FROM session_log WHERE id = ?', [
      id,
    ]);
    return row ? toArchived(row) : null;
  }

  /**
   * Arquiva uma sessão que acabou.
   *
   * Sessão sem ninguém não vira registro e devolve `null`: ligar o servidor
   * pra testar a rede, ou por engano, não é uma sessão de jogo, e uma lista
   * cheia de linhas vazias tornaria o arquivo inútil justamente pra quem
   * liga e desliga o servidor várias vezes.
   */
  async record(input: RecordSessionInput): Promise<ArchivedSession | null> {
    if (input.characters.length === 0) return null;

    const session: ArchivedSession = {
      id: crypto.randomUUID(),
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      notes: '',
      characters: input.characters,
    };
    await this.driver.execute(
      'INSERT INTO session_log (id, started_at, ended_at, notes, characters) VALUES (?, ?, ?, ?, ?)',
      [
        session.id,
        session.startedAt,
        session.endedAt,
        session.notes,
        JSON.stringify(session.characters),
      ],
    );
    return session;
  }

  async setNotes(id: string, notes: string): Promise<ArchivedSession> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Sessão "${id}" não encontrada.`);

    await this.driver.execute('UPDATE session_log SET notes = ? WHERE id = ?', [notes, id]);
    return { ...existing, notes };
  }

  async delete(id: string): Promise<void> {
    await this.driver.execute('DELETE FROM session_log WHERE id = ?', [id]);
  }
}
