import type { CardRank } from '@crazypixel/shared';

/**
 * Classic corner indices - top-left upright, bottom-right rotated 180deg, the "reads the same
 * upside down" trick a real deck uses. Shared by every card renderer (HandPanel, FlyingCard,
 * DealAnimation, LaidCard, StealFlight, the rank picker) so all of them stay in sync instead
 * of each hand-copying a pair of spans.
 *
 * aria-hidden: the rank is already in the enclosing control's accessible name, and these would
 * otherwise announce it twice.
 */
export function CardRankIndices({ rank }: { rank: CardRank }) {
  // "JOKER" is far wider than any other rank (5 chars vs at most 2), so it shrinks rather than
  // every card's index shrinking to fit the one outlier. Kept proportional to
  // .playing-card__index's own base size in theme.css.
  const style = rank === 'JOKER' ? { fontSize: '0.71rem' } : undefined;
  return (
    <>
      <span className="playing-card__index playing-card__index--top" style={style} aria-hidden="true">{rank}</span>
      <span className="playing-card__index playing-card__index--bottom" style={style} aria-hidden="true">{rank}</span>
    </>
  );
}
