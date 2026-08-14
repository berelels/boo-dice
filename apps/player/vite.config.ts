import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // Cobre o iOS: lá não existe empacotamento nativo (o app é Capacitor só
    // no Android), então "Adicionar à Tela de Início" no Safari é o caminho
    // de instalação. No Android o app instalado de verdade vem do Capacitor,
    // mas nada aqui atrapalha isso — o plugin só afeta o build web.
    VitePWA({
      registerType: 'autoUpdate',
      // Ativa o service worker também em `npm run dev`, para testar o
      // comportamento de instalação/offline sem precisar de um build.
      devOptions: { enabled: true },
      manifest: {
        name: 'Boo & Dice',
        short_name: 'Boo & Dice',
        description: 'Companion de mesa para D&D 5e — ficha, dados e glossário.',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#14120f',
        theme_color: '#14120f',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Os acervos (`public/data/*.db`) passam dos 2MB do limite padrão de
        // pré-cache do Workbox — cacheados sob demanda pelo runtimeCaching
        // abaixo em vez de forçados no install do service worker.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // SRD, livros importados e o índice de PDFs do Oráculo: grandes,
            // e praticamente nunca mudam depois do primeiro download —
            // `CacheFirst` evita rebaixar o mesmo banco a cada visita.
            urlPattern: /\/data\/.*\.db$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'dfo-data',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
  },
  resolve: {
    // Num monorepo, `@dfo/ui` e o app podem acabar resolvendo cópias distintas
    // do React, e duas instâncias quebram os hooks com "Invalid hook call".
    // `dedupe` força uma só, independentemente de como o npm aninhar.
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    exclude: [
      // O @sqlite.org/sqlite-wasm já é ESM e resolve o próprio .wasm por
      // `import.meta.url`. O pré-bundle do Vite reescreveria esse caminho e o
      // wasm deixaria de ser encontrado, então ele fica de fora.
      '@sqlite.org/sqlite-wasm',
      // @dfo/ui e @dfo/core são pacotes do monorepo, não dependências de
      // terceiros — mas por estarem em node_modules via workspace, o Vite os
      // trataria como tal e os pré-empacotaria. Sem isto, toda edição num dos
      // dois exige limpar `node_modules/.vite` e reiniciar o servidor para o
      // dev refletir a mudança, o que é péssimo para o ciclo de edição.
      '@dfo/ui',
      '@dfo/core',
    ],
  },
  build: {
    target: 'es2022',
    // Os bancos são baixados como assets, não embutidos no bundle.
    assetsInlineLimit: 4096,
  },
});
