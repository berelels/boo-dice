import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { classSummary, deriveCharacter, type Character, type PartySnapshot } from '@dfo/core';
import { Button, Card, Chip, EmptyState, Tappable } from '@dfo/ui';
import { useDmApi } from '../db/useDmApi.js';
import type { SessionStatus } from '../../../shared/ipc.js';
import { OracleCard } from './Oracle.js';
import { PlayerSheet } from './PlayerSheet.js';

/**
 * Painel de sessão: liga o servidor de LAN, mostra o código e o QR pra o
 * jogador entrar, e a lista de grupo ao vivo — PV/CA/condições de cada
 * personagem trazido, atualizando sozinha via `onPartyUpdate`.
 *
 * Direção única nesta rodada: só o jogador manda dado pra cá. Não existe
 * botão de "empurrar" nada de volta pro celular.
 */
export function SessionScreen(): JSX.Element {
  const dm = useDmApi();
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [party, setParty] = useState<PartySnapshot>({ players: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Só a identidade, não a ficha em si — assim a ficha aberta sempre reflete
  // o último push do grupo, em vez de congelar no que chegou no toque.
  const [openCharacter, setOpenCharacter] = useState<{ playerName: string; characterId: string } | null>(
    null,
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    void dm.session.status().then((status) => {
      setSession(status);
      setSelectedAddress(status?.addresses[0] ?? null);
    });

    // A tela só recebe o grupo por push — sem isto, trocar de aba e voltar
    // (o componente remonta) mostrava "ninguém conectado" até a próxima
    // atualização de um jogador, mesmo com gente conectada o tempo todo.
    // `receivedPush` evita que esta busca some por cima de um push mais
    // recente que já tenha chegado enquanto ela ainda estava em voo.
    let receivedPush = false;
    const unsubscribe = dm.session.onPartyUpdate((update) => {
      receivedPush = true;
      setParty(update);
    });
    void dm.session.party().then((current) => {
      if (current && !receivedPush) setParty(current);
    });

    return unsubscribe;
  }, [dm]);

  useEffect(() => {
    if (!session || !selectedAddress || !canvasRef.current) return;
    const payload = JSON.stringify({ host: selectedAddress, port: session.port, code: session.code });
    void QRCode.toCanvas(canvasRef.current, payload, { width: 200, margin: 1 });
  }, [session, selectedAddress]);

  const start = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const status = await dm.session.start();
      setSession(status);
      setSelectedAddress(status.addresses[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível iniciar a sessão.');
    } finally {
      setBusy(false);
    }
  };

  const stop = async (): Promise<void> => {
    setBusy(true);
    try {
      await dm.session.stop();
      setSession(null);
      setParty({ players: [] });
    } finally {
      setBusy(false);
    }
  };

  const openCharacterData = openCharacter
    ? party.players
        .find((player) => player.playerName === openCharacter.playerName)
        ?.characters.find((character) => character.id === openCharacter.characterId)
    : undefined;

  return (
    <div className="session">
      <Card>
        <div className="session__control">
          <div>
            <div className="dfo-headline">{session ? 'Sessão no ar' : 'Sessão parada'}</div>
            <div className="dfo-caption">
              {session
                ? 'Jogadores na mesma rede podem entrar agora.'
                : 'Inicie pra gerar o código e liberar a conexão em LAN.'}
            </div>
          </div>
          <Button
            variant={session ? 'danger' : 'primary'}
            disabled={busy}
            onTap={() => void (session ? stop() : start())}
          >
            {session ? 'Parar sessão' : 'Iniciar sessão'}
          </Button>
        </div>

        {error && <div className="session__error">{error}</div>}

        {session && (
          <div className="session__join">
            <div className="session__code">{session.code}</div>

            {session.addresses.length > 1 && (
              <div className="session__addresses">
                {session.addresses.map((address) => (
                  <Chip
                    key={address}
                    tone={address === selectedAddress ? 'accent' : 'neutral'}
                    onTap={() => setSelectedAddress(address)}
                  >
                    {address}
                  </Chip>
                ))}
              </div>
            )}

            <div className="dfo-caption">
              {selectedAddress ? `${selectedAddress}:${session.port}` : 'Nenhum endereço de LAN encontrado'}
            </div>

            <canvas ref={canvasRef} className="session__qr" />
          </div>
        )}
      </Card>

      <OracleCard />

      <div className="session__party">
        <div className="dfo-overline">Grupo</div>

        {party.players.length === 0 && (
          <EmptyState
            title="Ninguém conectado"
            description="Assim que um jogador entrar na sessão, os personagens trazidos aparecem aqui."
          />
        )}

        {party.players.map((player) => (
          <Card key={player.playerName}>
            <div className="dfo-headline">{player.playerName}</div>
            <div className="session__characters">
              {player.characters.map((character) => {
                const armorClass = deriveCharacter(character).armorClass.total;
                return (
                  <Tappable
                    as="div"
                    key={character.id}
                    className="session__character"
                    onTap={() => setOpenCharacter({ playerName: player.playerName, characterId: character.id })}
                  >
                    <div className="combatant-row__head">
                      <span className="dfo-body">{character.name}</span>
                      <span className="dfo-caption">{classSummary(character)}</span>
                    </div>
                    <div className="combatant-row__meta">
                      <span className="dfo-caption">
                        PV {character.hitPoints.current}/{character.hitPoints.max}
                        {character.hitPoints.temporary > 0 ? ` (+${character.hitPoints.temporary})` : ''}
                      </span>
                      <span className="dfo-caption">CA {armorClass}</span>
                      {character.inspiration && <Chip tone="accent">Inspiração</Chip>}
                    </div>
                    {character.conditions.length > 0 && (
                      <div className="combatant-row__conditions">
                        {character.conditions.map((condition) => (
                          <Chip key={condition} tone="danger">
                            {condition}
                          </Chip>
                        ))}
                      </div>
                    )}
                  </Tappable>
                );
              })}
            </div>
          </Card>
        ))}
      </div>

      <PlayerSheet
        playerName={openCharacter?.playerName ?? null}
        character={openCharacterData ?? null}
        onClose={() => setOpenCharacter(null)}
      />
    </div>
  );
}
