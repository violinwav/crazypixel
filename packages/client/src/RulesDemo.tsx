// The animated diagram on the How to Play screen, plus the written step list that carries the
// same information without it.
//
// Two deliberate choices here:
//   - The stage is aria-hidden and the <ol> beneath it is the accessible equivalent. Every
//     frame's caption is already the sentence that describes the picture (see rulesContent.ts),
//     so there is one explanation, rendered twice, rather than a diagram plus a separately
//     maintained text alternative.
//   - The steps are buttons that scrub the demo, and pressing one pauses playback. That is what
//     satisfies WCAG 2.2.2 for looping content - the RulesScreen's Play/Pause is the other half.
//
// Frame state lives in the parent so the step list, the stage and the Play/Pause control can
// never disagree about which frame is showing.

import type { CSSProperties } from 'react';
import { CARD_BACK_SPRITE, CARD_FACE_SPRITE } from './game/cardArt';
import { CardRankIndices } from './CardRankIndices';
import { PlayerMarble } from './PlayerMarble';
import { hueToCss } from './game/color';
import { DEMO_HOME_CELLS } from './game/rulesContent';
import type { CardsDemo, DemoLane, DemoSlot, RuleDemo, TrackDemo, TrackFrame } from './game/rulesContent';

const LANE_ORDER: DemoLane[] = ['them', 'you'];

// The board's own tile art, same three files TableScene preloads. Paths duplicated rather
// than shared through a module: TableScene hands them to Phaser's loader and this hands them
// to CSS, and neither wants the other's plumbing.
const TILE_TRACK = '/sprites/tile-track.png';
const TILE_START = '/sprites/tile-start.png';
const TILE_QUARTER = '/sprites/tile-quarter.png';

// Motion constants copied from TableScene so a demo walk runs at the board's own pace: one
// square every WALK_STEP_MS, linearly, so a 13-square move takes thirteen times as long as a
// 1-square one instead of every move taking the same beat. Anything that isn't a walk (a
// swap, a marble leaving the kennel, a captured marble going home) gets the board's plain
// tween instead.
const WALK_STEP_MS = 55;
const MOVE_TWEEN_MS = 220;
/** Phaser's 'Cubic.easeInOut', which is what TableScene tweens non-walk moves with. */
const EASE_CUBIC_IN_OUT = 'cubic-bezier(0.645, 0.045, 0.355, 1)';

interface Props {
  demo: RuleDemo;
  frame: number;
  onSelectFrame: (frame: number) => void;
  /** The viewer's own marble hue, so the demo's "your marble" is the colour they just picked
   * on the identity strip rather than a stock one. The rival is set opposite it on the wheel. */
  hue: number;
}

