import { partnerOf } from '@crazypixel/shared';
import type { GameConfig, GameMode, PlayerId } from '@crazypixel/shared';
import { ColorSlider } from './ColorSlider';

export interface PlayerSetup {
  config: GameConfig;
  colors: number[];
}

interface Props {
  value: PlayerSetup;
  onChange: (setup: PlayerSetup) => void;
  /** Which seat(s) this picker's Colors section lets you change. 'all' (default) is the
   * local-hotseat case - one person sets every seat's color before play starts. A seat
   * index is the online-host case - only the host's own seat exists pre-creation, everyone
   * else picks their own color after joining (see OnlineLobby's WaitingRoom), so there's
   * nothing for the host to set on their behalf here. */
  colorSeats?: 'all' | number;
}

const PLAYER_COUNTS: GameConfig['playerCount'][] = [2, 4, 6];

// Hues (0-359) spread evenly around the wheel, one seed per seat - a reasonable starting
// point that keeps every seat visibly distinct before anyone touches a slider. Colors are
// continuous now (see ColorSlider.tsx), so unlike the old fixed-6-palette version there's no
// scarcity to defend - two seats landing on the same or a nearby hue after manual picks is
// just the players' own choice, not a bug.
export function defaultColors(count: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.round((360 / count) * i));
}

export function PlayerSetupPicker({ value, onChange, colorSeats = 'all' }: Props) {
  const { config, colors } = value;
  const { playerCount, mode } = config;

  const handlePlayerCount = (count: GameConfig['playerCount']) => {
    // Partner offset is playerCount/2 - with only 2 seats that's each player's *only*
    // opponent, a degenerate "partner", so teams isn't a real option at 2.
    onChange({ config: { playerCount: count, mode: count === 2 ? 'ffa' : mode }, colors: defaultColors(count) });
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
        <h2 className="lobby__heading">Players</h2>
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
            disabled={playerCount === 2}
            onClick={() => handleMode('teams')}
          >
            Partners
          </button>
        </div>
        <p className="lobby__hint">
          {playerCount === 2
            ? 'Teams need 4 or 6 players.'
            : mode === 'teams'
              ? 'Seats across the table team up - every marble home for both partners wins it.'
              : 'Every player for themselves.'}
        </p>
      </section>

      <section className="cp-panel lobby__section">
        <h2 className="lobby__heading">{colorSeats === 'all' ? 'Colors' : 'Your Color'}</h2>
        <div className="lobby__seats">
          {(colorSeats === 'all' ? seats : [colorSeats]).map((seat) => {
            const partner = colorSeats === 'all' && mode === 'teams' ? partnerOf(config, seat as PlayerId) : null;
            return (
              <div key={seat} className="lobby__seat">
                {colorSeats === 'all' && (
                  <span className="lobby__seat-label">
                    Player {seat + 1}
                    {partner !== null && <span className="lobby__seat-partner"> · partners P{partner + 1}</span>}
                  </span>
                )}
                <ColorSlider
                  label={colorSeats === 'all' ? `Player ${seat + 1} color` : 'Color'}
                  value={colors[seat]}
                  onChange={(hue) => handleColorPick(seat, hue)}
                />
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
