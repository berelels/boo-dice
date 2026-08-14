import { abilityModifier, ABILITIES, type Ability } from './abilities.js';
import { CLASSES, type ClassId } from './classes.js';
import { SUBCLASSES } from './subclasses.js';
import type { Character, Feature } from '../schema/character.js';

/**
 * Progressão automática de características de classe e trilha.
 *
 * `resolveClassFeatures` calcula, a partir de `character.classes`, quais
 * características o personagem já tem — puro e síncrono, sem tocar em banco
 * nenhum (o SRD trazido pelo pipeline de dados fica só em inglês e vive numa
 * tabela de busca em texto; esta tabela é escrita à mão, em português, no
 * mesmo espírito de `CLASSES`/`XP_THRESHOLDS`).
 *
 * `syncClassFeatures` é quem grava: funde o resultado dentro de
 * `character.features`, preservando `resource.spent` do que já existia
 * (quanto já foi usado desde o último descanso é decisão do jogador, não dá
 * pra recalcular) e nunca tocando em características que o próprio jogador
 * adicionou à mão — só nas que carregam o prefixo `class:`, a marca de que
 * foram esta função que colocou ali.
 */

type ResourceRecharge = 'short' | 'long' | 'none';

interface FeatureResourceContext {
  readonly classLevel: number;
  readonly abilityModifiers: Readonly<Record<Ability, number>>;
}

interface ClassFeatureResourceDefinition {
  readonly max: number | ((ctx: FeatureResourceContext) => number);
  readonly recharge: ResourceRecharge | ((ctx: Pick<FeatureResourceContext, 'classLevel'>) => ResourceRecharge);
}

interface ClassFeatureDefinition {
  /** Único dentro da classe — vira parte do id final, prefixado. */
  readonly id: string;
  readonly label: string;
  /** Nível *nesta classe*, não nível total do personagem. */
  readonly level: number;
  /** Presente só quando a característica vem da trilha, não da classe base. */
  readonly subclassId?: string;
  readonly description: string;
  readonly resource?: ClassFeatureResourceDefinition;
}

// ---------------------------------------------------------------------------
// Bardo — o exemplo que deu origem a esta feature.
// ---------------------------------------------------------------------------

const BARD_FEATURES: readonly ClassFeatureDefinition[] = [
  {
    id: 'bardic-inspiration',
    label: 'Inspiração de Bardo',
    level: 1,
    description:
      'Como ação bônus, dá um dado de inspiração (d6, sobe para d8 no nível 5, d10 no 10, d12 no 15) a uma criatura a até 18m que consiga ouvir. Ela pode somar o dado a uma jogada de ataque, teste ou resistência, uma vez, em até 10 minutos.',
    resource: {
      max: ({ abilityModifiers }) => Math.max(1, abilityModifiers.cha),
      // Fonte de Inspiração (nível 5) muda a recarga de longo pra curto.
      recharge: ({ classLevel }) => (classLevel >= 5 ? 'short' : 'long'),
    },
  },
  {
    id: 'jack-of-all-trades',
    label: 'Versado em Tudo',
    level: 2,
    description: 'Soma metade do bônus de proficiência (arredondado para baixo) a qualquer teste de habilidade sem proficiência.',
  },
  {
    id: 'song-of-rest',
    label: 'Música de Descanso',
    level: 2,
    description:
      'No descanso curto, quem ouvir a música e gastar ao menos um dado de vida recupera 1d6 PV extras (sobe para d8 no nível 9, d10 no 13, d12 no 17).',
  },
  {
    id: 'expertise-1',
    label: 'Especialização',
    level: 3,
    description: 'Escolha duas perícias com proficiência: o bônus de proficiência nelas dobra.',
  },
  {
    id: 'font-of-inspiration',
    label: 'Fonte de Inspiração',
    level: 5,
    description: 'A partir de agora, a Inspiração de Bardo volta também num descanso curto, não só num longo.',
  },
  {
    id: 'countercharm',
    label: 'Contracanto',
    level: 6,
    description: 'Como ação, você e as criaturas a até 9m ganham vantagem em resistências contra ficarem amedrontadas ou enfeitiçadas enquanto a música continuar.',
  },
  {
    id: 'expertise-2',
    label: 'Especialização (2ª vez)',
    level: 10,
    description: 'Escolha mais duas perícias com proficiência para dobrar o bônus.',
  },
  {
    id: 'magical-secrets-1',
    label: 'Segredos Mágicos',
    level: 10,
    description: 'Aprenda duas magias de qualquer classe, de qualquer nível que já consiga conjurar — contam como magias de bardo.',
  },
  {
    id: 'magical-secrets-2',
    label: 'Segredos Mágicos (2ª vez)',
    level: 14,
    description: 'Aprenda mais duas magias de qualquer classe.',
  },
  {
    id: 'magical-secrets-3',
    label: 'Segredos Mágicos (3ª vez)',
    level: 18,
    description: 'Aprenda mais duas magias de qualquer classe.',
  },
  {
    id: 'superior-inspiration',
    label: 'Inspiração Superior',
    level: 20,
    description: 'Ao rolar iniciativa, se não tiver nenhum uso de Inspiração de Bardo, recupera um.',
  },
  // Trilha: Colégio do Conhecimento.
  {
    id: 'lore-bonus-proficiencies',
    label: 'Proficiências Adicionais',
    level: 3,
    subclassId: 'lore',
    description: 'Ganha proficiência em três perícias à escolha.',
  },
  {
    id: 'cutting-words',
    label: 'Palavras Cortantes',
    level: 3,
    subclassId: 'lore',
    description: 'Como reação, gasta um dado de Inspiração de Bardo pra subtrair o resultado de uma jogada de ataque, teste ou dano de uma criatura hostil a até 18m que consiga ouvir.',
  },
  {
    id: 'additional-magical-secrets',
    label: 'Segredos Mágicos Adicionais',
    level: 6,
    subclassId: 'lore',
    description: 'Aprenda duas magias extras de qualquer classe — nenhuma delas conta contra o limite de Segredos Mágicos normal.',
  },
  {
    id: 'peerless-skill',
    label: 'Talento Incomparável',
    level: 14,
    subclassId: 'lore',
    description: 'Pode gastar um dado de Inspiração de Bardo pra somar ao próprio teste de habilidade.',
  },
];

