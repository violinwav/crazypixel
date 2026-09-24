// Keeps an online seat alive across drops. A phone backgrounding the tab, a flaky network or
// the OS suspending the page all close the socket without the player meaning to leave; the
// server holds the seat open for a while (GameRoom.onLeave), and this hook is what walks back
// into it. Reconnecting yields a brand-new Room object, so everything downstream reads the
// room from here rather than holding on to the one it was first handed.

import { useEffect, useState } from 'react';
import type { Room } from 'colyseus.js';
import { forgetRoom, isRoomGone, reconnectRoom } from './network';
import type { RoomState } from './network';

// colyseus.js's CloseCode.CONSENTED - the socket closed because this client called leave().
// Not imported: colyseus.js only exports it from a deep path.
const CLOSE_CONSENTED = 4000;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 8000;

export type ConnectionStatus = 'connected' | 'reconnecting' | 'lost';

export function useRoomConnection(initialRoom: Room<RoomState>) {
  const [room, setRoom] = useState(initialRoom);
  const [status, setStatus] = useState<ConnectionStatus>('connected');

  useEffect(() => {
    // Read now, not at drop time: colyseus keeps it on the Room object, but a fresh one is
    // issued per connection, so it has to be this room's.
    const token = room.reconnectionToken;
    let dropped = false;
    let inFlight = false;
    let cancelled = false;
    let attempt = 0;
    let retryTimer: number | undefined;

    const tryReconnect = () => {
      if (cancelled || inFlight || !dropped) return;
      window.clearTimeout(retryTimer);
      inFlight = true;
      reconnectRoom(token)
        .then((next) => {
          if (cancelled) return;
          setRoom(next);
          setStatus('connected');
        })
        .catch((error: unknown) => {
          inFlight = false;
          if (cancelled) return;
          if (isRoomGone(error)) {
            forgetRoom();
            setStatus('lost');
            return;
          }
          // Still offline, or the server is restarting - keep trying. The 'visible' and
          // 'online' listeners below cut the wait short the moment either is worth a try.
          attempt += 1;
          retryTimer = window.setTimeout(tryReconnect, Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS));
        });
    };

    const handleLeave = (code: number) => {
      if (code === CLOSE_CONSENTED) return;
      dropped = true;
      setStatus('reconnecting');
      tryReconnect();
    };

    // A backgrounded mobile tab has its timers throttled or frozen outright, so a pending
    // backoff retry may not fire for minutes after the player comes back to it. Retry on
    // return instead of waiting that out.
    const handleResume = () => {
      if (document.visibilityState === 'visible') tryReconnect();
    };

    room.onLeave(handleLeave);
    document.addEventListener('visibilitychange', handleResume);
    window.addEventListener('online', handleResume);
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      room.onLeave.remove(handleLeave);
      document.removeEventListener('visibilitychange', handleResume);
      window.removeEventListener('online', handleResume);
    };
  }, [room]);

  return { room, status };
}
