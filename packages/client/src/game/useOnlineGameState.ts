// Online game state. The server is authoritative: play/passCurrentHand only send intents,
// and every GameState comes back through room.onStateChange, never mutated locally. Exposes
// the same shape as useGameState.ts (local hotseat) plus the online-only extras -
// turnDeadline, steal intents and emotes - so GameBoard.tsx can render either.
//
// Movement animations are planned locally from room.state.lastMoveJson (the Move the server
// applied, synced in the same patch as stateJson) run through the same planTurn the local
// hook uses, against this client's previous snapshot. That is what makes a remote marble
// walk its real path square by square: a before/after GameState pair says where a marble
// ended up but nothing about how it got there. Captures stay a pure zone diff, which also
// catches a capture from a state that arrived with no move behind it.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card, GameState, Move, PlayerId } from '@crazypixel/shared';
import type { Room } from 'colyseus.js';
import { requestRematch, sendEmote, sendStealIntent } from './network';
import type { EmoteMessage, RoomState, StealIntentMessage } from './network';
import { EMPTY_TURN_ANIMATION, planCaptures, planTurn } from './animationPlan';
import type { TurnAnimation } from './animationPlan';

// How many emotes the feed holds at once. Small on purpose - this is a HUD strip beside the
// discard pile, not a chat log, and the board behind it has to stay readable.
const MAX_FEED = 4;
// How long one emote survives if nothing pushes it out first. Long enough to answer one (the
// server cooldown is 1.2s), short enough that a quiet table clears itself back to a bare
// board instead of leaving stale reactions parked over it.
const EMOTE_TTL_MS = 6500;

/**
 * One emote as the feed holds it. `id` is the server's own counter (GameRoom.handleEmote),
 * so identical emotes sent back to back stay distinct entries.
 */
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
  // string is the dedupe key: StrictMode double-invokes this effect and there's no
  // unsubscribe (see below), so the handler runs twice per server change. Without the guard
  // the second run would diff the new state against ITSELF, find no captures, and overwrite
  // the plan the first run just built.
  const prevStateRef = useRef<GameState>(state);
  const prevJsonRef = useRef<string>(room.state.stateJson);
  // "Someone has singled out a hand to steal from, but hasn't committed to a card yet" -
  // ephemeral and broadcast-only, never part of stateJson (see GameRoom.handleStealIntent).
  const [stealIntent, setStealIntent] = useState<StealIntentMessage | null>(null);
  // Newest last. Same ephemeral, broadcast-only shape as stealIntent above.
  const [emotes, setEmotes] = useState<FeedEmote[]>([]);

  useEffect(() => {
    const applyStateJson = () => {
      if (!room.state.stateJson) return;
      setTurnDeadline(room.state.turnDeadline);
      if (room.state.stateJson === prevJsonRef.current) return;
      const next = JSON.parse(room.state.stateJson) as GameState;
      // A rematch replaces the whole GameState with a freshly dealt one, and gameEnd ->
      // anything else is the only transition that can do it (the engine never leaves gameEnd
      // on its own). Diffing across that boundary would read every marble that was out in
      // the finished game as "just sent to kennel" and flash a capture for all of them.
      const isRematch = prevStateRef.current.phase === 'gameEnd' && next.phase !== 'gameEnd';
      // Planned against the PREVIOUS snapshot: that's the state the server ran the move
      // against, and the one the walk animation starts from. An empty string means no move
      // was behind this state (a pass, a fresh deal); a rematch is skipped for the same
      // reason its captures are.
      const moveJson = room.state.lastMoveJson;
      const plan = moveJson && !isRematch
        ? planTurn(prevStateRef.current, JSON.parse(moveJson) as Move)
        : EMPTY_TURN_ANIMATION;
      lastPlanRef.current = {
        marbles: plan.marbles,
        draws: plan.draws,
        capturedMarbleIds: isRematch ? [] : planCaptures(prevStateRef.current, next),
      };
      prevStateRef.current = next;
      prevJsonRef.current = room.state.stateJson;
      // New authoritative state means the turn moved on, so whatever the last player was
      // lining up is over. Expiring the intent here rather than on a server "clear" broadcast
      // avoids racing this very state patch (colyseus makes no ordering guarantee between a
      // broadcast and a state patch flushed in the same tick), and covers every way an intent
      // can end: the steal committing, a different card being played, or the turn clock
      // auto-playing for a thief who walked away mid-pick.
      setStealIntent(null);
      setState(next);
    };
    room.onStateChange(applyStateJson);
    room.onMessage('stealIntent', (message: StealIntentMessage) => setStealIntent(message));
    room.onMessage('emote', (message: EmoteMessage) => {
      // Deduped on the server's id for the same reason applyStateJson dedupes on raw JSON:
      // StrictMode double-invokes this effect and there's no unsubscribe, so colyseus.js ends
      // up with this callback registered twice (onMessage appends rather than replaces) and
      // every broadcast arrives twice. Unlike setStealIntent, appending to a list isn't
      // idempotent - without this every emote shows up twice in dev.
      setEmotes((prev) => (prev.some((e) => e.id === message.id)
        ? prev
        : [...prev, { id: message.id, by: message.by, emoteId: message.emoteId }].slice(-MAX_FEED)));
      // Expiry is per-message rather than one sweeping interval, so each emote gets its full
      // TTL from its own arrival. Firing twice under the double-registration above is
      // harmless: removing an id that's already gone returns the same array.
      setTimeout(() => {
        setEmotes((prev) => (prev.some((e) => e.id === message.id) ? prev.filter((e) => e.id !== message.id) : prev));
      }, EMOTE_TTL_MS);
    });
    // No unsubscribe - this hook lives for the whole online session, the same lifecycle
    // convention as GameBoard's Phaser instance and WaitingRoom.tsx's own listener.
  }, [room]);

  // `player` is ignored: the server derives the seat from the connection. The parameter
  // exists so this matches useGameState's play signature, which GameBoard.tsx calls.
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
