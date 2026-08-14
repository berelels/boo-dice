import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

/**
 * `externalizeDepsPlugin()` no main e no preload evita que o Rollup tente
 * empacotar o `better-sqlite3` (módulo nativo) — ele precisa continuar sendo
 * `require`ido em tempo de execução, não bundlado. `@dfo/core` fica de fora
 * dessa lista de propósito: é TypeScript fonte do workspace (sem build
 * próprio, ver `packages/core/package.json`), e "externalizar" um pacote
 * assim faz o Node tentar importar `.ts` direto em runtime — o Rollup
 * precisa mesmo transpilar/empacotar esse aqui. O renderer segue as mesmas
 * convenções de `apps/player/vite.config.ts`: dedupe do React e os pacotes
 * do monorepo fora do pré-bundle, para edições ali refletirem sem precisar
 * limpar cache.
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@dfo/core'] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@dfo/core'] })],
    // Script de pré-carregamento com `sandbox: true` (ver `main/window.ts`)
    // não aceita ESM — precisa ser CJS, mesmo o resto do projeto sendo
    // `"type": "module"`.
    build: {
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      exclude: ['@dfo/ui', '@dfo/core'],
    },
    build: {
      target: 'es2022',
    },
  },
});
