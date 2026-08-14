import { useEffect, useState } from 'react';
import type { SessionNote } from '@dfo/core';
import { Button, Card, EmptyState } from '@dfo/ui';
import { useDmApi } from '../db/useDmApi.js';

export function NotesListScreen({ onOpen }: { onOpen: (noteId: string) => void }): JSX.Element {
  const dm = useDmApi();
  const [notes, setNotes] = useState<SessionNote[] | null>(null);
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const refresh = (): void => {
    void dm.notes.list().then(setNotes);
    void dm.settings.getVaultPath().then(setVaultPath);
  };

  useEffect(refresh, [dm]);

  const create = async (): Promise<void> => {
    const note = await dm.notes.create({ title: 'Nova nota' });
    onOpen(note.id);
  };

  const chooseVault = async (): Promise<void> => {
    setApplying(true);
    try {
      await dm.settings.chooseVaultFolder();
      refresh();
    } finally {
      setApplying(false);
    }
  };

  const clearVault = async (): Promise<void> => {
    setApplying(true);
    try {
      await dm.settings.clearVaultPath();
      refresh();
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="notes-list">
      <Card className="notes-list__vault">
        {applying ? (
          <p className="dfo-caption">Aplicando…</p>
        ) : vaultPath ? (
          <>
            <p className="dfo-caption">
              Sincronizando com <code>{vaultPath}/Boo &amp; Dice</code>
            </p>
            <Button variant="ghost" onTap={() => void clearVault()}>
              Usar armazenamento local
            </Button>
          </>
        ) : (
          <>
            <p className="dfo-caption">
              As notas ficam só neste app. Aponte para a pasta de um vault do Obsidian pra ler e
              escrever os arquivos <code>.md</code> direto nele.
            </p>
            <Button variant="ghost" onTap={() => void chooseVault()}>
              Escolher pasta do vault
            </Button>
          </>
        )}
      </Card>

      <div className="notes-list__new">
        <Button variant="primary" full onTap={() => void create()}>
          Nova nota
        </Button>
      </div>

      {notes?.length === 0 && (
        <EmptyState title="Nenhuma nota" description="Anote ganchos, segredos e o que a mesa esqueceu de fazer." />
      )}

      <div className="notes-list__items">
        {notes?.map((note) => (
          <Card key={note.id} onTap={() => onOpen(note.id)}>
            <div className="dfo-headline">{note.title || 'Sem título'}</div>
            {note.body && <p className="dfo-caption notes-list__preview">{preview(note.body)}</p>}
          </Card>
        ))}
      </div>
    </div>
  );
}

function preview(body: string): string {
  const oneLine = body.replace(/\s+/g, ' ').trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine;
}
