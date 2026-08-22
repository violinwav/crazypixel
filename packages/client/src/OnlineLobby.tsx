import { useEffect, useRef, useState } from 'react';
import type { Room } from 'colyseus.js';
import type { PlayerId } from '@crazypixel/shared';
import { createRoom, joinRoom } from './game/network';
import type { RoomState } from './game/network';
import { PlayerSetupPicker, defaultColors } from './PlayerSetupPicker';
import type { PlayerSetup } from './PlayerSetupPicker';

export interface OnlineSession {
  room: Room<RoomState>;
  mySeat: PlayerId;
  colors: number[];
}

interface Props {
  onReady: (session: OnlineSession) => void;
}

type Step =
  | { kind: 'choose' }
  | { kind: 'hostConfig'; setup: PlayerSetup; error: string | null }
  | { kind: 'joinCode'; code: string; error: string | null }
  | { kind: 'connecting' }
  | { kind: 'waiting'; room: Room<RoomState>; isHost: boolean };

export function OnlineLobby({ onReady }: Props) {
  const [step, setStep] = useState<Step>({ kind: 'choose' });

  if (step.kind === 'choose') {
    return (
      <section className="cp-panel lobby__section">
        <h2 className="lobby__heading">Online</h2>
        <div className="lobby__choices">
          <button
            type="button"
            className="cp-button"
            onClick={() => setStep({
              kind: 'hostConfig',
              setup: { config: { playerCount: 4, mode: 'ffa' }, colors: defaultColors(4) },
              error: null,
            })}
          >
            Host a Game
          </button>
          <button type="button" className="cp-button" onClick={() => setStep({ kind: 'joinCode', code: '', error: null })}>
            Join a Game
          </button>
        </div>
      </section>
    );
  }

  if (step.kind === 'hostConfig') {
    const { setup } = step;
    return (
      <>
        <PlayerSetupPicker value={setup} onChange={(next) => setStep({ kind: 'hostConfig', setup: next, error: null })} />
        {step.error && (
          <p className="lobby__error" role="alert">{step.error}</p>
        )}
        <button
          type="button"
          className="cp-button lobby__start"
          onClick={() => {
            setStep({ kind: 'connecting' });
            createRoom(setup)
              .then((room) => setStep({ kind: 'waiting', room, isHost: true }))
              .catch(() => setStep({ kind: 'hostConfig', setup, error: 'Could not create room. Check your connection and try again.' }));
          }}
        >
          Create Room
        </button>
      </>
    );
  }

  if (step.kind === 'joinCode') {
    return (
      <section className="cp-panel lobby__section">
        <h2 className="lobby__heading">Join a Game</h2>
        <label className="lobby__hint" htmlFor="online-lobby-code-input">Room code</label>
        <input
          id="online-lobby-code-input"
          type="text"
          className="lobby__code-input"
          value={step.code}
          aria-describedby={step.error ? 'online-lobby-code-error' : undefined}
          aria-invalid={step.error ? true : undefined}
          onChange={(e) => setStep({ kind: 'joinCode', code: e.target.value, error: null })}
        />
        {step.error && (
          <p id="online-lobby-code-error" className="lobby__error" role="alert">{step.error}</p>
        )}
        <button
          type="button"
          className="cp-button"
          disabled={step.code.trim().length === 0}
          onClick={() => {
            const { code } = step;
            setStep({ kind: 'connecting' });
            joinRoom(code)
              .then((room) => setStep({ kind: 'waiting', room, isHost: false }))
              .catch(() => setStep({ kind: 'joinCode', code, error: 'Room not found or full.' }));
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

  useEffect(() => {
    if (readyFiredRef.current) return;
    if (room.state.phase !== 'playing') return;
    const seatIndex = Array.from(room.state.seatSessionIds).indexOf(room.sessionId);
    if (seatIndex === -1) return;
    readyFiredRef.current = true;
    onReady({ room, mySeat: seatIndex as PlayerId, colors: Array.from(room.state.colors) });
  });

  const filledSeats = room.state.seatSessionIds.length;
  const totalSeats = room.state.playerCount;
  // One persistent live region for everything that changes here (room creation, seats
  // filling) - same convention as GameBoard's lastMoveAnnouncement paragraph, rather than
  // marking individually mounting/unmounting elements as live (unreliable across screen
  // readers when the region itself appears at the same time as its content).
  const announcement = isHost
    ? `Room created. Code ${room.id}. ${filledSeats} of ${totalSeats} players connected.`
    : `${filledSeats} of ${totalSeats} players connected.`;

  return (
    <section className="cp-panel lobby__section">
      <h2 className="lobby__heading">Waiting for players</h2>
      {isHost && (
        <>
          <p className="lobby__hint">Share this code:</p>
          <p className="lobby__code">{room.id}</p>
        </>
      )}
      <div className="lobby__seats">
        {Array.from({ length: totalSeats }, (_, i) => (
          <div key={i} className="lobby__seat">
            <span className={`lobby__seat-label${i < filledSeats ? '' : ' lobby__seat-label--empty'}`}>
              Player {i + 1} {i < filledSeats ? '- connected' : '- waiting...'}
            </span>
          </div>
        ))}
      </div>
      <p className="lobby__hint">{filledSeats} / {totalSeats} players connected.</p>
      <p aria-live="polite" className="visually-hidden">{announcement}</p>
    </section>
  );
}
