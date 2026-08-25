import { useEffect, useRef, useState } from 'react';
import type { Room } from 'colyseus.js';
import type { PlayerId } from '@crazypixel/shared';
import { createRoom, joinRoom, setSeatColor, startGame } from './game/network';
import type { RoomState } from './game/network';
import { PlayerSetupPicker, defaultColors } from './PlayerSetupPicker';
import type { PlayerSetup } from './PlayerSetupPicker';
import { ColorSlider } from './ColorSlider';
import { hueToCss } from './game/color';

export interface OnlineSession {
  room: Room<RoomState>;
  mySeat: PlayerId;
  colors: number[];
  playerNames: string[];
}

interface Props {
  onReady: (session: OnlineSession) => void;
}

type Step =
  | { kind: 'name'; name: string }
  | { kind: 'choose'; name: string }
  | { kind: 'hostConfig'; name: string; setup: PlayerSetup; error: string | null }
  | { kind: 'joinCode'; name: string; code: string; error: string | null }
  | { kind: 'connecting' }
  | { kind: 'waiting'; room: Room<RoomState>; isHost: boolean };

export function OnlineLobby({ onReady }: Props) {
  const [step, setStep] = useState<Step>({ kind: 'name', name: '' });

  if (step.kind === 'name') {
    return (
      <section className="cp-panel lobby__section">
        <h2 className="lobby__heading">Display Name</h2>
        <label className="lobby__hint" htmlFor="online-lobby-name-input">What should other players call you?</label>
        <input
          id="online-lobby-name-input"
          type="text"
          className="lobby__code-input"
          value={step.name}
          maxLength={20}
          onChange={(e) => setStep({ kind: 'name', name: e.target.value })}
        />
        <button
          type="button"
          className="cp-button lobby__start"
          disabled={step.name.trim().length === 0}
          onClick={() => setStep({ kind: 'choose', name: step.name.trim() })}
        >
          Continue
        </button>
      </section>
    );
  }

  if (step.kind === 'choose') {
    const { name } = step;
    return (
      <section className="cp-panel lobby__section">
        <h2 className="lobby__heading">Online</h2>
        <div className="lobby__choices">
          <button
            type="button"
            className="cp-button"
            onClick={() => setStep({
              kind: 'hostConfig',
              name,
              setup: { config: { playerCount: 4, mode: 'ffa' }, colors: defaultColors(4) },
              error: null,
            })}
          >
            Host a Game
          </button>
          <button type="button" className="cp-button" onClick={() => setStep({ kind: 'joinCode', name, code: '', error: null })}>
            Join a Game
          </button>
        </div>
      </section>
    );
  }

  if (step.kind === 'hostConfig') {
    const { name, setup } = step;
    return (
      <>
        <PlayerSetupPicker
          value={setup}
          onChange={(next) => setStep({ kind: 'hostConfig', name, setup: next, error: null })}
          colorSeats={0}
        />
        {step.error && (
          <p className="lobby__error" role="alert">{step.error}</p>
        )}
        <button
          type="button"
          className="cp-button lobby__start"
          onClick={() => {
            setStep({ kind: 'connecting' });
            createRoom(setup, name)
              .then((room) => setStep({ kind: 'waiting', room, isHost: true }))
              .catch(() => setStep({ kind: 'hostConfig', name, setup, error: 'Could not create room. Check your connection and try again.' }));
          }}
        >
          Create Room
        </button>
      </>
    );
  }

  if (step.kind === 'joinCode') {
    const { name } = step;
    return (
      <section className="cp-panel lobby__section">
        <h2 className="lobby__heading">Join a Game</h2>
        <label className="lobby__hint" htmlFor="online-lobby-code-input">4-digit room code</label>
        <input
          id="online-lobby-code-input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          className="lobby__code-input"
          value={step.code}
          aria-describedby={step.error ? 'online-lobby-code-error' : undefined}
          aria-invalid={step.error ? true : undefined}
          onChange={(e) => setStep({ kind: 'joinCode', name, code: e.target.value.replace(/\D/g, '').slice(0, 4), error: null })}
        />
        {step.error && (
          <p id="online-lobby-code-error" className="lobby__error" role="alert">{step.error}</p>
        )}
        <button
          type="button"
          className="cp-button"
          disabled={step.code.length !== 4}
          onClick={() => {
            const { code } = step;
            setStep({ kind: 'connecting' });
            joinRoom(code, name)
              .then((room) => setStep({ kind: 'waiting', room, isHost: false }))
              .catch(() => setStep({ kind: 'joinCode', name, code, error: 'Room not found or full.' }));
          }}
        >
          Join
        </button>
      </section>
    );
  }

  if (step.kind === 'connecting') {
    return (
      <p className="lobby__hint" role="status">Connecting…</p>
    );
  }

  return <WaitingRoom room={step.room} isHost={step.isHost} onReady={onReady} />;
}

