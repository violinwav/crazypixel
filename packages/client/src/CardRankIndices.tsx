import type { CardRank } from '@crazypixel/shared';

/** Classic playing-card corner indices - top-left upright, bottom-right rotated 180deg (the
 * "look the same when the card is upside down" trick real decks use) - rather than one
 * centered label. Shared across HandPanel/FlyingCard/DealAnimation so all three stay in
 * sync instead of three hand-copied spans quietly drifting apart. */
export function CardRankIndices({ rank }: { rank: CardRank }) {
  // "JOKER" is far wider than any other rank string (5 chars vs at most 2) - shrink it
  // specifically rather than shrinking every card's index to fit the one outlier. Kept
  // proportional to .playing-card__index's own base size (theme.css) as that's grown - was
  // 0.62rem against a 1.05rem base (ratio ~0.59), now scaled up off the current 1.2rem base
  // at the same ratio.
  const style = rank === 'JOKER' ? { fontSize: '0.71rem' } : undefined;
  return (
    <>
      <span className="playing-card__index playing-card__index--top" style={style} aria-hidden="true">{rank}</span>
      <span className="playing-card__index playing-card__index--bottom" style={style} aria-hidden="true">{rank}</span>
    </>
  );
}
