import { useEffect, useRef, useState } from 'react';
import type { Room } from 'colyseus.js';
import type { PlayerId } from '@crazypixel/shared';
import { setSeatColor, startGame } from './game/network';
import type { RoomState, OnlineSession } from './game/network';
import { PlayerMarble } from './PlayerMarble';
import type { PlayerIdentity as Identity } from './game/playerIdentity';

interface Props {
  room: Room<RoomState>;
  isHost: boolean;
  identity: Identity;
  onReady: (session: OnlineSession) => void;
}

// Mirrors GameRoom.ts's own MIN_PLAYERS/MAX_PLAYERS - purely for showing the right message
// client-side before the server's authoritative check runs (handleStartGame re-derives this
// exact rule server-side regardless of what this component decides to enable/disable).
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

function startReason(mode: RoomState['mode'], filledSeats: number): string {
  if (filledSeats < MIN_PLAYERS) return `Need at least ${MIN_PLAYERS} players - ${filledSeats} joined.`;
  if (mode === 'teams' && (filledSeats < 4 || filledSeats % 2 !== 0)) {
    return `Partners needs an even player count, 4 or 6 - ${filledSeats} joined.`;
  }
  return `${filledSeats} of up to ${MAX_PLAYERS} joined - ready to start.`;
}

/** The room's own lobby screen, shared by the host (who can Start once the room's eligible)
 * and every joiner (who just watches it fill). Extracted out of the old OnlineLobby.tsx step
 * machine into its own file since Lobby.tsx now reaches this screen from two different
 * places (host-create success, and a direct join) rather than one linear step sequence. */
export function WaitingRoom({ room, isHost, identity, onReady }: Props) {
  const [, forceRender] = useState(0);
  const [copyStatus, setCopyStatus] = useState('');
  const [copyError, setCopyError] = useState('');
  const copyTimeoutRef = useRef<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Guards onReady (a real side effect - hands the finished session up to App, which
  // unmounts this whole lobby tree) against firing twice, same pattern as
  // BoardOverlay.tsx's autoPlayedKeyRef - see CLAUDE.md's StrictMode double-invoke note.
  const readyFiredRef = useRef(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleChange = () => forceRender((n) => n + 1);
    room.onStateChange(handleChange);
    // No unsubscribe - this room lives for the whole online session once joined, same
    // lifecycle convention as GameView's Phaser instance.
  }, [room]);

  useEffect(() => () => {
    if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
  }, []);

  const mySeatIndex = Array.from(room.state.seatSessionIds).indexOf(room.sessionId);

  useEffect(() => {
    if (readyFiredRef.current) return;
    if (room.state.phase !== 'playing') return;
    if (mySeatIndex === -1) return;
    readyFiredRef.current = true;
    onReady({
      room,
      mySeat: mySeatIndex as PlayerId,
      colors: Array.from(room.state.colors),
      playerNames: Array.from(room.state.playerNames),
    });
  });

  // Your color lives in one place now (the profile strip up top, PlayerIdentity.tsx via
  // MarbleColorPicker) - this just relays a change to the server whenever it happens while
  // you're seated here, instead of this screen having its own separate slider that could
  // drift from what the profile strip shows.
  useEffect(() => {
    if (mySeatIndex === -1) return;
    setSeatColor(room, identity.hue);
  }, [identity.hue, mySeatIndex, room]);

  const filledSeats = room.state.seatSessionIds.length;
  const canStart = filledSeats >= MIN_PLAYERS
    && (room.state.mode !== 'teams' || (filledSeats >= 4 && filledSeats % 2 === 0));
  const modeLabel = room.state.mode === 'teams' ? 'Partners' : 'Free for all';
  const reason = startReason(room.state.mode, filledSeats);
  // One persistent live region for everything ambient here (room creation, seats filling,
  // Start becoming available) - same convention as GameBoard's lastMoveAnnouncement
  // paragraph, rather than marking individually mounting/unmounting elements as live
  // (unreliable across screen readers when the region itself appears at the same time as
  // its content). This only re-announces on a real room.onStateChange event (a join/leave/
  // start), never on an unrelated local render, so folding the Start-eligibility reason in
  // here doesn't turn it into per-tick spam.
  const announcement = isHost
    ? `Room created. Code ${room.state.code}. ${reason}`
    : `${filledSeats} players connected.`;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(room.state.code)
      .then(() => {
        setCopyError('');
        setCopyStatus('Copied');
        if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = window.setTimeout(() => setCopyStatus(''), 2500);
      })
      .catch(() => {
        setCopyStatus('');
        setCopyError('Could not copy automatically - select and copy the code above.');
      });
  };

  return (
    <section className="cp-panel lobby__section">
      <h2 className="lobby__heading" ref={headingRef} tabIndex={-1}>Waiting for players</h2>
      {isHost && (
        <div className="lobby__code-row">
          <p className="lobby__code">{room.state.code}</p>
          <button type="button" className="cp-button lobby__code-copy" onClick={handleCopyCode}>
            Copy
          </button>
          {/* Visible confirmation for sighted users - aria-hidden since the role="status"
              paragraph right below already covers screen readers. Kept as a separate element
              rather than swapping the button's own label/text: a name change on an
              already-focused control isn't reliably re-announced (see the a11y review this
              file's history references), so the button's accessible name never changes. */}
          <span className={`lobby__copy-feedback${copyStatus ? ' lobby__copy-feedback--shown' : ''}`} aria-hidden="true">
            Copied
          </span>
        </div>
      )}
      {isHost && <p role="status" className="visually-hidden">{copyStatus}</p>}
      {isHost && copyError && <p role="alert" className="lobby__error">{copyError}</p>}
      <p className="lobby__hint">{modeLabel}</p>

      <ul className="lobby__roster">
        {Array.from({ length: filledSeats }, (_, i) => (
          <li key={i} className="lobby__roster-seat">
            <PlayerMarble hue={room.state.colors[i] ?? 0} size="20px" />
            <span className="lobby__roster-name">
              {room.state.playerNames[i]}
              {i === 0 && <span className="lobby__roster-tag"> · host</span>}
            </span>
          </li>
        ))}
      </ul>

      {isHost ? (
        <>
          <p id="start-reason" className="lobby__hint">{reason}</p>
          <button
            type="button"
            className="cp-button lobby__start"
            aria-disabled={!canStart}
            aria-describedby="start-reason"
            onClick={() => {
              if (!canStart) return;
              startGame(room);
            }}
          >
            Start Game
          </button>
        </>
      ) : (
        <p className="lobby__hint" role="status">
          {canStart ? 'Waiting for the host to start the game.' : 'Waiting for more players to join.'}
        </p>
      )}
      <p aria-live="polite" className="visually-hidden">{announcement}</p>
    </section>
  );
}
