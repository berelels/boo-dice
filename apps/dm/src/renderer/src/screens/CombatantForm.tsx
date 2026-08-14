import { useState } from 'react';
import {
  CONDITIONS,
  CONDITION_DEFINITIONS,
  parseMonsterActions,
  type Combatant,
  type CombatantKind,
  type CombatantPatch,
  type ConditionId,
  type MonsterAction,
  type NewCombatantInput,
  type SearchHit,
} from '@dfo/core';
import { Button, Card, Chip, Field, SegmentedControl } from '@dfo/ui';
import { useDmApi } from '../db/useDmApi.js';

const KIND_OPTIONS: readonly { readonly value: CombatantKind; readonly label: string }[] = [
  { value: 'pc', label: 'Jogador' },
  { value: 'npc', label: 'NPC' },
  { value: 'monster', label: 'Monstro' },
];

function numberField(data: unknown, key: string): number | null {
  if (typeof data !== 'object' || data === null) return null;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : null;
}

/**
 * Um formulário, dois modos. `existing === null` é "adicionar combatente"
 * (nome, tipo, iniciativa, PV máximo — e, pra monstro, um atalho pra
 * preencher tudo isso e o ataque a partir do bestiário). Com `existing`,
 * vira o cartão de edição: dano e cura aplicam na hora (é o botão que o
 * mestre mais usa, em combate), o resto (nome, iniciativa, CA, notas,
 * condições) junta num só "Salvar" — não há por que interromper o jogo pra
 * cada campo.
 */
