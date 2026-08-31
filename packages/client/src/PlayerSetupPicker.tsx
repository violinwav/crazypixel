// Singleplayer/hotseat setup: player count, mode, and a color per seat. Online hosting skips
// all of this - a room adapts to however many people actually join.

import { partnerOf } from '@crazypixel/shared';
import type { GameConfig, GameMode, PlayerId } from '@crazypixel/shared';
import { MarbleColorPicker } from './MarbleColorPicker';

export interface PlayerSetup {
  config: GameConfig;
  colors: number[];
}

interface Props {
  value: PlayerSetup;
  onChange: (setup: PlayerSetup) => void;
}

const PLAYER_COUNTS: GameConfig['playerCount'][] = [2, 3, 4, 6];

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

export function PlayerSetupPicker({ value, onChange }: Props) {
  const { config, colors } = value;
  const { playerCount, mode } = config;

  const handlePlayerCount = (count: GameConfig['playerCount']) => {
    onChange({ config: { playerCount: count, mode: teamsAvailable(count) ? mode : 'ffa' }, colors: defaultColors(count) });
  };

  const handleMode = (nextMode: GameMode) => {
    onChange({ config: { ...config, mode: nextMode }, colors });
  };

  const handleColorPick = (seat: number, hue: number) => {
    const next = [...colors];
    next[seat] = hue;
    onChange({ config, colors: next });
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
        <h2 className="lobby__heading">Players</h2>
        <div className="lobby__seats">
          {seats.map((seat) => {
            const partner = mode === 'teams' ? partnerOf(config, seat as PlayerId) : null;
            return (
              <div key={seat} className="lobby__seat">
                <span className="lobby__seat-label">
                  Player {seat + 1}
                  {partner !== null && <span className="lobby__seat-partner"> · partners P{partner + 1}</span>}
                </span>
                <MarbleColorPicker
                  label={`Player ${seat + 1} color`}
                  hue={colors[seat]}
                  onChange={(hue) => handleColorPick(seat, hue)}
                  align="end"
                />
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
