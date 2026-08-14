import { useEffect, useState } from 'react';
import { sortByInitiative, type Combatant, type EncounterWithCombatants } from '@dfo/core';
import { BottomSheet, Button, Card, Chip, EmptyState, Tappable } from '@dfo/ui';
import { useDmApi } from '../db/useDmApi.js';
import { CombatantForm } from './CombatantForm.js';

const KIND_LABELS = { pc: 'Jogador', npc: 'NPC', monster: 'Monstro' } as const;

export function EncounterScreen({
  encounterId,
  onBack,
}: {
  encounterId: string;
  onBack: () => void;
}): JSX.Element {
  const dm = useDmApi();
  const [encounter, setEncounter] = useState<EncounterWithCombatants | null>(null);
  const [formTarget, setFormTarget] = useState<'new' | Combatant | null>(null);

  const reload = (): void => {
    void dm.encounters.get(encounterId).then(setEncounter);
  };

  useEffect(reload, [dm, encounterId]);

  if (!encounter) return <></>;

  const advance = async (direction: 'next' | 'previous'): Promise<void> => {
    await dm.turn.advance(encounterId, direction);
    reload();
  };

  const sortNow = async (): Promise<void> => {
    const orderedIds = sortByInitiative(encounter.combatants).map((combatant) => combatant.id);
    await dm.combatants.reorder(encounterId, orderedIds);
    reload();
  };

  const closeForm = (): void => setFormTarget(null);

  return (
    <div className="encounter">
      <div className="encounter__header">
        <Tappable onTap={onBack} className="icon-button" ariaLabel="Voltar aos encontros">
          <span aria-hidden="true">←</span>
        </Tappable>
        <div>
          <div className="dfo-headline">{encounter.name}</div>
          <div className="dfo-caption">Rodada {encounter.round}</div>
        </div>
      </div>

      <div className="encounter__actions">
        <Button variant="secondary" onTap={() => void advance('previous')}>
          ◂ Anterior
        </Button>
        <Button variant="primary" onTap={() => void advance('next')}>
          Próximo ▸
        </Button>
        <Button variant="ghost" onTap={() => void sortNow()}>
          Ordenar por iniciativa
        </Button>
      </div>

      {encounter.combatants.length === 0 && (
        <EmptyState
          title="Nenhum combatente"
          description="Adicione os personagens e monstros que estão nesta cena."
        />
      )}

      <div className="encounter__list">
        {encounter.combatants.map((combatant) => (
          <Card
            key={combatant.id}
            onTap={() => setFormTarget(combatant)}
            className={
              combatant.id === encounter.currentCombatantId ? 'encounter__combatant--current' : ''
            }
          >
            <div className="combatant-row__head">
              <span className="dfo-headline">{combatant.name}</span>
              <span className="dfo-numeric">{combatant.initiative}</span>
            </div>
            <div className="combatant-row__meta">
              <Chip tone="neutral">{KIND_LABELS[combatant.kind]}</Chip>
              <span className="dfo-caption">
                PV {combatant.hp.current}/{combatant.hp.max}
                {combatant.hp.temporary > 0 ? ` (+${combatant.hp.temporary})` : ''}
              </span>
              {combatant.armorClass !== null && (
                <span className="dfo-caption">CA {combatant.armorClass}</span>
              )}
            </div>
            {combatant.conditions.length > 0 && (
              <div className="combatant-row__conditions">
                {combatant.conditions.map((condition) => (
                  <Chip key={condition} tone="danger">
                    {condition}
                  </Chip>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>

      <div className="encounter__add">
        <Button variant="secondary" full onTap={() => setFormTarget('new')}>
          Adicionar combatente
        </Button>
      </div>

      <BottomSheet
        open={formTarget !== null}
        onClose={closeForm}
        title={formTarget === 'new' ? 'Adicionar combatente' : formTarget?.name}
        maxHeight={0.9}
      >
        {formTarget && (
          <CombatantForm
            existing={formTarget === 'new' ? null : formTarget}
            onAdd={(input) => {
              void dm.combatants.add(encounterId, input).then(() => {
                closeForm();
                reload();
              });
            }}
            onSave={(patch) => {
              if (formTarget === 'new') return;
              void dm.combatants.update(formTarget.id, patch).then(() => {
                closeForm();
                reload();
              });
            }}
            onRemove={() => {
              if (formTarget === 'new') return;
              void dm.combatants.remove(formTarget.id).then(() => {
                closeForm();
                reload();
              });
            }}
          />
        )}
      </BottomSheet>
    </div>
  );
}
