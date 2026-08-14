import { z } from 'zod';
import { ABILITIES, SKILLS } from '../rules/abilities.js';
import { CLASS_IDS } from '../rules/classes.js';
import { CONDITIONS } from '../rules/conditions.js';
import { COINS } from '../rules/encumbrance.js';
import { MAX_LEVEL, MIN_LEVEL } from '../rules/progression.js';

/**
 * Schema da ficha — a fonte única de verdade sobre o que é um personagem.
 *
 * O Zod aqui não é enfeite: a ficha vem do disco (SQLite), de um arquivo
 * importado ou, mais tarde, da rede numa sessão. Validar na fronteira significa
 * que nada acima desta camada precisa ficar checando se `abilities.str` existe.
 *
 * `schemaVersion` é o que permite evoluir a ficha sem quebrar personagens que
 * já estão salvos — ver `migrateCharacter`.
 */

export const CURRENT_SCHEMA_VERSION = 1;

const proficiencyLevelSchema = z.enum(['none', 'half', 'proficient', 'expertise']);

const abilityScoresSchema = z.object(
  Object.fromEntries(
    ABILITIES.map((ability) => [ability, z.number().int().min(1).max(30)]),
  ) as Record<(typeof ABILITIES)[number], z.ZodNumber>,
);

const classLevelSchema = z.object({
  classId: z.enum(CLASS_IDS),
  level: z.number().int().min(MIN_LEVEL).max(MAX_LEVEL),
  subclassId: z.string().optional(),
});

/** Recurso com usos limitados: Fúria, Surto de Ação, Canalizar Divindade, Ki. */
const resourceSchema = z.object({
  id: z.string(),
  label: z.string(),
  max: z.number().int().min(0),
  spent: z.number().int().min(0).default(0),
  /** Quando volta: descanso curto, longo, ou nunca (item consumível). */
  recharge: z.enum(['short', 'long', 'none']).default('long'),
});

const featureSchema = z.object({
  id: z.string(),
  label: z.string(),
  source: z.string(),
  description: z.string().default(''),
  resource: resourceSchema.optional(),
});

const attackSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Habilidade que rege acerto e dano. Arma com Acuidade costuma usar `dex`. */
  ability: z.enum(ABILITIES).default('str'),
  proficient: z.boolean().default(true),
  /** Notação do dano base, sem o modificador: `1d8`, `2d6`. */
  damageDice: z.string().default('1d4'),
  damageType: z.string().default(''),
  range: z.string().default('Corpo a corpo'),
  properties: z.array(z.string()).default([]),
  /** Bônus mágico da arma (+1, +2, +3), somado a acerto e dano. */
  magicBonus: z.number().int().default(0),
  /** Sobrescreve o cálculo automático quando a mesa combina algo diferente. */
  attackBonusOverride: z.number().int().nullable().default(null),
  notes: z.string().default(''),
});

const inventoryItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  quantity: z.number().int().min(0).default(1),
  weightKg: z.number().min(0).default(0),
  equipped: z.boolean().default(false),
  /** Referência ao item do SRD, quando veio do catálogo. */
  srdId: z.string().nullable().default(null),
  description: z.string().default(''),
});

const spellEntrySchema = z.object({
  /** ID do SRD quando a magia veio do catálogo; slug próprio se for caseira. */
  spellId: z.string(),
  label: z.string(),
  level: z.number().int().min(0).max(9),
  /** Preparada hoje. Truques e magias de bruxo ignoram isto. */
  prepared: z.boolean().default(false),
  /** Sempre preparada, sem contar no limite (domínio de clérigo, juramento). */
  alwaysPrepared: z.boolean().default(false),
  /** De qual classe veio, em multiclasse. */
  classId: z.enum(CLASS_IDS).nullable().default(null),
});

const spellcastingSchema = z.object({
  /** Espaços gastos por nível de magia. Índice 0 = 1º nível. */
  slotsUsed: z.array(z.number().int().min(0)).length(9).default(() => new Array(9).fill(0)),
  /** Magia de Pacto do bruxo tem pool próprio, que volta no descanso curto. */
  pactSlotsUsed: z.number().int().min(0).default(0),
  spells: z.array(spellEntrySchema).default([]),
  /** `spellId` da magia em concentração, ou `null`. Só cabe uma. */
  concentratingOn: z.string().nullable().default(null),
});

const armorSchema = z.object({
  /** ID da armadura equipada no catálogo do SRD, ou `null` para desarmado. */
  armorId: z.string().nullable().default(null),
  shield: z.boolean().default(false),
  unarmoredDefense: z.enum(['barbarian', 'monk']).nullable().default(null),
  bonuses: z
    .array(z.object({ source: z.string(), value: z.number().int() }))
    .default([]),
});

