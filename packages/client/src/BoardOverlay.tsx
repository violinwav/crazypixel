import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { getLegalMoves } from '@crazypixel/shared';
import type { Card, CardRank, GameState, Move, PlayerId } from '@crazypixel/shared';
import { trackLengthFor } from '@crazypixel/shared';
import { computeBoardGeometry } from './game/boardLayout';
import { resolveMoveTargets } from './game/moveTargets';
import { groupMovesByFigure } from './game/figureTargets';
import type { Figure } from './game/figureTargets';
import { describeMove } from './game/describeMove';
import { CARD_FACE_SPRITE, CARD_BACK_SPRITE } from './game/cardArt';
import { CardRankIndices } from './CardRankIndices';
import { SevenSplitOverlay } from './SevenSplitOverlay';
import { StealCardOverlay } from './StealCardOverlay';

const TARGET_SIZE = 44; // WCAG 2.5.8 touch-target floor - matters here more than most
// buttons, since these sit directly over the (smaller) marble/tile art they highlight.
const PATH_DOT_SIZE = 8;

/** Unwraps wildAs/copyLastCard down to see if a move is, at heart, a splitSeven - true not
 * just for a real 7, but for an 8 (or a Joker played as 8) copying a previous 7's effect.
 * Those copies used to fall through FigureThenMoves' generic "can't map this to a board
 * position" fallback (a real bug: a multi-marble split has no single figure/target to
 * highlight, so it rendered as a vertical stack of raw describeMove() sentences instead of
 * the real allocator UI a 7 gets - confirmed live). Route anything that unwraps to a
 * splitSeven through SevenSplitOverlay instead, same as a real 7. */
function isSevenSplitMove(move: Move): boolean {
  if (move.kind === 'splitSeven') return true;
  if (move.kind === 'wildAs' || move.kind === 'copyLastCard') return isSevenSplitMove(move.innerMove);
  return false;
}

interface Props {
  state: GameState;
  selectedCard: Card | null;
  containerSize: { width: number; height: number };
  onPlay: (player: PlayerId, move: Move) => void;
  mySeat: PlayerId;
  /** Fired the moment the player commits to stealing from a specific opponent (tapping their
   * kennel/"red circle"), before they've picked which hand position - see FigureThenMoves'
   * handleFigureClick. Lets GameBoard start the card's fly-to-discard animation right there
   * instead of waiting for StealCardOverlay's own reveal flight to finish, per feedback that
   * the card should visually "lay down" at the moment of committing to steal, not after. */
  onCardLeavingHand: (card: Card) => void;
}

// Sits absolutely positioned over the Phaser canvas. Selecting a card highlights real board
// positions (a marble, a kennel cluster, the full trail of squares a move would walk) as
// the interactive targets, rather than listing moves as sentences - each highlight IS a
// real <button> (positioned invisibly to match the glow it renders), so this stays
// keyboard/screen-reader operable rather than trading that away for the visual. See
// game/figureTargets.ts for the two-phase "pick the piece, then pick where it goes" split,
// game/moveTargets.ts for how a resolved move maps to a board position, and
// SevenSplitOverlay for the 7's dedicated multi-marble allocator.
export function BoardOverlay({ state, selectedCard, containerSize, onPlay, mySeat, onCardLeavingHand }: Props) {
  const [jokerRank, setJokerRank] = useState<CardRank | 'START' | null>(null);
  // Without this, jokerRank survives past the card that produced it - deselecting the Joker
  // (or any card change at all, including a different player's turn picking a Joker again)
  // left a stale rank behind, so the picker got silently skipped every time after the first
  // real use instead of asking again.
  useEffect(() => setJokerRank(null), [selectedCard?.id]);

  if (!selectedCard || containerSize.width === 0) return null;

  const player = state.currentPlayer;
  const geo = computeBoardGeometry(containerSize.width, containerSize.height, trackLengthFor(state.config), mySeat, state.config.playerCount);
  const legalMoves = getLegalMoves(state, player, selectedCard);

  if (selectedCard.rank === 'JOKER') {
    const wildMoves = legalMoves.filter((m): m is Extract<Move, { kind: 'wildAs' }> => m.kind === 'wildAs');
    const availableRanks = [...new Set(wildMoves.map((m) => m.asRank))];
    // The Joker's OWN start ability (its canStart, same as an Ace/King) isn't wrapped as a
    // wildAs - see GameEngine.ts's isWild loop skipping startMarble to avoid offering it
    // three times over. It still needs its own chip here, or it's simply unreachable.
    const canStartDirect = legalMoves.some((m) => m.kind === 'startMarble');

    if (!jokerRank) {
      // Actual mini card faces, not text chips - "play the Joker as a 7" reads instantly as
      // a picture of a 7 in a way a bare letter/number button didn't.
      return (
        <div className="board-overlay">
          <div className="rank-picker" role="group" aria-label="Choose what to play the Joker as">
            {canStartDirect && (
              <button
                type="button"
                className="playing-card rank-picker__card"
                style={{ '--card-face': `url(${CARD_BACK_SPRITE})` } as CSSProperties}
                aria-label="Bring a marble from your base"
                onClick={() => setJokerRank('START')}
              />
            )}
            {availableRanks.map((rank) => (
              <button
                key={rank}
                type="button"
                className="playing-card rank-picker__card"
                style={{ '--card-face': `url(${CARD_FACE_SPRITE[rank]})` } as CSSProperties}
                aria-label={`Play as ${rank}`}
                onClick={() => setJokerRank(rank)}
              >
                <CardRankIndices rank={rank} />
              </button>
            ))}
          </div>
        </div>
      );
    }

    const movesForRank = jokerRank === 'START'
      ? legalMoves.filter((m) => m.kind === 'startMarble')
      : wildMoves.filter((m) => m.asRank === jokerRank);

    return (
      <MoveRouter
        key={jokerRank}
        state={state}
        moves={movesForRank}
        geo={geo}
        player={player}
        onPlay={onPlay}
        onCardLeavingHand={onCardLeavingHand}
      />
    );
  }

  return (
    <MoveRouter
      key={selectedCard.id}
      state={state}
      moves={legalMoves}
      geo={geo}
      player={player}
      onPlay={onPlay}
      onCardLeavingHand={onCardLeavingHand}
    />
  );
}