// ---------------------------------------------------------------------------
// Guerreiro — contraste sem conjuração, com vários recursos de usos.
// ---------------------------------------------------------------------------

const FIGHTER_FEATURES: readonly ClassFeatureDefinition[] = [
  {
    id: 'fighting-style',
    label: 'Estilo de Combate',
    level: 1,
    description: 'Escolha um estilo de combate (Arquearia, Combate com Duas Armas, Defesa, Duelo, Luta às Cegas ou Proteção) e ganha o bônus dele permanentemente.',
  },
  {
    id: 'second-wind',
    label: 'Segundo Fôlego',
    level: 1,
    description: 'Como ação bônus, recupera 1d10 + seu nível de guerreiro em PV.',
    resource: { max: 1, recharge: 'short' },
  },
  {
    id: 'action-surge',
    label: 'Surto de Ação',
    level: 2,
    description: 'Ganha uma ação extra neste turno (dois usos entre um descanso e outro a partir do nível 17).',
    resource: {
      max: ({ classLevel }) => (classLevel >= 17 ? 2 : 1),
      recharge: 'short',
    },
  },
  {
    id: 'extra-attack',
    label: 'Ataque Extra',
    level: 5,
    description: 'Ataca duas vezes, em vez de uma, sempre que usa a ação de Ataque no seu turno.',
  },
  {
    id: 'indomitable',
    label: 'Indomável',
    level: 9,
    description: 'Pode rerrolar uma resistência falhada (dois usos a partir do nível 13, três a partir do 17) — precisa usar o novo resultado.',
    resource: {
      max: ({ classLevel }) => (classLevel >= 17 ? 3 : classLevel >= 13 ? 2 : 1),
      recharge: 'long',
    },
  },
  {
    id: 'extra-attack-2',
    label: 'Ataque Extra (2)',
    level: 11,
    description: 'Ataca três vezes sempre que usa a ação de Ataque.',
  },
  {
    id: 'extra-attack-3',
    label: 'Ataque Extra (3)',
    level: 20,
    description: 'Ataca quatro vezes sempre que usa a ação de Ataque.',
  },
  // Trilha: Campeão.
  {
    id: 'improved-critical',
    label: 'Crítico Aprimorado',
    level: 3,
    subclassId: 'champion',
    description: 'Um ataque com arma acerta um crítico com 19 ou 20 no dado, não só com 20.',
  },
  {
    id: 'remarkable-athlete',
    label: 'Atleta Notável',
    level: 7,
    subclassId: 'champion',
    description: 'Soma metade do bônus de proficiência (arredondado pra cima) a testes de Força, Destreza ou Constituição sem proficiência, e o salto em distância aumenta.',
  },
  {
    id: 'additional-fighting-style',
    label: 'Estilo de Combate Adicional',
    level: 10,
    subclassId: 'champion',
    description: 'Escolhe um segundo Estilo de Combate.',
  },
  {
    id: 'superior-critical',
    label: 'Crítico Superior',
    level: 15,
    subclassId: 'champion',
    description: 'Um ataque com arma acerta um crítico com 18, 19 ou 20 no dado.',
  },
  {
    id: 'survivor',
    label: 'Sobrevivente',
    level: 18,
    subclassId: 'champion',
    description: 'No início de cada turno, se estiver com PV a 50% do máximo ou menos, recupera PV extras automaticamente.',
  },
];

// ---------------------------------------------------------------------------
// Bárbaro.
// ---------------------------------------------------------------------------

const BARBARIAN_FEATURES: readonly ClassFeatureDefinition[] = [
  {
    id: 'rage',
    label: 'Fúria',
    level: 1,
    description:
      'Como ação bônus, entra em fúria: vantagem em testes e resistências de Força, bônus no dano corpo a corpo com Força, e resistência a dano cortante, perfurante e de concussão. Dura 1 minuto (2 usos por descanso longo no início, sobe para 3 no nível 3, 4 no 6, 5 no 12, 6 no 17, ilimitado no 20).',
    resource: {
      max: ({ classLevel }) =>
        classLevel >= 20 ? 99 : classLevel >= 17 ? 6 : classLevel >= 12 ? 5 : classLevel >= 6 ? 4 : classLevel >= 3 ? 3 : 2,
      recharge: 'long',
    },
  },
  {
    id: 'unarmored-defense-barbarian',
    label: 'Defesa sem Armadura',
    level: 1,
    description: 'Sem armadura, sua CA é 10 + modificador de Destreza + modificador de Constituição (pode usar escudo).',
  },
  {
    id: 'reckless-attack',
    label: 'Ataque Imprudente',
    level: 2,
    description: 'Pode atacar com desvantagem em troca de vantagem nos seus ataques corpo a corpo baseados em Força até o próximo turno.',
  },
  {
    id: 'danger-sense',
    label: 'Senso de Perigo',
    level: 2,
    description: 'Vantagem em resistências de Destreza contra efeitos que você consegue ver (armadilhas, magias), desde que não esteja cego, surdo ou incapacitado.',
  },
  {
    id: 'extra-attack-barbarian',
    label: 'Ataque Extra',
    level: 5,
    description: 'Ataca duas vezes sempre que usa a ação de Ataque no seu turno.',
  },
  {
    id: 'fast-movement',
    label: 'Movimento Rápido',
    level: 5,
    description: 'Deslocamento aumenta em 3m enquanto não estiver usando armadura pesada.',
  },
  {
    id: 'feral-instinct',
    label: 'Instinto Selvagem',
    level: 7,
    description: 'Vantagem em iniciativa, e pode agir normalmente mesmo surpreso se entrar em fúria no seu primeiro turno.',
  },
  {
    id: 'brutal-critical-1',
    label: 'Crítico Brutal',
    level: 9,
    description: 'Soma um dado de dano extra a um crítico corpo a corpo com Força (dois dados extras no nível 13, três no 17).',
  },
  {
    id: 'relentless-rage',
    label: 'Fúria Implacável',
    level: 11,
    description:
      'Se cair a 0 PV em fúria sem morrer de vez, pode fazer um teste de Constituição (CD 10, sobe 5 a cada uso desde o último descanso) para continuar com 1 PV.',
  },
  {
    id: 'persistent-rage',
    label: 'Fúria Persistente',
    level: 15,
    description: 'A fúria só termina antes da hora se você ficar inconsciente ou decidir parar.',
  },
  {
    id: 'indomitable-might',
    label: 'Poder Indomável',
    level: 18,
    description: 'Se o total de um teste de Força for menor que sua pontuação de Força, usa a pontuação no lugar do total.',
  },
  {
    id: 'primal-champion',
    label: 'Campeão Primitivo',
    level: 20,
    description: 'Força e Constituição aumentam em 4, até o máximo de 24.',
  },
  // Trilha: Furioso.
  {
    id: 'frenzy',
    label: 'Frenesi',
    level: 3,
    subclassId: 'berserker',
    description: 'Em fúria, pode entrar em frenesi: dano bônus corpo a corpo com Força a cada turno, mas fica exausto quando a fúria termina.',
  },
  {
    id: 'mindless-rage',
    label: 'Fúria Insensata',
    level: 6,
    subclassId: 'berserker',
    description: 'Não pode ficar amedrontado ou enfeitiçado em fúria; se já estiver, o efeito é suspenso.',
  },
  {
    id: 'intimidating-presence',
    label: 'Presença Intimidante',
    level: 10,
    subclassId: 'berserker',
    description: 'Como ação, amedronta uma criatura a até 9m com um teste de Carisma resistido por Sabedoria.',
  },
  {
    id: 'retaliation',
    label: 'Retaliação',
    level: 14,
    subclassId: 'berserker',
    description: 'Como reação a sofrer dano corpo a corpo, pode atacar quem causou o dano, se estiver a seu alcance.',
  },
];

