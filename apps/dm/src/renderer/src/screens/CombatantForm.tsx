import { useState } from 'react';
import {
  CONDITIONS,
  CONDITION_DEFINITIONS,
  type Combatant,
  type CombatantKind,
  type CombatantPatch,
  type ConditionId,
  type NewCombatantInput,
} from '@dfo/core';
import { Button, Chip, Field, SegmentedControl } from '@dfo/ui';

const KIND_OPTIONS: readonly { readonly value: CombatantKind; readonly label: string }[] = [
  { value: 'pc', label: 'Jogador' },
  { value: 'npc', label: 'NPC' },
  { value: 'monster', label: 'Monstro' },
];

/**
 * Um formulário, dois modos. `existing === null` é "adicionar combatente"
 * (nome, tipo, iniciativa, PV máximo). Com `existing`, vira o cartão de
 * edição: dano e cura aplicam na hora (é o botão que o mestre mais usa, em
 * combate), o resto (nome, iniciativa, CA, notas, condições) junta num só
 * "Salvar" — não há por que interromper o jogo pra cada campo.
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

  const toggleCondition = (id: ConditionId): void => {
    setConditions((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  const parsedArmorClass = armorClass.trim() === '' ? null : Number(armorClass);

  if (!existing) {
    return (
      <div className="combatant-form">
        <Field label="Nome">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Goblin batedor"
            autoComplete="off"
          />
        </Field>

        <Field label="Tipo">
          <SegmentedControl value={kind} onChange={setKind} options={KIND_OPTIONS} />
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