/** Splits off anything that's a splitSeven at heart (a real 7, or an 8/Joker-as-8 copying a
 * previous 7's effect - see isSevenSplitMove) into the dedicated multi-marble allocator,
 * everything else through the normal figure-then-target flow. Both can legally coexist on
 * one card (an 8 offers "copy the 7" alongside its own plain move-8), so both render at
 * once rather than one replacing the other. */
function MoveRouter({ state, moves, geo, player, onPlay, onCardLeavingHand }: FigureThenMovesProps) {
  const splitMoves = moves.filter(isSevenSplitMove);
  const otherMoves = moves.filter((m) => !isSevenSplitMove(m));

  if (splitMoves.length === 0) {
    return (
      <FigureThenMoves state={state} moves={moves} geo={geo} player={player} onPlay={onPlay} onCardLeavingHand={onCardLeavingHand} />
    );
  }

  return (
    <>
      <div className="board-overlay">
        <SevenSplitOverlay state={state} moves={splitMoves} geo={geo} onPlay={onPlay} />
      </div>
      {otherMoves.length > 0 && (
        <FigureThenMoves state={state} moves={otherMoves} geo={geo} player={player} onPlay={onPlay} onCardLeavingHand={onCardLeavingHand} />
      )}
    </>
  );
}

interface FigureThenMovesProps {
  state: GameState;
  moves: Move[];
  geo: ReturnType<typeof computeBoardGeometry>;
  player: PlayerId;
  onPlay: Props['onPlay'];
  onCardLeavingHand: Props['onCardLeavingHand'];
}

/** Two-phase move picker: highlight the pieces that can act (a marble, your base, an
 * opponent's hand for a steal), then - once one is picked - highlight where it can go. The
 * `key` prop callers pass (selectedCard.id / jokerRank) forces a fresh instance whenever the
 * underlying move set changes, so this never carries a stale figure selection across cards. */
