// The server browser: every live room on the server, waiting or already playing.
//
// Read-only over plain HTTP (see network.fetchRoomList) and polled, not pushed: colyseus's own
// realtime lobby room only ever lists rooms that are unlocked and public, which is precisely
// the set that excludes every game in progress - the half of this list a player watching for a
// friend's table most wants to see.
//
// Most of the machinery below exists because a list that rewrites itself every few seconds is
// hostile to anyone trying to read or operate it: a poll must not move a row out from under a
// keyboard, and must not narrate itself to a screen reader that never asked.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { fetchRoomList } from './game/network';
import type { RoomSummary } from './game/network';

const POLL_MS = 5000;

interface Props {
  onJoin: (code: string) => void;
  /** Focused on mount by Lobby, matching how every other pregame screen hands off focus. */
  headingRef: RefObject<HTMLHeadingElement>;
}

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; rooms: RoomSummary[] }
  /** Carries the last good list - one failed poll shouldn't blank the screen. */
  | { kind: 'error'; rooms: RoomSummary[] };

function modeLabel(mode: RoomSummary['mode']): string {
  return mode === 'teams' ? 'Partners' : 'Free for all';
}

/**
 * Why a row's Join is inert, or null when it is joinable. One function rather than two booleans
 * so the button's state, its description and the visible tag can't drift apart.
 */
function blockedReason(room: RoomSummary): string | null {
  if (room.phase === 'playing') return 'In progress';
  if (room.seats >= room.maxSeats) return 'Full';
  return null;
}

/**
 * "1234" -> "1 2 3 4". A room code is four digits a player reads out to a friend, not a
 * quantity: speech synthesis turns a bare run of four into "one thousand two hundred thirty
 * four", or a year. Visible text stays the plain code.
 */
function spokenCode(code: string): string {
  return code.split('').join(' ');
}

function summarize(rooms: RoomSummary[]): string {
  // Both numbers, because they differ the moment a listed room is already playing: "4 rooms"
  // followed by one reachable Join button is a mismatch a keyboard user can't resolve.
  const joinable = rooms.filter((room) => blockedReason(room) === null).length;
  return `${rooms.length} room${rooms.length === 1 ? '' : 's'}, ${joinable} joinable`;
}

