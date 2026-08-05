import { useState } from 'react';
import { partnerOf } from '@crazypixel/shared';
import type { GameConfig, GameMode, PlayerId } from '@crazypixel/shared';
import { PALETTE } from './game/theme';

export interface GameSetup {
  config: GameConfig;
  colors: number[];
}

interface Props {
  onStart: (setup: GameSetup) => void;
}

const PLAYER_COUNTS: GameConfig['playerCount'][] = [2, 4, 6];
const COLOR_HEX = PALETTE.players.map((c) => `#${c.toString(16).padStart(6, '0')}`);
const COLOR_NAMES = ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Orange'];

function defaultColors(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

export function Lobby({ onStart }: Props) {
  const [playerCount, setPlayerCount] = useState<GameConfig['playerCount']>(4);
  const [mode, setMode] = useState<GameMode>('ffa');
  const [colors, setColors] = useState<number[]>(() => defaultColors(4));

  const handlePlayerCount = (count: GameConfig['playerCount']) => {
    setPlayerCount(count);
    setColors(defaultColors(count));
    // Partner offset is playerCount/2 - with only 2 seats that's each player's *only*
    // opponent, a degenerate "partner", so teams isn't a real option at 2.
    if (count === 2) setMode('ffa');
  };

  const handleColorPick = (seat: number, colorIndex: number) => {
    setColors((prev) => {
      const next = [...prev];
      const conflictSeat = next.findIndex((c) => c === colorIndex);
      if (conflictSeat !== -1 && conflictSeat !== seat) {
        next[conflictSeat] = next[seat]; // swap, so two seats never share a color
      }
      next[seat] = colorIndex;
      return next;
    });
  };

  const seats = Array.from({ length: playerCount }, (_, i) => i);
  const config: GameConfig = { playerCount, mode };

  return (
    <main className="lobby">
      <h1 className="cp-title lobby__title">CRAZYPIXEL</h1>
      <p className="lobby__subtitle">Singleplayer demo - one screen, hotseat local play. Online sessions coming later.</p>

      <section className="cp-panel lobby__section">
        <h2 className="lobby__heading">Players</h2>
        <div role="group" aria-label="Player count" className="lobby__choices">
          {PLAYER_COUNTS.map((count) => (
            <button
              key={count}
              type="button"
              className="cp-button"
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
            className="cp-button"
            aria-pressed={mode === 'ffa'}
            onClick={() => setMode('ffa')}
          >
            Free for all
          </button>
          <button
            type="button"
            className="cp-button"
            aria-pressed={mode === 'teams'}
            disabled={playerCount === 2}
            onClick={() => setMode('teams')}
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
        <h2 className="lobby__heading">Colors</h2>
        <div className="lobby__seats">
          {seats.map((seat) => {
            const partner = mode === 'teams' ? partnerOf(config, seat as PlayerId) : null;
            return (
              <div key={seat} role="group" aria-label={`Player ${seat + 1} color`} className="lobby__seat">
                <span className="lobby__seat-label">
                  Player {seat + 1}
                  {partner !== null && <span className="lobby__seat-partner"> · partners P{partner + 1}</span>}
                </span>
                <div className="lobby__swatches">
                  {COLOR_HEX.map((hex, colorIndex) => (
                    <button
                      key={colorIndex}
                      type="button"
                      className="lobby__swatch"
                      style={{ backgroundColor: hex }}
                      aria-pressed={colors[seat] === colorIndex}
                      aria-label={COLOR_NAMES[colorIndex]}
                      onClick={() => handleColorPick(seat, colorIndex)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <button type="button" className="cp-button lobby__start" onClick={() => onStart({ config, colors })}>
        Start Game
      </button>
    </main>
  );
}
