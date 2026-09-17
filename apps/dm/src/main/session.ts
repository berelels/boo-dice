import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  archiveCharacter,
  clientMessageSchema,
  generateJoinCode,
  DEFAULT_SESSION_PORT,
  type ArchivedCharacter,
  type Character,
  type PartyMember,
  type PartySnapshot,
  type ServerMessage,
} from '@dfo/core';

const PORT = DEFAULT_SESSION_PORT;

export interface SessionHandle {
  readonly code: string;
  readonly port: number;
  readonly addresses: readonly string[];
  readonly startedAt: string;
  /** Estado do grupo agora — não só a partir do próximo evento de push. */
  getParty(): PartySnapshot;
  /**
   * Todo mundo que passou por esta sessão, no último estado em que foi visto —
   * inclusive quem já desconectou. É isto que vai pro arquivo quando a sessão
   * termina: quem saiu mais cedo também jogou.
   */
  getRoster(): readonly ArchivedCharacter[];
  /**
   * Manda uma mensagem pro(s) dispositivo(s) que trouxe(ram) este personagem.
   * `characterId` já é único o bastante pra mirar — não precisa de id de
   * jogador. Manda pra todas as conexões que tiverem esse personagem (o
   * mesmo jogador pode estar em dois aparelhos com o mesmo arquivo
   * exportado); devolve `true` se pelo menos uma mandou.
   */
  sendToCharacter(characterId: string, message: ServerMessage): boolean;
  stop(): void;
}

interface ConnectedPlayer {
  playerName: string;
  characters: Map<string, Character>;
}

/**
 * Hospeda a sessão em LAN: um servidor HTTP+WebSocket no processo main do
 * Electron — só um processo Node consegue abrir um socket de verdade, nem o
 * navegador nem a WebView do jogador conseguiriam hospedar isto.
 *
 * O estado do grupo fica só em memória, nunca no `dm.db`: é estado de sessão,
 * não dado persistente. Toda mensagem recebida é entrada não confiável — só
 * passa pela validação `clientMessageSchema.safeParse` antes de qualquer uso,
 * e uma mensagem malformada é descartada em silêncio, não derruba o servidor.
 */
export function startSession(onPartyChange: (party: PartySnapshot) => void): Promise<SessionHandle> {
  return new Promise((resolve, reject) => {
    const code = generateJoinCode();
    const startedAt = new Date().toISOString();
    const players = new Map<WebSocket, ConnectedPlayer>();
    // Separado de `players`: aquele mapa é o grupo conectado *agora*, e perde
    // quem fecha o app no meio. Este acumula e nunca esquece, porque é o que
    // responde "quem jogou hoje" quando a sessão acaba.
    const roster = new Map<string, ArchivedCharacter>();

    function remember(playerName: string, character: Character): void {
      roster.set(character.id, archiveCharacter(playerName, character));
    }

    const server = createServer();
    const wss = new WebSocketServer({ server });

    function buildSnapshot(): PartySnapshot {
      return {
        players: [...players.values()].map((player) => ({
          playerName: player.playerName,
          characters: [...player.characters.values()],
        })),
      };
    }

    /** Só nomes — a ficha de um jogador nunca desce pro aparelho de outro. */
    function buildRoster(): PartyMember[] {
      const members: PartyMember[] = [];
      for (const player of players.values()) {
        for (const character of player.characters.values()) {
          members.push({
            characterId: character.id,
            characterName: character.name,
            playerName: player.playerName,
          });
        }
      }
      return members;
    }

    function broadcastParty(): void {
      onPartyChange(buildSnapshot());

      // Os jogadores também precisam saber quem está na sessão, pra escolher
      // quem ajudar. Vai pra todo mundo a cada mudança: entrar, sair ou
      // trocar de nome muda a lista de aliados possíveis na tela deles.
      const roster = JSON.stringify({ type: 'party', members: buildRoster() });
      for (const ws of players.keys()) ws.send(roster);
    }

    wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        let payload: unknown;
        try {
          payload = JSON.parse(raw.toString());
        } catch {
          return;
        }

        const parsed = clientMessageSchema.safeParse(payload);
        if (!parsed.success) return;
        const message = parsed.data;

        if (message.type === 'hello') {
          if (message.code !== code) {
            ws.send(JSON.stringify({ type: 'error', reason: 'wrong-code' }));
            ws.close();
            return;
          }
          players.set(ws, {
            playerName: message.playerName,
            characters: new Map(message.characters.map((character) => [character.id, character])),
          });
          for (const character of message.characters) remember(message.playerName, character);
          ws.send(JSON.stringify({ type: 'welcome' }));
          broadcastParty();
        } else if (message.type === 'characterUpdate') {
          const player = players.get(ws);
          if (!player) return;
          player.characters.set(message.character.id, message.character);
          remember(player.playerName, message.character);
          broadcastParty();
        } else if (message.type === 'support') {
          const player = players.get(ws);
          if (!player) return;
          // O remetente só pode ajudar *como* um personagem que ele mesmo
          // trouxe. Sem esta checagem, qualquer aparelho na LAN que soubesse
          // o código poderia curar em nome de outro jogador.
          const from = player.characters.get(message.fromCharacterId);
          if (!from) return;

          const payload = JSON.stringify({
            type: 'support',
            characterId: message.targetCharacterId,
            source: from.name,
            label: message.label,
            effect: message.effect,
          } satisfies ServerMessage);

          for (const [socket, other] of players) {
            if (other.characters.has(message.targetCharacterId)) socket.send(payload);
          }
        } else if (message.type === 'leave') {
          players.delete(ws);
          broadcastParty();
        }
      });

      ws.on('close', () => {
        if (players.delete(ws)) broadcastParty();
      });
    });

    server.once('error', reject);
    server.listen(PORT, '0.0.0.0', () => {
      server.removeListener('error', reject);
      resolve({
        code,
        port: PORT,
        addresses: listLanAddresses(),
        startedAt,
        getParty: buildSnapshot,
        getRoster: () => [...roster.values()],
        sendToCharacter(characterId, message) {
          let sent = false;
          for (const [ws, player] of players) {
            if (!player.characters.has(characterId)) continue;
            ws.send(JSON.stringify(message));
            sent = true;
          }
          return sent;
        },
        stop() {
          for (const ws of players.keys()) ws.close();
          wss.close();
          server.close();
        },
      });
    });
  });
}

/** IPs de LAN da máquina, ignorando loopback e interfaces internas — pode haver mais de um. */
function listLanAddresses(): string[] {
  const addresses: string[] = [];
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) addresses.push(info.address);
    }
  }
  return addresses;
}
