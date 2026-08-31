// The interactive layer over the Phaser canvas. Selecting a card highlights real board
// positions - a marble, your base, an opponent's hand, the trail of squares a move would walk -
// as the targets, rather than listing moves as sentences. Every highlight IS a real <button>,
// positioned invisibly to match the glow it renders, so this stays keyboard and screen-reader
// operable rather than trading that away for the visual.
//
// Three modules do the work behind it: game/figureTargets.ts for "which piece acts",
// game/moveTargets.ts for "where does it go", and SevenSplitOverlay for the 7's allocator.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { getLegalMoves, trackLengthFor } from '@crazypixel/shared';
import type { Card, CardRank, GameState, Move, PlayerId } from '@crazypixel/shared';
import { computeBoardGeometry, handCountPoint } from './game/boardLayout';
import type { BoardGeometry } from './game/boardLayout';
import { resolveMoveTargets } from './game/moveTargets';
import { groupMovesByFigure } from './game/figureTargets';
import type { Figure } from './game/figureTargets';
import { describeMove } from './game/describeMove';
import { CARD_FACE_SPRITE, CARD_BACK_SPRITE, handCardWidthFor } from './game/cardArt';
import { CardRankIndices } from './CardRankIndices';
import { SevenSplitOverlay } from './SevenSplitOverlay';
import { StealCardOverlay } from './StealCardOverlay';

// WCAG 2.5.8's touch-target floor, which matters here more than for most buttons since these
// sit directly over the (smaller) marble and tile art they highlight.
const TARGET_SIZE = 44;
const PATH_DOT_SIZE = 8;
// figureTargets keys an opponent's-hand figure as `opponent:<seat>`; tapping one is the
// irreversible steal commit, so several branches below have to recognise it.
const OPPONENT_KEY_PREFIX = 'opponent:';

/** Spoken counterpart of the red capture highlight. A 7 can burn several squares in one play,
 * so this counts them rather than just saying "a capture". */
function captureCountLabel(captured: boolean[]): string {
  const count = captured.filter(Boolean).length;
  if (count === 0) return '';
  return count === 1 ? ' (sends a marble home)' : ` (sends ${count} marbles home)`;
}

/** Is this move, at heart, a splitSeven - true not just for a real 7 but for an 8 (or a Joker
 * played as 8) copying a previous 7's effect. Without piercing the wrappers, those copies fell
 * through to the generic "can't map this to a board position" fallback and rendered as a stack
 * of raw describeMove() sentences instead of the allocator a real 7 gets. */
function isSevenSplitMove(move: Move): boolean {
  if (move.kind === 'splitSeven') return true;
  if (move.kind === 'wildAs' || move.kind === 'copyLastCard') return isSevenSplitMove(move.innerMove);
  return false;
}

/** A 7 that actually spreads its steps over more than one marble. When no legal play does (one
 * eligible marble, so "that marble takes all 7" is the only allocation), the allocator is pure
 * ceremony - a slider with a single reachable value that committed the card on the first tap.
 * Those route through the ordinary figure-then-target flow instead, so such a 7 previews its
 * path and asks for a confirming tap exactly like a 9 does. */
function isMultiMarbleSeven(move: Move): boolean {
  if (move.kind === 'splitSeven') return move.steps.length > 1;
  if (move.kind === 'wildAs' || move.kind === 'copyLastCard') return isMultiMarbleSeven(move.innerMove);
  return false;
}

/** The rank a Joker is being played as, seen through any copyLastCard wrapper - an 8 copying a
 * previously played Joker produces copyLastCard{wildAs}, which needs the same rank picker a
 * bare Joker gets, or the board floods with every rank's moves at once. */
function wildRankOf(move: Move): CardRank | null {
  if (move.kind === 'wildAs') return move.asRank;
  if (move.kind === 'copyLastCard') return wildRankOf(move.innerMove);
  return null;
}

/** Unwrapped-startMarble test, for the same wrapper-piercing reason as wildRankOf: the Joker's
 * own start ability arrives as copyLastCard{startMarble} when an 8 copies it. */