// ---------------------------------------------------------------------------
// Clérigo.
// ---------------------------------------------------------------------------

const CLERIC_FEATURES: readonly ClassFeatureDefinition[] = [
  {
    id: 'channel-divinity',
    label: 'Canalizar Divindade',
    level: 2,
    description: 'Como ação, gasta um uso para Expulsar Mortos-vivos ou usar uma opção do seu domínio (dois usos a partir do nível 6, três no 18).',
    resource: {
      max: ({ classLevel }) => (classLevel >= 18 ? 3 : classLevel >= 6 ? 2 : 1),
      recharge: 'short',
    },
  },
  {
    id: 'destroy-undead',
    label: 'Destruir Mortos-vivos',
    level: 5,
    description: 'Ao expulsar um morto-vivo, ele é destruído automaticamente se o ND dele estiver abaixo de um limite que sobe com seu nível de clérigo.',
  },
  {
    id: 'divine-intervention',
    label: 'Intervenção Divina',
    level: 10,
    description:
      'Pede um milagre ao seu deus: role percentual igual ou menor que seu nível de clérigo para o seu deus intervir diretamente (a partir do nível 20, funciona automaticamente).',
    resource: { max: 1, recharge: 'long' },
  },
  // Trilha: Domínio da Vida.
  {
    id: 'life-bonus-proficiency',
    label: 'Proficiência Adicional',
    level: 1,
    subclassId: 'life',
    description: 'Ganha proficiência com armaduras pesadas.',
  },
  {
    id: 'disciple-of-life',
    label: 'Discípulo da Vida',
    level: 1,
    subclassId: 'life',
    description: 'Suas magias de cura curam PV extras, iguais a 2 + o nível da magia.',
  },
  {
    id: 'preserve-life',
    label: 'Canalizar Divindade: Preservar Vida',
    level: 2,
    subclassId: 'life',
    description:
      'Gasta um uso de Canalizar Divindade pra distribuir PV curados (5× seu nível de clérigo) entre criaturas próximas, sem passar de metade do máximo de cada uma.',
  },
  {
    id: 'blessed-healer',
    label: 'Curandeiro Abençoado',
    level: 6,
    subclassId: 'life',
    description: 'Quando conjura uma magia de cura em outra criatura, você também recupera PV.',
  },
  {
    id: 'divine-strike-cleric',
    label: 'Golpe Divino',
    level: 8,
    subclassId: 'life',
    description: 'Uma vez por turno, um ataque com arma causa 1d8 de dano radiante extra (2d8 a partir do nível 14).',
  },
  {
    id: 'supreme-healing',
    label: 'Cura Suprema',
    level: 17,
    subclassId: 'life',
    description: 'Em vez de rolar dados de cura, usa o resultado máximo possível.',
  },
];

// ---------------------------------------------------------------------------
// Druida.
// ---------------------------------------------------------------------------

const DRUID_FEATURES: readonly ClassFeatureDefinition[] = [
  {
    id: 'wild-shape',
    label: 'Forma Selvagem',
    level: 2,
    description:
      'Como ação, se transforma numa criatura besta que já tenha visto (as opções disponíveis crescem com o nível). Ilimitado a partir do nível 20.',
    resource: {
      max: ({ classLevel }) => (classLevel >= 20 ? 99 : 2),
      recharge: 'short',
    },
  },
  {
    id: 'timeless-body-druid',
    label: 'Corpo Atemporal',
    level: 18,
    description: 'Envelhece muito mais devagar: um ano de idade a cada dez.',
  },
  {
    id: 'beast-spells',
    label: 'Magias Bestiais',
    level: 18,
    description: 'Pode conjurar magias druídicas mesmo em Forma Selvagem.',
  },
  {
    id: 'archdruid',
    label: 'Arquidruida',
    level: 20,
    description: 'Pode usar Forma Selvagem quantas vezes quiser, sem gastar usos.',
  },
  // Trilha: Círculo da Terra.
  {
    id: 'land-bonus-cantrip',
    label: 'Truque Adicional',
    level: 2,
    subclassId: 'land',
    description: 'Aprende um truque adicional da lista de druida.',
  },
  {
    id: 'natural-recovery',
    label: 'Recuperação Natural',
    level: 2,
    subclassId: 'land',
    description:
      'Uma vez por dia, num descanso curto, recupera espaços de magia num total de níveis igual à metade do seu nível de druida (nenhum de 6º nível ou mais).',
  },
  {
    id: 'circle-spells',
    label: 'Magias do Círculo',
    level: 3,
    subclassId: 'land',
    description: 'Ganha magias extras sempre preparadas, de acordo com o terreno escolhido pro seu círculo.',
  },
  {
    id: 'lands-stride-druid',
    label: 'Passo da Terra',
    level: 6,
    subclassId: 'land',
    description: 'Atravessa terreno difícil não-mágico sem gastar deslocamento extra, e tem vantagem em resistências contra plantas mágicas que restrinjam movimento.',
  },
  {
    id: 'natures-ward',
    label: 'Proteção da Natureza',
    level: 10,
    subclassId: 'land',
    description: 'Imune a ser envenenado ou doente, e a ser amedrontado ou enfeitiçado por elementais ou fadas.',
  },
  {
    id: 'natures-sanctuary',
    label: 'Santuário da Natureza',
    level: 14,
    subclassId: 'land',
    description: 'Bestas e plantas precisam ter sucesso num teste de Sabedoria pra te atacar; se falharem, precisam escolher outro alvo ou desistir do ataque.',
  },
];

