import { useState } from 'react';
import type { Card, GameState, Move, PlayerId } from '@crazypixel/shared';
import { CARD_BACK_SPRITE } from './game/cardArt';
import { StealFlight } from './StealFlight';
import type { StealFlightPlan } from './StealFlight';
import type { Point } from './game/boardLayout';

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
  /** Where the target's own card stack sits on the board, in board-overlay coordinates (see
   * boardLayout's handCountPoint). The reveal flight starts THERE rather than at the tapped
   * position in the picker row: the picker is an abstract grid at the bottom of the screen,
   * so a card leaving it says nothing about whose hand it came out of, while a card leaving
   * the stack hovering over that player's own home row says it without a word. */
  targetFanPoint?: Point;
  /** Fired once the reveal has been held long enough to read - the hand opens a slot on the
   * right for the card so it has somewhere to land (see GameBoard's incomingCard). */
  onIncoming: (card: Card) => void;
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
// then pick a position. Choosing whose hand happens one level up (BoardOverlay's figure
// step) and is irreversible - the card is already face-up on the discard pile by the time
// this renders - so there is no way out of here but picking a position, or letting the turn
// clock pick one (GameRoom.autoPlayTurn). Once a position is committed to, StealFlight
// carries the card back from that player's stack and reveals it in the thief's hand rather
// than the move applying with an instant teleport.
export function StealCardOverlay({ state, moves, onPlay, forcedTarget, targetFanPoint, onIncoming }: Props) {
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
        onMakeRoom={() => onIncoming(flight.plan.card)}
        // Queried here rather than inside StealFlight, which has no business knowing what the
        // hand panel's markup looks like - this component already reads .hand-panel and
        // .board-overlay for the flight's own endpoints.
        resolveLanding={() => {
          const slot = document.querySelector('[data-incoming-slot]');
          if (!slot) return null;
          const rect = slot.getBoundingClientRect();
          // A slot mid-way through opening (or already closed again) is not somewhere to aim.
          if (rect.width < 1) return null;
          return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
        }}
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
                const fromRect = e.currentTarget.getBoundingClientRect();
                const handRect = document.querySelector('.hand-panel')?.getBoundingClientRect();
                if (!handRect) {
                  // No hand panel measured (shouldn't happen in practice) - fall back to
                  // applying the move directly rather than losing the tap entirely.
                  onPlay(player, match.top);
                  return;
                }
                // closest(), not a document-wide query: several .board-overlay layers can be
                // mounted at once (an 8 offering its own move alongside a copied one), and
                // this walks up to the exact one targetFanPoint was measured against. They're
                // all inset:0 over the same container, so any of them would give the same
                // rect today - this just can't silently stop being true.
                const overlayRect = e.currentTarget.closest('.board-overlay')?.getBoundingClientRect();
                const from = targetFanPoint && overlayRect
                  ? {
                    x: overlayRect.left + targetFanPoint.x - fromRect.width / 2,
                    y: overlayRect.top + targetFanPoint.y - fromRect.height / 2,
                    width: fromRect.width,
                    height: fromRect.height,
                  }
                  : { x: fromRect.left, y: fromRect.top, width: fromRect.width, height: fromRect.height };
                setFlight({
                  move: match.top,
                  plan: {
                    card: state.hands[targetPlayer][i],
                    from,
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
    </div>
  );
}
