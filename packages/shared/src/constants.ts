import type { CardRank, PlayerId } from './types';

export interface CardDef {
  rank: CardRank;
  /** Forward(+)/backward(-) step options this card offers as a plain move. */
  moveOptions: number[];
  canStart: boolean;
  isJack: boolean;
  isSevenSplit: boolean;
  isWild: boolean;
  /** House rule: move 2 forward OR force an opponent to draw a card. */
  customTwo: boolean;
  /** House rule: move 8 forward OR replay the last played card's effect. */
  customEight: boolean;
}

export const CARD_DEFS: Record<CardRank, CardDef> = {
  A:     { rank: 'A',     moveOptions: [1, 11], canStart: true,  isJack: false, isSevenSplit: false, isWild: false, customTwo: false, customEight: false },
  K:     { rank: 'K',     moveOptions: [13],    canStart: true,  isJack: false, isSevenSplit: false, isWild: false, customTwo: false, customEight: false },
  JOKER: { rank: 'JOKER', moveOptions: [],      canStart: true,  isJack: false, isSevenSplit: false, isWild: true,  customTwo: false, customEight: false },
  J:     { rank: 'J',     moveOptions: [],      canStart: false, isJack: true,  isSevenSplit: false, isWild: false, customTwo: false, customEight: false },
  '7':   { rank: '7',     moveOptions: [],      canStart: false, isJack: false, isSevenSplit: true,  isWild: false, customTwo: false, customEight: false },
  Q:     { rank: 'Q',     moveOptions: [12],    canStart: false, isJack: false, isSevenSplit: false, isWild: false, customTwo: false, customEight: false },
  '10':  { rank: '10',    moveOptions: [10],    canStart: false, isJack: false, isSevenSplit: false, isWild: false, customTwo: false, customEight: false },
  '9':   { rank: '9',     moveOptions: [9],     canStart: false, isJack: false, isSevenSplit: false, isWild: false, customTwo: false, customEight: false },
  '8':   { rank: '8',     moveOptions: [8],     canStart: false, isJack: false, isSevenSplit: false, isWild: false, customTwo: false, customEight: true },
  '6':   { rank: '6',     moveOptions: [6],     canStart: false, isJack: false, isSevenSplit: false, isWild: false, customTwo: false, customEight: false },
  '5':   { rank: '5',     moveOptions: [5],     canStart: false, isJack: false, isSevenSplit: false, isWild: false, customTwo: false, customEight: false },
  '4':   { rank: '4',     moveOptions: [4, -4], canStart: false, isJack: false, isSevenSplit: false, isWild: false, customTwo: false, customEight: false },
  '3':   { rank: '3',     moveOptions: [3],     canStart: false, isJack: false, isSevenSplit: false, isWild: false, customTwo: false, customEight: false },
  '2':   { rank: '2',     moveOptions: [2],     canStart: false, isJack: false, isSevenSplit: false, isWild: false, customTwo: true,  customEight: false },
};

/** Cards dealt per round; cycles back to 6 after 2. */
export const ROUND_DEAL_SIZES = [6, 5, 4, 3, 2];

export const PLAYER_IDS: PlayerId[] = [0, 1, 2, 3];
export const PARTNER_OF: Record<PlayerId, PlayerId> = { 0: 2, 1: 3, 2: 0, 3: 1 };
export const TEAM_OF: Record<PlayerId, 0 | 1> = { 0: 0, 1: 1, 2: 0, 3: 1 };

export const ARM_LENGTH = 16;
export const TRACK_LENGTH = ARM_LENGTH * 4; // 64
export const HOME_STRETCH_LENGTH = 4;
export const KENNEL_SIZE = 4;

/** Global track index each player's marbles enter the board on. */
export const START_INDEX: Record<PlayerId, number> = { 0: 0, 1: 16, 2: 32, 3: 48 };
