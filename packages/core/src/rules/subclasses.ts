import type { ClassId } from './classes.js';

/**
 * Trilhas (subclasses).
 *
 * O SRD 5.1 traz exatamente uma trilha por classe — as demais (as várias
 * opções dos livros pagos) ficam de fora por licença, igual já acontece com
 * magias e monstros. Isso não impede o jogador de *escolher* uma trilha de
 * outro livro na mesa; só significa que, por enquanto, só esta aparece pronta
 * pra seleção no app.
 */

export interface SubclassDefinition {
  readonly id: string;
  readonly label: string;
  /** Uma linha de sabor — não é o texto de regra completo. */
  readonly description: string;
}

export const SUBCLASSES: Readonly<Record<ClassId, readonly SubclassDefinition[]>> = {
  barbarian: [
    {
      id: 'berserker',
      label: 'Trilha do Furioso',
      description: 'A fúria vira violência pura — mais dano, mais risco, sem limites.',
    },
  ],
  bard: [
    {
      id: 'lore',
      label: 'Colégio do Conhecimento',
      description: 'Magia através de palavras e música coletadas de toda parte, capaz de quase tudo.',
    },
  ],
  cleric: [
    {
      id: 'life',
      label: 'Domínio da Vida',
      description: 'O domínio da cura — magias e canalizações voltadas a manter o grupo de pé.',
    },
  ],
  druid: [
    {
      id: 'land',
      label: 'Círculo da Terra',
      description: 'Magia ligada a um bioma específico, com truques e magias extras do seu terreno.',
    },
  ],
  fighter: [
    {
      id: 'champion',
      label: 'Campeão',
      description: 'Simples e brutal: mais chance de acerto crítico e mais resistência física.',
    },
  ],
  monk: [
    {
      id: 'open-hand',
      label: 'Caminho da Mão Aberta',
      description: 'Golpes desarmados que derrubam, empurram ou atordoam — o monge marcial clássico.',
    },
  ],
  paladin: [
    {
      id: 'devotion',
      label: 'Juramento de Devoção',
      description: 'O ideal do cavaleiro sagrado: proteção, verdade e punição ao mal.',
    },
  ],
  ranger: [
    {
      id: 'hunter',
      label: 'Caçador',
      description: 'Táticas específicas contra grupos de inimigos ou uma presa poderosa.',
    },
  ],
  rogue: [
    {
      id: 'thief',
      label: 'Ladrão',
      description: 'Mais rápido com as mãos e os pés — dois usos de objeto por turno, escalada sem custo.',
    },
  ],
  sorcerer: [
    {
      id: 'draconic',
      label: 'Linhagem Dracônica',
      description: 'Sangue de dragão: mais PV, uma resistência elemental e, depois, asas.',
    },
  ],
  warlock: [
    {
      id: 'fiend',
      label: 'Pacto do Corruptor',
      description: 'Um patrono infernal — magias de dano e fogo, e uma rede de segurança contra a morte.',
    },
  ],
  wizard: [
    {
      id: 'evocation',
      label: 'Escola de Evocação',
      description: 'Magia de dano em área sem ferir os aliados no meio — a escola do combate direto.',
    },
  ],
};
