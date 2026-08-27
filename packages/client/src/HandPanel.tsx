import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { getLegalMoves } from '@crazypixel/shared';
import type { Card, GameState, PlayerId } from '@crazypixel/shared';
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
  /** Whose hand to show - the viewer's own seat, not necessarily state.currentPlayer. Online
   * play shows your hand at all times, not just on your turn (see GameBoard.tsx); local
   * hotseat always passes state.currentPlayer, so this is a no-op change there. */
  player: PlayerId;
  /** False when it isn't player's turn - every card renders dim/inert rather than showing
   * real legality (which getLegalMoves would happily compute for a non-current player too,
   * since it isn't itself turn-aware) and clicks are ignored. */
  interactive: boolean;
  selectedCardId: string | null;
  onSelectCard: (cardId: string | null) => void;
  /** A card an opponent has just taken from this hand, kept rendered in the slot it used to
   * occupy for the length of the steal presentation (see GameBoard). Two reasons it can't
   * just disappear with the state update: the row would silently re-flow one card narrower
   * before the player has registered which card left, and the flight that carries it to the
   * thief's stack needs a real on-screen rect to start from - by the time this component
   * re-renders, the card is already gone from state.hands and has no DOM node to measure.
   * Inert and aria-hidden: it's a picture of a card that isn't in the hand anymore, not a
   * control, and the spoken version lives in GameBoard's aria-live region. */
  stolenGhost?: { card: Card; index: number } | null;
  /** A card this hand has already spent but that the engine hasn't removed yet - the 2 of a
   * committed steal, which is face-up on the discard pile from the moment a target is picked
   * while the move itself is still a reveal animation away (see GameBoard's stealCommit).
   * Hidden here so the hand shows what the player actually still holds rather than a card
   * they can see lying on the pile. */
  hiddenCardId?: string | null;
  /** Width in px of a slot to hold open at the right-hand end for a card on its way in, or
   * null for none. Opens from zero so the row visibly makes room, and StealFlight aims its
   * landing at whatever rect this ends up with (see its resolveLanding). A number rather
   * than the card itself: the slot is an empty gap, and a primitive keeps the open/close
   * effect below from re-firing on every parent render. */
  incomingSlotWidth?: number | null;
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
export function HandPanel({ state, player, interactive, selectedCardId, onSelectCard, stolenGhost, hiddenCardId, incomingSlotWidth }: Props) {
  const hand = state.hands[player].filter((c) => c.id !== hiddenCardId);
  // Ghost spliced back in at its old index rather than appended - a steal takes a specific
  // card out of a specific position, and re-inserting it anywhere else would move every real
  // card next to it, which is precisely the re-flow the ghost exists to prevent.
  const slots: Array<{ card: Card; ghost: boolean }> = hand.map((card) => ({ card, ghost: false }));
  if (stolenGhost) {
    slots.splice(Math.min(stolenGhost.index, slots.length), 0, { card: stolenGhost.card, ghost: true });
  }

  // Width flipped on a tick after the slot first renders, not set on the same frame - a
  // brand-new DOM node has no previous width to transition FROM, so opening straight to the
  // full width would just step the row sideways (the same trap .playing-card--dim documents
  // in theme.css). setTimeout rather than requestAnimationFrame for this project's usual
  // reason: rAF is throttled in a backgrounded tab.
  const [slotOpen, setSlotOpen] = useState(false);
  useEffect(() => {
    if (!incomingSlotWidth) {
      setSlotOpen(false);
      return undefined;
    }
    const timer = setTimeout(() => setSlotOpen(true), 20);
    return () => clearTimeout(timer);
  }, [incomingSlotWidth]);

  // Re-arms on every turn switch (not just the initial deal) - a plain hand reveal with no
  // deal animation at all (cycling to a player already dealt to this round) gets the same
  // settle window, so illegal cards always dim as a distinct step, never baked into however
  // the hand happened to appear.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [player, interactive]);

  return (
    <section className="hand-panel">
      <div role="group" aria-label="Your hand" className="hand-panel__cards">
        {slots.map(({ card, ghost }) => {
          if (ghost) {
            return (
              <div
                key={`stolen:${card.id}`}
                data-card-id={card.id}
                className="playing-card hand-panel__card hand-panel__card--stolen"
                style={{ '--card-face': `url(${CARD_FACE_SPRITE[card.rank]})` } as CSSProperties}
                aria-hidden="true"
              >
                <CardRankIndices rank={card.rank} />
              </div>
            );
          }
          // getLegalMoves isn't itself turn-aware (it'll happily compute moves for a player
          // who isn't state.currentPlayer - see StealCardOverlay previewing an opponent's
          // hand) - `interactive` is what actually reflects whether it's this hand's turn.
          const hasMoves = interactive && getLegalMoves(state, player, card).length > 0;
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
        {incomingSlotWidth ? (
          <span
            data-incoming-slot
            className={`hand-panel__slot${slotOpen ? ' hand-panel__slot--open' : ''}`}
            style={{ width: slotOpen ? incomingSlotWidth : 0 }}
            aria-hidden="true"
          />
        ) : null}
      </div>
    </section>
  );
}
