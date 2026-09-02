// Content and demo scripts for the How to Play screen (RulesScreen.tsx / RulesDemo.tsx).
//
// Written as data, not JSX, for one reason: every frame carries the caption that describes it,
// so the same script drives both the animation and the written step list that stands in for it.
// A screen reader (or anyone with the animation paused) reads the identical sequence - there is
// no second, hand-maintained copy of the explanation to drift out of sync with the picture.
//
// Every rule stated here is one the engine actually implements - see GameEngine.ts's
// getLegalMoves / planMovement and constants.ts's CARD_DEFS.

import type { CardRank } from '@crazypixel/shared';

/** Home-stretch cells the demo strip draws at its right-hand end. Matches HOME_STRETCH_LENGTH. */
export const DEMO_HOME_CELLS = 4;

export type DemoRole = 'you' | 'rival';

export interface DemoSlot {
  zone: 'kennel' | 'track' | 'home';
  index: number;
}

export interface DemoMarble {
  /** Stable across frames: the DOM node persists, so a position change animates as a walk
   * rather than one marble vanishing and another appearing. A NEW id in a later frame is
   * therefore a deliberate "and here are three more" beat, not a mistake. */
  id: string;
  role: DemoRole;
  at: DemoSlot;
}

export interface TrackFrame {
  caption: string;
  marbles: DemoMarble[];
  /**
   * The marble that WALKS this frame, square by square, the way TableScene animates a real
   * move. Everything else takes the board's plain 220ms tween (a Jack swap, a marble leaving
   * the kennel, a captured marble going home) - the same split planMarbles makes.
   */
  walker?: string;
  /**
   * The squares the walk covers, in walk order and INCLUDING the one departed from - matching
   * TableScene.walkMarble, which drops a trail mark on the departure square before stepping.
   * So `trail.length - 1` is the number of legs, and the walk's duration falls out of it.
   */
  trail?: number[];
  /** Track squares flashed as a capture on this frame. */
  captured?: number[];
  /** Lights the home stretch, for the frames where one is reached or earned. */
  homeLit?: boolean;
}

export interface TrackDemo {
  kind: 'track';
  /** Track squares this particular script needs. Per-demo rather than one global width so a
   * plain 3 gets big, readable cells instead of being squeezed to the King's 13-square scale. */
  trackCells: number;
  frames: TrackFrame[];
}

export type DemoLane = 'them' | 'you';

export interface DemoCard {
  /** Stable across frames, like DemoMarble.id - this is what animates a card between lanes. */
  id: string;
  lane: DemoLane;
  slot: number;
  /** null renders a face-down back. */
  rank: CardRank | null;
  /** Changing this replays the flip animation on the face (RulesDemo keys the face on it). */
  flipKey?: string;
  highlight?: boolean;
}

export interface CardFrame {
  caption: string;
  cards: DemoCard[];
}

export interface CardsDemo {
  kind: 'cards';
  laneLabels: Partial<Record<DemoLane, string>>;
  frames: CardFrame[];
}

export type RuleDemo = TrackDemo | CardsDemo;

export interface RuleCard {
  rank: CardRank;
  name: string;
  /** One line, shown under the rank heading and used as the tab's accessible name. */
  summary: string;
  demo: RuleDemo;
  /** Anything true of the card that no frame of the demo shows. */
  note?: string;
}

const kennel = (index: number): DemoSlot => ({ zone: 'kennel', index });
const track = (index: number): DemoSlot => ({ zone: 'track', index });
const home = (index: number): DemoSlot => ({ zone: 'home', index });

/** Inclusive, and counts down when `to` is behind `from` - the 4's backward walk needs the
 * trail in the order it was actually walked, not sorted. */
function walk(from: number, to: number): number[] {
  const step = to >= from ? 1 : -1;
  const out: number[] = [];
  for (let i = from; i !== to + step; i += step) out.push(i);
  return out;
}

