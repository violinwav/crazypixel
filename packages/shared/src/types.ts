export type PlayerId = 0 | 1 | 2 | 3;

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
  /** kennel: 0-3 slot. track: 0-63 global index. home: 0-3 home-stretch slot. */
  index: number;
}

export interface Marble {
  id: string;
  owner: PlayerId;
  location: MarbleLocation;
}

export type GamePhase = 'dealing' | 'cardPass' | 'playing' | 'roundEnd' | 'gameEnd';

export interface GameState {
  marbles: Marble[];
  hands: Record<PlayerId, Card[]>;
  drawPile: Card[];
  discardPile: Card[];
  lastPlayedCard: Card | null;
  lastPlayedBy: PlayerId | null;
  roundIndex: number;
  dealerIndex: PlayerId;
  currentPlayer: PlayerId;
  phase: GamePhase;
  winningTeam: 0 | 1 | null;
}

export type Move =
  | { kind: 'startMarble'; card: Card; marbleId: string }
  | { kind: 'moveMarble'; card: Card; marbleId: string; steps: number }
  | { kind: 'splitSeven'; card: Card; steps: { marbleId: string; steps: number }[] }
  | { kind: 'swapJack'; card: Card; marbleIdA: string; marbleIdB: string }
  | { kind: 'forceDraw'; card: Card; targetPlayer: PlayerId }
  | { kind: 'copyLastCard'; card: Card; innerMove: Move };
