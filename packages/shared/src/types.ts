export type PlayerId = 0 | 1 | 2 | 3 | 4 | 5;

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';

export type CardRank =
  | 'A' | 'K' | 'Q' | 'J' | '10' | '9' | '8' | '7' | '6' | '5' | '4' | '3' | '2' | 'JOKER';

export interface Card {
  id: string;
  suit: Suit | null;
  rank: CardRank;
}

export type Zone = 'kennel' | 'track' | 'home';

export interface MarbleLocation {
  zone: Zone;
  /** kennel: 0-3 slot. track: global index, range depends on player count (ARM_LENGTH *
   * playerCount). home: 0-(HOME_STRETCH_LENGTH-1) home-stretch slot. */
  index: number;
}

export interface Marble {
  id: string;
  owner: PlayerId;
  location: MarbleLocation;
  /** Has this marble, since it was last sent to the kennel, ever landed exactly on its own
   * start square (via completing a forward lap, or the backward-4 house rule)? That's what
   * actually grants "the right to enter home" a real board game gives you there - see
   * planMovement's atEntrance check in GameEngine.ts. A marble freshly placed by
   * startMarble sits on that same square with this still false; only a move that lands it
   * there counts. */
  hasLapped: boolean;
}

export type GamePhase = 'dealing' | 'cardPass' | 'playing' | 'roundEnd' | 'gameEnd';

export type GameMode = 'ffa' | 'teams';

export interface GameConfig {
  /** 3 is ffa-only - odd counts have no symmetric partner to pair with (see partnerOf in
   * constants.ts), enforced client-side (PlayerSetupPicker.tsx locks Partners out for it). */
  playerCount: 2 | 3 | 4 | 6;
  mode: GameMode;
}

export interface GameState {
  config: GameConfig;
  marbles: Marble[];
  /** Always all 6 slots allocated regardless of config.playerCount - simpler than a
   * partial/sparse record, and inactive slots just stay empty arrays, never iterated. */
  hands: Record<PlayerId, Card[]>;
  drawPile: Card[];
  discardPile: Card[];
  lastPlayedCard: Card | null;
  lastPlayedBy: PlayerId | null;
  roundIndex: number;
  dealerIndex: PlayerId;
  currentPlayer: PlayerId;
  phase: GamePhase;
  /** The player(s) who got every marble home first - both members of a team in 'teams'
   * mode, a single player in 'ffa'. */
  winners: PlayerId[] | null;
}

export type Move =
  | { kind: 'startMarble'; card: Card; marbleId: string }
  | { kind: 'moveMarble'; card: Card; marbleId: string; steps: number }
  | { kind: 'splitSeven'; card: Card; steps: { marbleId: string; steps: number }[] }
  | { kind: 'swapJack'; card: Card; marbleIdA: string; marbleIdB: string }
  | { kind: 'forceDraw'; card: Card; targetPlayer: PlayerId; targetCardIndex: number }
  | { kind: 'copyLastCard'; card: Card; innerMove: Move }
  | { kind: 'wildAs'; card: Card; asRank: CardRank; innerMove: Move };
