// How to Play - the goal, a turn, every card, and the board rules the cards assume.
//
// The card reference is a real tablist (roving tabindex, arrow keys, selection follows focus)
// rather than a list of expandable panels: there are fourteen ranks and only one is ever worth
// reading at a time, so a single panel that swaps its contents beats fourteen that can all be
// open at once.

import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, RefObject } from 'react';
import { CARD_FACE_SPRITE } from './game/cardArt';
import { CardRankIndices } from './CardRankIndices';
import { RulesDemo } from './RulesDemo';
import { GOAL_DEMO, RULE_CARDS } from './game/rulesContent';

/** How long each frame of a demo holds before the next one. Long enough to read the caption
 * that goes with it - these are explanations first and animations second. */
const FRAME_MS = 2600;

interface Props {
  /** The viewer's own marble hue - the demos colour "your marble" with it. */
  hue: number;
  /** Lobby moves focus here on entry, the same as every other screen it swaps in. */
  headingRef: RefObject<HTMLHeadingElement>;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export function RulesScreen({ hue, headingRef }: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const [playing, setPlaying] = useState(!reducedMotion);
  const [selected, setSelected] = useState(0);
  const [goalFrame, setGoalFrame] = useState(0);
  const [cardFrame, setCardFrame] = useState(0);

  const baseId = useId();
  const tabId = (index: number) => `${baseId}-tab-${index}`;
  const panelId = `${baseId}-panel`;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Someone turning the OS setting on mid-visit gets the same treatment as someone who had it
  // on when the screen mounted. Turning it back off doesn't auto-resume - that would be motion
  // they didn't ask for.
  useEffect(() => {
    if (reducedMotion) setPlaying(false);
  }, [reducedMotion]);

  const goalLength = GOAL_DEMO.frames.length;
  const cardDemo = RULE_CARDS[selected].demo;
  const cardLength = cardDemo.frames.length;

  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => {
      setGoalFrame((f) => (f + 1) % goalLength);
      setCardFrame((f) => (f + 1) % cardLength);
    }, FRAME_MS);
    return () => clearInterval(timer);
    // `selected` is in here on purpose even though the body never reads it: picking a new card
    // resets its demo to frame 0, and without restarting the timer that frame would inherit
    // whatever was left of the previous card's tick and flick past almost immediately.
  }, [playing, goalLength, cardLength, selected]);

  const selectCard = (index: number) => {
    setSelected(index);
    setCardFrame(0);
  };

  // Scrubbing by hand is also the pause mechanism - an animation that kept advancing under the
  // step you just picked would be unusable, and WCAG 2.2.2 wants a way to stop it regardless.
  const scrub = (setFrame: (frame: number) => void) => (frame: number) => {
    setPlaying(false);
    setFrame(frame);
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = RULE_CARDS.length - 1;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = selected === last ? 0 : selected + 1;
    else if (event.key === 'ArrowLeft') next = selected === 0 ? last : selected - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    selectCard(next);
    tabRefs.current[next]?.focus();
  };

  const card = RULE_CARDS[selected];

  return (
    <>
      <h2 className="cp-title rules__title" ref={headingRef} tabIndex={-1}>How to Play</h2>

      <div className="rules__motion">
        <button type="button" className="cp-button cp-button--ghost" onClick={() => setPlaying((p) => !p)}>
          <span aria-hidden="true">{playing ? '❚❚ ' : '▶ '}</span>
          {playing ? 'Pause demos' : 'Play demos'}
        </button>
      </div>

      <section className="cp-panel rules__section" aria-labelledby={`${baseId}-goal`}>
        <h3 className="lobby__heading" id={`${baseId}-goal`}>The goal</h3>
        <p className="rules__lede">
          Everyone gets four marbles. Race them out of your kennel, once around the shared track,
          and into your own home stretch. First player home wins — or, in Partners mode, the first
          pair to get all eight home.
        </p>
        <RulesDemo demo={GOAL_DEMO} frame={goalFrame} onSelectFrame={scrub(setGoalFrame)} hue={hue} />
      </section>

      <section className="cp-panel rules__section" aria-labelledby={`${baseId}-turn`}>
        <h3 className="lobby__heading" id={`${baseId}-turn`}>A turn</h3>
        <ol className="rules__list">
          <li>Play one card from your hand and do what it says. That is your whole turn.</li>
          <li>
            If not a single card in your hand has a legal move, the whole hand goes to the discard
            pile and you sit out until the next deal.
          </li>
          <li>Rounds deal 6 cards each, then 5, 4, 3, 2 — then back to 6 and around again.</li>
        </ol>
      </section>

      <section className="cp-panel rules__section" aria-labelledby={`${baseId}-cards`}>
        <h3 className="lobby__heading" id={`${baseId}-cards`}>The cards</h3>
        <p className="rules__lede">
          Every rank does something. Pick one to see it played out.
        </p>
        <div
          className="rules__tabs"
          role="tablist"
          aria-label="Cards"
          aria-orientation="horizontal"
          onKeyDown={onTabKeyDown}
        >
          {RULE_CARDS.map((entry, index) => (
            <button
              key={entry.rank}
              type="button"
              role="tab"
              id={tabId(index)}
              aria-selected={index === selected}
              aria-controls={panelId}
              tabIndex={index === selected ? 0 : -1}
              ref={(node) => { tabRefs.current[index] = node; }}
              className={`rules__tab${index === selected ? ' rules__tab--selected' : ''}`}
              style={{ '--card-face': `url(${CARD_FACE_SPRITE[entry.rank]})` } as CSSProperties}
              onClick={() => selectCard(index)}
            >
              <span className="visually-hidden">{`${entry.name}: ${entry.summary}`}</span>
              <CardRankIndices rank={entry.rank} />
            </button>
          ))}
        </div>
        <div className="rules__panel" role="tabpanel" id={panelId} aria-labelledby={tabId(selected)}>
          <h4 className="rules__card-name">{card.name}</h4>
          <p className="rules__card-summary">{card.summary}</p>
          <RulesDemo demo={cardDemo} frame={cardFrame} onSelectFrame={scrub(setCardFrame)} hue={hue} />
          {card.note && <p className="rules__note">{card.note}</p>}
        </div>
      </section>

      <section className="cp-panel rules__section" aria-labelledby={`${baseId}-board`}>
        <h3 className="lobby__heading" id={`${baseId}-board`}>Rules of the board</h3>
        <dl className="rules__glossary">
          <dt>Blockade</dt>
          <dd>
            A marble on its owner’s start square seals that square for everyone — its owner
            included — and cannot be sent home while it sits there. Nothing passes it.
          </dd>
          <dt>Capture</dt>
          <dd>
            Land on any marble and it goes straight back to its owner’s kennel, losing the lap it
            had banked. Your own marbles never stack, so you can’t land on one.
          </dd>
          <dt>Home stretch</dt>
          <dd>
            Four private squares behind your start. A marble can only turn in once it has landed
            exactly on your start square since leaving the kennel — by finishing a lap, or by
            backing onto it with a 4. Inside, marbles can’t jump each other and nothing is ever
            captured.
          </dd>
          <dt>Partners</dt>
          <dd>
            In Partners mode you play with the seat opposite you and win together. A 7’s steps can
            go on their marbles as well as yours, and a 2 never steals from them.
          </dd>
        </dl>
      </section>
    </>
  );
}
