import type { Migration } from '../db/migrations.js';

/**
 * Migrações do banco do app do mestre (`dm.db`).
 *
 * Banco próprio, separado do `player.db` — o mestre não é um jogador a mais,
 * e nada aqui precisa (ainda) saber sobre fichas de personagem. `encounters`
 * e `combatants` seguem o mesmo espírito de `characters`/`roll_log`: tabelas
 * simples, sem normalização além do necessário para ordenar e filtrar.
 */

export const DM_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'estrutura-inicial',
    up: `
      CREATE TABLE IF NOT EXISTS encounters (
        id                   TEXT PRIMARY KEY,
        name                 TEXT NOT NULL,
        round                INTEGER NOT NULL DEFAULT 1,
        current_combatant_id TEXT,
        created_at           TEXT NOT NULL,
        updated_at           TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_encounters_updated
        ON encounters (updated_at DESC);

      CREATE TABLE IF NOT EXISTS combatants (
        id           TEXT PRIMARY KEY,
        encounter_id TEXT NOT NULL REFERENCES encounters (id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        kind         TEXT NOT NULL DEFAULT 'npc',
        initiative   INTEGER NOT NULL,
        sort_order   INTEGER NOT NULL,
        hp_current   INTEGER NOT NULL DEFAULT 0,
        hp_max       INTEGER NOT NULL DEFAULT 0,
        hp_temp      INTEGER NOT NULL DEFAULT 0,
        armor_class  INTEGER,
        conditions   TEXT NOT NULL DEFAULT '[]',
        notes        TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_combatants_encounter
        ON combatants (encounter_id, sort_order);

      -- Notas de sessão: texto livre, sem vínculo com encontro nenhum — o
      -- mestre anota o que quiser, da trama ao que esqueceu de descrever.
      CREATE TABLE IF NOT EXISTS session_notes (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL DEFAULT '',
        body       TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_session_notes_updated
        ON session_notes (updated_at DESC);
    `,
  },
];