// ---------------------------------------------------------------------------
// Monge.
// ---------------------------------------------------------------------------

const MONK_FEATURES: readonly ClassFeatureDefinition[] = [
  {
    id: 'unarmored-defense-monk',
    label: 'Defesa sem Armadura',
    level: 1,
    description: 'Sem armadura e sem escudo, sua CA é 10 + modificador de Destreza + modificador de Sabedoria.',
  },
  {
    id: 'martial-arts',
    label: 'Artes Marciais',
    level: 1,
    description:
      'Pode usar Destreza em vez de Força em ataques desarmados/armas de monge, causa dano desarmado maior que o padrão (d4, sobe para d6 no nível 5, d8 no 11, d10 no 17), e pode fazer um ataque desarmado bônus.',
  },
  {
    id: 'ki',
    label: 'Ki',
    level: 2,
    description: 'Pontos de ki para Rajada de Golpes, Defesa Paciente, Passo de Vento e outras técnicas — usa até uma vez por ponto gasto.',
    resource: { max: ({ classLevel }) => classLevel, recharge: 'short' },
  },
  {
    id: 'unarmored-movement',
    label: 'Movimento sem Armadura',
    level: 2,
    description: 'Deslocamento aumenta sem armadura ou escudo (cresce com o nível; a partir do 9 pode andar em superfícies verticais e sobre líquidos).',
  },
  {
    id: 'deflect-missiles',
    label: 'Defletir Mísseis',
    level: 3,
    description: 'Como reação, reduz o dano de um ataque à distância com arma; se zerar o dano, pode até pegar o projétil e arremessá-lo de volta.',
  },
  {
    id: 'slow-fall',
    label: 'Queda Suave',
    level: 4,
    description: 'Como reação, reduz o dano de queda em 5× seu nível de monge.',
  },
  {
    id: 'extra-attack-monk',
    label: 'Ataque Extra',
    level: 5,
    description: 'Ataca duas vezes sempre que usa a ação de Ataque no seu turno.',
  },
  {
    id: 'stunning-strike',
    label: 'Golpe Atordoante',
    level: 5,
    description:
      'Ao acertar um ataque corpo a corpo, pode gastar 1 ponto de ki para forçar um teste de Constituição: se falhar, a criatura fica atordoada até o fim do seu próximo turno.',
  },
  {
    id: 'ki-empowered-strikes',
    label: 'Golpes Potencializados por Ki',
    level: 6,
    description: 'Seus ataques desarmados contam como mágicos, pra passar de resistências e imunidades.',
  },
  {
    id: 'evasion-monk',
    label: 'Evasão',
    level: 7,
    description: 'Sucesso num teste de Destreza contra um efeito em área não causa dano nenhum, e falha causa só metade.',
  },
  {
    id: 'stillness-of-mind',
    label: 'Quietude da Mente',
    level: 7,
    description: 'Como ação, encerra em si mesmo um efeito de enfeitiçado ou amedrontado.',
  },
  {
    id: 'purity-of-body',
    label: 'Pureza do Corpo',
    level: 10,
    description: 'Imune a doenças e venenos.',
  },
  {
    id: 'tongue-of-sun-and-moon',
    label: 'Língua do Sol e da Lua',
    level: 13,
    description: 'Entende qualquer idioma falado, e qualquer criatura que entenda algum idioma entende você.',
  },
  {
    id: 'diamond-soul',
    label: 'Alma de Diamante',
    level: 14,
    description: 'Proficiência em todas as resistências; pode gastar 1 ponto de ki pra rerrolar uma resistência falhada.',
  },
  {
    id: 'timeless-body-monk',
    label: 'Corpo Atemporal',
    level: 15,
    description: 'Não sofre os efeitos da velhice e não precisa de comida ou água.',
  },
  {
    id: 'empty-body',
    label: 'Corpo Vazio',
    level: 18,
    description: 'Gasta 4 pontos de ki pra ficar invisível e com resistência a quase todo dano por 1 minuto; ou 8 pontos pra conjurar projeção astral.',
  },
  {
    id: 'perfect-self',
    label: 'Eu Perfeito',
    level: 20,
    description: 'Ao rolar iniciativa sem nenhum ponto de ki sobrando, recupera 4 pontos.',
  },
  // Trilha: Mão Aberta.
  {
    id: 'open-hand-technique',
    label: 'Técnica da Mão Aberta',
    level: 3,
    subclassId: 'open-hand',
    description:
      'Ao acertar Rajada de Golpes, pode impor: teste de Destreza ou derrubado; teste de Força ou empurrado 4,5m; ou o alvo não faz reações até o fim do seu próximo turno.',
  },
  {
    id: 'wholeness-of-body',
    label: 'Integridade do Corpo',
    level: 6,
    subclassId: 'open-hand',
    description: 'Como ação, recupera PV iguais a 3× seu nível de monge, uma vez por descanso longo.',
  },
  {
    id: 'tranquility',
    label: 'Tranquilidade',
    level: 11,
    subclassId: 'open-hand',
    description: 'Ao terminar um descanso longo, fica sob o efeito de santuário até o início do próximo descanso longo.',
  },
  {
    id: 'quivering-palm',
    label: 'Palma Trêmula',
    level: 17,
    subclassId: 'open-hand',
    description: 'Ao acertar um ataque desarmado, pode implantar vibrações letais — depois, como ação, pode tentar matar o alvo à distância.',
  },
];