export function RulesDemo({ demo, frame, onSelectFrame, hue }: Props) {
  const index = Math.min(frame, demo.frames.length - 1);
  return (
    <div className="rules-demo">
      <div className="rules-demo__stage" aria-hidden="true">
        {demo.kind === 'track'
          ? <TrackStage demo={demo} frame={index} hue={hue} />
          : <CardsStage demo={demo} frame={index} />}
      </div>
      {/* role="list" is not redundant here: list-style:none drops list semantics in VoiceOver,
          and the step order is the whole point of this list. */}
      <ol className="rules-demo__steps" role="list">
        {demo.frames.map((f, i) => (
          <li key={f.caption} className="rules-demo__step">
            <button
              type="button"
              className={`rules-demo__step-btn${i === index ? ' rules-demo__step-btn--current' : ''}`}
              aria-current={i === index ? 'step' : undefined}
              onClick={() => onSelectFrame(i)}
            >
              {f.caption}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function percent(value: number): string {
  return `${(value * 100).toFixed(4)}%`;
}

/**
 * How many squares the walking marble covers this frame. Taken from the SCRIPT's previous
 * frame rather than from what is on screen: the demo is a fixed sequence, so the step count
 * is knowable without tracking render history. Scrubbing backwards therefore times a move
 * against the wrong neighbour - harmless, and it self-corrects on the next step.
 */
function walkLegs(current: TrackFrame, previous: TrackFrame | null, columnOf: (slot: DemoSlot) => number): number {
  if (!current.walker || !previous) return 0;
  const from = previous.marbles.find((m) => m.id === current.walker);
  const to = current.marbles.find((m) => m.id === current.walker);
  if (!from || !to) return 0;
  return Math.abs(columnOf(to.at) - columnOf(from.at));
}

function TrackStage({ demo, frame, hue }: { demo: TrackDemo; frame: number; hue: number }) {
  const columns = 1 + demo.trackCells + DEMO_HOME_CELLS;
  const colWidth = 1 / columns;
  const current = demo.frames[frame];
  const previous = frame > 0 ? demo.frames[frame - 1] : null;

  // Column 0 is the kennel, column 1 is the owner's start square, and the last
  // DEMO_HOME_CELLS are the home stretch - the same left-to-right reading the captions use.
  const columnOf = (slot: DemoSlot): number => {
    if (slot.zone === 'kennel') return 0;
    if (slot.zone === 'track') return 1 + slot.index;
    return 1 + demo.trackCells + slot.index;
  };

  const walkMs = walkLegs(current, previous, columnOf) * WALK_STEP_MS;
  const walkerHue = current.marbles.find((m) => m.id === current.walker)?.role === 'rival'
    ? (hue + 180) % 360
    : hue;

  // Field art per column, matching TableScene.redrawBoard: the real tile sprites on the
  // track (start square, then every 4th square as a quarter marker), a bordered socket for
  // the kennel, and the player-coloured outline for each goal slot.
  const field = (col: number) => {
    if (col === 0) return <span className="rules-track__field rules-track__field--kennel" />;
    if (col > demo.trackCells) {
      return (
        <span
          className="rules-track__field rules-track__field--goal"
          style={{ '--goal-edge': hueToCss(hue) } as CSSProperties}
        />
      );
    }
    const trackIndex = col - 1;
    const sprite = trackIndex === 0 ? TILE_START : trackIndex % 4 === 0 ? TILE_QUARTER : TILE_TRACK;
    return <span className="rules-track__tile" style={{ '--tile': `url(${sprite})` } as CSSProperties} />;
  };

  return (
    <div className="rules-track">
      <div className="rules-track__slots">
        {Array.from({ length: columns }, (_, col) => (
          <span key={col} className="rules-track__slot">{field(col)}</span>
        ))}
      </div>
      {/* Keyed on the frame so React remounts the whole layer: a trail square lit in two
          consecutive frames would otherwise keep its class and never replay its animation. */}
      <div className="rules-track__fx" key={frame}>
        {(current.trail ?? []).map((cell, i) => (
          <span
            key={`trail-${cell}`}
            className="rules-track__trail"
            style={{
              left: percent((1 + cell) * colWidth),
              width: percent(colWidth),
              '--trail-i': i,
              '--trail-color': hueToCss(walkerHue),
            } as CSSProperties}
          />
        ))}
        {(current.captured ?? []).map((cell) => (
          <span
            key={`capture-${cell}`}
            className="rules-track__capture"
            style={{ left: percent((1 + cell) * colWidth), width: percent(colWidth), animationDelay: `${walkMs}ms` }}
          />
        ))}
        {current.homeLit && (
          <span
            className="rules-track__home-flash"
            style={{
              left: percent((1 + demo.trackCells) * colWidth),
              width: percent(DEMO_HOME_CELLS * colWidth),
              animationDelay: `${walkMs}ms`,
            }}
          />
        )}
      </div>
      {current.marbles.map((marble) => {
        const walking = marble.id === current.walker;
        return (
          <span
            key={marble.id}
            className="rules-track__marble"
            style={{
              left: percent(columnOf(marble.at) * colWidth),
              width: percent(colWidth),
              transitionProperty: 'left',
              transitionDuration: `${walking ? walkMs : MOVE_TWEEN_MS}ms`,
              transitionTimingFunction: walking ? 'linear' : EASE_CUBIC_IN_OUT,
              // Everything that isn't the walk waits for the walk to finish, the way
              // TableScene holds a captured marble's trip home until the capturing marble
              // has actually arrived on it.
              transitionDelay: walking ? '0ms' : `${walkMs}ms`,
            }}
          >
            {/* 78% of a square: that is what makes every field around it land on the
                board's own proportions - see the derivation over .rules-track in theme.css. */}
            <PlayerMarble hue={marble.role === 'you' ? hue : (hue + 180) % 360} size="78%" />
          </span>
        );
      })}
    </div>
  );
}

function CardsStage({ demo, frame }: { demo: CardsDemo; frame: number }) {
  const lanes = LANE_ORDER.filter((lane) => demo.laneLabels[lane] !== undefined);
  const current = demo.frames[frame];

  return (
    <div className="rules-cards" style={{ '--lane-count': lanes.length } as CSSProperties}>
      {lanes.map((lane, row) => (
        <span key={lane} className="rules-cards__lane" style={{ '--lane': row } as CSSProperties}>
          {demo.laneLabels[lane]}
        </span>
      ))}
      {current.cards.map((card) => {
        const face = card.rank ? CARD_FACE_SPRITE[card.rank] : CARD_BACK_SPRITE;
        return (
          <span
            key={card.id}
            className={`rules-cards__card${card.highlight ? ' rules-cards__card--highlight' : ''}`}
            style={{ '--lane': lanes.indexOf(card.lane), '--slot': card.slot } as CSSProperties}
          >
            {/* Keyed on the flip, not the card: the outer span persists so a move between lanes
                animates, while a rank change remounts only the face and replays its flip. */}
            <span
              key={card.flipKey ?? card.rank ?? 'back'}
              className="rules-cards__face"
              style={{ '--card-face': `url(${face})` } as CSSProperties}
            >
              {card.rank && <CardRankIndices rank={card.rank} />}
            </span>
          </span>
        );
      })}
    </div>
  );
}
