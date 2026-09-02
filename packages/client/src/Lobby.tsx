// The whole pregame flow: a persistent identity strip above whichever screen is active.
//
// Join-by-code and Host live on the same top-level menu screen, with no separate "choose online
// mode" detour, and Host only ever asks for a mode - the room adapts to however many people
// actually join. Singleplayer is the one place that still picks a fixed player count up front.

import { useEffect, useId, useRef, useState } from 'react';
import type { Room } from 'colyseus.js';
import type { GameMode } from '@crazypixel/shared';
import { PlayerSetupPicker, defaultColors } from './PlayerSetupPicker';
import type { PlayerSetup } from './PlayerSetupPicker';
import { PlayerIdentity } from './PlayerIdentity';
import { WaitingRoom } from './WaitingRoom';
import { RulesScreen } from './RulesScreen';
import { createRoom, joinRoom } from './game/network';
import type { RoomState, OnlineSession } from './game/network';
import type { PlayerIdentity as Identity } from './game/playerIdentity';

export type { PlayerSetup as GameSetup } from './PlayerSetupPicker';

const JOIN_CODE_LENGTH = 4;

interface Props {
  identity: Identity;
  onIdentityChange: (identity: Identity) => void;
  onStart: (setup: PlayerSetup) => void;
  onOnlineReady: (session: OnlineSession) => void;
}

type Screen =
  | { kind: 'menu' }
  | { kind: 'hostSettings' }
  | { kind: 'singleplayer' }
  | { kind: 'rules' }
  | { kind: 'connecting' }
  | { kind: 'waiting'; room: Room<RoomState>; isHost: boolean };