// ---------------------------------------------------------------------------
// Paladino.
// ---------------------------------------------------------------------------

const PALADIN_FEATURES: readonly ClassFeatureDefinition[] = [
  {
    id: 'divine-sense',
    label: 'Sentido Divino',
    level: 1,
    description: 'Como ação, detecta a presença de celestiais, corruptores ou mortos-vivos poderosos, e locais/objetos consagrados ou profanados, a até 18m.',
    resource: { max: ({ abilityModifiers }) => Math.max(1, 1 + abilityModifiers.cha), recharge: 'long' },
  },
  {
    id: 'lay-on-hands',
    label: 'Impor as Mãos',
    level: 1,
    description: 'Reserva de cura (5× seu nível de paladino) que pode distribuir com um toque; também pode gastar 5 pontos para curar uma doença ou veneno em vez de PV.',
    resource: { max: ({ classLevel }) => classLevel * 5, recharge: 'long' },
  },
  {
    id: 'divine-smite',
    label: 'Fulminar Divino',
    level: 2,
    description:
      'Ao acertar um ataque corpo a corpo, pode gastar um espaço de magia para causar 2d8 de dano radiante extra (mais 1d8 por nível de espaço acima do 1º, até 5d8; +1d8 contra corruptores/mortos-vivos).',
  },
  {
    id: 'divine-health',
    label: 'Saúde Divina',
    level: 3,
    description: 'Imune a doenças.',
  },
  {
    id: 'extra-attack-paladin',
    label: 'Ataque Extra',
    level: 5,
    description: 'Ataca duas vezes sempre que usa a ação de Ataque no seu turno.',
  },
  {
    id: 'aura-of-protection',
    label: 'Aura de Proteção',
    level: 6,
    description: 'Você e criaturas aliadas a até 3m (9m a partir do nível 18) somam seu modificador de Carisma (mínimo +1) em qualquer resistência.',
  },
  {
    id: 'aura-of-courage',
    label: 'Aura de Coragem',
    level: 10,
    description: 'Você e criaturas aliadas na aura de proteção não podem ficar amedrontadas.',
  },
  {
    id: 'improved-divine-smite',
    label: 'Fulminar Divino Aprimorado',
    level: 11,
    description: 'Todo ataque corpo a corpo que acertar causa 1d8 de dano radiante extra, mesmo sem gastar espaço de magia.',
  },
  {
    id: 'cleansing-touch',
    label: 'Toque Purificador',
    level: 14,
    description: 'Como ação, encerra uma magia em si mesmo ou numa criatura disposta que esteja tocando.',
    resource: { max: ({ abilityModifiers }) => Math.max(1, abilityModifiers.cha), recharge: 'long' },
  },
  // Trilha: Juramento de Devoção.
  {
    id: 'channel-divinity-paladin',
    label: 'Canalizar Divindade',
    level: 3,
    subclassId: 'devotion',
    description: 'Gasta um uso para Arma Sagrada (arma brilha e soma seu Carisma nos acertos) ou Afugentar o Profano (amedronta corruptores/mortos-vivos).',
    resource: { max: 1, recharge: 'short' },
  },
  {
    id: 'aura-of-devotion',
    label: 'Aura de Devoção',
    level: 7,
    subclassId: 'devotion',
    description: 'Você e aliados na sua aura não podem ficar enfeitiçados.',
  },
  {
    id: 'purity-of-spirit',
    label: 'Pureza de Espírito',
    level: 15,
    subclassId: 'devotion',
    description: 'Fica permanentemente sob o efeito de proteção contra o bem e o mal.',
  },
  {
    id: 'holy-nimbus',
    label: 'Auréola Sagrada',
    level: 20,
    subclassId: 'devotion',
    description: 'Como ação, emite luz e dano radiante a corruptores e mortos-vivos próximos, com vantagem em resistências contra magias deles, uma vez por descanso longo.',
  },
];

// ---------------------------------------------------------------------------
// Patrulheiro.
// ---------------------------------------------------------------------------

