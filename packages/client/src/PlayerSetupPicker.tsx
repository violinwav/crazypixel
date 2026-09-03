// Singleplayer setup: player count, mode, a color per seat, and - since every non-human seat is
// now a bot (see GameView.tsx / useSingleplayerAutopilot.ts) - a difficulty per bot and whether
// your own turn is time-limited. Online hosting skips all of this - a room adapts to however
// many people actually join, and every seat there is a real remote player.

import { partnerOf } from '@crazypixel/shared';
import type { GameConfig, GameMode, PlayerId } from '@crazypixel/shared';
import { MarbleColorPicker } from './MarbleColorPicker';
import { PixelSlider } from './PixelSlider';
import { BOT_DIFFICULTIES } from './game/botAI';
import type { BotDifficulty } from './game/botAI';
import { BOT_FACE_SPRITE } from './game/botFaceArt';

export interface PlayerSetup {
  config: GameConfig;
  colors: number[];
  /**
   * Index-aligned with seats. Seat 0 is always null (the human) - every other seat is always a
   * bot. There's no per-seat human/bot toggle: singleplayer no longer means "everyone takes
   * turns on this device", it means "you play one seat against bots", matching the shape of an
   * online table instead of the old hotseat-for-everyone one.
   */
  bots: (BotDifficulty | null)[];
  /**
   * Whether YOUR OWN turn auto-plays if you run out of time, same as online's server clock.
   * Bots are unaffected either way - they always commit ~3s after their turn starts regardless.
   * Defaults to on (matching online), but has to be switchable off: unlike online, a solo game
   * against bots has no other waiting human the clock is protecting, so nothing requires forcing
   * a hard time limit on the one real player at the table (WCAG 2.2.1, Timing Adjustable).
   */
  turnTimerEnabled: boolean;
}

interface Props {
  value: PlayerSetup;
  onChange: (setup: PlayerSetup) => void;
}

const PLAYER_COUNTS: GameConfig['playerCount'][] = [2, 3, 4, 6];

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Teams needs an even seat count so every player has exactly one partner across the table (see
 * partnerOf). 2 is its own degenerate case - your only opponent would also be your partner -
 * and 3 has no symmetric partner at all.
 */
function teamsAvailable(playerCount: GameConfig['playerCount']): boolean {
  return playerCount >= 4 && playerCount % 2 === 0;
}

/**
 * Hues spread evenly around the wheel, one seed per seat - a starting point that keeps every
 * seat visibly distinct before anyone touches a slider. Color is continuous now, so unlike a
 * fixed palette there is no scarcity to defend: two seats landing on nearby hues after manual
 * picks is the players' own choice, not a bug.
 */
export function defaultColors(count: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.round((360 / count) * i));
}

/** Seat 0 is always the human (null); every other seat starts at Medium. */
export function defaultBots(count: number): (BotDifficulty | null)[] {
  return Array.from({ length: count }, (_, i) => (i === 0 ? null : 'medium'));
}

