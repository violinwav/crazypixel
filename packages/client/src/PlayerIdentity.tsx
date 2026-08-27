import { useId } from 'react';
import { MarbleColorPicker } from './MarbleColorPicker';
import type { PlayerIdentity as Identity } from './game/playerIdentity';

interface Props {
  identity: Identity;
  onChange: (identity: Identity) => void;
}

/** Persistent top-of-flow strip - your name and your color, a click-to-expand marble
 * (MarbleColorPicker.tsx) standing in for both the swatch and the label a separate "Your
 * color" row used to need. Shown once, above whichever pregame screen is active (Lobby.tsx
 * renders this outside its own screen-switch), so it never remounts (and never re-steals
 * focus - see Lobby.tsx's per-screen heading focus instead) as you move between
 * menu/host/singleplayer/waiting. */
export function PlayerIdentity({ identity, onChange }: Props) {
  const nameId = useId();

  return (
    <section className="cp-panel identity-strip" aria-label="Your player">
      <div className="identity-strip__row">
        <MarbleColorPicker
          label="Your color"
          hue={identity.hue}
          onChange={(hue) => onChange({ ...identity, hue })}
          size="40px"
        />
        <div className="identity-strip__name">
          <label htmlFor={nameId} className="identity-strip__label">Name</label>
          <input
            id={nameId}
            type="text"
            className="identity-strip__input"
            placeholder="Your name"
            value={identity.name}
            maxLength={20}
            onChange={(e) => onChange({ ...identity, name: e.target.value })}
          />
        </div>
      </div>
    </section>
  );
}