/** The shape shared by every card that only ever moves one marble a fixed distance. */
function plainMove(steps: number): TrackDemo {
  return {
    kind: 'track',
    trackCells: steps + 2,
    frames: [
      {
        caption: 'One of your marbles, already out on the track.',
        marbles: [{ id: 'you', role: 'you', at: track(0) }],
      },
      {
        caption: `Move it exactly ${steps} squares forward. No choice, no split.`,
        marbles: [{ id: 'you', role: 'you', at: track(steps) }],
        walker: 'you',
        trail: walk(0, steps),
      },
    ],
  };
}

/** The overview demo on the How to Play screen - a whole game in five beats. */
export const GOAL_DEMO: TrackDemo = {
  kind: 'track',
  trackCells: 14,
  frames: [
    {
      caption: 'Four of your marbles wait in the kennel. Only an Ace, a King or a Joker opens the door.',
      marbles: [
        { id: 'you', role: 'you', at: kennel(0) },
        { id: 'rival', role: 'rival', at: track(9) },
      ],
    },
    {
      caption: 'A starting card puts one on your own start square, where it also blocks the way for everyone.',
      marbles: [
        { id: 'you', role: 'you', at: track(0) },
        { id: 'rival', role: 'rival', at: track(9) },
      ],
    },
    {
      caption: 'From there cards carry it around the shared track - and anything you land on is sent back to its own kennel.',
      marbles: [
        { id: 'you', role: 'you', at: track(9) },
        { id: 'rival', role: 'rival', at: kennel(0) },
      ],
      walker: 'you',
      trail: walk(0, 9),
      captured: [9],
    },
    {
      caption: 'One full lap later you reach your own start square again, and turn off the track into your private home stretch.',
      marbles: [
        { id: 'you', role: 'you', at: home(0) },
        { id: 'rival', role: 'rival', at: kennel(0) },
      ],
      walker: 'you',
      trail: walk(9, 13),
      homeLit: true,
    },
    {
      caption: 'Get all four of your marbles home to win - in Partners mode, you and your partner together.',
      marbles: [
        { id: 'you', role: 'you', at: home(0) },
        { id: 'you2', role: 'you', at: home(1) },
        { id: 'you3', role: 'you', at: home(2) },
        { id: 'you4', role: 'you', at: home(3) },
      ],
      homeLit: true,
    },
  ],
};

