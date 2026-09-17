import { useState } from 'react';
import {
  CONDITIONS,
  CONDITION_DEFINITIONS,
  roll,
  tryParseNotation,
  type Character,
  type ConditionId,
} from '@dfo/core';
import { BottomSheet, Button, Card, Chip, Field, Section, haptic } from '@dfo/ui';
import { useSession } from '../state/session.js';

/**
 * Ajudar um aliado da mesa: cura, PV temporários, tirar uma condição.
 *
 * Só aparece em sessão e só com mais alguém conectado — fora disso não há a
 * quem ajudar, e um botão morto na ficha só ocupa espaço.
 *
 * Não existe conexão direta entre aparelhos de jogador: isto sobe pro Mestre,
 * que repassa pro aparelho certo (ver `sync/protocol.ts`). Quem aplica é o
 * app do aliado, com as mesmas funções puras de regra — daqui sai a
 * *intenção*, nunca uma ficha alheia já alterada.
 */
export function AllySupport({ character }: { character: Character }): JSX.Element | null {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [healing, setHealing] = useState('');
  const [temporaryHp, setTemporaryHp] = useState('');
  const [notation, setNotation] = useState('');
  const [conditions, setConditions] = useState<ConditionId[]>([]);
  const [sentTo, setSentTo] = useState<string | null>(null);

  // O próprio personagem aberto sai da lista. Os outros deste mesmo aparelho
  // ficam: quem joga com dois personagens pode curar um com o outro.
  const allies = session.party.filter((member) => member.characterId !== character.id);
  if (session.status !== 'connected' || allies.length === 0) return null;

  const target = allies.find((member) => member.characterId === targetId) ?? allies[0] ?? null;
  const parsedNotation = notation.trim() === '' ? null : tryParseNotation(notation);

  const rollHealing = (): void => {
    if (!parsedNotation?.ok) return;
    const result = roll(parsedNotation.parsed);
    haptic('light');
    setHealing(String(Math.max(0, result.total)));
  };

  const toggleCondition = (id: ConditionId): void => {
    setConditions((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  const amount = (text: string): number => Math.max(0, Math.trunc(Number(text) || 0));
  const nothingToSend =
    amount(healing) === 0 && amount(temporaryHp) === 0 && conditions.length === 0;

  const close = (): void => {
    setOpen(false);
    setLabel('');
    setHealing('');
    setTemporaryHp('');
    setNotation('');
    setConditions([]);
  };

  const send = (): void => {
    if (!target || nothingToSend) return;
    session.sendSupport({
      fromCharacterId: character.id,
      targetCharacterId: target.characterId,
      label: label.trim() === '' ? 'Ajuda' : label.trim(),
      effect: {
        healing: amount(healing),
        temporaryHp: amount(temporaryHp),
        conditionsRemoved: conditions,
      },
    });
    haptic('success');
    setSentTo(target.characterName);
    close();
  };

  return (
    <Section title="Ajudar aliado">
      <Card>
        <div className="dfo-caption">
          {allies.length === 1
            ? `${allies[0]!.characterName} está na sessão com você.`
            : `${allies.length} aliados na sessão com você.`}
        </div>
        {sentTo && <div className="ally-support__sent dfo-caption">Enviado pra {sentTo}.</div>}
        <Button
          variant="secondary"
          full
          onTap={() => {
            setSentTo(null);
            setTargetId(allies[0]?.characterId ?? null);
            setOpen(true);
          }}
        >
          Ajudar alguém
        </Button>
      </Card>

      <BottomSheet open={open} onClose={close} title="Ajudar aliado" maxHeight={0.9}>
        <div className="ally-support">
          <Field label="Quem">
            <div className="ally-support__targets">
              {allies.map((member) => (
                <Chip
                  key={member.characterId}
                  tone={member.characterId === target?.characterId ? 'accent' : 'neutral'}
                  onTap={() => setTargetId(member.characterId)}
                >
                  {member.characterName}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="O que você usou" hint="Aparece no aviso que chega pra ele.">
            <input
              type="text"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Palavra Curativa"
              autoComplete="off"
            />
          </Field>

          <div className="ally-support__row">
            <Field label="Cura">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={healing}
                onChange={(event) => setHealing(event.target.value)}
                placeholder="0"
              />
            </Field>
            <Field label="PV temporários">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={temporaryHp}
                onChange={(event) => setTemporaryHp(event.target.value)}
                placeholder="0"
              />
            </Field>
          </div>

          <Field label="Rolar a cura" hint="Opcional — o resultado cai no campo de cura.">
            <div className="ally-support__roll">
              <input
                type="text"
                value={notation}
                onChange={(event) => setNotation(event.target.value)}
                placeholder="1d4+3"
                autoComplete="off"
                spellCheck={false}
              />
              <Button variant="secondary" disabled={!parsedNotation?.ok} onTap={rollHealing}>
                Rolar
              </Button>
            </div>
          </Field>

          <Field label="Tirar condição (opcional)">
            <div className="ally-support__conditions">
              {CONDITIONS.map((id) => (
                <Chip
                  key={id}
                  tone={conditions.includes(id) ? 'success' : 'neutral'}
                  onTap={() => toggleCondition(id)}
                >
                  {CONDITION_DEFINITIONS[id].label}
                </Chip>
              ))}
            </div>
          </Field>

          <Button variant="primary" full disabled={nothingToSend} onTap={send}>
            {target ? `Enviar pra ${target.characterName}` : 'Enviar'}
          </Button>
        </div>
      </BottomSheet>
    </Section>
  );
}
