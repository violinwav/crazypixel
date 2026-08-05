import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { getLegalMoves } from '@crazypixel/shared';
import type { GameState } from '@crazypixel/shared';
import { CARD_FACE_SPRITE } from './game/cardArt';
import { CardRankIndices } from './CardRankIndices';

// How long a freshly-revealed hand sits fully solid before illegal cards dim - long enough
// to clear .hand-panel-slot's own 250ms crossfade (see theme.css), so the dim-down reads as
// its own distinct step (flow in, flip, THEN fade) instead of baking straight into the
// reveal. Without this, disabled cards had no visible "before" state to transition from -
// a brand-new DOM node just paints at its final :disabled opacity from frame one, so the dim
// landed instantly, at the same time as (not after) the reveal (confirmed live - looked like
// a clipped/glitchy pop rather than a settle).
const SETTLE_MS = 260;

interface Props {
  state: GameState;
  selectedCardId: string | null;
  onSelectCard: (cardId: string | null) => void;
}

// Move selection itself now lives in BoardOverlay (highlighted board positions, not a text
// list) - this panel's job is just showing the hand and letting one card be selected. A
// second tap on an already-selected card just deselects it, always - it doesn't play the
// card even when there's only one legal move (tried that, reverted per feedback: it made
// tapping a card unpredictable depending on how many moves it happened to have). Card art is
// keyed by rank only (suit stopped mattering visually - see cardArt.ts), applied as a
// background-image so the display-font rank text can still sit crisply on top of it. Turn
// label and the no-legal-moves fallback both live on the board now (see BoardStatus.tsx),
// not boxed inside this panel.
export function HandPanel({ state, selectedCardId, onSelectCard }: Props) {
  const player = state.currentPlayer;
  const hand = state.hands[player];

  // Re-arms on every turn switch (not just the initial deal) - a plain hand reveal with no
  // deal animation at all (cycling to a player already dealt to this round) gets the same
  // settle window, so illegal cards always dim as a distinct step, never baked into however
  // the hand happened to appear.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [player]);

  return (
    <section className="hand-panel">
      <div role="group" aria-label="Your hand" className="hand-panel__cards">
        {hand.map((card) => {
          const hasMoves = getLegalMoves(state, player, card).length > 0;
          const isSelected = selectedCardId === card.id;
          return (
            <button
              key={card.id}
              type="button"
              data-card-id={card.id}
              className={`playing-card hand-panel__card${!hasMoves && settled ? ' playing-card--dim' : ''}`}
              style={{ '--card-face': `url(${CARD_FACE_SPRITE[card.rank]})` } as CSSProperties}
              aria-pressed={isSelected}
              aria-label={`${card.rank} of ${card.suit ?? 'no suit'}${hasMoves ? '' : ', no legal moves'}`}
              // Not the native `disabled` attribute - Chromium/WebKit skip CSS transitions
              // entirely on disabled form controls, so the --dim opacity fade above always
              // cut instantly regardless of the settle timer (confirmed live). aria-disabled
              // keeps the same "not a legal move" semantics for assistive tech while staying
              // a real, transitionable element - the click guard below is what actually
              // blocks the illegal play.
              aria-disabled={!hasMoves}
              onClick={() => {
                if (!hasMoves) return;
                onSelectCard(isSelected ? null : card.id);
              }}
            >
              <CardRankIndices rank={card.rank} />
            </button>
          );
        })}
      </div>
    </section>
  );
}