export const RULE_CARDS: RuleCard[] = [
  {
    rank: 'A',
    name: 'Ace',
    summary: 'Start a marble, or move 1 or 11.',
    demo: {
      kind: 'track',
      trackCells: 13,
      frames: [
        {
          caption: 'A marble sitting in your kennel.',
          marbles: [{ id: 'you', role: 'you', at: kennel(0) }],
        },
        {
          caption: 'An Ace brings it out onto your start square.',
          marbles: [{ id: 'you', role: 'you', at: track(0) }],
        },
        {
          caption: 'Or, for a marble already out, move one square…',
          marbles: [{ id: 'you', role: 'you', at: track(1) }],
          walker: 'you',
          trail: walk(0, 1),
        },
        {
          caption: '…or eleven. You pick which, every time you play it.',
          marbles: [{ id: 'you', role: 'you', at: track(12) }],
          walker: 'you',
          trail: walk(1, 12),
        },
      ],
    },
  },
  {
    rank: 'K',
    name: 'King',
    summary: 'Start a marble, or move 13.',
    demo: {
      kind: 'track',
      trackCells: 14,
      frames: [
        {
          caption: 'The King opens the kennel too.',
          marbles: [{ id: 'you', role: 'you', at: kennel(0) }],
        },
        {
          caption: 'Out onto your start square, same as an Ace.',
          marbles: [{ id: 'you', role: 'you', at: track(0) }],
        },
        {
          caption: 'Or spend it as thirteen squares - the longest single move in the deck.',
          marbles: [{ id: 'you', role: 'you', at: track(13) }],
          walker: 'you',
          trail: walk(0, 13),
        },
      ],
    },
  },
  {
    rank: 'Q',
    name: 'Queen',
    summary: 'Move 12.',
    demo: plainMove(12),
  },
  {
    rank: 'J',
    name: 'Jack',
    summary: 'Swap any two marbles on the track.',
    demo: {
      kind: 'track',
      trackCells: 12,
      frames: [
        {
          caption: 'Your marble on one square, somebody else’s further along.',
          marbles: [
            { id: 'you', role: 'you', at: track(3) },
            { id: 'rival', role: 'rival', at: track(10) },
          ],
        },
        {
          caption: 'The Jack simply trades their places. Nothing is walked, so nothing in between matters.',
          marbles: [
            { id: 'you', role: 'you', at: track(10) },
            { id: 'rival', role: 'rival', at: track(3) },
          ],
        },
        {
          caption: 'One of the two has to be yours, and a marble still guarding its own start square is off limits.',
          marbles: [
            { id: 'you', role: 'you', at: track(10) },
            { id: 'rival', role: 'rival', at: track(3) },
          ],
        },
      ],
    },
    note: 'Neither marble is captured - a swap only moves them.',
  },
  { rank: '10', name: 'Ten', summary: 'Move 10.', demo: plainMove(10) },
  { rank: '9', name: 'Nine', summary: 'Move 9.', demo: plainMove(9) },
  {
    rank: '8',
    name: 'Eight',
    summary: 'Move 8, or replay the last card played.',
    demo: {
      kind: 'cards',
      laneLabels: { them: 'Last card played', you: 'Your hand' },
      frames: [
        {
          caption: 'Somebody just played a Queen.',
          cards: [{ id: 'last', lane: 'them', slot: 0, rank: 'Q' }],
        },
        {
          caption: 'You are holding an eight.',
          cards: [
            { id: 'last', lane: 'them', slot: 0, rank: 'Q' },
            { id: 'mine', lane: 'you', slot: 0, rank: '8' },
          ],
        },
        {
          caption: 'Play it as a copy and it becomes that Queen - twelve squares forward, for you.',
          cards: [
            { id: 'last', lane: 'them', slot: 0, rank: 'Q' },
            { id: 'mine', lane: 'you', slot: 0, rank: 'Q', flipKey: 'copy', highlight: true },
          ],
        },
        {
          caption: 'It cannot copy another eight, and a passed hand is not a played card - there is nothing to copy after one.',
          cards: [
            { id: 'last', lane: 'them', slot: 0, rank: 'Q' },
            { id: 'mine', lane: 'you', slot: 0, rank: 'Q', flipKey: 'copy' },
          ],
        },
      ],
    },
    note: 'Or ignore all that and move a marble eight squares forward.',
  },
  {
    rank: '7',
    name: 'Seven',
    summary: 'Split seven steps across your marbles.',
    demo: {
      kind: 'track',
      trackCells: 14,
      frames: [
        {
          caption: 'Two of your marbles on the track, and a rival parked between them.',
          marbles: [
            { id: 'a', role: 'you', at: track(2) },
            { id: 'b', role: 'you', at: track(8) },
            { id: 'rival', role: 'rival', at: track(10) },
          ],
        },
        {
          caption: 'Spend three of the seven on the first marble…',
          marbles: [
            { id: 'a', role: 'you', at: track(5) },
            { id: 'b', role: 'you', at: track(8) },
            { id: 'rival', role: 'rival', at: track(10) },
          ],
          walker: 'a',
          trail: walk(2, 5),
        },
        {
          caption: '…and the last four on the second. A seven sends home everything it walks over, not just what it lands on.',
          marbles: [
            { id: 'a', role: 'you', at: track(5) },
            { id: 'b', role: 'you', at: track(12) },
            { id: 'rival', role: 'rival', at: kennel(0) },
          ],
          walker: 'b',
          trail: walk(8, 12),
          captured: [10],
        },
        {
          caption: 'Steps resolve one at a time, so an early one can clear a blockade for a later one. Marbles already in a home stretch still cannot be jumped.',
          marbles: [
            { id: 'a', role: 'you', at: track(5) },
            { id: 'b', role: 'you', at: track(12) },
            { id: 'rival', role: 'rival', at: kennel(0) },
          ],
        },
      ],
    },
    note: 'In Partners mode the steps may go on your partner’s marbles as well as your own.',
  },
  { rank: '6', name: 'Six', summary: 'Move 6.', demo: plainMove(6) },
  { rank: '5', name: 'Five', summary: 'Move 5.', demo: plainMove(5) },
  {
    rank: '4',
    name: 'Four',
    summary: 'Move 4 forward or 4 backward.',
    demo: {
      kind: 'track',
      trackCells: 10,
      frames: [
        {
          caption: 'Your marble, four squares past your own start.',
          marbles: [{ id: 'you', role: 'you', at: track(4) }],
        },
        {
          caption: 'Four squares forward…',
          marbles: [{ id: 'you', role: 'you', at: track(8) }],
          walker: 'you',
          trail: walk(4, 8),
        },
        {
          caption: '…or four backward. It is the only card in the deck that reverses.',
          marbles: [{ id: 'you', role: 'you', at: track(4) }],
          walker: 'you',
          trail: walk(8, 4),
        },
        {
          caption: 'Backing exactly onto your own start square earns your home entry - without walking a whole lap for it.',
          marbles: [{ id: 'you', role: 'you', at: track(0) }],
          walker: 'you',
          trail: walk(4, 0),
          homeLit: true,
        },
      ],
    },
    note: 'Backward never enters home directly - it earns the right, which a later forward move spends.',
  },
  { rank: '3', name: 'Three', summary: 'Move 3.', demo: plainMove(3) },
  {
    rank: '2',
    name: 'Two',
    summary: 'Move 2, or steal a card blind.',
    demo: {
      kind: 'cards',
      laneLabels: { them: 'An opponent’s hand', you: 'Your hand' },
      frames: [
        {
          caption: 'An opponent’s hand. You cannot see any of it.',
          cards: [
            { id: 't0', lane: 'them', slot: 0, rank: null },
            { id: 't1', lane: 'them', slot: 1, rank: null },
            { id: 't2', lane: 'them', slot: 2, rank: null },
            { id: 'two', lane: 'you', slot: 0, rank: '2' },
          ],
        },
        {
          caption: 'Play your two and point at a position - you are choosing a slot, not a card.',
          cards: [
            { id: 't0', lane: 'them', slot: 0, rank: null },
            { id: 't1', lane: 'them', slot: 1, rank: null, highlight: true },
            { id: 't2', lane: 'them', slot: 2, rank: null },
            { id: 'two', lane: 'you', slot: 0, rank: '2' },
          ],
        },
        {
          caption: 'It is yours now, whatever it turned out to be. Sometimes a King, sometimes a three.',
          cards: [
            { id: 't0', lane: 'them', slot: 0, rank: null },
            { id: 't2', lane: 'them', slot: 2, rank: null },
            { id: 'two', lane: 'you', slot: 0, rank: '2' },
            { id: 't1', lane: 'you', slot: 1, rank: 'K', flipKey: 'taken', highlight: true },
          ],
        },
      ],
    },
    note: 'Never from your partner - only from an opponent. Or just move a marble two squares forward.',
  },
  {
    rank: 'JOKER',
    name: 'Joker',
    summary: 'Any rank you name.',
    demo: {
      kind: 'cards',
      laneLabels: { you: 'Your hand' },
      frames: [
        {
          caption: 'The Joker has no rank of its own.',
          cards: [{ id: 'j', lane: 'you', slot: 0, rank: 'JOKER' }],
        },
        {
          caption: 'Name one as you play it. An Ace, to open the kennel…',
          cards: [{ id: 'j', lane: 'you', slot: 0, rank: 'A', flipKey: 'a', highlight: true }],
        },
        {
          caption: '…a Jack, to swap two marbles…',
          cards: [{ id: 'j', lane: 'you', slot: 0, rank: 'J', flipKey: 'j', highlight: true }],
        },
        {
          caption: '…or a seven, and split it like one. It becomes that card completely, house rules included.',
          cards: [{ id: 'j', lane: 'you', slot: 0, rank: '7', flipKey: 's', highlight: true }],
        },
      ],
    },
  },
];
