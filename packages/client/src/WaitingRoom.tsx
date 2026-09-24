import { useEffect, useRef, useState } from 'react';
import type { Room } from 'colyseus.js';
import type { PlayerId } from '@crazypixel/shared';
import { setSeatColor, startGame } from './game/network';
import type { RoomState, OnlineSession } from './game/network';
import { PlayerMarble } from './PlayerMarble';
import type { PlayerIdentity as Identity } from './game/playerIdentity';
import { useRoomConnection } from './game/useRoomConnection';
import { ConnectionBanner } from './ConnectionBanner';

interface Props {
  room: Room<RoomState>;
  identity: Identity;
  onReady: (session: OnlineSession) => void;
  /** Back to the menu, once a dropped connection can't be recovered. */
  onExit: () => void;
}

// Mirrors GameRoom's MIN_PLAYERS/MAX_PLAYERS, purely so the right message shows before the
// server's authoritative check runs - handleStartGame re-derives this rule regardless of what
// this component decides to enable.
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
// How long the "Copied" confirmation stays up.
const COPY_FEEDBACK_MS = 2500;

function startReason(mode: RoomState['mode'], filledSeats: number): string {
  if (filledSeats < MIN_PLAYERS) return `Need at least ${MIN_PLAYERS} players - ${filledSeats} joined.`;
  if (mode === 'teams' && (filledSeats < 4 || filledSeats % 2 !== 0)) {
    return `Partners needs an even player count, 4 or 6 - ${filledSeats} joined.`;
  }
  return `${filledSeats} of up to ${MAX_PLAYERS} joined - ready to start.`;
}

/**
 * The room's own lobby screen, shared by the host (who can Start once the room is eligible) and
 * every joiner (who watches it fill). Its own file rather than a step in a machine, since
 * Lobby.tsx reaches this screen from two places - host-create success and a direct join.
 */
export function WaitingRoom({ room: initialRoom, identity, onReady, onExit }: Props) {
  // Everything below reads the live room, never the prop: a reconnect swaps in a new Room
  // object, and onReady must hand App the one that is actually connected.
  const { room, status } = useRoomConnection(initialRoom);
  const [, forceRender] = useState(0);
  const [copyStatus, setCopyStatus] = useState('');
  const [copyError, setCopyError] = useState('');
  const copyTimeoutRef = useRef<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Guards onReady - a real side effect, handing the finished session up to App, which unmounts
  // this whole tree - against firing twice under StrictMode's double-invoke. Same pattern as
  // BoardOverlay's autoPlayedKeyRef; see CLAUDE.md.
  const readyFiredRef = useRef(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleChange = () => forceRender((n) => n + 1);
    room.onStateChange(handleChange);
    // No unsubscribe - this room lives for the whole online session once joined, the same
    // lifecycle convention as GameBoard's Phaser instance.
  }, [room]);

  useEffect(() => () => {
    if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
  }, []);

  const mySeatIndex = Array.from(room.state.seatSessionIds).indexOf(room.sessionId);
  // Derived live, not fixed at mount: the server's host is simply whoever sits in seat 0
  // (handleStartGame), and that moves when an earlier seat leaves the lobby - a joiner can be
  // promoted mid-wait and needs the code and Start button the moment they are.
  const isHost = mySeatIndex === 0;
  // Whether this client opened the room, as opposed to inheriting it - only for wording the
  // announcement. Latched on the first render that knows our seat, not the first render: the
  // create/join promise settles one message before the first state patch, so the seat list
  // can still be empty on mount. Seat 0 then means created here (or resumed as its host after
  // a reload, where "created" is still the truthful framing).
  const createdHereRef = useRef<boolean | null>(null);
  if (createdHereRef.current === null && mySeatIndex !== -1) createdHereRef.current = isHost;
  const createdHere = createdHereRef.current ?? false;

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

  // Color lives in one place, the profile strip. This only relays a change to the server while
  // you are seated here, rather than this screen keeping a second slider that could drift from
  // what the strip shows.
  useEffect(() => {
    if (mySeatIndex === -1) return;
    setSeatColor(room, identity.hue);
  }, [identity.hue, mySeatIndex, room]);

  const filledSeats = room.state.seatSessionIds.length;
  const canStart = filledSeats >= MIN_PLAYERS
    && (room.state.mode !== 'teams' || (filledSeats >= 4 && filledSeats % 2 === 0));
  const modeLabel = room.state.mode === 'teams' ? 'Partners' : 'Free for all';
  const reason = startReason(room.state.mode, filledSeats);
  // One persistent live region for everything ambient here (room creation, seats filling, Start
  // becoming available), rather than marking individually mounting elements as live - which is
  // unreliable across screen readers when the region appears at the same time as its content.
  // This only re-announces on a real room.onStateChange, never on an unrelated local render, so
  // folding the Start-eligibility reason in doesn't turn it into per-tick spam.
  const announcement = isHost
    ? `${createdHere ? 'Room created' : 'You are now the host'}. Code ${room.state.code}. ${reason}`
    : `${filledSeats} players connected.`;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(room.state.code)
      .then(() => {
        setCopyError('');
        setCopyStatus('Copied');
        if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = window.setTimeout(() => setCopyStatus(''), COPY_FEEDBACK_MS);
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
          {/* Visible confirmation for sighted users, aria-hidden because the role="status"
              paragraph below already covers screen readers. A separate element rather than
              swapping the button's own label: a name change on an already-focused control isn't
              reliably re-announced, so the button's accessible name never changes. */}
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
          {/* aria-disabled rather than the native attribute, so this stays focusable while its
              disabled-ness flips on its own as players join - see .cp-button[aria-disabled] in
              theme.css. The guard in onClick is what actually blocks an early start. */}
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
      <ConnectionBanner status={status} onExit={onExit} />
    </section>
  );
}
