import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card, GameState, Move, PlayerId } from '@crazypixel/shared';
import type { Room } from 'colyseus.js';
import { requestRematch, sendEmote, sendStealIntent } from './network';
import type { EmoteMessage, RoomState, StealIntentMessage } from './network';
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

// How many emotes the feed holds at once. Small on purpose - this is a HUD strip beside the
// discard pile, not a chat log, and the board behind it has to stay readable. Older entries
// fall off the top rather than scrolling.
const MAX_FEED = 4;
// How long a single emote survives if nothing pushes it out first. Long enough to answer one
// (the cooldown is 1.2s server-side), short enough that a quiet table clears itself back to a
// bare board instead of leaving stale reactions parked over it.
const EMOTE_TTL_MS = 6500;

/** One emote as the feed holds it. `id` is the server's own counter (see
 * GameRoom.handleEmote), so identical emotes sent back to back stay distinct entries. */
export interface FeedEmote {
  id: number;
  by: PlayerId;
  emoteId: string;
}

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
  // Newest last. Same ephemeral, broadcast-only shape as stealIntent above - emotes are
  // never part of stateJson (see GameRoom.handleEmote for why).
  const [emotes, setEmotes] = useState<FeedEmote[]>([]);

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
    room.onMessage('emote', (message: EmoteMessage) => {
      // Deduped by the server's own id, for the same reason applyStateJson dedupes on the
      // raw JSON above: StrictMode double-invokes this effect and there's no unsubscribe, so
      // colyseus.js ends up with this callback registered twice (its onMessage APPENDS to a
      // nanoevents list rather than replacing) and every broadcast arrives here twice. Unlike
      // setStealIntent, appending to a list isn't idempotent - without this every emote shows
      // up in the feed as two identical entries in dev.
      setEmotes((prev) => (prev.some((e) => e.id === message.id)
        ? prev
        : [...prev, { id: message.id, by: message.by, emoteId: message.emoteId }].slice(-MAX_FEED)));
      // Expiry is per-message rather than one sweeping interval so each emote gets the full
      // TTL from its own arrival, not from wherever a shared tick happened to be. Firing
      // twice under the double-registration above is harmless - removing an id that's already
      // gone is a no-op that returns the same array.
      setTimeout(() => {
        setEmotes((prev) => (prev.some((e) => e.id === message.id) ? prev.filter((e) => e.id !== message.id) : prev));
      }, EMOTE_TTL_MS);
    });
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

  const emote = useCallback((emoteId: string) => {
    sendEmote(room, emoteId);
  }, [room]);

  return {
    state, play, passCurrentHand, rematch, lastPlanRef, turnDeadline, stealIntent, announceStealIntent,
    emotes, emote,
  };
}
