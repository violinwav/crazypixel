// The shared data model. Every package reads and writes these shapes; the rules that
// interpret them live in GameEngine.ts.

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
  /**
   * kennel: 0-3 slot. track: global index, 0 to (ARM_LENGTH * playerCount - 1).
   * home: 0 to (HOME_STRETCH_LENGTH - 1) home-stretch slot.
   */
  index: number;
}

export interface Marble {
  id: string;
  owner: PlayerId;
  location: MarbleLocation;
  /**
   * Has this marble landed exactly on its own start square since it was last kenneled -
   * by completing a forward lap, or via the backward-4 house rule? That is what grants the
   * right to enter home (see planMovement's atEntrance check). A marble freshly placed by
   * startMarble sits on the same square with this still false: only a move that *lands*
   * there counts.
   */
  hasLapped: boolean;
}

export type GamePhase = 'dealing' | 'cardPass' | 'playing' | 'roundEnd' | 'gameEnd';

export type GameMode = 'ffa' | 'teams';

export interface GameConfig {
  /**
   * 3 and 5 are ffa-only - odd counts have no symmetric partner to pair with (see
   * partnerOf). Enforced client-side (PlayerSetupPicker.tsx) and server-side
   * (GameRoom.handleStartGame). 5 only ever arises from an online lobby's actual join
   * count; local setup offers 2/3/4/6.
   */
  playerCount: 2 | 3 | 4 | 5 | 6;
  mode: GameMode;
}

export interface GameState {
  config: GameConfig;
  marbles: Marble[];
  /**
   * Always all 6 slots regardless of config.playerCount - simpler than a sparse record;
   * inactive slots stay empty arrays and are never iterated.
   */
  hands: Record<PlayerId, Card[]>;
  drawPile: Card[];
  discardPile: Card[];
  lastPlayedCard: Card | null;
  lastPlayedBy: PlayerId | null;
  roundIndex: number;
  /**
   * Who dealt the current round. Rotates one seat per deal, and the round's first turn goes
   * to the seat after this one (see advanceTurn), so the opening seat walks round the table
   * instead of following on from whoever happened to play last.
   */
  dealerIndex: PlayerId;
  currentPlayer: PlayerId;
  phase: GamePhase;
  /** Who got every marble home first - both partners in 'teams', one player in 'ffa'. */
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