export function Lobby({ identity, onIdentityChange, onStart, onOnlineReady }: Props) {
  const [screen, setScreen] = useState<Screen>({ kind: 'menu' });
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [hostMode, setHostMode] = useState<GameMode>('ffa');
  const [hostError, setHostError] = useState<string | null>(null);
  const [setup, setSetup] = useState<PlayerSetup>({
    config: { playerCount: 4, mode: 'ffa' },
    colors: defaultColors(4),
  });

  const joinCodeId = useId();
  const joinErrorId = useId();

  // Moves focus to the new screen's own heading on every real transition (Back, Join, Host, a
  // completed connect) - never on first mount, so loading the app doesn't yank focus away from
  // the top of the page. 'connecting' and 'waiting' manage focus locally instead, being
  // single-purpose and short-lived.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const prevScreenKindRef = useRef(screen.kind);
  useEffect(() => {
    if (prevScreenKindRef.current === screen.kind) return;
    prevScreenKindRef.current = screen.kind;
    headingRef.current?.focus();
  }, [screen.kind]);

  const connectingRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (screen.kind === 'connecting') connectingRef.current?.focus();
  }, [screen.kind]);

  const name = identity.name.trim();
  const canJoin = name.length > 0 && joinCode.length === JOIN_CODE_LENGTH;
  const canHost = name.length > 0;

  const handleJoin = () => {
    if (!canJoin) return;
    setJoinError(null);
    setScreen({ kind: 'connecting' });
    joinRoom(joinCode, name, identity.hue)
      .then((room) => setScreen({ kind: 'waiting', room, isHost: false }))
      .catch(() => {
        setScreen({ kind: 'menu' });
        setJoinError('Room not found or full.');
      });
  };

  const handleCreateRoom = () => {
    setHostError(null);
    setScreen({ kind: 'connecting' });
    createRoom({ mode: hostMode, hue: identity.hue, displayName: name })
      .then((room) => setScreen({ kind: 'waiting', room, isHost: true }))
      .catch(() => {
        setScreen({ kind: 'hostSettings' });
        setHostError('Could not create room. Check your connection and try again.');
      });
  };

  let body;
  if (screen.kind === 'menu') {
    body = (
      <>
        <h2 className="lobby__heading visually-hidden" ref={headingRef} tabIndex={-1}>Play</h2>
        <section className="cp-panel lobby__section">
          <h3 className="lobby__heading">Multiplayer</h3>
          {/* A <form> around the code field and its submit only - Host and Singleplayer aren't
              part of "join a game" semantically and shouldn't share a group with it. */}
          <form
            className="lobby__join-row"
            onSubmit={(e) => {
              e.preventDefault();
              handleJoin();
            }}
          >
            <div className="lobby__join-field">
              <label htmlFor={joinCodeId} className="lobby__label">Room code</label>
              <input
                id={joinCodeId}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={JOIN_CODE_LENGTH}
                className="lobby__code-input"
                value={joinCode}
                aria-describedby={joinError ? joinErrorId : undefined}
                aria-invalid={joinError ? true : undefined}
                onChange={(e) => {
                  setJoinCode(e.target.value.replace(/\D/g, '').slice(0, JOIN_CODE_LENGTH));
                  setJoinError(null);
                }}
              />
            </div>
            <button type="submit" className="cp-button" disabled={!canJoin}>Join</button>
          </form>
          {joinError && <p id={joinErrorId} role="alert" className="lobby__error">{joinError}</p>}
          <button
            type="button"
            className="cp-button lobby__host-btn"
            disabled={!canHost}
            onClick={() => setScreen({ kind: 'hostSettings' })}
          >
            Host a Game
          </button>
          {!canHost && <p className="lobby__hint">Enter your name above to join or host.</p>}
        </section>
        <button
          type="button"
          className="cp-button lobby__singleplayer-btn"
          onClick={() => setScreen({ kind: 'singleplayer' })}
        >
          Singleplayer
        </button>
        <button
          type="button"
          className="cp-button cp-button--ghost lobby__rules-btn"
          onClick={() => setScreen({ kind: 'rules' })}
        >
          How to Play
        </button>
      </>
    );
  } else if (screen.kind === 'hostSettings') {
    body = (
      <section className="cp-panel lobby__section">
        <button type="button" className="cp-button cp-button--ghost lobby__back" onClick={() => setScreen({ kind: 'menu' })}>
          ‹ Back
        </button>
        <h3 className="lobby__heading" ref={headingRef} tabIndex={-1}>Host a Game</h3>
        <div role="group" aria-label="Game mode" className="lobby__choices">
          <button type="button" className="cp-button lobby__choice" aria-pressed={hostMode === 'ffa'} onClick={() => setHostMode('ffa')}>
            Free for all
          </button>
          <button type="button" className="cp-button lobby__choice" aria-pressed={hostMode === 'teams'} onClick={() => setHostMode('teams')}>
            Partners
          </button>
        </div>
        <p className="lobby__hint">
          {hostMode === 'teams'
            ? 'Needs an even number of players (4 or 6) once everyone has joined.'
            : 'Every player for themselves. Any number of players can join.'}
        </p>
        {hostError && <p role="alert" className="lobby__error">{hostError}</p>}
        <button type="button" className="cp-button lobby__start" onClick={handleCreateRoom}>Create Room</button>
      </section>
    );
  } else if (screen.kind === 'singleplayer') {
    body = (
      <>
        <button type="button" className="cp-button cp-button--ghost lobby__back" onClick={() => setScreen({ kind: 'menu' })}>
          ‹ Back
        </button>
        <h3 className="lobby__heading visually-hidden" ref={headingRef} tabIndex={-1}>Singleplayer setup</h3>
        <PlayerSetupPicker value={setup} onChange={setSetup} />
        <button type="button" className="cp-button lobby__start" onClick={() => onStart(setup)}>
          Start Game
        </button>
      </>
    );
  } else if (screen.kind === 'rules') {
    body = (
      <>
        <button type="button" className="cp-button cp-button--ghost lobby__back" onClick={() => setScreen({ kind: 'menu' })}>
          ‹ Back
        </button>
        <RulesScreen hue={identity.hue} headingRef={headingRef} />
      </>
    );
  } else if (screen.kind === 'connecting') {
    body = (
      <p className="lobby__hint" role="status" ref={connectingRef} tabIndex={-1}>Connecting…</p>
    );
  } else {
    body = <WaitingRoom room={screen.room} isHost={screen.isHost} identity={identity} onReady={onOnlineReady} />;
  }

  return (
    /* The rules screen needs more room than the pregame flow's phone-width column - the card
       demos read as a strip of squares and get unusably small at 480px on a desktop. */
    <main className={`lobby${screen.kind === 'rules' ? ' lobby--rules' : ''}`}>
      <h1 className="cp-title lobby__title">CRAZYPIXEL</h1>
      <PlayerIdentity identity={identity} onChange={onIdentityChange} />
      {/* Keyed on screen.kind so React remounts this div - and only this div, never the identity
          strip above - on every real transition, replaying its CSS entrance animation. */}
      <div key={screen.kind} className="lobby__screen">{body}</div>
    </main>
  );
}
