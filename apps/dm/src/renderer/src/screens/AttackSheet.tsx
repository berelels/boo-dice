import { useEffect, useState } from 'react';
import {
  deriveCharacter,
  parseMonsterActions,
  roll,
  rollD20,
  type Character,
  type MonsterAction,
  type SearchHit,
} from '@dfo/core';
import { BottomSheet, Button, Card, Chip, EmptyState, Field, SegmentedControl, Tappable } from '@dfo/ui';
import { useDmApi } from '../db/useDmApi.js';

type Mode = 'search' | 'manual';

interface RolledAttack {
  readonly attackBonus: number;
  readonly d20: number;
  readonly hitRoll: number;
  readonly critical: boolean;
  readonly hit: boolean;
  readonly damage: number;
}

/**
 * Ataque de monstro contra um personagem conectado — busca no bestiário
 * (com bônus de acerto e dado de dano já preenchidos, extraídos de
 * `catalog.data.actions` do SRD) ou entrada manual, rola contra a CA atual
 * do alvo, e só depois de conferir o resultado o mestre confirma o envio.
 * O jogador nunca vê um número sem o mestre ter mandado de propósito.
 */
export function AttackSheet({
  character,
  onClose,
}: {
  character: Character | null;
  onClose: () => void;
}): JSX.Element {
  const dm = useDmApi();
  const [mode, setMode] = useState<Mode>('search');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [monsterName, setMonsterName] = useState<string | null>(null);
  const [actions, setActions] = useState<MonsterAction[]>([]);
  const [selectedAction, setSelectedAction] = useState<MonsterAction | null>(null);

  const [manualName, setManualName] = useState('Ataque manual');
  const [manualBonus, setManualBonus] = useState(4);
  const [manualDamage, setManualDamage] = useState('1d6+2');

  const [rolled, setRolled] = useState<RolledAttack | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const reset = (): void => {
    setQuery('');
    setHits([]);
    setMonsterName(null);
    setActions([]);
    setSelectedAction(null);
    setRolled(null);
    setSent(false);
  };

  useEffect(() => {
    if (!character) reset();
  }, [character]);

  useEffect(() => {
    if (query.trim().length === 0) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void dm.library.search(query, { limit: 20, kinds: ['monster'] }).then((results) => {
        if (!cancelled) setHits(results);
      });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, dm]);

  const pickMonster = async (hit: SearchHit): Promise<void> => {
    const entry = await dm.library.get(hit.id);
    const parsed = parseMonsterActions(entry?.data ?? null);
    setMonsterName(hit.title);
    setActions(parsed);
    setSelectedAction(parsed[0] ?? null);
    setRolled(null);
  };

  const source = mode === 'search' ? (monsterName ?? '') : manualName.trim() || 'Ataque manual';
  const attackBonus = mode === 'search' ? (selectedAction?.attackBonus ?? null) : manualBonus;
  const damageDice = mode === 'search' ? (selectedAction?.damageDice ?? null) : manualDamage.trim();
  const canRoll = attackBonus !== null && !!damageDice && !!character;

  const rollAttack = (): void => {
    if (!character || attackBonus === null || !damageDice) return;
    const targetAc = deriveCharacter(character).armorClass.total;
    const d20 = rollD20({ modifier: attackBonus });
    const critical = d20.critical === 'success';
    const hit = critical || (d20.critical !== 'failure' && d20.total >= targetAc);
    const damage = hit ? roll(damageDice, { critical }).total : 0;

    setRolled({ attackBonus, d20: d20.natural, hitRoll: d20.total, critical, hit, damage });
    setSent(false);
  };

  const send = async (): Promise<void> => {
    if (!character || !rolled) return;
    setSending(true);
    try {
      await dm.session.attack(character.id, {
        source,
        hit: rolled.hit,
        damage: rolled.damage,
        conditions: [],
      });
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  const targetAc = character ? deriveCharacter(character).armorClass.total : null;

  return (
    <BottomSheet open={character !== null} onClose={onClose} title={character ? `Atacar ${character.name}` : undefined}>
      {character && (
        <div className="attack-sheet">
          <p className="dfo-caption">CA de {character.name}: {targetAc}</p>

          <SegmentedControl
            value={mode}
            onChange={(next) => {
              setMode(next);
              setRolled(null);
            }}
            options={[
              { value: 'search', label: 'Bestiário' },
              { value: 'manual', label: 'Manual' },
            ]}
          />

          {mode === 'search' ? (
            <>
              <input
                type="search"
                className="dfo-input"
                value={query}
                placeholder="Goblin, lobo, esqueleto…"
                autoComplete="off"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setMonsterName(null);
                  setActions([]);
                  setSelectedAction(null);
                  setRolled(null);
                }}
              />

              {monsterName === null && hits.length > 0 && (
                <div className="attack-sheet__hits">
                  {hits.map((hit) => (
                    <Card key={hit.id} onTap={() => void pickMonster(hit)}>
                      <span className="dfo-body">{hit.title}</span>
                    </Card>
                  ))}
                </div>
              )}

              {monsterName !== null && actions.length === 0 && (
                <EmptyState
                  title="Sem ataque cadastrado"
                  description={`${monsterName} não tem bônus de acerto e dado de dano no bestiário — use o modo manual.`}
                />
              )}

              {monsterName !== null && actions.length > 0 && (
                <div className="attack-sheet__actions">
                  {actions.map((action) => (
                    <Tappable
                      as="div"
                      key={action.name}
                      className={`chip-button${selectedAction?.name === action.name ? ' is-active' : ''}`}
                      onTap={() => {
                        setSelectedAction(action);
                        setRolled(null);
                      }}
                    >
                      {action.name} (+{action.attackBonus}, {action.damageDice})
                    </Tappable>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <Field label="Nome">
                <input
                  type="text"
                  value={manualName}
                  onChange={(event) => {
                    setManualName(event.target.value);
                    setRolled(null);
                  }}
                  autoComplete="off"
                />
              </Field>
              <div className="attack-sheet__row">
                <Field label="Bônus de acerto">
                  <input
                    type="number"
                    inputMode="numeric"
                    value={manualBonus}
                    onChange={(event) => {
                      setManualBonus(Number(event.target.value) || 0);
                      setRolled(null);
                    }}
                  />
                </Field>
                <Field label="Dado de dano">
                  <input
                    type="text"
                    value={manualDamage}
                    placeholder="1d6+2"
                    onChange={(event) => {
                      setManualDamage(event.target.value);
                      setRolled(null);
                    }}
                    autoComplete="off"
                  />
                </Field>
              </div>
            </>
          )}

          <Button variant="secondary" full disabled={!canRoll} onTap={rollAttack}>
            Rolar ataque
          </Button>

          {rolled && (
            <Card className="attack-sheet__result">
              <div className="dfo-headline">
                {rolled.critical ? 'Crítico!' : rolled.hit ? 'Acertou' : 'Errou'} (d20 {rolled.d20}
                {rolled.attackBonus >= 0 ? '+' : ''}
                {rolled.attackBonus} = {rolled.hitRoll})
              </div>
              {rolled.hit && <div className="dfo-body">{rolled.damage} de dano</div>}
              <Button variant="primary" full disabled={sending || sent} onTap={() => void send()}>
                {sent ? 'Enviado' : sending ? 'Enviando…' : 'Enviar pro jogador'}
              </Button>
              {sent && <Chip tone="success">O jogador já recebeu.</Chip>}
            </Card>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