export function ServerList({ onJoin, headingRef }: Props) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [auto, setAuto] = useState(true);
  const [held, setHeld] = useState(false);
  /**
   * The spoken-only channel, deliberately separate from the visible status line: that line
   * changes on every background poll, and a live region on it would read a room count aloud
   * every five seconds to someone who never asked for one. Only the player's own actions write
   * here.
   */
  const [notice, setNotice] = useState('');
  const baseId = useId();
  const headingId = `${baseId}-heading`;

  // Guards a fetch that resolves after unmount (or after StrictMode's second mount has taken
  // over) from writing state into a dead component.
  const aliveRef = useRef(true);
  const listRef = useRef<HTMLUListElement>(null);
  /** A poll result withheld because the keyboard was inside the list when it landed. */
  const pendingRef = useRef<RoomSummary[] | null>(null);

  const commit = useCallback((rooms: RoomSummary[]) => {
    pendingRef.current = null;
    setHeld(false);
    setLoad({ kind: 'ready', rooms });
  }, []);

  /**
   * `force` marks a refresh the player asked for. Anything else is a background poll, and a
   * background poll landing while the keyboard is inside the list is held rather than applied:
   * committing it would reorder or delete the very row holding focus, and an unmounted button
   * drops focus to <body> with nothing said about it. The fetch still runs, so a held result is
   * current the instant focus leaves.
   *
   * Why `force` is a parameter rather than a document.activeElement check: Safari doesn't focus
   * a <button> on tap, so a tapped Refresh would be indistinguishable from a background poll.
   */
  const refresh = useCallback((force: boolean) => {
    fetchRoomList()
      .then((rooms) => {
        if (!aliveRef.current) return;
        if (!force && listRef.current?.contains(document.activeElement)) {
          pendingRef.current = rooms;
          setHeld(true);
          return;
        }
        commit(rooms);
        if (force) setNotice(`Updated. ${summarize(rooms)}.`);
      })
      .catch(() => {
        if (!aliveRef.current) return;
        setLoad((prev) => ({ kind: 'error', rooms: prev.kind === 'loading' ? [] : prev.rooms }));
      });
  }, [commit]);

  useEffect(() => {
    aliveRef.current = true;
    refresh(true);
    return () => {
      aliveRef.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!auto) return undefined;
    const timer = window.setInterval(() => refresh(false), POLL_MS);
    return () => window.clearInterval(timer);
  }, [auto, refresh]);

  /**
   * focusout fires before the next element takes focus, so the check waits a tick - tabbing
   * from one row to the next must not read as "the keyboard left the list".
   */
  const handleListBlur = () => {
    window.setTimeout(() => {
      if (!aliveRef.current || !pendingRef.current) return;
      if (listRef.current?.contains(document.activeElement)) return;
      commit(pendingRef.current);
    }, 0);
  };

  const handleRefreshClick = () => {
    // Cleared first so the result is guaranteed to be a real text change. Rewriting a region
    // with the string already in it is no DOM mutation and no announcement - which is exactly
    // how Refresh on an unchanged list comes across as a dead button.
    setNotice('');
    refresh(true);
  };

  const rooms = load.kind === 'loading' ? [] : load.rooms;
  // Waiting rooms first - the ones a player can act on - then by code, so a row only moves when
  // its own status changes and the list doesn't reshuffle under a tap between polls.
  const sorted = [...rooms].sort((a, b) => {
    if (a.phase !== b.phase) return a.phase === 'waiting' ? -1 : 1;
    return a.code.localeCompare(b.code);
  });

  let status: string;
  if (load.kind === 'loading') status = 'Loading rooms…';
  else if (load.kind === 'error') status = 'Could not reach the server.';
  else if (sorted.length === 0) status = 'No rooms right now. Host one!';
  else status = summarize(sorted);

  return (
    /* No aria-labelledby on the section: naming it would publish a region landmark repeating
       the heading directly below it. The list itself carries the name instead. */
    <section className="cp-panel lobby__section">
      <div className="server-list__head">
        <h2 className="lobby__heading server-list__heading" id={headingId} ref={headingRef} tabIndex={-1}>Rooms</h2>
        {/* The list updates on a timer nobody started, so it needs a stop - the same call
            RulesScreen makes for its looping card demos. */}
        <button
          type="button"
          className="cp-button cp-button--ghost"
          aria-pressed={auto}
          onClick={() => setAuto((on) => !on)}
        >
          {auto ? 'Pause updates' : 'Auto-update'}
        </button>
        <button type="button" className="cp-button cp-button--ghost server-list__refresh" onClick={handleRefreshClick}>
          Refresh
        </button>
      </div>

      <p className="lobby__hint">{status}</p>
      {held && <p className="lobby__hint">New results waiting - press Refresh.</p>}
      {/* Polite, never assertive: a poll failure repeats for as long as a server is down, and
          an assertive region would cut the reader off on every retry. */}
      <p className="visually-hidden" role="status">{notice}</p>

      {sorted.length > 0 && (
        <ul className="server-list" ref={listRef} aria-labelledby={headingId} onBlur={handleListBlur}>
          {sorted.map((room) => {
            const blocked = blockedReason(room);
            const tagId = `${baseId}-tag-${room.code}`;
            return (
              <li key={room.code} className="server-list__row">
                <div className="server-list__info">
                  {/* Two copies of every row: the glyph layer for the eye, a spoken layer for
                      speech, which mangles both halves of the visible text - see spokenCode for
                      the digits, and "2/4" comes out as anything from "2 slash 4" to a date. A
                      plain aria-label on these spans is not the fix: a span's implicit role is
                      `generic`, which ARIA 1.2 prohibits naming, so it would be dropped. */}
                  <span className="server-list__code" aria-hidden="true">{room.code}</span>
                  <span className="visually-hidden visually-hidden--nocopy">Room {spokenCode(room.code)}</span>
                  <span className="server-list__meta" aria-hidden="true">
                    {room.host ? `${room.host} · ` : ''}{modeLabel(room.mode)} · {room.seats}/{room.maxSeats}
                  </span>
                  <span className="visually-hidden visually-hidden--nocopy">
                    {room.host ? `Hosted by ${room.host}. ` : ''}{modeLabel(room.mode)}. {room.seats} of {room.maxSeats} players.
                  </span>
                </div>
                {blocked && <span className="server-list__tag" id={tagId}>{blocked}</span>}
                <button
                  type="button"
                  className="cp-button server-list__join"
                  /* aria-disabled, not the native attribute, and never swapped out for the tag
                     beside it: a row's joinability flips on its own as players join and games
                     start. Native disabled would drop the button out of the tab sequence under
                     a keyboard user who was just on it; unmounting it would drop their focus to
                     <body> outright. Same call WaitingRoom's Start button makes. */
                  aria-disabled={blocked ? true : undefined}
                  aria-describedby={blocked ? tagId : undefined}
                  /* Just the code: short, unique per row, and - unlike a seat count - stable
                     across polls. A name that changes under an already-focused control isn't
                     reliably re-announced, so live numbers stay out of it. */
                  aria-label={`Join room ${spokenCode(room.code)}`}
                  onClick={() => {
                    if (blocked) return;
                    onJoin(room.code);
                  }}
                >
                  Join
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
