import { useState } from 'react';
import type { GameState, Move, PlayerId } from '@crazypixel/shared';
import { CARD_BACK_SPRITE } from './game/cardArt';
import { StealFlight } from './StealFlight';
import type { StealFlightPlan } from './StealFlight';
import type { StealProgressInfo } from './BoardOverlay';

type ForceDrawMove = Extract<Move, { kind: 'forceDraw' }>;

interface Props {
  state: GameState;
  /** Top-level legal moves for the selected card, already filtered to ones that are (or
   * wrap, via copyLastCard/wildAs) a forceDraw - see unwrapForceDraw. */
  moves: Move[];
  onPlay: (player: PlayerId, move: Move) => void;
  /** Set when the opponent was already picked one level up (BoardOverlay's figure-select
   * step now doubles as "whose hand" - see figureTargets.ts) - skips this component's own
   * opponent chooser and goes straight to the card-position picker. */
  forcedTarget?: PlayerId;
  /** Shown instead of the internal "choose a different player" control when forcedTarget is
   * set, since going back means re-opening the figure list one level up, not re-picking
   * within this component. */
  onBack?: () => void;
  /** Called with cardIndex set the moment a specific hand position is tapped (before the
   * flight/reveal animation even starts) - see BoardOverlay.tsx's StealProgressInfo. */
  onStealProgress: (info: StealProgressInfo) => void;
}

/** Unwraps copyLastCard/wildAs down to the underlying forceDraw, same pattern as
 * SevenSplitOverlay's unwrapSplitSeven - so this works the same whether the 2 was played
 * directly, copied by an 8, or impersonated by a Joker. */
export function unwrapForceDraw(move: Move): ForceDrawMove | null {
  if (move.kind === 'forceDraw') return move;
  if (move.kind === 'wildAs' || move.kind === 'copyLastCard') return unwrapForceDraw(move.innerMove);
  return null;
}

// "Draw opponent's card" - a blind steal at *pick* time (the position grid never shows
// which card is which, so the choice itself is genuinely uninformed). The engine enumerates
// one legal move per (opponent, hand position), so the UI's job is just: pick whose hand,
// then pick a position. Once a position is committed to, StealFlight reveals the real card
// mid-flight into the thief's hand (see its own comment on why that's fine to show) rather
// than the move applying with an instant teleport.
export function StealCardOverlay({ state, moves, onPlay, forcedTarget, onBack, onStealProgress }: Props) {
  const [targetPlayer, setTargetPlayer] = useState<PlayerId | null>(forcedTarget ?? null);
  const [flight, setFlight] = useState<{ plan: StealFlightPlan; move: Move } | null>(null);
  const player = state.currentPlayer;

  const candidates = moves
    .map((top) => ({ top, inner: unwrapForceDraw(top) }))
    .filter((c): c is { top: Move; inner: ForceDrawMove } => c.inner !== null);

  const targets = [...new Set(candidates.map((c) => c.inner.targetPlayer))];

  if (flight) {
    return (
      <StealFlight
        plan={flight.plan}
        onDone={() => {
          onPlay(player, flight.move);
          setFlight(null);
        }}
      />
    );
  }

  if (targetPlayer === null) {
    return (
      <div className="rank-picker" role="group" aria-label="Choose whose hand to draw from">
        {targets.map((t) => (
          <button key={t} type="button" className="cp-button rank-picker__chip" onClick={() => setTargetPlayer(t)}>
            Player {t + 1}
          </button>
        ))}
      </div>
    );
  }

  const cardCount = state.hands[targetPlayer].length;
  const forTarget = candidates.filter((c) => c.inner.targetPlayer === targetPlayer);

  return (
    <div className="steal-overlay">
      <div role="group" aria-label={`Player ${targetPlayer + 1}'s hand, face down - pick a card to draw`} className="steal-overlay__cards">
        {Array.from({ length: cardCount }, (_, i) => {
          const match = forTarget.find((c) => c.inner.targetCardIndex === i);
          if (!match) return null;
          return (
            <button
              key={i}
              type="button"
              className="playing-card steal-overlay__card"
              aria-label={`Draw Player ${targetPlayer + 1}'s card, ${i + 1} of ${cardCount}`}
              onClick={(e) => {
                onStealProgress({ targetPlayer, card: match.top.card, cardIndex: i });
                const fromRect = e.currentTarget.getBoundingClientRect();
                const handRect = document.querySelector('.hand-panel')?.getBoundingClientRect();
                if (!handRect) {
                  // No hand panel measured (shouldn't happen in practice) - fall back to
                  // applying the move directly rather than losing the tap entirely.
                  onPlay(player, match.top);
                  return;
                }
                setFlight({
                  move: match.top,
                  plan: {
                    card: state.hands[targetPlayer][i],
                    from: { x: fromRect.left, y: fromRect.top, width: fromRect.width, height: fromRect.height },
                    to: { x: handRect.left + handRect.width / 2, y: handRect.top + handRect.height / 2 },
                  },
                });
              }}
            >
              <img src={CARD_BACK_SPRITE} alt="" aria-hidden="true" className="steal-overlay__back" />
            </button>
          );
        })}
      </div>
      {onBack ? (
        <button type="button" className="cp-button steal-overlay__cancel" onClick={onBack}>
          Back
        </button>
      ) : targets.length > 1 && (
        <button type="button" className="cp-button steal-overlay__cancel" onClick={() => setTargetPlayer(null)}>
          Choose a different player
        </button>
      )}
    </div>
  );
}
