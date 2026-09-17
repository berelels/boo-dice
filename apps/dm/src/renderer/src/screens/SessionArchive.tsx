import { useEffect, useState } from 'react';
import { CONDITION_DEFINITIONS, type ArchivedCharacter, type ArchivedSession } from '@dfo/core';
import { BottomSheet, Button, Card, Chip, EmptyState, Field } from '@dfo/ui';
import { useDmApi } from '../db/useDmApi.js';

/**
 * Arquivo das sessões que já terminaram.
 *
 * Mora na aba Sessão, embaixo do grupo, porque é ali que o mestre está quando
 * quer saber "onde a gente parou?" — no começo da mesa seguinte, com o
 * servidor ainda desligado. A resposta é o que o app já sabia e jogava fora:
 * PV, espaços de magia e condições de cada um no momento em que a sessão
 * acabou.
 *
 * `reloadKey` muda quando uma sessão é encerrada na tela de cima; sem isso a
 * sessão recém-arquivada só apareceria ao trocar de aba e voltar.
 */
export function SessionArchive({ reloadKey }: { reloadKey: number }): JSX.Element {
  const dm = useDmApi();
  const [sessions, setSessions] = useState<ArchivedSession[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  const reload = (): void => {
    void dm.sessionLog.list().then(setSessions);
  };

  useEffect(reload, [dm, reloadKey]);

  const open = sessions?.find((session) => session.id === openId) ?? null;

  const openSession = (session: ArchivedSession): void => {
    setOpenId(session.id);
    setNotes(session.notes);
  };

  const close = (): void => {
    // Salva ao fechar, não a cada tecla: é texto longo, escrito devagar, e um
    // gravar por caractere encheria o banco de escrita à toa.
    if (open && notes !== open.notes) {
      void dm.sessionLog.setNotes(open.id, notes).then(reload);
    }
    setOpenId(null);
  };

  const remove = (): void => {
    if (!open) return;
    void dm.sessionLog.delete(open.id).then(() => {
      setOpenId(null);
      reload();
    });
  };

  if (sessions !== null && sessions.length === 0) return <></>;

  return (
    <div className="session__archive">
      <div className="dfo-overline">Sessões anteriores</div>

      {sessions?.map((session) => (
        <Card key={session.id} onTap={() => openSession(session)}>
          <div className="session__archive-head">
            <span className="dfo-headline">{formatDay(session.endedAt)}</span>
            <span className="dfo-caption">{formatSpan(session)}</span>
          </div>
          <div className="dfo-caption">
            {session.characters.map((character) => character.name).join(', ')}
          </div>
          {session.notes.trim().length > 0 && (
            <div className="session__archive-note dfo-caption">{session.notes}</div>
          )}
        </Card>
      ))}

      <BottomSheet
        open={open !== null}
        onClose={close}
        title={open ? formatDay(open.endedAt) : undefined}
        maxHeight={0.9}
      >
        {open && (
          <div className="session__archive-detail">
            <div className="dfo-caption">{formatSpan(open)}</div>

            {open.characters.length === 0 && (
              <EmptyState
                title="Sem fichas"
                description="Esta sessão foi gravada sem nenhum personagem legível."
              />
            )}

            {open.characters.map((character) => (
              <Card key={`${character.playerName}-${character.name}`}>
                <div className="session__archive-head">
                  <span className="dfo-headline">{character.name}</span>
                  <span className="dfo-caption">{character.playerName}</span>
                </div>
                <div className="dfo-caption">{character.classes}</div>
                <div className="combatant-row__meta">
                  <span className="dfo-caption">
                    PV {character.hitPoints.current}/{character.hitPoints.max}
                    {character.hitPoints.temporary > 0 ? ` (+${character.hitPoints.temporary})` : ''}
                  </span>
                  <span className="dfo-caption">{spellSlotSummary(character)}</span>
                </div>
                {character.conditions.length > 0 && (
                  <div className="combatant-row__conditions">
                    {character.conditions.map((condition) => (
                      <Chip key={condition} tone="danger">
                        {CONDITION_DEFINITIONS[condition].label}
                      </Chip>
                    ))}
                  </div>
                )}
              </Card>
            ))}

            <Field label="O que aconteceu">
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={6}
                className="session__archive-notes"
                placeholder="O grupo fugiu do templo sem a relíquia. O sacerdote sabe os nomes deles."
              />
            </Field>

            <Button variant="primary" full onTap={close}>
              Salvar e fechar
            </Button>
            <Button variant="ghost" full onTap={remove}>
              Apagar esta sessão
            </Button>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

/** "19:30 às 23:45 · 4h15" — quanto tempo a mesa durou, em linguagem de mesa. */
function formatSpan(session: ArchivedSession): string {
  const start = new Date(session.startedAt);
  const end = new Date(session.endedAt);
  const time = (date: Date): string =>
    date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const length = hours > 0 ? `${hours}h${String(rest).padStart(2, '0')}` : `${rest}min`;

  return `${time(start)} às ${time(end)} · ${length}`;
}

/**
 * Espaços de magia gastos, por nível — o que o jogador ainda não recuperou.
 * Quem não lança magia não ganha linha nenhuma.
 */
function spellSlotSummary(character: ArchivedCharacter): string {
  const spent = character.slotsUsed
    .map((count, index) => (count > 0 ? `${count} de ${index + 1}º` : null))
    .filter((entry): entry is string => entry !== null);

  if (character.pactSlotsUsed > 0) spent.push(`${character.pactSlotsUsed} de pacto`);
  if (spent.length === 0) return 'Nenhum espaço de magia gasto';
  return `Espaços gastos: ${spent.join(', ')}`;
}
