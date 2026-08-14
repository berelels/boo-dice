import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Empacotamento nativo do app do jogador.
 *
 * O `appId` mantém o identificador original do pacote — trocá-lo depois de
 * qualquer instalação/publicação invalidaria atualizações futuras. Só o
 * `appName` (o que aparece na tela do aparelho) segue o nome novo.
 */
const config: CapacitorConfig = {
  appId: 'io.github.berelels.boodice',
  appName: 'Boo & Dice',
  webDir: 'dist',

  // Fundo escuro também na tela de carregamento nativa, para não haver um
  // flash branco antes do app aparecer — o app é escuro por padrão.
  backgroundColor: '#0d0c0f',

  android: {
    // O WebView do Android não deve ampliar o texto por conta própria: a
    // tipografia já é em `rem` e acompanha a configuração do sistema.
    allowMixedContent: false,
  },

  plugins: {
    CapacitorSQLite: {
      android: {
        // Sem criptografia por ora: a ficha não guarda nada sensível, e exigir
        // uma senha para abrir o personagem atrapalharia mais do que ajudaria.
        // O banco fica na área privada do app, inacessível a outros apps.
        databaseLocation: 'default',
      },
    },
  },
};

export default config;
