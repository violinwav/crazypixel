import type { CSSProperties } from 'react';
import { emoteById, trackLengthFor } from '@crazypixel/shared';
import type { GameState, PlayerId } from '@crazypixel/shared';
import { computeBoardGeometry, discardPileCenter } from './game/boardLayout';
import { handCardWidthFor } from './game/cardArt';
import { hueToTextCss } from './game/color';
import { playerLabel } from './game/playerName';
import type { FeedEmote } from './game/useOnlineGameState';

interface Props {
  emotes: FeedEmote[];
  state: GameState;
  containerSize: { width: number; height: number };
  viewerSeat: PlayerId;
  colors: number[];
  playerNames?: string[];
}

// Gap between the discard pile's own left edge and the feed's right edge.
const PILE_GAP = 12;
// Keeps the column off the viewport's left edge on a narrow phone even when the
// pile-relative math would push it there.
const EDGE_MARGIN = 8;
// Fixed column width, so every message chip is the same width and their colour bars stack
// into one continuous vertical rail. Sized off the widest kaomoji in the catalogue
// (`╾━╤デ╦︻ (•_- )`, ~103px at 15px) plus the chip's own padding and border. Without a fixed
// width each chip shrank to its own content and, because the column is anchored on its right
// edge against the pile, every bar landed at a different x - measured live at 402 and 336 for
// two messages sitting directly above one another. Clamped below on a narrow viewport, where
// the space between the pile and the screen edge is less than this.
const FEED_WIDTH = 128;
// Alpha for the newest line down to the oldest still on screen. Not a computed ramp: these
// four values are the ones that keep every visible line above 4.5:1 for the worst hue on the
// wheel (see hueToTextCss's own note in game/color.ts for the measurements). The stronger
// visual fade comes from each line's backing chip, which carries no text and so is free to
// drop to nothing.
const DEPTH_ALPHA = [1, 0.9, 0.8, 0.7];

/** Recent emotes, stacked to the LEFT of the discard pile and rising out of it - newest at
 * the bottom, level with the pile where the eye already is between turns; older ones pushed
 * up and dimmed until they age out. Anchored off discardPileCenter, the same geometry
 * LaidCard.tsx draws the pile itself with, so the column tracks the pile through every
 * resize and player count instead of sitting at a hand-tuned offset that only lines up at
 * one viewport size.
 *
 * Purely visual - aria-hidden, with the spoken version going through GameBoard's own
 * role="log" region. Same split StealAlert uses, and doubly right here: a kaomoji read
 * glyph-by-glyph is noise ("macron, backslash, low line, left parenthesis, tsu..."), and the
 * reordering and opacity churn as lines rise would re-announce the whole column on every
 * message. The catalogue's `label` is what actually gets spoken. */
export function EmoteFeed({ emotes, state, containerSize, viewerSeat, colors, playerNames }: Props) {
  if (containerSize.width === 0 || emotes.length === 0) return null;

  const geo = computeBoardGeometry(
    containerSize.width, containerSize.height, trackLengthFor(state.config), viewerSeat, state.config.playerCount,
  );
  const pile = discardPileCenter(geo);
  const cardWidth = handCardWidthFor(containerSize.width);
  // Positioned by `right`, not `left`, so the column grows leftward into the board's empty
  // lower-left corner as messages get longer rather than running under the pile.
  const right = containerSize.width - (pile.x - cardWidth / 2 - PILE_GAP);

  return (
    <div
      className="emote-feed"
      style={{
        right,
        bottom: containerSize.height - pile.y - cardWidth * 0.7,
        width: Math.min(FEED_WIDTH, Math.max(0, containerSize.width - right - EDGE_MARGIN)),
      }}
      aria-hidden="true"
    >
      {emotes.map((entry, i) => {
        const emote = emoteById(entry.emoteId);
        if (!emote) return null;
        // Depth counted from the BOTTOM (newest = 0), which is what the fade is keyed to -
        // `emotes` is oldest-first and the column renders bottom-up, so a raw array index
        // would fade the newest line hardest.
        const depth = emotes.length - 1 - i;
        return (
          <p
            key={entry.id}
            className="emote-feed__line"
            style={{
              '--emote-color': hueToTextCss(colors[entry.by]),
              '--emote-alpha': String(DEPTH_ALPHA[Math.min(depth, DEPTH_ALPHA.length - 1)]),
            } as CSSProperties}
          >
            <span className="emote-feed__who">{playerLabel(playerNames, entry.by)}</span>
            <span className="emote-glyph emote-feed__glyph">{emote.text}</span>
          </p>
        );
      })}
    </div>
  );
}