const RANGER_FEATURES: readonly ClassFeatureDefinition[] = [
  {
    id: 'favored-enemy',
    label: 'Inimigo Predileto',
    level: 1,
    description:
      'Escolhe um tipo de inimigo: vantagem em testes de Sabedoria (Sobrevivência) pra rastreá-lo e Inteligência pra lembrar informações sobre ele (mais um tipo no nível 6 e outro no 14).',
  },
  {
    id: 'natural-explorer',
    label: 'Exploradora Nata',
    level: 1,
    description: 'Escolhe um terreno favorito com vários benefícios de exploração e furtividade nele (mais um terreno no nível 6 e outro no 10).',
  },
  {
    id: 'primeval-awareness',
    label: 'Consciência Primeva',
    level: 3,
    description: 'Gasta uma ação e um espaço de magia pra sentir se certos tipos de criatura estão na região ao redor.',
  },
  {
    id: 'extra-attack-ranger',
    label: 'Ataque Extra',
    level: 5,
    description: 'Ataca duas vezes sempre que usa a ação de Ataque no seu turno.',
  },
  {
    id: 'lands-stride-ranger',
    label: 'Passo da Terra',
    level: 8,
    description: 'Atravessa terreno difícil não-mágico sem gastar deslocamento extra, e tem vantagem em resistências contra plantas mágicas que restrinjam movimento.',
  },
  {
    id: 'hide-in-plain-sight',
    label: 'Esconder-se à Vista',
    level: 10,
    description: 'Gasta um minuto se camuflando: +10 em testes de Furtividade enquanto não se mover.',
  },
  {
    id: 'vanish',
    label: 'Desaparecer',
    level: 14,
    description: 'Pode usar a ação Esconder-se como ação bônus, e não pode ser rastreado por meios não-mágicos a menos que queira.',
  },
  {
    id: 'feral-senses',
    label: 'Sentidos Selvagens',
    level: 18,
    description: 'Luta sem desvantagem contra criaturas invisíveis, desde que consiga localizá-las.',
  },
  {
    id: 'foe-slayer',
    label: 'Abatedora de Inimigos',
    level: 20,
    description: 'Uma vez por turno, soma seu modificador de Sabedoria a uma jogada de ataque ou dano contra um inimigo predileto.',
  },
  // Trilha: Caçadora.
  {
    id: 'hunters-prey',
    label: 'Presa da Caçadora',
    level: 3,
    subclassId: 'hunter',
    description:
      'Escolhe uma técnica de combate: dano extra contra criaturas grandes, dano extra ao dar o golpe de misericórdia, ou ataque bônus contra outro alvo perto de quem você já atacou.',
  },
  {
    id: 'defensive-tactics',
    label: 'Táticas Defensivas',
    level: 7,
    subclassId: 'hunter',
    description: 'Escolhe uma tática: menos ataques de oportunidade contra você em grupo, vantagem em resistência contra criaturas já enfrentadas, ou reduzir dano dividido com aliados.',
  },
  {
    id: 'multiattack-hunter',
    label: 'Múltiplos Ataques',
    level: 11,
    subclassId: 'hunter',
    description: 'Escolhe uma opção: atacar todas as criaturas ao alcance de uma vez (com desvantagem), ou um ataque corpo a corpo bônus contra outro alvo adjacente.',
  },
  {
    id: 'superior-hunters-defense',
    label: 'Defesa Superior da Caçadora',
    level: 15,
    subclassId: 'hunter',
    description: 'Escolhe uma defesa: evitar dano de área com sucesso em Destreza, dar vantagem a um aliado ao sofrer dano, ou reduzir dano de um ataque como reação.',
  },
];

// ---------------------------------------------------------------------------
// Ladino.
// ---------------------------------------------------------------------------

const ROGUE_FEATURES: readonly ClassFeatureDefinition[] = [
  {
    id: 'expertise-rogue-1',
    label: 'Especialização',
    level: 1,
    description: 'Escolhe duas perícias (ou uma perícia e ferramentas de ladrão) com proficiência: o bônus de proficiência nelas dobra.',
  },
  {
    id: 'sneak-attack',
    label: 'Ataque Furtivo',
    level: 1,
    description:
      'Uma vez por turno, causa 1d6 de dano extra num ataque com vantagem (ou sem desvantagem, com um aliado adjacente ao alvo) — o dado cresce a cada dois níveis, até 10d6 no nível 20.',
  },
  {
    id: 'cunning-action',
    label: 'Ação Ardilosa',
    level: 2,
    description: 'Como ação bônus, pode Disparar, Desengajar ou Esconder-se.',
  },
  {
    id: 'uncanny-dodge',
    label: 'Esquiva Sobrenatural',
    level: 5,
    description: 'Como reação, reduz à metade o dano de um ataque que acertou você.',
  },
  {
    id: 'expertise-rogue-2',
    label: 'Especialização (2ª vez)',
    level: 6,
    description: 'Escolhe mais duas proficiências para dobrar o bônus.',
  },
  {
    id: 'evasion-rogue',
    label: 'Evasão',
    level: 7,
    description: 'Sucesso num teste de Destreza contra um efeito em área não causa dano nenhum, e falha causa só metade.',
  },
  {
    id: 'reliable-talent',
    label: 'Talento Confiável',
    level: 11,
    description: 'Em testes de habilidade com proficiência, trata qualquer resultado de 9 ou menos no d20 como 10.',
  },
  {
    id: 'blindsense',
    label: 'Sentido Cego',
    level: 14,
    description: 'Percebe a localização de criaturas escondidas ou invisíveis a até 3m, mesmo sem conseguir vê-las.',
  },
  {
    id: 'slippery-mind',
    label: 'Mente Escorregadia',
    level: 15,
    description: 'Ganha proficiência em resistências de Sabedoria.',
  },
  {
    id: 'elusive',
    label: 'Elusivo',
    level: 18,
    description: 'Nenhuma jogada de ataque contra você tem vantagem, enquanto não estiver incapacitado.',
  },
  {
    id: 'stroke-of-luck',
    label: 'Golpe de Sorte',
    level: 20,
    description:
      'Se um ataque falhar ou um teste de habilidade não passar, pode transformá-lo em sucesso (ataque acerta, ou teste vira 20) — uma vez por descanso curto ou longo.',
    resource: { max: 1, recharge: 'short' },
  },
  // Trilha: Ladrão.
  {
    id: 'fast-hands',
    label: 'Mãos Rápidas',
    level: 3,
    subclassId: 'thief',
    description: 'A Ação Ardilosa também pode usar ferramentas de ladrão, fazer Prestidigitação ou usar um objeto.',
  },
  {
    id: 'second-story-work',
    label: 'Trabalho de Segundo Andar',
    level: 3,
    subclassId: 'thief',
    description: 'Escalar não custa deslocamento extra, e o salto em distância aumenta em metros iguais ao seu modificador de Destreza.',
  },
  {
    id: 'supreme-sneak',
    label: 'Furtividade Suprema',
    level: 9,
    subclassId: 'thief',
    description: 'Vantagem em testes de Furtividade sempre que se move a metade do deslocamento ou menos no turno.',
  },
  {
    id: 'use-magic-device',
    label: 'Usar Dispositivo Mágico',
    level: 13,
    subclassId: 'thief',
    description: 'Ignora requisitos de classe, raça e nível pra usar itens mágicos.',
  },
  {
    id: 'thiefs-reflexes',
    label: 'Reflexos de Ladrão',
    level: 17,
    subclassId: 'thief',
    description: 'Age em duas rodadas no primeiro turno do combate: uma na sua iniciativa normal, outra 10 pontos abaixo.',
  },
];

