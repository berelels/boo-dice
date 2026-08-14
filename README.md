# Boo & Dice

> **Projeto pessoal de estudos.** Feito por hobby, para aprender e treinar
> enquanto jogo D&D com meus amigos. Não é um produto comercial, não
> representa nenhuma empresa, e não deve ser interpretado como portfólio de
> experiência profissional — é código de fim de semana, não de trabalho.

Companion de mesa para D&D 5e — ficha de personagem, dados, glossário de
regras e tudo que uma mesa precisa, direto no celular ou no computador. Feito
para jogar **offline**: nada de internet obrigatória, nada de conta, nada de
anúncio.

Tem duas partes, uma pra cada lado da mesa:

- **App do Jogador** — ficha completa (atributos, magias, inventário, ataques),
  rolagem de dados, glossário de regras com busca, e backup exportável da
  sua ficha.
- **App do Mestre** — rastreador de iniciativa e combate, notas de sessão
  (com suporte a sincronizar com um vault do Obsidian), e um Oráculo de
  regras com IA rodando **local** — sem mandar nada pra internet.

Durante a sessão, o app do Mestre e os jogadores conectados na mesma rede
(Wi-Fi/LAN) sincronizam ao vivo: o Mestre vê PV, CA e condições de cada
personagem em tempo real.

## Baixar

| Plataforma | Como instalar |
| --- | --- |
| **Android** | Baixe o `.apk` mais recente nas [Releases](../../releases/latest) e instale (pode ser preciso permitir "fontes desconhecidas" nas configurações do Android). |
| **iOS (iPhone/iPad)** | Abra **[o app pelo Safari](https://berelels.github.io/boo-dice/)**, toque em **Compartilhar** → **Adicionar à Tela de Início**. Funciona como um app normal, com ícone próprio e offline. |
| **Windows** (app do Mestre) | Baixe o `Setup.exe` nas [Releases](../../releases/latest). O Windows pode avisar "editor desconhecido" — é esperado, o app não tem certificado pago; clique em "Mais informações" → "Executar assim mesmo". |
| **Linux** (app do Mestre) | Baixe o `.AppImage` nas [Releases](../../releases/latest), dê permissão de execução (`chmod +x`) e rode. |

## Por que offline-first

Tudo o que você faz — ficha, rolagens, notas — fica salvo no próprio
aparelho. Não existe conta, não existe servidor guardando seus dados, e o
app funciona sem sinal nenhum, inclusive no meio de uma sessão numa casa sem
Wi-Fi. A sincronização entre jogador e Mestre só acontece dentro da mesma
rede local, na hora da sessão — nunca passa pela internet.

## Conteúdo e licenças

O app vem com o **SRD 5.1** (o subconjunto de regras que a própria Wizards
of the Coast disponibiliza de graça), sob licença
[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). Se você tiver um
livro oficial (Player's Handbook, Caldeirão de Tasha, etc.), pode importá-lo
localmente para ter as regras completas em português — esse conteúdo nunca
sai do seu aparelho nem é distribuído junto com o app.

## Para desenvolvedores

Quer rodar o projeto localmente, entender a arquitetura ou contribuir? Veja
o [guia de desenvolvimento](DEVELOPMENT.md).