export const characterSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().default(CURRENT_SCHEMA_VERSION),

  name: z.string().default('Sem nome'),
  /** Cor de acento do card na galeria — identidade visual rápida. */
  accent: z.string().default('amber'),
  portraitDataUrl: z.string().nullable().default(null),

  classes: z.array(classLevelSchema).min(1),
  xp: z.number().int().min(0).default(0),

  identity: z
    .object({
      raceId: z.string().default(''),
      raceLabel: z.string().default(''),
      subraceLabel: z.string().default(''),
      background: z.string().default(''),
      alignment: z.string().default(''),
      playerName: z.string().default(''),
      age: z.string().default(''),
      height: z.string().default(''),
      weight: z.string().default(''),
      eyes: z.string().default(''),
      skin: z.string().default(''),
      hair: z.string().default(''),
      appearance: z.string().default(''),
      backstory: z.string().default(''),
      allies: z.string().default(''),
      treasure: z.string().default(''),
    })
    .default({}),

  abilities: abilityScoresSchema,
  savingThrows: z.record(z.enum(ABILITIES), proficiencyLevelSchema).default({}),
  skills: z.record(z.enum(SKILLS), proficiencyLevelSchema).default({}),

  hitPoints: z
    .object({
      current: z.number().int(),
      max: z.number().int().min(0),
      temporary: z.number().int().min(0).default(0),
    })
    .default({ current: 1, max: 1, temporary: 0 }),
  /** Dados de vida já gastos, por faces: `{ "10": 2 }` = dois d10 usados. */
  hitDiceSpent: z.record(z.string(), z.number().int().min(0)).default({}),
  deathSaves: z
    .object({
      successes: z.number().int().min(0).max(3).default(0),
      failures: z.number().int().min(0).max(3).default(0),
    })
    .default({ successes: 0, failures: 0 }),

  armor: armorSchema.default({}),
  speedMeters: z.number().min(0).default(9),
  initiativeBonus: z.number().int().default(0),

  attacks: z.array(attackSchema).default([]),
  spellcasting: spellcastingSchema.default({}),

  inventory: z.array(inventoryItemSchema).default([]),
  purse: z
    .object(
      Object.fromEntries(COINS.map((coin) => [coin, z.number().int().min(0).default(0)])) as Record<
        (typeof COINS)[number],
        z.ZodDefault<z.ZodNumber>
      >,
    )
    .default({}),

  proficiencies: z
    .object({
      armor: z.array(z.string()).default([]),
      weapons: z.array(z.string()).default([]),
      tools: z.array(z.string()).default([]),
      languages: z.array(z.string()).default([]),
    })
    .default({}),
  features: z.array(featureSchema).default([]),

  personality: z
    .object({
      traits: z.string().default(''),
      ideals: z.string().default(''),
      bonds: z.string().default(''),
      flaws: z.string().default(''),
    })
    .default({}),

  conditions: z.array(z.enum(CONDITIONS)).default([]),
  exhaustion: z.number().int().min(0).max(6).default(0),
  inspiration: z.boolean().default(false),

  notes: z.string().default(''),

  createdAt: z.string().default(() => new Date().toISOString()),
  updatedAt: z.string().default(() => new Date().toISOString()),
});

export type Character = z.infer<typeof characterSchema>;

/**
 * A forma *antes* dos padrões serem aplicados. Quem monta uma ficha nova
 * informa só o que sabe — classe, atributos, nome — e o schema preenche o
 * resto. Usar `Partial<Character>` aqui obrigaria a passar `magicBonus: 0` em
 * cada ataque, que é justamente o que os padrões existem para evitar.
 */
export type CharacterInput = z.input<typeof characterSchema>;
export type ClassLevelInput = z.infer<typeof classLevelSchema>;
export type Attack = z.infer<typeof attackSchema>;
export type InventoryItem = z.infer<typeof inventoryItemSchema>;
export type SpellEntry = z.infer<typeof spellEntrySchema>;
export type Feature = z.infer<typeof featureSchema>;
export type Resource = z.infer<typeof resourceSchema>;

/**
 * Migra uma ficha salva para o schema atual.
 *
 * Está aqui desde a v1, com um só passo possível, de propósito: o custo de
 * criar o mecanismo depois — quando já existem fichas reais no celular de
 * alguém — é muito maior que o de mantê-lo vazio agora.
 */
export function migrateCharacter(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const data = { ...(raw as Record<string, unknown>) };
  const version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;

  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Ficha gravada na versão ${version}, mas este app entende até a ${CURRENT_SCHEMA_VERSION}. Atualize o app.`,
    );
  }

  // Passos futuros entram aqui, um `if (version < N)` por vez.

  data.schemaVersion = CURRENT_SCHEMA_VERSION;
  return data;
}

export function parseCharacter(raw: unknown): Character {
  return characterSchema.parse(migrateCharacter(raw));
}

export function safeParseCharacter(
  raw: unknown,
): { ok: true; character: Character } | { ok: false; error: z.ZodError } {
  const result = characterSchema.safeParse(migrateCharacter(raw));
  return result.success
    ? { ok: true, character: result.data }
    : { ok: false, error: result.error };
}

/** Cria uma ficha nova já válida, com os padrões do schema aplicados. */
export function createCharacter(
  input: Omit<CharacterInput, 'id' | 'schemaVersion'> & { id?: string },
): Character {
  return characterSchema.parse({
    ...input,
    id: input.id ?? crypto.randomUUID(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
  });
}