function isStartMove(move: Move): boolean {
  if (move.kind === 'startMarble') return true;
  if (move.kind === 'copyLastCard') return isStartMove(move.innerMove);
  return false;
}

interface Props {
  state: GameState;
  selectedCard: Card | null;
  containerSize: { width: number; height: number };
  onPlay: (player: PlayerId, move: Move) => void;
  viewerSeat: PlayerId;
  /** Fired when the player picks whose hand to reach into (tapping the red ring around their
   * cards), before the blind position is chosen. That tap is the point of no return: the card
   * is spent, it lays down on the discard pile then and there for everyone, and this overlay
   * offers no way back to a different target or card. All that follows is which position. */
  onStealCommit: (card: Card, target: PlayerId) => void;
  /** Forwarded to StealCardOverlay - fires when a stolen card's reveal is done being held up,
   * so the hand can open a slot for it to land in. */
  onStealIncoming: (card: Card) => void;
}

export function BoardOverlay({ state, selectedCard, containerSize, onPlay, viewerSeat, onStealCommit, onStealIncoming }: Props) {
  const [jokerRank, setJokerRank] = useState<CardRank | 'START' | null>(null);
  // Without this, jokerRank survives past the card that produced it: deselecting the Joker (or
  // any card change at all, including a later turn picking a Joker again) left a stale rank
  // behind, so the picker was silently skipped every time after the first.
  useEffect(() => setJokerRank(null), [selectedCard?.id]);

  if (!selectedCard || containerSize.width === 0) return null;

  const player = state.currentPlayer;
  const geo = computeBoardGeometry(containerSize.width, containerSize.height, trackLengthFor(state.config), viewerSeat, state.config.playerCount);
  const legalMoves = getLegalMoves(state, player, selectedCard);

  // Any move bottoming out in a wildAs needs the rank picker - a bare Joker, or an 8 copying a
  // Joker played before it.
  const wildMoves = legalMoves.filter((m) => wildRankOf(m) !== null);

  if (wildMoves.length > 0) {
    const availableRanks = [...new Set(wildMoves.map((m) => wildRankOf(m)!))];
    // The Joker's OWN start ability isn't wrapped as a wildAs (the engine's isWild loop skips
    // startMarble to avoid offering it three times over), so it needs its own chip here or it
    // is simply unreachable.
    const startMoves = legalMoves.filter((m) => wildRankOf(m) === null && isStartMove(m));
    // Whatever the played card can do on its own - an 8's plain move-8, alongside its copy of
    // the Joker - stays on the board through both phases. It isn't part of the Joker's rank
    // choice, and hiding it behind the picker would make it unreachable.
    const ownMoves = legalMoves.filter((m) => wildRankOf(m) === null && !isStartMove(m));

    const ownLayer = ownMoves.length > 0 ? (
      <MoveRouter
        key={`own-${selectedCard.id}`}
        state={state}
        moves={ownMoves}
        geo={geo}
        player={player}
        onPlay={onPlay}
        onStealCommit={onStealCommit}
        onStealIncoming={onStealIncoming}
      />
    ) : null;

    if (!jokerRank) {
      // Real card faces at the width a hand card currently renders at. The picker sits in its
      // own centered flex-wrap row, not the hand panel's 6-slot layout, so it can't lean on
      // that CSS calc() and has to compute the same width in JS - otherwise it stays
      // desktop-size on a phone where the hand has already shrunk well below 80px.
      const cardWidth = handCardWidthFor(containerSize.width);
      return (
        <>
          {ownLayer}
          <div className="board-overlay">
            <div className="rank-picker" role="group" aria-label="Choose what to play the Joker as">
              {startMoves.length > 0 && (
                <button
                  type="button"
                  className="playing-card rank-picker__card"
                  style={{ '--card-face': `url(${CARD_BACK_SPRITE})`, width: cardWidth } as CSSProperties}
                  aria-label="Bring a marble from your base"
                  onClick={() => setJokerRank('START')}
                />
              )}
              {availableRanks.map((rank) => (
                <button
                  key={rank}
                  type="button"
                  className="playing-card rank-picker__card"
                  style={{ '--card-face': `url(${CARD_FACE_SPRITE[rank]})`, width: cardWidth } as CSSProperties}
                  aria-label={`Play as ${rank}`}
                  onClick={() => setJokerRank(rank)}
                >
                  <CardRankIndices rank={rank} />
                </button>
              ))}
            </div>
          </div>
        </>
      );
    }

    const movesForRank = jokerRank === 'START'
      ? startMoves
      : wildMoves.filter((m) => wildRankOf(m) === jokerRank);

    return (
      <>
        {ownLayer}
        <MoveRouter
          key={jokerRank}
          state={state}
          moves={movesForRank}
          geo={geo}
          player={player}
          onPlay={onPlay}
          onStealCommit={onStealCommit}
          onStealIncoming={onStealIncoming}
        />
      </>
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
      onStealCommit={onStealCommit}
      onStealIncoming={onStealIncoming}
    />
  );
}

interface FigureThenMovesProps {
  state: GameState;
  moves: Move[];
  geo: BoardGeometry;
  player: PlayerId;
  onPlay: Props['onPlay'];
  onStealCommit: Props['onStealCommit'];
  onStealIncoming: Props['onStealIncoming'];
}

/**
 * Splits off anything that is a splitSeven at heart into the dedicated allocator, and routes
 * everything else through the normal figure-then-target flow. Both can legally coexist on one
 * card - an 8 offers "copy the 7" alongside its own plain move-8 - so both render at once
 * rather than one replacing the other. The allocator only appears when some legal play genuinely
 * spreads the 7 over multiple marbles.
 */
function MoveRouter({ state, moves, geo, player, onPlay, onStealCommit, onStealIncoming }: FigureThenMovesProps) {
  const needsAllocator = moves.some(isMultiMarbleSeven);
  const splitMoves = needsAllocator ? moves.filter(isSevenSplitMove) : [];
  const otherMoves = needsAllocator ? moves.filter((m) => !isSevenSplitMove(m)) : moves;

  if (splitMoves.length === 0) {
    return (
      <FigureThenMoves state={state} moves={moves} geo={geo} player={player} onPlay={onPlay} onStealCommit={onStealCommit} onStealIncoming={onStealIncoming} />
    );
  }

  return (
    <>
      <div className="board-overlay">
        <SevenSplitOverlay state={state} moves={splitMoves} geo={geo} onPlay={onPlay} />
      </div>
      {otherMoves.length > 0 && (
        <FigureThenMoves state={state} moves={otherMoves} geo={geo} player={player} onPlay={onPlay} onStealCommit={onStealCommit} onStealIncoming={onStealIncoming} />
      )}
    </>
  );
}

/**
 * The two-phase move picker: highlight the pieces that can act, then - once one is picked -
 * highlight where it can go. The `key` prop callers pass (selectedCard.id / jokerRank) forces a
 * fresh instance whenever the underlying move set changes, so this never carries a stale figure
 * selection across cards.
 */
function FigureThenMoves({ state, moves, geo, player, onPlay, onStealCommit, onStealIncoming }: FigureThenMovesProps) {
  const [figureKey, setFigureKey] = useState<string | null>(null);
  const { figures, unresolved } = groupMovesByFigure(state, moves, geo);
  // A single eligible piece is no real choice, so skip straight to its moves rather than forcing
  // a confirm tap on a picker with one option. A lone STEAL target is the exception: selecting
  // that figure spends the card irreversibly, and an irreversible commit must never happen on
  // render - only on a real tap.
  const activeKey = figureKey
    ?? (figures.length === 1 && !figures[0].key.startsWith(OPPONENT_KEY_PREFIX) ? figures[0].key : null);
  const selected = figures.find((f) => f.key === activeKey) ?? null;
  // React 18 StrictMode double-invokes an effect with no cleanup (mount, simulated unmount,
  // mount again) to catch impurity bugs. This one has no cleanup and calls onPlay, which
  // advances the turn - without the guard, that dev-only double-invoke played the same
  // auto-selected card twice and silently skipped the next player's entire turn. The ref
  // survives both invocations of one effect run (unlike component state) but still resets on a
  // genuine new selection, since the `key` prop forces a fresh instance per card/rank.
  const autoPlayedKeyRef = useRef<string | null>(null);

  // Bringing a marble out of your base skips the confirm tap only when it is the ONLY thing this
  // card could do - if a marble already on the board could also move, starting is a real choice
  // among several. This covers the case where "start" is the only figure and gets auto-selected
  // above without ever being clicked; the explicit-tap case is handled in handleFigureClick.
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

  // Tapping "start" directly is itself the confirm - if it is the only way to bring that marble
  // in, no second tap on a target square is needed. Deliberately looser than the auto-select
  // effect above (which also requires figures.length === 1): here the player has already chosen
  // "start" over any other figure by tapping it.
  const handleFigureClick = (f: Figure) => {
    if (f.key === 'start' && f.moves.length === 1) {
      onPlay(player, f.moves[0]);
      return;
    }
    // Committing to steal from this opponent is itself the "lay the card down" moment, not
    // whichever hand position gets tapped next - and it is irreversible. This tap is the only
    // path to it (see activeKey above), so it fires exactly once and never from a render.
    if (f.key.startsWith(OPPONENT_KEY_PREFIX)) {
      onStealCommit(f.moves[0].card, Number(f.key.slice(OPPONENT_KEY_PREFIX.length)) as PlayerId);
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
            className={`board-overlay__target board-overlay__figure${f.key.startsWith(OPPONENT_KEY_PREFIX) ? ' board-overlay__figure--opponent' : ''}`}
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

  if (selected.key.startsWith(OPPONENT_KEY_PREFIX)) {
    const targetPlayer = Number(selected.key.slice(OPPONENT_KEY_PREFIX.length)) as PlayerId;
    return (
      // No Back button here, unlike every other figure below: the card was spent when this
      // target was tapped, so there is nothing to go back to. All that remains is which position
      // in that hand, and letting the turn clock run out picks one at random rather than
      // cancelling.
      <div className="board-overlay">
        <StealCardOverlay
          state={state}
          moves={selected.moves}
          onPlay={onPlay}
          forcedTarget={targetPlayer}
          // Board-space, not screen-space - StealCardOverlay converts it at click time off the
          // .board-overlay layer it renders inside, which is the element this geometry is
          // measured against.
          targetFanPoint={handCountPoint(state.config, targetPlayer, geo)}
          onIncoming={onStealIncoming}
        />
      </div>
    );
  }

  const { targets, unresolved: innerUnresolved } = resolveMoveTargets(state, selected.moves, geo);
  return (
    <div className="board-overlay">
      {targets.map(({ move, point, path, captured, capturesTarget }, i) => (
        <div key={i}>
          {path.slice(0, -1).map((p, j) => (
            <div
              key={j}
              className={`board-overlay__path-dot${captured[j] ? ' board-overlay__path-dot--capture' : ''}`}
              style={{ left: p.x - PATH_DOT_SIZE / 2, top: p.y - PATH_DOT_SIZE / 2, width: PATH_DOT_SIZE, height: PATH_DOT_SIZE }}
            />
          ))}
          <button
            type="button"
            className={`board-overlay__target${capturesTarget ? ' board-overlay__target--capture' : ''}`}
            style={{ left: point.x - TARGET_SIZE / 2, top: point.y - TARGET_SIZE / 2, width: TARGET_SIZE, height: TARGET_SIZE }}
            // Red is the only *visual* difference between a plain landing square and one that
            // sends a marble home, so the label has to carry the same information or the cue is
            // invisible to a screen reader (WCAG 1.4.1).
            aria-label={`${describeMove(move, state)}${captureCountLabel(captured)}`}
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
