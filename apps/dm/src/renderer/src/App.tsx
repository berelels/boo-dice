import { useState } from 'react';
import { Screen, TopBar, SegmentedControl } from '@dfo/ui';
import { GlossaryScreen } from './screens/Glossary.js';
import { EncounterListScreen } from './screens/EncounterList.js';
import { EncounterScreen } from './screens/Encounter.js';
import { NotesListScreen } from './screens/NotesList.js';
import { NoteScreen } from './screens/Note.js';
import { SessionScreen } from './screens/Session.js';

type Tab = 'bestiary' | 'encounters' | 'notes' | 'session';

const TABS: readonly { readonly value: Tab; readonly label: string }[] = [
  { value: 'bestiary', label: 'Bestiário' },
  { value: 'encounters', label: 'Iniciativa' },
  { value: 'notes', label: 'Notas' },
  { value: 'session', label: 'Sessão' },
];

/**
 * Três ferramentas, uma janela só — sem pilha de navegação como o app do
 * jogador tem. Uma mesa de RPG não navega "pra dentro" de nada: o mestre
 * alterna entre o bestiário, o combate e as notas o tempo todo, no meio da
 * mesma cena.
 */
export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('session');
  // Pilha de dois níveis só dentro da aba de iniciativa: lista de encontros,
  // ou um encontro aberto. Não é o modelo de navegação do app do jogador —
  // aqui é só uma tela indo e voltando, não vale a pena por uma pilha de verdade.
  const [openEncounterId, setOpenEncounterId] = useState<string | null>(null);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);

  return (
    <Screen>
      <TopBar title="Boo & Dice" subtitle="Mestre" />
      <div className="dm-tabs">
        <SegmentedControl value={tab} onChange={setTab} options={TABS} />
      </div>

      {tab === 'bestiary' && <GlossaryScreen />}
      {tab === 'encounters' &&
        (openEncounterId ? (
          <EncounterScreen encounterId={openEncounterId} onBack={() => setOpenEncounterId(null)} />
        ) : (
          <EncounterListScreen onOpen={setOpenEncounterId} />
        ))}
      {tab === 'notes' &&
        (openNoteId ? (
          <NoteScreen noteId={openNoteId} onBack={() => setOpenNoteId(null)} />
        ) : (
          <NotesListScreen onOpen={setOpenNoteId} />
        ))}
      {tab === 'session' && <SessionScreen />}
    </Screen>
  );
}
