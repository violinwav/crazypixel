import type { CSSProperties } from 'react';
import { trackLengthFor } from '@crazypixel/shared';
import type { Card, GameState, PlayerId } from '@crazypixel/shared';
import { computeBoardGeometry, discardPileCenter } from './game/boardLayout';
import { CARD_FACE_SPRITE, handCardWidthFor } from './game/cardArt';
import { CardRankIndices } from './CardRankIndices';

interface Props {
  /** The card to show face-up on the pile. Usually state.lastPlayedCard, but a committed
   * steal lays its card down before the move itself is sent (see GameBoard's
   * pendingLaidCard) - the caller decides which, this just draws it. */
  card: Card;
  state: GameState;
  containerSize: { width: number; height: number };
  viewerSeat: PlayerId;
}

/** The discard pile's top (face-up) card - a real DOM .playing-card, positioned over the
 * Phaser canvas at the same discardPileCenter point TableScene.ts draws its own card-back
 * pile at (see drawDiscardStack there). Deliberately the same component/CSS/sprite every
 * other card on screen uses (HandPanel, FlyingCard, DealAnimation) instead of a separately
 * hand-tuned Phaser canvas font/size that only ever approximated it - one card resource, not
 * two independently-drifting ones. */
export function LaidCard({ card, state, containerSize, viewerSeat }: Props) {
  if (containerSize.width === 0) return null;

  const geo = computeBoardGeometry(
    containerSize.width, containerSize.height, trackLengthFor(state.config), viewerSeat, state.config.playerCount,
  );
  const { x, y } = discardPileCenter(geo);
  // Sized off the hand card's own current width, not the board's trackRadius-relative scale
  // - on a narrow phone the hand shrinks (see .hand-panel__card in theme.css) well before
  // the board itself does, and the discard pile has to shrink in lockstep with it to still
  // read as "the same card", not a board-scale one that stays bigger than the hand.
  const width = handCardWidthFor(containerSize.width);

  const style: CSSProperties = {
    position: 'absolute',
    left: x,
    top: y,
    width,
    transform: 'translate(-50%, -50%)',
    '--card-face': `url(${CARD_FACE_SPRITE[card.rank]})`,
  } as CSSProperties;

  return (
    // Keyed by card.id at the call site (GameBoard.tsx) so a new discard remounts this
    // (rather than just swapping --card-face on the same node), replaying the pop-in
    // animation below instead of the face silently changing mid-transition.
    <div className="playing-card laid-card" style={style} aria-hidden="true">
      <CardRankIndices rank={card.rank} />
    </div>
  );
}
