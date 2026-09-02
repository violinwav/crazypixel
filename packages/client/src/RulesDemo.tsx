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
import { DEMO_HOME_CELLS } from './game/rulesContent';
import type { CardsDemo, DemoLane, DemoSlot, RuleDemo, TrackDemo } from './game/rulesContent';

const LANE_ORDER: DemoLane[] = ['them', 'you'];

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

function TrackStage({ demo, frame, hue }: { demo: TrackDemo; frame: number; hue: number }) {
  const columns = 1 + demo.trackCells + DEMO_HOME_CELLS;
  const colWidth = 1 / columns;
  const current = demo.frames[frame];

  // Column 0 is the kennel, column 1 is the owner's start square, and the last DEMO_HOME_CELLS
  // are the home stretch - the same left-to-right reading the captions describe.
  const columnClass = (col: number): string => {
    if (col === 0) return 'rules-track__cell rules-track__cell--kennel';
    if (col === 1) return 'rules-track__cell rules-track__cell--start';
    if (col > demo.trackCells) return 'rules-track__cell rules-track__cell--home';
    return 'rules-track__cell';
  };

  const columnOf = (slot: DemoSlot): number => {
    if (slot.zone === 'kennel') return 0;
    if (slot.zone === 'track') return 1 + slot.index;
    return 1 + demo.trackCells + slot.index;
  };

  return (
    <div className={`rules-track${current.homeLit ? ' rules-track--home-lit' : ''}`}>
      <div className="rules-track__cells">
        {Array.from({ length: columns }, (_, col) => (
          <span key={col} className={columnClass(col)} />
        ))}
      </div>
      {/* Keyed on the frame so React remounts the whole layer: a trail square that is lit in two
          consecutive frames would otherwise keep its class and never replay its animation. */}
      <div className="rules-track__fx" key={frame}>
        {(current.trail ?? []).map((cell, i) => (
          <span
            key={`trail-${cell}`}
            className="rules-track__trail"
            style={{ left: percent((1 + cell) * colWidth), width: percent(colWidth), '--trail-i': i } as CSSProperties}
          />
        ))}
        {(current.captured ?? []).map((cell) => (
          <span
            key={`capture-${cell}`}
            className="rules-track__capture"
            style={{ left: percent((1 + cell) * colWidth), width: percent(colWidth) }}
          />
        ))}
      </div>
      {current.marbles.map((marble) => (
        <span
          key={marble.id}
          className="rules-track__marble"
          style={{ left: percent(columnOf(marble.at) * colWidth), width: percent(colWidth) }}
        >
          <PlayerMarble hue={marble.role === 'you' ? hue : (hue + 180) % 360} size="82%" />
        </span>
      ))}
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