// ---------------------------------------------------------------------------
// Feiticeiro.
// ---------------------------------------------------------------------------

const SORCERER_FEATURES: readonly ClassFeatureDefinition[] = [
  {
    id: 'font-of-magic',
    label: 'Fonte de Magia',
    level: 2,
    description: 'Pontos de feitiçaria (igual ao seu nível de feiticeiro) que pode converter em espaços de magia, ou espaços em pontos, entre um descanso e outro.',
    resource: { max: ({ classLevel }) => classLevel, recharge: 'long' },
  },
  {
    id: 'metamagic',
    label: 'Metamagia',
    level: 3,
    description:
      'Escolhe duas opções de Metamagia (Feitiço Distante, Duplo, Rápido, Discreto, Cuidadoso, Estendido, Ampliado ou Silencioso) pra alterar suas magias gastando pontos de feitiçaria (mais uma opção no nível 10, outra no 17).',
  },
  {
    id: 'sorcerous-restoration',
    label: 'Restauração Feiticeira',
    level: 20,
    description: 'Recupera 4 pontos de feitiçaria sempre que termina um descanso curto.',
  },
  // Trilha: Linhagem Dracônica.
  {
    id: 'dragon-ancestor',
    label: 'Ancestral Dracônico',
    level: 1,
    subclassId: 'draconic',
    description: 'Escolhe um tipo de dragão: define o tipo de dano de certas características e magias.',
  },
  {
    id: 'draconic-resilience',
    label: 'Resiliência Dracônica',
    level: 1,
    subclassId: 'draconic',
    description: 'PV máximo aumenta em 1 por nível de feiticeiro; sem armadura, sua CA é 13 + modificador de Destreza.',
  },
  {
    id: 'elemental-affinity',
    label: 'Afinidade Elemental',
    level: 6,
    subclassId: 'draconic',
    description:
      'Ao conjurar uma magia do tipo de dano do seu ancestral, soma seu modificador de Carisma ao dano; pode gastar 1 ponto de feitiçaria pra ganhar resistência àquele tipo por 1 hora.',
  },
  {
    id: 'dragon-wings',
    label: 'Asas de Dragão',
    level: 14,
    subclassId: 'draconic',
    description: 'Como ação bônus, cria asas dracônicas: deslocamento de voo igual ao seu deslocamento atual, enquanto não estiver usando armadura pesada.',
  },
  {
    id: 'draconic-presence',
    label: 'Presença Dracônica',
    level: 18,
    subclassId: 'draconic',
    description: 'Gasta 5 pontos de feitiçaria e uma ação pra emanar temor ou admiração numa área ao redor.',
  },
];

// ---------------------------------------------------------------------------
// Bruxo.
// ---------------------------------------------------------------------------

const WARLOCK_FEATURES: readonly ClassFeatureDefinition[] = [
  {
    id: 'eldritch-invocations',
    label: 'Invocações Sobrenaturais',
    level: 2,
    description: 'Aprende invocações que concedem benefícios mágicos permanentes (duas no início, mais vagas se abrindo em níveis seguintes).',
  },
  {
    id: 'pact-boon',
    label: 'Dádiva do Pacto',
    level: 3,
    description: 'Escolhe a natureza do seu pacto: Pacto da Corrente (familiar), Pacto da Lâmina (arma pactual) ou Pacto do Tomo (grimório com truques rituais).',
  },
  {
    id: 'mystic-arcanum',
    label: 'Arcano Místico',
    level: 11,
    description: 'Aprende uma magia de 6º nível que pode conjurar uma vez por descanso longo, sem gastar espaço (mais uma de 7º no nível 13, 8º no 15, 9º no 17).',
  },
  {
    id: 'eldritch-master',
    label: 'Mestre Sobrenatural',
    level: 20,
    description: 'Gasta 1 minuto implorando ao seu patrono pra recuperar todos os espaços de Magia de Pacto gastos, uma vez por descanso longo.',
  },
  // Trilha: Pacto do Corruptor.
  {
    id: 'dark-ones-blessing',
    label: 'Bênção do Corruptor',
    level: 1,
    subclassId: 'fiend',
    description: 'Ao reduzir uma criatura hostil a 0 PV, ganha PV temporários iguais ao seu modificador de Carisma + seu nível de bruxo.',
  },
  {
    id: 'dark-ones-own-luck',
    label: 'Sorte do Próprio Corruptor',
    level: 6,
    subclassId: 'fiend',
    description: 'Soma 1d10 a um teste de habilidade ou resistência que esteja prestes a falhar.',
    resource: { max: ({ abilityModifiers }) => Math.max(1, abilityModifiers.cha), recharge: 'long' },
  },
  {
    id: 'fiendish-resilience',
    label: 'Resiliência Sinistra',
    level: 10,
    subclassId: 'fiend',
    description: 'Ao terminar um descanso curto ou longo, escolhe um tipo de dano e ganha resistência a ele até o próximo descanso.',
  },
  {
    id: 'hurl-through-hell',
    label: 'Arremessar ao Inferno',
    level: 14,
    subclassId: 'fiend',
    description: 'Ao acertar um ataque corpo a corpo, pode banir o alvo por um instante a um plano inferior — ele sofre dano psíquico ao voltar.',
    resource: { max: 1, recharge: 'long' },
  },
];

// ---------------------------------------------------------------------------
// Mago.
// ---------------------------------------------------------------------------

