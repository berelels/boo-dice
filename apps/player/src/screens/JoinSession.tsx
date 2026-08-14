import { useEffect, useState } from 'react';
import { DEFAULT_SESSION_PORT, type CharacterSummary } from '@dfo/core';
import { Button, Card, Chip, EmptyState, Field, Screen, Tappable, TopBar } from '@dfo/ui';
import { useAppData } from '../db/provider.js';
import { useSession } from '../state/session.js';
import { canScanQr, scanSessionQr } from '../state/qrScan.js';

/**
 * Entrar na sessão do Mestre.
 *
 * Campos manuais primeiro — IP, porta, código, nome — com o leitor de QR
 * como atalho por cima disso, não substituindo os campos. O jogador escolhe
 * quais personagens trazer aqui; as atualizações de PV/CA/condições depois
 * saem sozinhas da ficha normal, sem precisar voltar a esta tela.
 */
export function JoinSessionScreen({ onBack }: { onBack: () => void }): JSX.Element {
  const { characters } = useAppData();
  const session = useSession();
  const [list, setList] = useState<CharacterSummary[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [playerName, setPlayerName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(DEFAULT_SESSION_PORT);
  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    void characters.list().then(setList);
  }, [characters]);

  const scan = async (): Promise<void> => {
    setScanning(true);
    setScanError(null);
    try {
      const result = await scanSessionQr();
      if (!result) {
        setScanError('Não consegui ler um QR de sessão. Tente de novo ou preencha à mão.');
        return;
      }
      setHost(result.host);
      setPort(result.port);
      setCode(result.code.toUpperCase());
    } finally {
      setScanning(false);
    }
  };

  const toggle = (id: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canJoin =
    playerName.trim().length > 0 && host.trim().length > 0 && code.trim().length === 6 && selected.size > 0;

  const join = async (): Promise<void> => {
    await session.connect({
      host: host.trim(),
      port,
      code: code.trim().toUpperCase(),
      playerName: playerName.trim(),
      characterIds: [...selected],
    });
  };

  return (
    <Screen>
      <TopBar
        title="Entrar em sessão"
        leading={
          <Tappable onTap={onBack} className="icon-button" ariaLabel="Voltar">
            <span aria-hidden="true">←</span>
          </Tappable>
        }
      />

      <div className="join-session">
        {session.status === 'connected' ? (
          <Card>
            <div className="dfo-headline">Conectado</div>
            <div className="dfo-caption">O Mestre está vendo seus personagens ao vivo.</div>
            <div className="join-session__leave">
              <Button variant="danger" full onTap={() => session.disconnect()}>
                Sair da sessão
              </Button>
            </div>
          </Card>
        ) : (
          <>
            {canScanQr() && (
              <div className="join-session__scan">
                <Button variant="secondary" full disabled={scanning} onTap={() => void scan()}>
                  {scanning ? 'Abrindo câmera…' : '◻ Escanear QR do Mestre'}
                </Button>
                {scanError && <div className="join-session__error">{scanError}</div>}
              </div>
            )}

            <Field label="Seu nome">
              <input
                type="text"
                value={playerName}
                onChange={(event) => setPlayerName(event.target.value)}
                placeholder="Ana"
                autoComplete="off"
              />
            </Field>

            <div className="join-session__row">
              <Field label="IP do Mestre">
                <input
                  type="text"
                  value={host}
                  onChange={(event) => setHost(event.target.value)}
                  placeholder="192.168.0.42"
                  autoComplete="off"
                  inputMode="decimal"
                />
              </Field>
              <Field label="Porta">
                <input
                  type="number"
                  value={port}
                  onChange={(event) => setPort(Number(event.target.value) || DEFAULT_SESSION_PORT)}
                  inputMode="numeric"
                />
              </Field>
            </div>

            <Field label="Código da sessão">
              <input
                type="text"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="BXQP7M"
                maxLength={6}
                autoComplete="off"
                className="join-session__code-input"
              />
            </Field>

            <div className="dfo-overline">Personagens pra trazer</div>

            {list?.length === 0 && (
              <EmptyState
                title="Nenhum personagem"
                description="Crie um personagem antes de entrar numa sessão."
              />
            )}

            <div className="join-session__characters">
              {list?.map((summary) => (
                <Card
                  key={summary.id}
                  onTap={() => toggle(summary.id)}
                  className={selected.has(summary.id) ? 'join-session__character--selected' : ''}
                >
                  <div className="join-session__character-head">
                    <span className="dfo-body">{summary.name}</span>
                    {selected.has(summary.id) && <Chip tone="accent">Selecionado</Chip>}
                  </div>
                  <div className="dfo-caption">{summary.classSummary || 'Sem classe'}</div>
                </Card>
              ))}
            </div>

            {session.status === 'error' && session.error && (
              <div className="join-session__error">{session.error}</div>
            )}

            <Button
              variant="primary"
              full
              disabled={!canJoin || session.status === 'connecting'}
              onTap={() => void join()}
            >
              {session.status === 'connecting' ? 'Entrando…' : 'Entrar'}
            </Button>
          </>
        )}
      </div>
    </Screen>
  );
}