export function CombatantForm({
  existing,
  onAdd,
  onSave,
  onRemove,
}: {
  existing: Combatant | null;
  onAdd: (input: NewCombatantInput) => void;
  onSave: (patch: CombatantPatch) => void;
  onRemove: () => void;
}): JSX.Element {
  const dm = useDmApi();
  const [name, setName] = useState(existing?.name ?? '');
  const [kind, setKind] = useState<CombatantKind>(existing?.kind ?? 'npc');
  const [initiative, setInitiative] = useState(existing?.initiative ?? 10);
  const [hpMax, setHpMax] = useState(existing?.hp.max ?? 10);
  const [armorClass, setArmorClass] = useState<string>(
    existing?.armorClass != null ? String(existing.armorClass) : '',
  );
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [conditions, setConditions] = useState<ConditionId[]>([...(existing?.conditions ?? [])]);
  const [amount, setAmount] = useState(0);

  // Só usados em modo "adicionar" + tipo Monstro — busca no bestiário pra
  // pré-preencher nome/PV/CA/ataque, em vez de digitar tudo às cegas.
  const [monsterQuery, setMonsterQuery] = useState('');
  const [monsterHits, setMonsterHits] = useState<SearchHit[]>([]);
  const [attackBonus, setAttackBonus] = useState<number | null>(null);
  const [damageDice, setDamageDice] = useState<string | null>(null);
  const [monsterActions, setMonsterActions] = useState<MonsterAction[]>([]);

  const searchMonsters = (value: string): void => {
    setMonsterQuery(value);
    if (value.trim().length === 0) {
      setMonsterHits([]);
      return;
    }
    void dm.library.search(value, { limit: 10, kinds: ['monster'] }).then(setMonsterHits);
  };

  const pickMonster = async (hit: SearchHit): Promise<void> => {
    const entry = await dm.library.get(hit.id);
    const parsedActions = parseMonsterActions(entry?.data ?? null);
    const firstAction = parsedActions[0] ?? null;

    setName(hit.title);
    setHpMax(numberField(entry?.data, 'hitPoints') ?? hpMax);
    setArmorClass(String(numberField(entry?.data, 'armorClass') ?? armorClass));
    setMonsterActions(parsedActions);
    setAttackBonus(firstAction?.attackBonus ?? null);
    setDamageDice(firstAction?.damageDice ?? null);
    setMonsterHits([]);
    setMonsterQuery(hit.title);
  };

  const toggleCondition = (id: ConditionId): void => {
    setConditions((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  const parsedArmorClass = armorClass.trim() === '' ? null : Number(armorClass);

  if (!existing) {
    return (
      <div className="combatant-form">
        <Field label="Tipo">
          <SegmentedControl value={kind} onChange={setKind} options={KIND_OPTIONS} />
        </Field>

        {kind === 'monster' && (
          <Field label="Escolher do bestiário (opcional)">
            <input
              type="search"
              className="dfo-input"
              value={monsterQuery}
              placeholder="Goblin, lobo, esqueleto…"
              autoComplete="off"
              onChange={(event) => searchMonsters(event.target.value)}
            />
            {monsterHits.length > 0 && (
              <div className="combatant-form__monster-hits">
                {monsterHits.map((hit) => (
                  <Card key={hit.id} onTap={() => void pickMonster(hit)}>
                    <span className="dfo-body">{hit.title}</span>
                  </Card>
                ))}
              </div>
            )}
            {monsterActions.length > 0 && (
              <p className="dfo-caption">
                Ataque: +{attackBonus} para acertar, {damageDice} de dano
                {monsterActions.length > 1 ? ` (${monsterActions[0]!.name}, entre ${monsterActions.length})` : ''}
              </p>
            )}
          </Field>
        )}

        <Field label="Nome">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Goblin batedor"
            autoComplete="off"
          />
        </Field>

        <div className="combatant-form__row">
          <Field label="Iniciativa">
            <input
              type="number"
              inputMode="numeric"
              value={initiative}
              onChange={(event) => setInitiative(Number(event.target.value) || 0)}
            />
          </Field>
          <Field label="PV máximo">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={hpMax}
              onChange={(event) => setHpMax(Math.max(0, Number(event.target.value) || 0))}
            />
          </Field>
          <Field label="CA">
            <input
              type="number"
              inputMode="numeric"
              value={armorClass}
              onChange={(event) => setArmorClass(event.target.value)}
              placeholder="—"
            />
          </Field>
        </div>

        <Button
          variant="primary"
          full
          onTap={() =>
            onAdd({
              name: name.trim() || 'Sem nome',
              kind,
              initiative,
              hpMax,
              armorClass: parsedArmorClass,
              attackBonus: kind === 'monster' ? attackBonus : null,
              damageDice: kind === 'monster' ? damageDice : null,
            })
          }
        >
          Adicionar
        </Button>
      </div>
    );
  }

  return (
    <div className="combatant-form">
      <div className="combatant-form__hp">
        <div className="dfo-caption">
          PV {existing.hp.current}/{existing.hp.max}
          {existing.hp.temporary > 0 ? ` (+${existing.hp.temporary} temp.)` : ''}
        </div>
        <input
          type="number"
          inputMode="numeric"
          className="combatant-form__amount"
          value={amount}
          onChange={(event) => setAmount(Number(event.target.value) || 0)}
          aria-label="Quantidade de dano ou cura"
        />
        <div className="combatant-form__hp-actions">
          <Button variant="danger" onTap={() => onSave({ damage: amount })}>
            Aplicar dano
          </Button>
          <Button variant="secondary" onTap={() => onSave({ heal: amount })}>
            Curar
          </Button>
        </div>
      </div>

      <Field label="Nome">
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="off"
        />
      </Field>

      <div className="combatant-form__row">
        <Field label="Iniciativa">
          <input
            type="number"
            inputMode="numeric"
            value={initiative}
            onChange={(event) => setInitiative(Number(event.target.value) || 0)}
          />
        </Field>
        <Field label="CA">
          <input
            type="number"
            inputMode="numeric"
            value={armorClass}
            onChange={(event) => setArmorClass(event.target.value)}
            placeholder="—"
          />
        </Field>
      </div>

      <Field label="Condições">
        <div className="combatant-form__conditions">
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

      <Field label="Notas">
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          className="combatant-form__notes"
        />
      </Field>

      <Button
        variant="primary"
        full
        onTap={() =>
          onSave({
            name,
            initiative,
            armorClass: parsedArmorClass,
            notes,
            conditions,
          })
        }
      >
        Salvar
      </Button>
      <Button variant="ghost" full onTap={onRemove}>
        Remover combatente
      </Button>
    </div>
  );
}
