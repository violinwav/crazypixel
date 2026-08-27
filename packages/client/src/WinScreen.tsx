import type { GameState } from '@crazypixel/shared';
import { hueToCss } from './game/color';
import { playerLabel } from './game/playerName';

interface Props {
  state: GameState;
  colors: number[];
  playerNames?: string[];
  onPlayAgain?: () => void;
  /** Defaults to 'Play Again' (local hotseat, where it really is just another game on this
   * device). Online passes 'Rematch' - same seats, same room, same people, which is what
   * that word means to the players and what the hint below calls it too. */
  playAgainLabel?: string;
  /** Shown in the button's place when onPlayAgain is absent - online, only the host can
   * start a rematch (see GameRoom.handleRematch), and everyone else needs to be told that's
   * what they're waiting on rather than being left with a win screen that looks like a dead
   * end. Undefined for local hotseat, which always has its own Play Again. */
  playAgainHint?: string;
}

// Reload rather than a React-level "back to lobby" - GameView's Phaser instance is
// deliberately never torn down mid-session (see its own comment on why: StrictMode's
// dev-only double-invoke tearing down a Phaser.Game mid-boot leaves an orphaned canvas).
// Changing config means a genuinely new game, so a real page load is the safe way back
// rather than reintroducing that teardown risk for a rarely-used exit path.
function backToLobby() {
  window.location.reload();
}

export function WinScreen({ state, colors, playerNames, onPlayAgain, playAgainLabel = 'Play Again', playAgainHint }: Props) {
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
              <span className="win-screen__swatch" style={{ backgroundColor: hueToCss(colors[player]) }} aria-hidden="true" />
              {playerLabel(playerNames, player)}
            </span>
          ))}
        </div>
        <div className="win-screen__actions">
          {onPlayAgain ? (
            <button type="button" className="cp-button" onClick={onPlayAgain}>
              {playAgainLabel}
            </button>
          ) : playAgainHint ? (
            /* aria-live: the host can start the rematch at any moment, and when they do this
               whole dialog unmounts with no other cue. Announcing the wait when the dialog
               opens is what makes that disappearance read as "the host started it" rather
               than the screen just vanishing. */
            <p className="win-screen__hint" aria-live="polite">{playAgainHint}</p>
          ) : null}
          <button type="button" className="cp-button" onClick={backToLobby}>
            Change Settings
          </button>
        </div>
      </div>
    </div>
  );
}
