import { z } from 'zod';
import { characterSchema, type Character } from '../schema/character.js';
import { CONDITIONS } from '../rules/conditions.js';

/**
 * Contrato do WebSocket entre o app do jogador e o app do Mestre numa sessão
 * em LAN — o equivalente, pro sync, do que `shared/ipc.ts` é pro Electron.
 *
 * Mensagem chegando de outro aparelho é entrada não confiável, igual a um
 * arquivo importado: por isso a validação aqui é Zod na fronteira, não só
 * tipo TypeScript — reaproveitando o mesmo `characterSchema` que já valida
 * fichas vindas de disco ou de arquivo importado (ver `schema/character.ts`).
 *
 * A ficha viaja **inteira**, não um resumo: o Mestre precisa ver tudo, não só
 * PV/CA/condições. O painel de grupo (visão rápida) deriva o que precisa da
 * ficha completa já recebida — não existe mais um tipo de "vitrine" à parte.
 *
 * O mestre também pode empurrar coisa de volta: um ataque de monstro contra
 * um personagem conectado (`attack`). O resultado (acerto, dano, condições)
 * já vem resolvido do lado do Mestre — o jogador só aplica, não recalcula
 * nada, e as mesmas funções puras de `rules/combat.ts`/`rules/conditions.ts`
 * valem dos dois lados.
 *
 * E um jogador pode ajudar outro (`support`): cura, PV temporários, tirar uma
 * condição. Não existe conexão entre aparelhos de jogador — o Mestre é o
 * único ponto em comum, então ele repassa. Isso é por desenho, não por
 * limitação: a mesa inteira passa pelo Mestre, e é ele quem sabe quem está
 * de fato na sessão.
 */

const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I
const JOIN_CODE_LENGTH = 6;

/** Porta padrão do servidor de sessão do Mestre — uma constante só, usada nos dois apps. */
export const DEFAULT_SESSION_PORT = 45320;

/** Gera um código de sessão de 6 caracteres sem ambiguidade visual. */
export function generateJoinCode(): string {
  let code = '';
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code += JOIN_CODE_ALPHABET[Math.floor(Math.random() * JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

const clientHelloSchema = z.object({
  type: z.literal('hello'),
  code: z.string().length(JOIN_CODE_LENGTH),
  playerName: z.string().min(1).max(40),
  characters: z.array(characterSchema).min(1),
});

const clientCharacterUpdateSchema = z.object({
  type: z.literal('characterUpdate'),
  character: characterSchema,
});

/**
 * O efeito de uma ajuda, em números que o app já sabe aplicar.
 *
 * Só o que é mecânico e reversível pelas regras: cura, PV temporários,
 * condição que sai. "Bênção" e afins ficam de fora de propósito — o app não
 * modela dado de bônus em jogada futura, e fingir que modela seria pior que
 * não ter.
 */
const supportEffectSchema = z.object({
  /** Quanto curar. Zero = esta ajuda não cura. */
  healing: z.number().int().min(0).default(0),
  /** PV temporários concedidos — via `applyTemporaryHitPoints`, que não soma: fica o maior. */
  temporaryHp: z.number().int().min(0).default(0),
  /** Condições que saem do aliado. */
  conditionsRemoved: z.array(z.enum(CONDITIONS)).default([]),
});

export type SupportEffect = z.infer<typeof supportEffectSchema>;

const clientSupportSchema = z.object({
  type: z.literal('support'),
  /**
   * Personagem de quem está ajudando. O Mestre confere que este id é mesmo de
   * um personagem que *esta* conexão trouxe — sem isso, qualquer aparelho na
   * LAN poderia se passar por outro jogador.
   */
  fromCharacterId: z.string(),
  targetCharacterId: z.string(),
  /** O que foi usado, pro aliado ler: "Palavra Curativa", "Poção de cura". */
  label: z.string().min(1).max(60),
  effect: supportEffectSchema,
});

const clientLeaveSchema = z.object({
  type: z.literal('leave'),
});

export const clientMessageSchema = z.discriminatedUnion('type', [
  clientHelloSchema,
  clientCharacterUpdateSchema,
  clientSupportSchema,
  clientLeaveSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

const serverWelcomeSchema = z.object({
  type: z.literal('welcome'),
});

const serverErrorSchema = z.object({
  type: z.literal('error'),
  reason: z.enum(['wrong-code', 'malformed']),
});

/** Um ataque já resolvido do lado do Mestre, aplicado direto na ficha. */
const serverAttackSchema = z.object({
  type: z.literal('attack'),
  characterId: z.string(),
  /** Nome de exibição pro jogador: "Goblin", "Ataque manual". */
  source: z.string(),
  hit: z.boolean(),
  damage: z.number().int().min(0),
  conditions: z.array(z.enum(CONDITIONS)).default([]),
});

/**
 * Quem mais está na sessão — só nome, nunca ficha.
 *
 * O jogador precisa disto pra escolher quem ajudar, e precisa só disto. A
 * ficha alheia é do outro jogador: ela sobe pro Mestre porque ele arbitra a
 * mesa, e não desce pros outros aparelhos.
 */
const serverPartySchema = z.object({
  type: z.literal('party'),
  members: z.array(
    z.object({
      characterId: z.string(),
      characterName: z.string(),
      playerName: z.string(),
    }),
  ),
});

/** Ajuda de outro jogador, repassada pelo Mestre. */
const serverSupportSchema = z.object({
  type: z.literal('support'),
  /** Quem recebe — o personagem deste aparelho. */
  characterId: z.string(),
  /** Quem ajudou, já pronto pra exibir: "Wessil". */
  source: z.string(),
  label: z.string(),
  effect: supportEffectSchema,
});

export const serverMessageSchema = z.discriminatedUnion('type', [
  serverWelcomeSchema,
  serverErrorSchema,
  serverAttackSchema,
  serverPartySchema,
  serverSupportSchema,
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;

/** Um integrante da sessão como os *outros jogadores* o enxergam: só o nome. */
export interface PartyMember {
  readonly characterId: string;
  readonly characterName: string;
  readonly playerName: string;
}

/** Um jogador conectado e os personagens que trouxe pra sessão. */
export interface PartyPlayer {
  readonly playerName: string;
  readonly characters: readonly Character[];
}

/** O estado agregado do grupo, repassado do processo main pro renderer do Mestre. */
export interface PartySnapshot {
  readonly players: readonly PartyPlayer[];
}
