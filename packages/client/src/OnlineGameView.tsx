// Networked game. Same GameBoard as local hotseat, fed by the server-backed hook and given
// the online-only extras: a turn clock, steal warnings, emotes and drop recovery.

import { useOnlineGameState } from './game/useOnlineGameState';
import { useRoomConnection } from './game/useRoomConnection';
import { GameBoard } from './GameBoard';
import type { BoardBackground } from './GameBoard';
import { ConnectionBanner } from './ConnectionBanner';
import type { OnlineSession } from './game/network';

interface Props {
  session: OnlineSession;
  onBackgroundChange?: (background: BoardBackground) => void;
  /** Back to the pregame menu, once this seat can't be recovered. */
  onExit: () => void;
}

export function OnlineGameView({ session, onBackgroundChange, onExit }: Props) {
  const { room, status } = useRoomConnection(session.room);
  const {
    state, play, passCurrentHand, rematch, lastPlanRef, turnDeadline, stealIntent, announceStealIntent,
    emotes, emote, connected,
  } = useOnlineGameState(room);
  // The lowest connected seat deals the rematch - seat 0, the host who pressed Start, unless
  // they've dropped (see GameRoom.rematchSeat). One player decides for the table instead of
  // six win screens racing each other; everyone else gets hint text in the button's place,
  // so the win screen isn't a dead end.
  const rematchSeat = connected.indexOf(true);
  const canRematch = rematchSeat === session.mySeat;
  const rematchName = session.playerNames[rematchSeat] || `Player ${rematchSeat + 1}`;
  return (
    <>
      <GameBoard
        state={state}
        play={play}
        passCurrentHand={passCurrentHand}
        restart={canRematch ? rematch : undefined}
        restartLabel="Rematch"
        restartHint={canRematch ? undefined : `Waiting for ${rematchName} to start a rematch.`}
        lastPlanRef={lastPlanRef}
        mySeat={session.mySeat}
        colors={session.colors}
        playerNames={session.playerNames}
        turnDeadline={turnDeadline}
        onBackgroundChange={onBackgroundChange}
        // Steal warnings and emotes are online-only: both are messages about someone looking at
        // a different screen, which local hotseat (one shared device) has no equivalent of.
        stealIntent={stealIntent}
        onStealIntent={announceStealIntent}
        emotes={emotes}
        onEmote={emote}
      />
      <ConnectionBanner status={status} onExit={onExit} />
    </>
  );
}
