import type { SqlDriver } from '../db/driver.js';

/** Notas de sessão do mestre — texto livre, sem estrutura imposta. */
export interface SessionNote {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface SessionNoteRow {
  id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

function toNote(row: SessionNoteRow): SessionNote {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class NotesRepository {
  constructor(private readonly driver: SqlDriver) {}

  async list(): Promise<SessionNote[]> {
    const rows = await this.driver.query<SessionNoteRow>(
      'SELECT * FROM session_notes ORDER BY updated_at DESC',
    );
    return rows.map(toNote);
  }

  async get(id: string): Promise<SessionNote | null> {
    const row = await this.driver.queryOne<SessionNoteRow>(
      'SELECT * FROM session_notes WHERE id = ?',
      [id],
    );
    return row ? toNote(row) : null;
  }

  async create(input: { title?: string; body?: string } = {}): Promise<SessionNote> {
    const now = new Date().toISOString();
    const note: SessionNote = {
      id: crypto.randomUUID(),
      title: input.title ?? '',
      body: input.body ?? '',
      createdAt: now,
      updatedAt: now,
    };
    await this.driver.execute(
      'INSERT INTO session_notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [note.id, note.title, note.body, note.createdAt, note.updatedAt],
    );
    return note;
  }

  async update(id: string, patch: { title?: string; body?: string }): Promise<SessionNote> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Nota "${id}" não encontrada.`);

    const updated: SessionNote = {
      ...existing,
      title: patch.title ?? existing.title,
      body: patch.body ?? existing.body,
      updatedAt: new Date().toISOString(),
    };
    await this.driver.execute(
      'UPDATE session_notes SET title = ?, body = ?, updated_at = ? WHERE id = ?',
      [updated.title, updated.body, updated.updatedAt, updated.id],
    );
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.driver.execute('DELETE FROM session_notes WHERE id = ?', [id]);
  }
}