function WaitingRoom({ room, isHost, onReady }: { room: Room<RoomState>; isHost: boolean; onReady: Props['onReady'] }) {
  const [, forceRender] = useState(0);
  // Guards onReady (a real side effect - hands the finished session up to App, which
  // unmounts this whole lobby tree) against firing twice, same pattern as
  // BoardOverlay.tsx's autoPlayedKeyRef - see CLAUDE.md's StrictMode double-invoke note.
  const readyFiredRef = useRef(false);

  useEffect(() => {
    const handleChange = () => forceRender((n) => n + 1);
    room.onStateChange(handleChange);
    // No unsubscribe - this room lives for the whole online session once joined, same
    // lifecycle convention as GameView's Phaser instance.
  }, [room]);

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

  const filledSeats = room.state.seatSessionIds.length;
  const totalSeats = room.state.playerCount;
  const isFull = filledSeats === totalSeats;
  const modeLabel = room.state.mode === 'teams' ? 'Partners' : 'Free for all';
  // One persistent live region for everything that changes here (room creation, seats
  // filling) - same convention as GameBoard's lastMoveAnnouncement paragraph, rather than
  // marking individually mounting/unmounting elements as live (unreliable across screen
  // readers when the region itself appears at the same time as its content).
  const announcement = isHost
    ? `Room created. Code ${room.state.code}. ${filledSeats} of ${totalSeats} players connected.`
    : `${filledSeats} of ${totalSeats} players connected.`;

  return (
    <section className="cp-panel lobby__section">
      <h2 className="lobby__heading">Waiting for players</h2>
      {isHost && (
        <>
          <p className="lobby__hint">Share this code:</p>
          <p className="lobby__code">{room.state.code}</p>
        </>
      )}
      {/* Same room overview for host and joiners alike - player count/mode is fixed once
          the host creates the room (see GameRoom.ts), so it's shown here as plain info, not
          something a joiner can edit. */}
      <p className="lobby__hint">{totalSeats} players · {modeLabel}</p>
      <div className="lobby__seats">
        {Array.from({ length: totalSeats }, (_, i) => (
          <div key={i} className="lobby__seat lobby__seat--row">
            {i < filledSeats && (
              <span
                className="lobby__seat-swatch"
                style={{ backgroundColor: hueToCss(room.state.colors[i]) }}
                aria-hidden="true"
              />
            )}
            <span className={`lobby__seat-label${i < filledSeats ? '' : ' lobby__seat-label--empty'}`}>
              {i < filledSeats ? `${room.state.playerNames[i]} - connected` : `Player ${i + 1} - waiting...`}
            </span>
          </div>
        ))}
      </div>
      <p className="lobby__hint">{filledSeats} / {totalSeats} players connected.</p>
      {mySeatIndex !== -1 && (
        <ColorSlider
          label="Your color"
          value={room.state.colors[mySeatIndex] ?? 0}
          onChange={(hue) => setSeatColor(room, hue)}
        />
      )}
      {isHost ? (
        <button
          type="button"
          className="cp-button lobby__start"
          disabled={!isFull}
          onClick={() => startGame(room)}
        >
          Start Game
        </button>
      ) : (
        <p className="lobby__hint" role="status">
          {isFull ? 'Waiting for the host to start the game.' : 'Waiting for more players to join.'}
        </p>
      )}
      <p aria-live="polite" className="visually-hidden">{announcement}</p>
    </section>
  );
}
