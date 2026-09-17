import { useEffect, useState } from 'react';
import {
  CONDITIONS,
  CONDITION_DEFINITIONS,
  deriveCharacter,
  parseMonsterActions,
  roll,
  rollD20,
  type Character,
  type ConditionId,
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
 * Ataques já definidos de antemão — vindos de um combatente do rastreador de
 * Iniciativa, pulam a busca/entrada manual. São vários porque um monstro
 * raramente tem um ataque só: o mestre escolhe qual usar neste turno.
 */
export interface PresetAttack {
  readonly source: string;
  readonly actions: readonly MonsterAction[];
}

/**
 * Ataque de monstro contra um personagem conectado — busca no bestiário
 * (com bônus de acerto e dado de dano já preenchidos, extraídos de
 * `catalog.data.actions` do SRD) ou entrada manual, rola contra a CA atual
 * do alvo, e só depois de conferir o resultado o mestre confirma o envio.
 * O jogador nunca vê um número sem o mestre ter mandado de propósito.
 *
 * Com `presetAttack` (chamado a partir de um combatente monstro já
 * cadastrado no rastreador de Iniciativa), pula direto pra rolagem — o
 * ataque já foi escolhido antes, não precisa buscar de novo.
 */
export function AttackSheet({
  character,
  presetAttack,
  onClose,
}: {
  character: Character | null;
  presetAttack?: PresetAttack;
  onClose: () => void;
}): JSX.Element {
  const dm = useDmApi();
  const [mode, setMode] = useState<Mode>('search');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [monsterName, setMonsterName] = useState<string | null>(null);
  const [searchActions, setSearchActions] = useState<MonsterAction[]>([]);
  // Guarda o *nome* do ataque escolhido, e não o objeto: a lista pode vir das
  // props (rastreador) ou da busca, e casar por nome evita espelhar prop em
  // estado — que é onde nascem os laços de re-render.
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [conditions, setConditions] = useState<ConditionId[]>([]);

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
    setSearchActions([]);
    setSelectedName(null);
    setConditions([]);
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
    setSearchActions(parsed);
    setSelectedName(parsed[0]?.name ?? null);
    setRolled(null);
  };

  const toggleCondition = (id: ConditionId): void =>
    setConditions((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );

  // Os dois caminhos (rastreador e bestiário) terminam numa lista de ataques
  // pra escolher; só a entrada manual foge disso.
  const actions = presetAttack ? presetAttack.actions : searchActions;
  const selectedAction = actions.find((action) => action.name === selectedName) ?? actions[0] ?? null;
  const fromList = presetAttack !== undefined || mode === 'search';

  // Com mais de um ataque, o jogador merece saber qual acertou nele — "Dragão
  // vermelho jovem (Mordida)" diz muito mais que só o nome do bicho.
  const withAction = (base: string): string =>
    selectedAction && actions.length > 1 ? `${base} (${selectedAction.name})` : base;

  const source = presetAttack
    ? withAction(presetAttack.source)
    : mode === 'search'
      ? withAction(monsterName ?? '')
      : manualName.trim() || 'Ataque manual';
  const attackBonus = fromList ? (selectedAction?.attackBonus ?? null) : manualBonus;
  const damageDice = fromList ? (selectedAction?.damageDice ?? null) : manualDamage.trim();
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
        // Ataque que errou não aplica condição — quem erra não envenena ninguém.
        conditions: rolled.hit ? conditions : [],
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

          {!presetAttack && (
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
          )}

          {!presetAttack && mode === 'search' && (
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
                  setSearchActions([]);
                  setSelectedName(null);
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

              {monsterName !== null && searchActions.length === 0 && (
                <EmptyState
                  title="Sem ataque cadastrado"
                  description={`${monsterName} não tem bônus de acerto e dado de dano no bestiário — use o modo manual.`}
                />
              )}
            </>
          )}

          {!presetAttack && mode === 'manual' && (
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

          {/* Escolha do ataque — igual venha do rastreador ou da busca. */}
          {actions.length > 0 && (
            <Field label={actions.length > 1 ? 'Qual ataque' : 'Ataque'}>
              <div className="attack-sheet__actions">
                {actions.map((action) => (
                  <Tappable
                    as="div"
                    key={action.name}
                    className={`chip-button${selectedAction?.name === action.name ? ' is-active' : ''}`}
                    onTap={() => {
                      setSelectedName(action.name);
                      setRolled(null);
                    }}
                  >
                    {action.name} (+{action.attackBonus}, {action.damageDice})
                  </Tappable>
                ))}
              </div>
            </Field>
          )}

          <Field label="Condições ao acertar (opcional)">
            <div className="attack-sheet__conditions">
              {CONDITIONS.map((id) => (
                <Chip
                  key={id}
                  tone={conditions.includes(id) ? 'danger' : 'neutral'}
                  onTap={() => toggleCondition(id)}
                >
                  {CONDITION_DEFINITIONS[id].label}
                </Chip>
              ))}
            </div>
          </Field>

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
              {rolled.hit && conditions.length > 0 && (
                <div className="dfo-caption">
                  Aplica: {conditions.map((id) => CONDITION_DEFINITIONS[id].label).join(', ')}
                </div>
              )}
              {!rolled.hit && conditions.length > 0 && (
                <div className="dfo-caption">Errou — nenhuma condição será aplicada.</div>
              )}
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
