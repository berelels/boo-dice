# Desenvolvimento

Guia técnico do monorepo. Para o que o app faz e como instalar, veja o
[README](README.md).

## Rodando

```bash
npm install
npm run data && npm run dev          # app do jogador, http://localhost:5173
npm run dev:dm                       # app do mestre (Electron)
```

`npm run data` baixa o SRD (conteúdo aberto, ~1.700 verbetes). Sem ele o app
abre normalmente, só com o glossário vazio.

### Importando um livro próprio

```bash
npm run data:book -- "seu-livro.html"
npm run data:check   # confere o conteúdo dos bancos gerados
```

Gera `books.db` com as regras/magias em português. **Esse arquivo é local**:
está no `.gitignore` e nunca é distribuído junto com o app — nem no
repositório, nem nos binários publicados nas Releases (o pipeline de build
verifica isso antes de empacotar).

### Testes

```bash
npm test          # 271 testes: regras de 5e, dados, persistência, busca, sync, IPC
npm run typecheck
```

## Arquitetura

```
packages/core/      domínio headless — regras de 5e, dados, schema, persistência, sync
packages/ui/        design system: molas, gestos e primitivas visuais
packages/data/dist/ artefatos gerados (srd.db, books.db) — não versionados
apps/player/        app do jogador — React + Vite + Capacitor (Android nativo, web/PWA no iOS)
apps/dm/            app do mestre — React + Electron (Linux/Windows)
tools/build-data/   pipeline: SRD → srd.db, e livros locais → books.db
```

### Persistência

**SQLite em todos os alvos**, com um driver plugável por trás de uma interface
única (`SqlDriver`):

| alvo | driver | armazenamento |
| --- | --- | --- |
| navegador / PWA (iOS) | `@sqlite.org/sqlite-wasm` | imagem em memória, persistida no IndexedDB |
| Android (Capacitor) | `@capacitor-community/sqlite` | arquivo nativo |
| Electron (mestre) | `better-sqlite3` | arquivo nativo |
| Node (testes) | `better-sqlite3` | arquivo ou memória |

Nenhuma tela, repositório ou consulta muda entre eles. A escolha do driver
acontece num lugar só: `apps/player/src/db/open.ts`.

### Dados

O `srd.db` sai do [5e-bits/5e-database](https://github.com/5e-bits/5e-database)
(SRD 5.1 da Wizards of the Coast, sob CC-BY-4.0). Onde o repositório tem
tradução oficial — condições, raças, antecedentes, perícias, talentos — ela é
sobreposta e o registro fica marcado `lang: 'pt'`. Onde não tem, o registro
entra em inglês, marcado como tal, e a UI mostra um selo.

O `books.db` sai do livro do usuário. As magias em português são casadas com
os índices do SRD por **assinatura mecânica** (nível, escola, componentes,
concentração, ritual, alcance, tempo de conjuração, duração), em camadas do
critério mais estrito ao mais frouxo. 313 das 319 magias do SRD são ligadas
automaticamente, com zero casamentos errados; as que colidem por terem
mecânica idêntica (Bênção e Perdição, por exemplo) são resolvidas por um mapa
curado em `tools/build-data/src/link.ts`.

## Publicando um release

Binários (APK, AppImage, `.exe`) são publicados manualmente nas Releases do
GitHub — não há CI para isso ainda. Antes de gerar qualquer binário
destinado à distribuição pública, confirme que `packages/data/dist/books.db`
(e as cópias derivadas em `apps/player/public/` e `apps/dm/resources/data/`)
**não estão presentes** — só o SRD pode ir para um binário público.

O PWA (app do jogador, usado no iOS) é publicado automaticamente no GitHub
Pages a cada push em `main`, via `.github/workflows/deploy-pages.yml`.

A assinatura do APK usa uma chave guardada em `~/.keystores/boo-dice/`,
fora do repositório. Sem ela, `gradlew assembleRelease` gera um APK sem
assinatura de release.

### Se `apps/player/android/` for regenerado

O diretório é gerado (`npx cap add android`) e está no `.gitignore` —
regenerá-lo (por exemplo, pra trocar `applicationId`) apaga edições manuais.
Depois de regenerar, reaplique à mão:

- `signingConfigs.release` em `android/app/build.gradle` (lê
  `~/.keystores/boo-dice/keystore.properties`).
- Em `android/app/src/main/AndroidManifest.xml`: `<uses-permission
  android:name="android.permission.CAMERA" />` antes de `<application>`, e
  `<meta-data android:name="com.google.mlkit.vision.DEPENDENCIES"
  android:value="barcode_ui" />` dentro dela — exigidos pelo
  `@capacitor-mlkit/barcode-scanning` (leitor de QR da tela "Entrar em
  sessão"). Sem isso o app nunca consegue nem pedir a permissão de câmera ao
  Android, e o scan falha sempre, silenciosamente.
- `android/local.properties` com `sdk.dir=$HOME/Android/Sdk`.

Rode `npx cap sync android` de novo depois de qualquer rebuild do `dist/`
(a cópia dos bancos pra dentro do projeto nativo não é automática).

## Duas armadilhas documentadas no código

**`PRAGMA journal_mode = WAL` é persistente.** Ele é gravado nos bytes 18/19 do
cabeçalho do arquivo, e um banco marcado como WAL **não abre no navegador** — a
imagem em memória não tem o arquivo `-wal` que o SQLite exige, e o resultado é
`SQLITE_CANTOPEN`. Basta abrir um artefato distribuível com um driver que ligue
WAL para corrompê-lo silenciosamente. Por isso o `CatalogWriter` força
`journal_mode = DELETE` ao fechar, e o `BetterSqlite3Driver` tem modo
somente-leitura que não toca em pragma nenhum.

**O sql.js não tem FTS5.** O build publicado no npm é compilado sem ele, então
o glossário inteiro cai no navegador enquanto os testes em Node passam (o
`better-sqlite3` traz FTS5). Daí o uso do build oficial do SQLite
(`@sqlite.org/sqlite-wasm`) no navegador.
