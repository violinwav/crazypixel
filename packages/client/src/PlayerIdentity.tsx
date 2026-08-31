import { useId } from 'react';
import { MarbleColorPicker } from './MarbleColorPicker';
import type { PlayerIdentity as Identity } from './game/playerIdentity';

interface Props {
  identity: Identity;
  onChange: (identity: Identity) => void;
}

/**
 * The persistent top-of-flow strip: your name and your color, the latter as a click-to-expand
 * marble standing in for both the swatch and the "Your color" label a separate row used to
 * need. Lobby.tsx renders this outside its own screen switch, so it never remounts - and so
 * never steals focus - as you move between menu, host, singleplayer and waiting screens.
 */
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
