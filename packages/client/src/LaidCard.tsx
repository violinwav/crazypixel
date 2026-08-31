import type { CSSProperties } from 'react';
import { trackLengthFor } from '@crazypixel/shared';
import type { Card, GameState, PlayerId } from '@crazypixel/shared';
import { computeBoardGeometry, discardPileCenter } from './game/boardLayout';
import { CARD_FACE_SPRITE, handCardWidthFor } from './game/cardArt';
import { CardRankIndices } from './CardRankIndices';

interface Props {
  /** The card to show face-up. Usually state.lastPlayedCard, but a committed steal lays its
   * card down before the move itself is sent (see GameBoard's pendingLaidCard) - the caller
   * decides which, this just draws it. */
  card: Card;
  state: GameState;
  containerSize: { width: number; height: number };
  viewerSeat: PlayerId;
}

/**
 * The discard pile's top card: a real DOM .playing-card positioned over the Phaser canvas at
 * the same discardPileCenter TableScene draws its card-back stack at. Deliberately the same
 * component, CSS and sprite every other card on screen uses, rather than a separately
 * hand-tuned Phaser canvas font that only ever approximated it - one card resource, not two
 * that drift apart.
 *
 * aria-hidden: what was played is announced through GameBoard's aria-live region.
 */
export function LaidCard({ card, state, containerSize, viewerSeat }: Props) {
  if (containerSize.width === 0) return null;

  const geo = computeBoardGeometry(
    containerSize.width, containerSize.height, trackLengthFor(state.config), viewerSeat, state.config.playerCount,
  );
  const { x, y } = discardPileCenter(geo);
  // Sized off the hand card's current width, not the board's trackRadius-relative scale: on a
  // narrow phone the hand shrinks well before the board does, and the pile has to shrink with
  // it to still read as "the same card".
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
    // Keyed by card.id at the call site, so a new discard remounts this and replays the pop-in
    // animation instead of the face silently changing mid-transition.
    <div className="playing-card laid-card" style={style} aria-hidden="true">
      <CardRankIndices rank={card.rank} />
    </div>
  );
}
