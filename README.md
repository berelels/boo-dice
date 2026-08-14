# Boo & Dice

Companion de mesa para D&D 5e. Esta é a **v1**: o app do jogador, com ficha
completa, rolagem de dados integrada e glossário de regras — tudo offline.

O app do mestre (Electron), o sync ao vivo das fichas e o Oráculo com IA vêm
depois; a arquitetura já os acomoda.

## Rodando

```bash
npm install
```

Baixe o SRD (conteúdo aberto, ~1.700 verbetes) e suba o app:

```bash
npm run data && npm run dev
```

O app abre em `http://localhost:5173`.

### Importando seus próprios livros

O SRD é um subconjunto pequeno e está em inglês. Para ter as regras em
português, importe um livro que você já possui:

```bash
npm run data:book -- "LIVRO-DE-REGRAS-D_D-reduzido.html"
```

Isso gera `books.db` com as 361 magias em português e ~850 blocos de regra
pesquisáveis. **Esse arquivo é local**: fica no `.gitignore` e nunca é
distribuído junto com o app. O que o app embarca é só o SRD, que é aberto.

Depois de qualquer um dos dois comandos:

```bash
npm run data:check   # confere o conteúdo dos bancos gerados
```

### Testes

```bash
npm test        # 189 testes: regras de 5e, dados, persistência, busca, pipeline
npm run typecheck
```

## Arquitetura

```
packages/core/      domínio headless — regras de 5e, dados, schema, persistência
packages/ui/        design system: molas, gestos e primitivas visuais
packages/data/dist/ artefatos gerados (srd.db, books.db) — não versionados
apps/player/        React + Vite + Capacitor
tools/build-data/   pipeline: SRD → srd.db, e livros locais → books.db
```

### Persistência

**SQLite em todos os alvos**, com um driver plugável por trás de uma interface
única (`SqlDriver`):

| alvo | driver | armazenamento |
| --- | --- | --- |
| navegador | `@sqlite.org/sqlite-wasm` | imagem em memória, persistida no IndexedDB |
| Android / iOS | `@capacitor-community/sqlite` | arquivo nativo |
| Node (testes) | `better-sqlite3` | arquivo ou memória |

Nenhuma tela, repositório ou consulta muda entre os três. A escolha do driver
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
critério mais estrito ao mais frouxo. **313 das 319 magias do SRD** são ligadas
automaticamente, com zero casamentos errados; as 25 que colidem por terem
mecânica idêntica (Bênção e Perdição, por exemplo) são resolvidas por um mapa
curado em `tools/build-data/src/link.ts`.

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
`better-sqlite3` traz FTS5). Daí o uso do build oficial do SQLite.

## Limitações conhecidas da v1

- **Monstros só em inglês.** O dataset SRD não tem tradução de monstros, e o
  apêndice de criaturas do livro do usuário vira blocos de busca, não fichas
  estruturadas. Buscar "goblin" ou "lich" funciona; "dragão vermelho", não.
  É o que mais pesa no app do mestre, e é lá que deve ser resolvido.
- **Android precisa de JDK 21 + Android SDK**, que não estão instalados nesta
  máquina. O Capacitor já está configurado (`com.grupohermes.dfo`); falta só o
  ambiente nativo. iOS exige macOS.

## Conteúdo e licenças

O app embarca **apenas o SRD 5.1**, © Wizards of the Coast LLC, sob
[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). A atribuição vai
gravada dentro do próprio `srd.db`, na tabela `catalog_meta`.

Livros fechados (Player's Handbook, Caldeirão de Tasha e afins) **não são
distribuídos**. Cada usuário importa localmente os livros que já possui, e o
`books.db` resultante nunca sai da máquina dele.
