import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  clientMessageSchema,
  generateJoinCode,
  DEFAULT_SESSION_PORT,
  type Character,
  type PartySnapshot,
  type ServerMessage,
} from '@dfo/core';

const PORT = DEFAULT_SESSION_PORT;

export interface SessionHandle {
  readonly code: string;
  readonly port: number;
  readonly addresses: readonly string[];
  /** Estado do grupo agora — não só a partir do próximo evento de push. */
  getParty(): PartySnapshot;
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
    const players = new Map<WebSocket, ConnectedPlayer>();

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

    function broadcastParty(): void {
      onPartyChange(buildSnapshot());
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
          ws.send(JSON.stringify({ type: 'welcome' }));
          broadcastParty();
        } else if (message.type === 'characterUpdate') {
          const player = players.get(ws);
          if (!player) return;
          player.characters.set(message.character.id, message.character);
          broadcastParty();
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
        getParty: buildSnapshot,
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
