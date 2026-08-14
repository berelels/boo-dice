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

const clientLeaveSchema = z.object({
  type: z.literal('leave'),
});

export const clientMessageSchema = z.discriminatedUnion('type', [
  clientHelloSchema,
  clientCharacterUpdateSchema,
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

export const serverMessageSchema = z.discriminatedUnion('type', [
  serverWelcomeSchema,
  serverErrorSchema,
  serverAttackSchema,
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;

/** Um jogador conectado e os personagens que trouxe pra sessão. */
export interface PartyPlayer {
  readonly playerName: string;
  readonly characters: readonly Character[];
}

/** O estado agregado do grupo, repassado do processo main pro renderer do Mestre. */
export interface PartySnapshot {
  readonly players: readonly PartyPlayer[];
}
