import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { getLegalMoves } from '@crazypixel/shared';
import type { Card, GameState, PlayerId } from '@crazypixel/shared';
import { CARD_FACE_SPRITE } from './game/cardArt';
import { CardRankIndices } from './CardRankIndices';

// How long a freshly-revealed hand sits fully solid before illegal cards dim. Long enough to
// clear .hand-panel-slot's own crossfade, so the dim-down reads as its own step (flow in, flip,
// THEN fade). Without it, disabled cards had no visible "before" state to transition from - a
// brand-new DOM node paints at its final dim opacity from frame one, so the dim landed at the
// same instant as the reveal and read as a clipped pop rather than a settle.
const SETTLE_MS = 260;
// One tick before the incoming slot opens, for the same reason: a brand-new node has no
// previous width to transition FROM, so opening straight to full width steps the row sideways.
const SLOT_OPEN_DELAY_MS = 20;

interface Props {
  state: GameState;
  /** Whose hand to show - the viewer's own seat, not necessarily state.currentPlayer. Online
   * play shows your hand at all times, not only on your turn; local hotseat always passes
   * state.currentPlayer, so this is a no-op there. */
  player: PlayerId;
  /** False when it isn't this player's turn: every card renders dim and inert rather than
   * showing real legality (which getLegalMoves would happily compute for a non-current player,
   * since it isn't itself turn-aware) and clicks are ignored. */
  interactive: boolean;
  selectedCardId: string | null;
  onSelectCard: (cardId: string | null) => void;
  /** A card an opponent has just taken, kept rendered in the slot it occupied for the length of
   * the steal presentation. Two reasons it can't just disappear with the state update: the row
   * would re-flow one card narrower before the player registers which card left, and the flight
   * that carries it to the thief needs a real on-screen rect to start from - by the time this
   * re-renders, the card is gone from state.hands and has no DOM node to measure. Inert and
   * aria-hidden: a picture of a card that isn't in the hand any more, not a control. */
  stolenGhost?: { card: Card; index: number } | null;
  /** A card this hand has spent but the engine hasn't removed yet - the 2 of a committed steal,
   * face-up on the discard pile from the moment a target is picked while the move itself is
   * still a reveal animation away. Hidden here so the hand shows what the player still holds
   * rather than a card they can see lying on the pile. */
  hiddenCardId?: string | null;
  /** Width in px of a slot to hold open at the right-hand end for a card on its way in, or null
   * for none. Opens from zero so the row visibly makes room, and StealFlight aims its landing
   * at whatever rect this ends up with. A number rather than the card itself: the slot is an
   * empty gap, and a primitive keeps the open/close effect from re-firing on every parent
   * render. */
  incomingSlotWidth?: number | null;
}

/**
 * The player's hand. Selection only - move selection itself lives in BoardOverlay, as
 * highlighted board positions rather than a text list. A second tap on an already-selected card
 * always just deselects it, even when there is exactly one legal move: playing on the second
 * tap made tapping a card unpredictable depending on how many moves it happened to have.
 *
 * Card art is keyed by rank only and applied as a background-image, so the display-font rank
 * text can sit crisply on top of it.
 */
export function HandPanel({ state, player, interactive, selectedCardId, onSelectCard, stolenGhost, hiddenCardId, incomingSlotWidth }: Props) {
  const hand = state.hands[player].filter((c) => c.id !== hiddenCardId);
  // The ghost is spliced back in at its old index rather than appended: a steal takes a specific
  // card from a specific position, and re-inserting it anywhere else would move every card next
  // to it - precisely the re-flow the ghost exists to prevent.
  const slots: Array<{ card: Card; ghost: boolean }> = hand.map((card) => ({ card, ghost: false }));
  if (stolenGhost) {
    slots.splice(Math.min(stolenGhost.index, slots.length), 0, { card: stolenGhost.card, ghost: true });
  }

  const [slotOpen, setSlotOpen] = useState(false);
  useEffect(() => {
    if (!incomingSlotWidth) {
      setSlotOpen(false);
      return undefined;
    }
    const timer = setTimeout(() => setSlotOpen(true), SLOT_OPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [incomingSlotWidth]);

  // Re-arms on every turn switch, not just the initial deal, so a plain hand reveal with no deal
  // animation at all (cycling to a player already dealt to this round) gets the same settle
  // window and illegal cards always dim as a distinct step.
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
          // getLegalMoves isn't turn-aware - it will happily compute moves for a player who
          // isn't state.currentPlayer - so `interactive` is what actually reflects whether it is
          // this hand's turn.
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
              // aria-disabled, NOT the native attribute: Chromium and WebKit skip CSS
              // transitions entirely on disabled form controls, so the dim fade always cut
              // instantly regardless of the settle timer. This keeps the same "not a legal move"
              // semantics for assistive tech while staying a real, transitionable element - the
              // click guard below is what actually blocks the illegal play.
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