export function PlayerSetupPicker({ value, onChange }: Props) {
  const {
    config, colors, bots, turnTimerEnabled,
  } = value;
  const { playerCount, mode } = config;

  const handlePlayerCount = (count: GameConfig['playerCount']) => {
    onChange({
      config: { playerCount: count, mode: teamsAvailable(count) ? mode : 'ffa' },
      colors: defaultColors(count),
      bots: defaultBots(count),
      turnTimerEnabled,
    });
  };

  const handleMode = (nextMode: GameMode) => {
    onChange({
      config: { ...config, mode: nextMode }, colors, bots, turnTimerEnabled,
    });
  };

  const handleColorPick = (seat: number, hue: number) => {
    const next = [...colors];
    next[seat] = hue;
    onChange({
      config, colors: next, bots, turnTimerEnabled,
    });
  };

  const handleBotDifficulty = (seat: number, difficulty: BotDifficulty) => {
    const next = [...bots];
    next[seat] = difficulty;
    onChange({
      config, colors, bots: next, turnTimerEnabled,
    });
  };

  const handleTurnTimerToggle = (enabled: boolean) => {
    onChange({
      config, colors, bots, turnTimerEnabled: enabled,
    });
  };

  const seats = Array.from({ length: playerCount }, (_, i) => i);

  return (
    <>
      <section className="cp-panel lobby__section">
        <h2 className="lobby__heading">Player Count</h2>
        <div role="group" aria-label="Player count" className="lobby__choices">
          {PLAYER_COUNTS.map((count) => (
            <button
              key={count}
              type="button"
              className="cp-button lobby__choice"
              aria-pressed={playerCount === count}
              onClick={() => handlePlayerCount(count)}
            >
              {count}
            </button>
          ))}
        </div>
      </section>

      <section className="cp-panel lobby__section">
        <h2 className="lobby__heading">Mode</h2>
        <div role="group" aria-label="Game mode" className="lobby__choices">
          <button
            type="button"
            className="cp-button lobby__choice"
            aria-pressed={mode === 'ffa'}
            onClick={() => handleMode('ffa')}
          >
            Free for all
          </button>
          <button
            type="button"
            className="cp-button lobby__choice"
            aria-pressed={mode === 'teams'}
            disabled={!teamsAvailable(playerCount)}
            onClick={() => handleMode('teams')}
          >
            Partners
          </button>
        </div>
        <p className="lobby__hint">
          {!teamsAvailable(playerCount)
            ? 'Teams need an even number of players, 4 or 6.'
            : mode === 'teams'
              ? 'Seats across the table team up - every marble home for both partners wins it.'
              : 'Every player for themselves.'}
        </p>
      </section>

      <section className="cp-panel lobby__section">
        <h2 className="lobby__heading">Turn Timer</h2>
        <div role="group" aria-label="Turn timer" className="lobby__choices">
          <button
            type="button"
            className="cp-button lobby__choice"
            aria-pressed={turnTimerEnabled}
            onClick={() => handleTurnTimerToggle(true)}
          >
            On
          </button>
          <button
            type="button"
            className="cp-button lobby__choice"
            aria-pressed={!turnTimerEnabled}
            onClick={() => handleTurnTimerToggle(false)}
          >
            Off
          </button>
        </div>
        <p className="lobby__hint">
          {turnTimerEnabled
            ? "Your turn auto-plays if you run out of time, same as online. Bots always play after about 3 seconds."
            : "Take as long as you like on your own turn. Bots still play after about 3 seconds."}
        </p>
      </section>

      <section className="cp-panel lobby__section">
        <h2 className="lobby__heading">Players</h2>
        <div className="lobby__seats">
          {seats.map((seat) => {
            const partner = mode === 'teams' ? partnerOf(config, seat as PlayerId) : null;
            const difficulty = bots[seat];
            return (
              <div key={seat} className="lobby__seat">
                <div className="lobby__seat-row">
                  <span className="lobby__seat-label">
                    Player {seat + 1}
                    {seat === 0 && ' (You)'}
                    {partner !== null && <span className="lobby__seat-partner"> · partners P{partner + 1}</span>}
                  </span>
                  <MarbleColorPicker
                    label={`Player ${seat + 1} color`}
                    hue={colors[seat]}
                    onChange={(hue) => handleColorPick(seat, hue)}
                    align="end"
                  />
                </div>
                {difficulty && (
                  <div className="lobby__seat-bot">
                    <PixelSlider
                      label={`Player ${seat + 1} bot difficulty`}
                      min={0}
                      max={2}
                      value={BOT_DIFFICULTIES.indexOf(difficulty)}
                      valueLabel={capitalize(difficulty)}
                      onChange={(i) => handleBotDifficulty(seat, BOT_DIFFICULTIES[i])}
                    />
                    <img
                      src={BOT_FACE_SPRITE[difficulty]}
                      alt={`Player ${seat + 1} bot difficulty: ${capitalize(difficulty)}`}
                      className="lobby__seat-bot-face"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
