// Drives every non-human seat in singleplayer and enforces the human's own turn clock - the
// local counterpart to GameRoom.ts's scheduleTurnTimeout/autoPlayTurn. See that file for the
// server-side original this mirrors; the differences below are called out where they diverge.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getLegalMoves } from '@crazypixel/shared';
import type { Card, GameState, Move, PlayerId } from '@crazypixel/shared';
import { chooseBotMove, unwrapForceDraw } from './botAI';
import type { BotDifficulty } from './botAI';

// The clock every turn's bar counts down, matching the server's own TURN_MS online. It is the
// human's real deadline; for a bot it is only what's DRAWN - the bot commits at BOT_MOVE_MS and
// the turn moves on long before the bar empties, exactly the way a fast human online plays well
// inside their own 20s. Deliberately not shortened to BOT_MOVE_MS for bot turns: a bar that
// resized per seat turned every bot turn into its own visibly different countdown, when the
// point of showing it at all is that a turn always looks the same length whoever is taking it.
const TURN_MS = 20000;
const BOT_MOVE_MS = 3000;

interface PendingSteal {
  target: PlayerId;
  card: Card;
}

interface Args {
  state: GameState;
  humanSeat: PlayerId;
  botDifficulties: (BotDifficulty | null)[];
  /** Whether the human's own turn is time-limited at all. Bots always get their fixed 3s
   * regardless - this only controls whether YOUR turn can be taken away from you. Defaults to on
   * (matching online) in PlayerSetupPicker, but WCAG 2.2.1 (Timing Adjustable) requires a way to
   * turn a non-essential time limit off, and unlike online - where the clock also protects other
   * waiting humans - a solo game against bots has no one else it needs to keep moving for, so
   * there's no essential-exception argument for forcing it. */
  turnTimerEnabled: boolean;
  play: (player: PlayerId, move: Move) => void;
  passCurrentHand: () => void;
}

/**
 * Plays every non-human seat automatically ~3s after its turn starts, and - when
 * turnTimerEnabled - auto-plays the human's own seat if their 20s runs out. The pairing (bots
 * always, your own clock optionally) is what makes singleplayer feel like a seat at an online
 * table instead of hotseat-for-everyone, without forcing a hard time limit on a solo player who
 * needs more of it.
 */
export function useSingleplayerAutopilot({ state, humanSeat, botDifficulties, turnTimerEnabled, play, passCurrentHand }: Args) {
  const isHumanTurn = state.currentPlayer === humanSeat;

  // One full-length clock per turn whoever is acting - see TURN_MS. Keyed on `state` because a
  // new state object is exactly what a committed turn produces, so the bar restarts once per
  // turn and never mid-turn.
  const [deadline, setDeadline] = useState(() => Date.now() + TURN_MS);
  useEffect(() => {
    if (state.phase === 'gameEnd') return;
    setDeadline(Date.now() + TURN_MS);
  }, [state]);

  /**
   * Set the instant the human commits to a steal TARGET (BoardOverlay -> GameBoard's
   * handleStealCommit -> GameBoard's onStealIntent prop, wired online-only until now), before
   * they've picked the blind card position. Mirrors GameRoom's own pendingSteal field - the
   * local equivalent of the server's network gap is the human's own decision time between the
   * two taps. Cleared at the top of every turn, exactly like commitTurn clears the server copy.
   */
  const pendingStealRef = useRef<PendingSteal | null>(null);
  const onStealIntent = useCallback((target: PlayerId, card: Card) => {
    pendingStealRef.current = { target, card };
  }, []);

  /**
   * Dedupe guard against StrictMode's dev-only effect double-invoke. NOT the guard-then-schedule
   * shape BoardOverlay.tsx's autoPlayedKeyRef uses - that pattern relies on the effect having no
   * cleanup, so the second invocation sees the ref the first one just set synchronously. This
   * effect needs a real cleanup (clearing the pending timer on a genuine unmount or turn
   * change), and StrictMode runs that cleanup *between* its two invocations - clearing
   * invocation 1's timer before invocation 2 ever runs. A check-before-schedule guard would then
   * see the ref already claimed and skip rescheduling entirely, leaving zero live timers and a
   * turn that never times out. Scheduling unconditionally every invocation instead, with the
   * dedupe only checked/claimed once a timer actually FIRES, means invocation 1's timer is
   * cleared as intended and invocation 2's is the one that survives - exactly one call, on
   * every real turn including the first.
   */
  const firedForRef = useRef<GameState | null>(null);

  useEffect(() => {
    if (state.phase === 'gameEnd') return undefined;
    pendingStealRef.current = null;

    const seat = state.currentPlayer;
    const difficulty = botDifficulties[seat];
    if (seat === humanSeat && !turnTimerEnabled) return undefined; // unlimited time, same as hotseat always had
    if (seat !== humanSeat && difficulty == null) return undefined; // defensive: no controller for this seat

    const delay = seat === humanSeat ? TURN_MS : BOT_MOVE_MS;

    const fire = () => {
      if (firedForRef.current === state) return;
      firedForRef.current = state;

      if (seat === humanSeat) {
        const pending = pendingStealRef.current;
        if (pending) {
          const card = state.hands[seat].find((c) => c.id === pending.card.id);
          const steals = card
            ? getLegalMoves(state, seat, card).filter((m) => unwrapForceDraw(m)?.targetPlayer === pending.target)
            : [];
          if (steals.length > 0) {
            play(seat, steals[Math.floor(Math.random() * steals.length)]);
            return;
          }
          // No legal fallthrough for that exact steal any more - fall through to the ordinary
          // path below, mirroring GameRoom.autoPlayTurn's own fallthrough.
        }

        for (const card of state.hands[seat]) {
          const legal = getLegalMoves(state, seat, card);
          if (legal.length > 0) {
            play(seat, legal[Math.floor(Math.random() * legal.length)]);
            return;
          }
        }
        passCurrentHand();
        return;
      }

      const move = chooseBotMove(state, seat, difficulty!);
      if (move) play(seat, move);
      else passCurrentHand();
    };

    const timer = setTimeout(fire, delay);
    return () => clearTimeout(timer);
  }, [state, humanSeat, botDifficulties, turnTimerEnabled, play, passCurrentHand]);

  const showTimer = state.phase !== 'gameEnd' && (!isHumanTurn || turnTimerEnabled);
  return {
    turnDeadline: showTimer ? deadline : undefined,
    onStealIntent,
  };
}
