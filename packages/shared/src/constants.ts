// Card definitions and the config-aware seat/track helpers every rule is derived from.
// Player count and team mode are runtime choices (see GameConfig), so anything that used to
// be a fixed 4-player constant is a function of `config` here.

import type { CardRank, GameConfig, PlayerId } from './types';

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

export const HOME_STRETCH_LENGTH = 4;
export const KENNEL_SIZE = 4;

/**
 * Squares per player's arm of the track, fixed regardless of player count - the board grows
 * with more players rather than cramming them onto a fixed ring. 4 players is a 64-square
 * track, 6 players is 96.
 */
export const ARM_LENGTH = 16;

export function trackLengthFor(config: GameConfig): number {
  return ARM_LENGTH * config.playerCount;
}

export function activePlayerIds(config: GameConfig): PlayerId[] {
  return Array.from({ length: config.playerCount }, (_, i) => i as PlayerId);
}

/**
 * Player p's start square, always at global track index p * ARM_LENGTH - arms follow each
 * other around the ring, so seats are evenly spaced by construction. Takes `config` for
 * signature parity with the other helpers here, even though it doesn't need it.
 */
export function startIndexFor(config: GameConfig, player: PlayerId): number {
  return player * ARM_LENGTH;
}

/**
 * The seat directly opposite in 'teams' mode (4P: 0<->2, 1<->3; 6P: 0<->3, 1<->4, 2<->5).
 * Always null in 'ffa' - every player is on their own.
 */
export function partnerOf(config: GameConfig, player: PlayerId): PlayerId | null {
  if (config.mode !== 'teams') return null;
  return ((player + config.playerCount / 2) % config.playerCount) as PlayerId;
}

/**
 * Every active player who is neither this player nor their partner - in 'ffa' that's
 * everyone else. Used for the custom-2's force-draw target list.
 */
export function opponentsOf(config: GameConfig, player: PlayerId): PlayerId[] {
  const partner = partnerOf(config, player);
  return activePlayerIds(config).filter((p) => p !== player && p !== partner);
}
