import { CLASSES, totalLevel } from '../rules/classes.js';
import { parseCharacter, safeParseCharacter, type Character } from '../schema/character.js';
import type { SqlDriver } from './driver.js';

/** Resumo para a galeria — o suficiente para o card, sem ler a ficha inteira. */
export interface CharacterSummary {
  readonly id: string;
  readonly name: string;
  readonly classSummary: string;
  readonly totalLevel: number;
  /** Id da classe principal — a UI usa para colorir o card. */
  readonly accent: string;
  readonly portrait: string | null;
  readonly updatedAt: string;
}

interface CharacterRow {
  id: string;
  name: string;
  class_summary: string;
  total_level: number;
  accent: string;
  data: string;
  created_at: string;
  updated_at: string;
}

/** "Guerreiro 5" ou "Guerreiro 5 / Mago 3", como aparece no card. */
export function classSummary(character: Character): string {
  return character.classes
    .map((entry) => `${CLASSES[entry.classId].label} ${entry.level}`)
    .join(' / ');
}

/**
 * A classe principal é a primeira da lista — a que o personagem começou.
 * A interface usa isso para colorir o card e o topo da ficha, de modo que a
 * galeria seja legível de relance.
 */
export function primaryClassId(character: Character): string {
  return character.classes[0]?.classId ?? 'wizard';
}

export class CharacterRepository {
  constructor(private readonly driver: SqlDriver) {}

  async list(): Promise<CharacterSummary[]> {
    const rows = await this.driver.query<Omit<CharacterRow, 'data'> & { portrait: string | null }>(
      `SELECT id, name, class_summary, total_level, accent, portrait, created_at, updated_at
       FROM characters
       ORDER BY updated_at DESC`,
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      classSummary: row.class_summary,
      totalLevel: row.total_level,
      accent: row.accent,
      portrait: row.portrait,
      updatedAt: row.updated_at,
    }));
  }

  async get(id: string): Promise<Character | null> {
    const row = await this.driver.queryOne<CharacterRow>(
      'SELECT * FROM characters WHERE id = ?',
      [id],
    );
    if (!row) return null;
    return parseCharacter(JSON.parse(row.data));
  }

  /**
   * Lê uma ficha tolerando corrupção. Uma ficha que não valida não deve
   * derrubar a galeria inteira — o app precisa conseguir listar as outras e
   * avisar sobre esta.
   */
  async getSafe(
    id: string,
  ): Promise<{ ok: true; character: Character } | { ok: false; reason: string } | null> {
    const row = await this.driver.queryOne<CharacterRow>(
      'SELECT * FROM characters WHERE id = ?',
      [id],
    );
    if (!row) return null;

    let raw: unknown;
    try {
      raw = JSON.parse(row.data);
    } catch {
      return { ok: false, reason: 'A ficha está gravada com JSON inválido.' };
    }

    const result = safeParseCharacter(raw);
    return result.ok
      ? { ok: true, character: result.character }
      : { ok: false, reason: result.error.issues.map((issue) => issue.message).join('; ') };
  }

  async save(character: Character): Promise<Character> {
    const stamped: Character = { ...character, updatedAt: new Date().toISOString() };

    await this.driver.execute(
      `INSERT INTO characters (id, name, class_summary, total_level, accent, portrait, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name          = excluded.name,
         class_summary = excluded.class_summary,
         total_level   = excluded.total_level,
         accent        = excluded.accent,
         portrait      = excluded.portrait,
         data          = excluded.data,
         updated_at    = excluded.updated_at`,
      [
        stamped.id,
        stamped.name,
        classSummary(stamped),
        totalLevel(stamped.classes),
        // A coluna espelha a classe principal: é dela que sai a cor do card, e
        // gravá-la aqui evita a galeria ter de abrir cada ficha só para saber
        // de que cor pintar.
        primaryClassId(stamped),
        stamped.portraitDataUrl,
        JSON.stringify(stamped),
        stamped.createdAt,
        stamped.updatedAt,
      ],
    );

    return stamped;
  }

  async delete(id: string): Promise<void> {
    await this.driver.execute('DELETE FROM characters WHERE id = ?', [id]);
  }

  async count(): Promise<number> {
    const row = await this.driver.queryOne<{ total: number }>(
      'SELECT COUNT(*) AS total FROM characters',
    );
    return row?.total ?? 0;
  }

  /** Duplica uma ficha — útil para testar uma build alternativa do personagem. */
  async duplicate(id: string, newName?: string): Promise<Character | null> {
    const original = await this.get(id);
    if (!original) return null;

    const now = new Date().toISOString();
    return this.save({
      ...original,
      id: crypto.randomUUID(),
      name: newName ?? `${original.name} (cópia)`,
      createdAt: now,
      updatedAt: now,
    });
  }
}

// ---------------------------------------------------------------------------
// Registro de rolagens
// ---------------------------------------------------------------------------

export interface RollLogEntry {
  readonly id: string;
  readonly characterId: string | null;
  /** O que foi rolado: "Atletismo", "Machado de Batalha (dano)". */
  readonly label: string;
  readonly notation: string;
  readonly total: number;
  /** Detalhe legível: "d20: 17 (+3) = 20" ou "1d8+3: [5] +3 = 8". */
  readonly detail: string;
  readonly rolledAt: string;
}

export class RollLogRepository {
  constructor(private readonly driver: SqlDriver) {}

  async append(entry: Omit<RollLogEntry, 'id' | 'rolledAt'>): Promise<RollLogEntry> {
    const record: RollLogEntry = {
      ...entry,
      id: crypto.randomUUID(),
      rolledAt: new Date().toISOString(),
    };

    await this.driver.execute(
      `INSERT INTO roll_log (id, character_id, label, notation, total, detail, rolled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.characterId,
        record.label,
        record.notation,
        record.total,
        record.detail,
        record.rolledAt,
      ],
    );

    return record;
  }

  async recent(limit = 50, characterId?: string): Promise<RollLogEntry[]> {
    const rows = characterId
      ? await this.driver.query<Record<string, never>>(
          `SELECT * FROM roll_log WHERE character_id = ? ORDER BY rolled_at DESC LIMIT ?`,
          [characterId, limit],
        )
      : await this.driver.query<Record<string, never>>(
          `SELECT * FROM roll_log ORDER BY rolled_at DESC LIMIT ?`,
          [limit],
        );

    return rows.map((row) => {
      const record = row as unknown as {
        id: string;
        character_id: string | null;
        label: string;
        notation: string;
        total: number;
        detail: string;
        rolled_at: string;
      };
      return {
        id: record.id,
        characterId: record.character_id,
        label: record.label,
        notation: record.notation,
        total: record.total,
        detail: record.detail,
        rolledAt: record.rolled_at,
      };
    });
  }

  async clear(characterId?: string): Promise<void> {
    if (characterId) {
      await this.driver.execute('DELETE FROM roll_log WHERE character_id = ?', [characterId]);
    } else {
      await this.driver.execute('DELETE FROM roll_log');
    }
  }
}
