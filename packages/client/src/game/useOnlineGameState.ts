import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card, GameState, Move, PlayerId } from '@crazypixel/shared';
import type { Room } from 'colyseus.js';
import { requestRematch, sendStealIntent } from './network';
import type { RoomState, StealIntentMessage } from './network';
import { EMPTY_TURN_ANIMATION, planCaptures } from './animationPlan';
import type { TurnAnimation } from './animationPlan';

// Server is authoritative here - play/passCurrentHand only ever send the intent over the
// network; the resulting GameState comes back through room.onStateChange, never mutated
// locally. lastPlanRef's `marbles`/`draws` therefore stay empty always: unlike the local
// engine, this hook only sees before/after GameState snapshots for OTHER players' moves,
// not the Move itself, so it has nothing to build a real movement-path animation plan from
// (see design doc's out-of-scope note on server-driven animations). capturedMarbleIds is
// the exception - planCaptures is a pure before/after zone diff that never needed the Move
// in the first place, so the capture flash works online exactly as it does locally.
export function useOnlineGameState(room: Room<RoomState>) {
  const [state, setState] = useState<GameState>(() => JSON.parse(room.state.stateJson) as GameState);
  const [turnDeadline, setTurnDeadline] = useState(room.state.turnDeadline);
  const lastPlanRef = useRef<TurnAnimation>(EMPTY_TURN_ANIMATION);
  // Previous snapshot to diff captures against, plus the raw JSON it came from. The raw
  // string is the dedupe key: StrictMode double-invokes this hook's effect and there's no
  // unsubscribe (see below), so applyStateJson runs twice per server change. Without the
  // guard the second run would diff the new state against ITSELF, find no captures, and
  // overwrite the plan the first run just built - the flash would never fire.
  const prevStateRef = useRef<GameState>(state);
  const prevJsonRef = useRef<string>(room.state.stateJson);
  // "Someone has singled out a hand to steal from, but hasn't committed to a card yet" -
  // ephemeral, broadcast-only, never part of stateJson (see GameRoom.handleStealIntent).
  const [stealIntent, setStealIntent] = useState<StealIntentMessage | null>(null);

  useEffect(() => {
    const applyStateJson = () => {
      if (!room.state.stateJson) return;
      setTurnDeadline(room.state.turnDeadline);
      if (room.state.stateJson === prevJsonRef.current) return;
      const next = JSON.parse(room.state.stateJson) as GameState;
      // A rematch (GameRoom.handleRematch) replaces the whole GameState with a freshly
      // dealt one, and gameEnd -> anything else is the only transition that can do it (the
      // engine never leaves gameEnd on its own - checkWinner early-returns once winners is
      // set). Diffing across that boundary would read every marble that was out on the
      // track or home in the finished game as "just sent to kennel" and fire a capture
      // flash for all of them at once, on a board that's actually just been re-dealt.
      const isRematch = prevStateRef.current.phase === 'gameEnd' && next.phase !== 'gameEnd';
      lastPlanRef.current = {
        marbles: [],
        draws: [],
        capturedMarbleIds: isRematch ? [] : planCaptures(prevStateRef.current, next),
      };
      prevStateRef.current = next;
      prevJsonRef.current = room.state.stateJson;
      // Any new authoritative state means the turn moved on, so whatever the last player was
      // lining up is over - the steal intent expires here rather than needing its own "clear"
      // broadcast from the server, which would be racing this very state patch to arrive
      // first (colyseus makes no ordering guarantee between a broadcast and a state patch
      // flushed in the same tick). Covers every way an intent can end that isn't the thief
      // explicitly backing out: the steal committing, a different card being played instead,
      // and the 20s turn clock auto-playing for a thief who walked away mid-pick.
      setStealIntent(null);
      setState(next);
    };
    room.onStateChange(applyStateJson);
    room.onMessage('stealIntent', (message: StealIntentMessage) => setStealIntent(message));
    // No unsubscribe - this hook lives for the whole online game session, same lifecycle
    // convention as GameView's Phaser instance and WaitingRoom.tsx's own listener.
  }, [room]);

  const play = useCallback((player: PlayerId, move: Move) => {
    room.send('play', { move });
  }, [room]);

  const passCurrentHand = useCallback(() => {
    room.send('passHand');
  }, [room]);

  const rematch = useCallback(() => {
    requestRematch(room);
  }, [room]);

  const announceStealIntent = useCallback((targetPlayer: PlayerId, card: Card) => {
    sendStealIntent(room, targetPlayer, card);
  }, [room]);

  return { state, play, passCurrentHand, rematch, lastPlanRef, turnDeadline, stealIntent, announceStealIntent };
}
