import type { SqlDriver } from './driver.js';

/**
 * Migrações do banco local.
 *
 * A tabela `characters` guarda a ficha inteira como JSON, com algumas colunas
 * espelhadas ao lado. Isso é deliberado: a ficha é sempre lida por inteiro (não
 * existe tela que mostre "só as perícias"), então normalizá-la em quinze
 * tabelas só criaria `join`s sem ganho nenhum. As colunas espelhadas existem
 * para a galeria conseguir listar quarenta personagens sem desserializar
 * quarenta JSONs.
 */

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'estrutura-inicial',
    up: `
      CREATE TABLE IF NOT EXISTS characters (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        class_summary TEXT NOT NULL DEFAULT '',
        total_level   INTEGER NOT NULL DEFAULT 1,
        accent        TEXT NOT NULL DEFAULT 'amber',
        data          TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_characters_updated
        ON characters (updated_at DESC);

      -- Registro de rolagens da sessão. Fica no banco (e não em memória) para
      -- sobreviver a um fechamento acidental do app no meio do combate.
      CREATE TABLE IF NOT EXISTS roll_log (
        id           TEXT PRIMARY KEY,
        character_id TEXT,
        label        TEXT NOT NULL,
        notation     TEXT NOT NULL,
        total        INTEGER NOT NULL,
        detail       TEXT NOT NULL,
        rolled_at    TEXT NOT NULL,
        FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_roll_log_time
        ON roll_log (rolled_at DESC);

      CREATE TABLE IF NOT EXISTS app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: 'retrato-na-galeria',
    // O retrato é espelhado numa coluna para a galeria não precisar
    // desserializar cada ficha só para mostrar o rosto no card.
    up: `ALTER TABLE characters ADD COLUMN portrait TEXT;`,
  },
];

const SCHEMA_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`;

/**
 * Aplica as migrações que faltam, em ordem, cada uma na sua transação.
 * Rodar duas vezes não faz nada na segunda.
 *
 * O array de migrações é um parâmetro (e não sempre `MIGRATIONS`) porque o
 * app do mestre grava num banco próprio (`dm.db`, ver `../dm/migrations.js`)
 * com seu próprio histórico de `schema_migrations` — a tabela de controle é o
 * mesmo formato, a lista de migrações é que muda por banco.
 */
export async function migrate(
  driver: SqlDriver,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<number[]> {
  await driver.executeScript(SCHEMA_TABLE);

  const applied = await driver.query<{ version: number }>(
    'SELECT version FROM schema_migrations',
  );
  const appliedVersions = new Set(applied.map((row) => row.version));

  const executed: number[] = [];
  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (appliedVersions.has(migration.version)) continue;

    await driver.transaction(async (tx) => {
      await tx.executeScript(migration.up);
      await tx.execute(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        [migration.version, migration.name, new Date().toISOString()],
      );
    });
    executed.push(migration.version);
  }

  return executed;
}

export async function currentSchemaVersion(driver: SqlDriver): Promise<number> {
  const row = await driver.queryOne<{ version: number | null }>(
    'SELECT MAX(version) AS version FROM schema_migrations',
  );
  return row?.version ?? 0;
}
