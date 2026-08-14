import { useEffect, useState } from 'react';
import type { SessionNote } from '@dfo/core';
import { Button, Field, Tappable } from '@dfo/ui';
import { useDmApi } from '../db/useDmApi.js';

export function NoteScreen({
  noteId,
  onBack,
}: {
  noteId: string;
  onBack: () => void;
}): JSX.Element {
  const dm = useDmApi();
  const [note, setNote] = useState<SessionNote | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void dm.notes.get(noteId).then((loaded) => {
      setNote(loaded);
      setTitle(loaded?.title ?? '');
      setBody(loaded?.body ?? '');
    });
  }, [dm, noteId]);

  if (!note) return <></>;

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await dm.notes.update(noteId, { title, body });
      onBack();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    await dm.notes.delete(noteId);
    onBack();
  };

  return (
    <div className="note-editor">
      <div className="note-editor__header">
        <Tappable onTap={onBack} className="icon-button" ariaLabel="Voltar às notas">
          <span aria-hidden="true">←</span>
        </Tappable>
      </div>

      <Field label="Título">
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Gancho, segredo, lembrete…"
          autoComplete="off"
        />
      </Field>

      <Field label="Nota">
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={12}
          className="note-editor__body"
          placeholder="O barão sumiu com o mapa…"
        />
      </Field>

      <Button variant="primary" full disabled={saving} onTap={() => void save()}>
        Salvar
      </Button>
      <Button variant="ghost" full onTap={() => void remove()}>
        Excluir nota
      </Button>
    </div>
  );
}
