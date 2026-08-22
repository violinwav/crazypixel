import type { GameState } from '@crazypixel/shared';
import { PALETTE } from './game/theme';

interface Props {
  state: GameState;
  colors: number[];
  onPlayAgain?: () => void;
}

function colorHex(colorIndex: number): string {
  return `#${PALETTE.players[colorIndex].toString(16).padStart(6, '0')}`;
}

// Reload rather than a React-level "back to lobby" - GameView's Phaser instance is
// deliberately never torn down mid-session (see its own comment on why: StrictMode's
// dev-only double-invoke tearing down a Phaser.Game mid-boot leaves an orphaned canvas).
// Changing config means a genuinely new game, so a real page load is the safe way back
// rather than reintroducing that teardown risk for a rarely-used exit path.
function backToLobby() {
  window.location.reload();
}

export function WinScreen({ state, colors, onPlayAgain }: Props) {
  if (state.phase !== 'gameEnd' || !state.winners) return null;
  const isTeamWin = state.winners.length > 1;

  return (
    <div className="win-screen" role="alertdialog" aria-labelledby="win-screen-heading">
      <div className="cp-panel win-screen__card">
        <p className="cp-title win-screen__heading" id="win-screen-heading">
          {isTeamWin ? 'TEAM WINS' : 'WINNER'}
        </p>
        <div className="win-screen__players">
          {state.winners.map((player) => (
            <span key={player} className="win-screen__player">
              <span className="win-screen__swatch" style={{ backgroundColor: colorHex(colors[player]) }} aria-hidden="true" />
              Player {player + 1}
            </span>
          ))}
        </div>
        <div className="win-screen__actions">
          {onPlayAgain && (
            <button type="button" className="cp-button" onClick={onPlayAgain}>
              Play Again
            </button>
          )}
          <button type="button" className="cp-button" onClick={backToLobby}>
            Change Settings
          </button>
        </div>
      </div>
    </div>
  );
}
