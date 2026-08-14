import { useEffect, useState } from 'react';
import type { Encounter } from '@dfo/core';
import { Button, Card, EmptyState } from '@dfo/ui';
import { useDmApi } from '../db/useDmApi.js';

export function EncounterListScreen({ onOpen }: { onOpen: (encounterId: string) => void }): JSX.Element {
  const dm = useDmApi();
  const [encounters, setEncounters] = useState<Encounter[] | null>(null);

  useEffect(() => {
    void dm.encounters.list().then(setEncounters);
  }, [dm]);

  const create = async (): Promise<void> => {
    const encounter = await dm.encounters.create('Novo encontro');
    onOpen(encounter.id);
  };

  return (
    <div className="encounter-list">
      <div className="encounter-list__new">
        <Button variant="primary" full onTap={() => void create()}>
          Novo encontro
        </Button>
      </div>

      {encounters?.length === 0 && (
        <EmptyState
          title="Nenhum encontro"
          description="Crie um encontro para rastrear a iniciativa do próximo combate."
        />
      )}

      <div className="encounter-list__items">
        {encounters?.map((encounter) => (
          <Card key={encounter.id} onTap={() => onOpen(encounter.id)}>
            <div className="dfo-headline">{encounter.name}</div>
            <div className="dfo-caption">Rodada {encounter.round}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