const WIZARD_FEATURES: readonly ClassFeatureDefinition[] = [
  {
    id: 'arcane-recovery',
    label: 'Recuperação Arcana',
    level: 1,
    description:
      'Uma vez por dia, num descanso curto, recupera espaços de magia num total de níveis igual à metade do seu nível de mago, arredondado pra cima (nenhum de 6º nível ou mais).',
    resource: { max: 1, recharge: 'long' },
  },
  {
    id: 'spell-mastery',
    label: 'Maestria em Magia',
    level: 18,
    description: 'Escolhe uma magia de 1º e uma de 2º nível do seu grimório: pode conjurá-las no nível base sem gastar espaço de magia.',
  },
  {
    id: 'signature-spells',
    label: 'Magias Assinatura',
    level: 20,
    description: 'Escolhe duas magias de 3º nível sempre preparadas; cada uma pode ser conjurada uma vez sem gastar espaço, entre um descanso e outro.',
    resource: { max: 2, recharge: 'short' },
  },
  // Trilha: Escola de Evocação.
  {
    id: 'sculpt-spells',
    label: 'Esculpir Magias',
    level: 2,
    subclassId: 'evocation',
    description:
      'Ao conjurar uma magia de evocação em área, pode proteger aliados escolhidos: eles são tratados como tendo sucesso automático na resistência e não sofrem dano se o efeito normalmente permitiria isso.',
  },
  {
    id: 'potent-cantrip',
    label: 'Truque Potente',
    level: 6,
    subclassId: 'evocation',
    description: 'Quando um alvo tem sucesso na resistência contra um truque seu, ele sofre metade do dano mesmo assim.',
  },
  {
    id: 'empowered-evocation',
    label: 'Evocação Potencializada',
    level: 10,
    subclassId: 'evocation',
    description: 'Soma seu modificador de Inteligência ao dano de uma magia de evocação sua.',
  },
  {
    id: 'overchannel',
    label: 'Sobrecarga',
    level: 14,
    subclassId: 'evocation',
    description: 'Ao conjurar uma magia de evocação até o 5º nível, pode causar dano máximo — usar de novo antes de um descanso longo causa dano a você mesmo.',
    resource: { max: 1, recharge: 'long' },
  },
];

const CLASS_FEATURES: Readonly<Record<ClassId, readonly ClassFeatureDefinition[]>> = {
  barbarian: BARBARIAN_FEATURES,
  bard: BARD_FEATURES,
  cleric: CLERIC_FEATURES,
  druid: DRUID_FEATURES,
  fighter: FIGHTER_FEATURES,
  monk: MONK_FEATURES,
  paladin: PALADIN_FEATURES,
  ranger: RANGER_FEATURES,
  rogue: ROGUE_FEATURES,
  sorcerer: SORCERER_FEATURES,
  warlock: WARLOCK_FEATURES,
  wizard: WIZARD_FEATURES,
};

function resolveMax(resource: ClassFeatureResourceDefinition, ctx: FeatureResourceContext): number {
  return typeof resource.max === 'function' ? resource.max(ctx) : resource.max;
}

function resolveRecharge(
  resource: ClassFeatureResourceDefinition,
  classLevel: number,
): ResourceRecharge {
  return typeof resource.recharge === 'function' ? resource.recharge({ classLevel }) : resource.recharge;
}

/** Calcula quais características de classe/trilha o personagem já tem, agora. */
export function resolveClassFeatures(
  character: Pick<Character, 'classes' | 'abilities'>,
): Feature[] {
  const abilityModifiers = Object.fromEntries(
    ABILITIES.map((ability) => [ability, abilityModifier(character.abilities[ability])]),
  ) as Record<Ability, number>;

  const features: Feature[] = [];

  for (const entry of character.classes) {
    const classLabel = CLASSES[entry.classId].label;
    const subclassLabel = entry.subclassId
      ? SUBCLASSES[entry.classId].find((sub) => sub.id === entry.subclassId)?.label
      : undefined;

    for (const def of CLASS_FEATURES[entry.classId]) {
      if (def.level > entry.level) continue;
      if (def.subclassId !== undefined && def.subclassId !== entry.subclassId) continue;

      const id = `class:${entry.classId}:${def.id}`;
      const resourceCtx: FeatureResourceContext = { classLevel: entry.level, abilityModifiers };

      features.push({
        id,
        label: def.label,
        source: def.subclassId ? (subclassLabel ?? classLabel) : classLabel,
        description: def.description,
        resource: def.resource
          ? {
              id,
              label: def.label,
              max: resolveMax(def.resource, resourceCtx),
              spent: 0,
              recharge: resolveRecharge(def.resource, entry.level),
            }
          : undefined,
      });
    }

    for (const level of CLASSES[entry.classId].abilityScoreImprovementLevels) {
      if (level > entry.level) continue;
      features.push({
        id: `class:${entry.classId}:asi:${level}`,
        label: 'Melhoria de Atributo',
        source: classLabel,
        description:
          'Aumente um atributo em 2, ou dois atributos em 1 cada (até o máximo de 20) — ou troque por um talento, se a mesa usar essa regra.',
      });
    }
  }

  return features;
}

/**
 * Grava o resultado de `resolveClassFeatures` dentro de `character.features`,
 * preservando usos já gastos e sem tocar em nada que não tenha o prefixo
 * `class:`. Devolve a mesma referência de `character` quando não há nada pra
 * mudar — importante pra quem chama isto num `useEffect` não entrar em loop.
 */
export function syncClassFeatures(character: Character): Character {
  const resolvedById = new Map(resolveClassFeatures(character).map((feature) => [feature.id, feature]));

  let changed = false;
  const merged: Feature[] = [];

  for (const feature of character.features) {
    if (!feature.id.startsWith('class:')) {
      merged.push(feature);
      continue;
    }

    const next = resolvedById.get(feature.id);
    if (!next) {
      changed = true; // Classe removida, nível baixou ou trilha trocou: some.
      continue;
    }
    resolvedById.delete(feature.id);

    const spent =
      feature.resource && next.resource ? Math.min(feature.resource.spent, next.resource.max) : 0;
    const sameResource =
      (feature.resource === undefined) === (next.resource === undefined) &&
      (!feature.resource ||
        !next.resource ||
        (feature.resource.max === next.resource.max &&
          feature.resource.recharge === next.resource.recharge &&
          feature.resource.spent === spent));

    if (
      feature.label === next.label &&
      feature.description === next.description &&
      feature.source === next.source &&
      sameResource
    ) {
      merged.push(feature);
      continue;
    }

    changed = true;
    merged.push({ ...next, resource: next.resource ? { ...next.resource, spent } : undefined });
  }

  for (const feature of resolvedById.values()) {
    changed = true;
    merged.push(feature);
  }

  return changed ? { ...character, features: merged } : character;
}
