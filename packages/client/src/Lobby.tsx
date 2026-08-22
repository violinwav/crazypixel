import { useState } from 'react';
import { PlayerSetupPicker, defaultColors } from './PlayerSetupPicker';
import type { PlayerSetup } from './PlayerSetupPicker';
import { OnlineLobby } from './OnlineLobby';
import type { OnlineSession } from './OnlineLobby';

export type { PlayerSetup as GameSetup } from './PlayerSetupPicker';

interface Props {
  onStart: (setup: PlayerSetup) => void;
  onOnlineReady: (session: OnlineSession) => void;
}

export function Lobby({ onStart, onOnlineReady }: Props) {
  const [mode, setMode] = useState<'local' | 'online'>('local');
  const [setup, setSetup] = useState<PlayerSetup>({
    config: { playerCount: 4, mode: 'ffa' },
    colors: defaultColors(4),
  });

  return (
    <main className="lobby">
      <h1 className="cp-title lobby__title">CRAZYPIXEL</h1>
      <p className="lobby__subtitle">
        {mode === 'local'
          ? 'Singleplayer demo - one screen, hotseat local play.'
          : 'Host a room or join one with a code to play online.'}
      </p>

      <div role="group" aria-label="Play mode" className="lobby__choices lobby__mode-toggle">
        <button type="button" className="cp-button" aria-pressed={mode === 'local'} onClick={() => setMode('local')}>
          Local
        </button>
        <button type="button" className="cp-button" aria-pressed={mode === 'online'} onClick={() => setMode('online')}>
          Online
        </button>
      </div>

      {mode === 'local' ? (
        <>
          <PlayerSetupPicker value={setup} onChange={setSetup} />
          <button type="button" className="cp-button lobby__start" onClick={() => onStart(setup)}>
            Start Game
          </button>
        </>
      ) : (
        <OnlineLobby onReady={onOnlineReady} />
      )}
    </main>
  );
}
