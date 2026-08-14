import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { SPRING_DEFAULT } from '@dfo/ui';
import { AppDataProvider } from './db/provider.js';
import { RollProvider } from './state/rolling.js';
import { SessionProvider } from './state/session.js';
import { AttackBanner } from './components/AttackBanner.js';
import { GalleryScreen } from './screens/Gallery.js';
import { CreateScreen } from './screens/Create.js';
import { SheetScreen } from './screens/Sheet.js';
import { GlossaryScreen } from './screens/Glossary.js';
import { JoinSessionScreen } from './screens/JoinSession.js';
import { SettingsScreen } from './screens/Settings.js';

/**
 * Navegação.
 *
 * Uma pilha de telas em estado, sem biblioteca de rotas: são cinco telas, e a
 * transição entre elas é parte do design (entra pela direita, sai pela direita)
 * — algo que um roteador genérico atrapalharia mais do que ajudaria.
 */

export type Route =
  | { readonly name: 'gallery' }
  | { readonly name: 'create' }
  | { readonly name: 'sheet'; readonly characterId: string }
  | { readonly name: 'glossary' }
  | { readonly name: 'joinSession' }
  | { readonly name: 'settings' };

export function App(): JSX.Element {
  const [stack, setStack] = useState<Route[]>([{ name: 'gallery' }]);
  const current = stack.at(-1)!;
  // Incrementado a cada exclusão de personagem — entra na key da Galeria para
  // garantir uma montagem nova (e portanto uma releitura da lista) mesmo que,
  // por algum motivo, a tela não tivesse remontado sozinha ao voltar.
  const [galleryGeneration, setGalleryGeneration] = useState(0);

  const push = useCallback((route: Route) => setStack((routes) => [...routes, route]), []);
  const pop = useCallback(
    () => setStack((routes) => (routes.length > 1 ? routes.slice(0, -1) : routes)),
    [],
  );
  const reset = useCallback((route: Route) => setStack([route]), []);

  return (
    <AppDataProvider>
      <SessionProvider>
        <RollProvider characterId={current.name === 'sheet' ? current.characterId : null}>
          <AttackBanner />
          {/*
            `mode="popLayout"` mantém a tela que sai no fluxo até terminar de
            animar — sem isso a saída "pula" para o topo no meio da transição.
          */}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={routeKey(current, galleryGeneration)}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              // `pointerEvents: 'none'` entra na hora, sem esperar o resto da
              // animação — a tela que está saindo fica sobreposta à que está
              // entrando por uma fração de segundo (é o que dá a sensação de
              // transição), e se o quadro travar (aba em segundo plano, thread
              // principal ocupada) essa sobreposição pode durar bem mais que
              // isso. Sem esta linha, os botões da tela velha continuam
              // tocáveis embaixo da nova — e é assim que um toque no tema podia
              // abrir o glossário: acertava um botão de uma tela que já devia
              // ter sumido.
              exit={{ opacity: 0, x: -24, pointerEvents: 'none' }}
              transition={SPRING_DEFAULT}
            >
              {current.name === 'gallery' && (
                <GalleryScreen
                  onCreate={() => push({ name: 'create' })}
                  onOpen={(characterId) => push({ name: 'sheet', characterId })}
                  onGlossary={() => push({ name: 'glossary' })}
                  onJoinSession={() => push({ name: 'joinSession' })}
                  onSettings={() => push({ name: 'settings' })}
                />
              )}
              {current.name === 'create' && (
                <CreateScreen
                  onCancel={pop}
                  onCreated={(characterId) => reset({ name: 'sheet', characterId })}
                />
              )}
              {current.name === 'sheet' && (
                <SheetScreen
                  characterId={current.characterId}
                  onBack={() => reset({ name: 'gallery' })}
                  onDeleted={() => setGalleryGeneration((generation) => generation + 1)}
                  onGlossary={() => push({ name: 'glossary' })}
                />
              )}
              {current.name === 'glossary' && <GlossaryScreen onBack={pop} />}
              {current.name === 'joinSession' && <JoinSessionScreen onBack={pop} />}
              {current.name === 'settings' && <SettingsScreen onBack={pop} />}
            </motion.div>
          </AnimatePresence>
        </RollProvider>
      </SessionProvider>
    </AppDataProvider>
  );
}

function routeKey(route: Route, galleryGeneration: number): string {
  if (route.name === 'sheet') return `sheet:${route.characterId}`;
  if (route.name === 'gallery') return `gallery:${galleryGeneration}`;
  return route.name;
}