function FigureThenMoves({ state, moves, geo, player, onPlay, onCardLeavingHand }: FigureThenMovesProps) {
  const [figureKey, setFigureKey] = useState<string | null>(null);
  const { figures, unresolved } = groupMovesByFigure(state, moves, geo);
  // A single eligible piece is no real choice - skip straight to its moves rather than
  // forcing a confirm tap on a picker with exactly one option.
  const activeKey = figureKey ?? (figures.length === 1 ? figures[0].key : null);
  const selected = figures.find((f) => f.key === activeKey) ?? null;
  // React 18 StrictMode double-invokes an effect with no cleanup (mount -> simulated
  // unmount -> mount again) to catch impurity bugs - this one has no cleanup and calls
  // onPlay, an action with a real side effect (advances the turn), not a pure render. Without
  // this guard, StrictMode's dev-only double-invoke played the same auto-selected card
  // twice, silently skipping the next player's entire turn (confirmed live: Player 1's King
  // auto-start jumped straight to Player 3). The ref survives both invocations of the same
  // effect run (unlike component state) but still resets on a genuine new selection, since
  // the `key` prop callers pass forces a fresh FigureThenMoves instance per card/rank.
  const autoPlayedKeyRef = useRef<string | null>(null);

  // Bringing a marble out of your base only skips the confirm tap when it's the *only*
  // thing this card could possibly do - if a marble already on the board could also move
  // with it, starting is a real choice among several, not a foregone conclusion, so it
  // still gets the normal single-target confirm tap like any other move. Covers both entry
  // points: an explicit tap on the "start" figure (handled inline in the onClick below, no
  // flash) and the case where it's the *only* figure and gets auto-selected above without
  // ever being clicked (handled here).
  useEffect(() => {
    if (
      selected?.key === 'start' && selected.moves.length === 1 && figures.length === 1 && figureKey === null
      && autoPlayedKeyRef.current !== selected.key
    ) {
      autoPlayedKeyRef.current = selected.key;
      onPlay(player, selected.moves[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.key]);

  // Tapping the "start" figure directly is itself the confirm - if it's the only way to
  // bring that marble in, no second tap on a target square needed. Deliberately looser than
  // the auto-select effect above (which also requires figures.length === 1): here the player
  // has already chosen "start" over any other figure by tapping it, so a second figure being
  // available doesn't make a second start-target tap meaningful too.
  const handleFigureClick = (f: Figure) => {
    if (f.key === 'start' && f.moves.length === 1) {
      onPlay(player, f.moves[0]);
      return;
    }
    // Committing to steal from this opponent is itself the "lay the card down" moment, not
    // whichever hand position gets tapped next (StealCardOverlay) - see onCardLeavingHand's
    // own comment on Props.
    if (f.key.startsWith('opponent:')) {
      onCardLeavingHand(f.moves[0].card);
    }
    setFigureKey(f.key);
  };

  if (!selected) {
    return (
      <div className="board-overlay">
        {figures.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`board-overlay__target board-overlay__figure${f.key.startsWith('opponent:') ? ' board-overlay__figure--opponent' : ''}`}
            style={{ left: f.point.x - TARGET_SIZE / 2, top: f.point.y - TARGET_SIZE / 2, width: TARGET_SIZE, height: TARGET_SIZE }}
            aria-label={f.label}
            onClick={() => handleFigureClick(f)}
          />
        ))}
        {unresolved.length > 0 && (
          <div className="board-overlay__fallback" role="group" aria-label="Other moves">
            {unresolved.map((move, i) => (
              <button key={i} type="button" className="cp-button board-overlay__fallback-btn" onClick={() => onPlay(player, move)}>
                {describeMove(move, state)}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const goBack = figures.length > 1 ? () => setFigureKey(null) : undefined;

  if (selected.key.startsWith('opponent:')) {
    const targetPlayer = Number(selected.key.split(':')[1]) as PlayerId;
    return (
      <div className="board-overlay">
        <StealCardOverlay state={state} moves={selected.moves} onPlay={onPlay} forcedTarget={targetPlayer} onBack={goBack} />
      </div>
    );
  }

  const { targets, unresolved: innerUnresolved } = resolveMoveTargets(state, selected.moves, geo);
  return (
    <div className="board-overlay">
      {targets.map(({ move, point, path }, i) => (
        <div key={i}>
          {path.slice(0, -1).map((p, j) => (
            <div
              key={j}
              className="board-overlay__path-dot"
              style={{ left: p.x - PATH_DOT_SIZE / 2, top: p.y - PATH_DOT_SIZE / 2, width: PATH_DOT_SIZE, height: PATH_DOT_SIZE }}
            />
          ))}
          <button
            type="button"
            className="board-overlay__target"
            style={{ left: point.x - TARGET_SIZE / 2, top: point.y - TARGET_SIZE / 2, width: TARGET_SIZE, height: TARGET_SIZE }}
            aria-label={describeMove(move, state)}
            onClick={() => onPlay(player, move)}
          />
        </div>
      ))}
      {innerUnresolved.length > 0 && (
        <div className="board-overlay__fallback" role="group" aria-label="Other moves">
          {innerUnresolved.map((move, i) => (
            <button key={i} type="button" className="cp-button board-overlay__fallback-btn" onClick={() => onPlay(player, move)}>
              {describeMove(move, state)}
            </button>
          ))}
        </div>
      )}
      {goBack && (
        <button type="button" className="cp-button steal-overlay__cancel board-overlay__back" onClick={goBack}>
          Back
        </button>
      )}
    </div>
  );
}
