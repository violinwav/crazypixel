// The one control that silences the game, in both of the places it needs to exist: the pregame
// menu and the board itself.
//
// Setup alone is not enough - someone who discovers mid-match that the ticks are too much has to
// be able to stop them right then, without leaving the game. The board copy is therefore rendered
// unconditionally, not gated on isMyTurn or on emotes being available, or it would vanish
// precisely when someone wants it (on other players' turns, and in local hotseat entirely).

import { useEffect, useState } from 'react';
import { isSoundEnabled, setSoundEnabled, subscribeSound, play } from './game/audio';

interface Props {
  /**
   * 'board' pins it beside the board's other chrome; 'strip' sits inline in the lobby's identity
   * row. Only positioning differs - the control itself is the same in both.
   */
  variant: 'board' | 'strip';
}

export function SoundToggle({ variant }: Props) {
  const [on, setOn] = useState(isSoundEnabled);
  useEffect(() => subscribeSound(setOn), []);

  const toggle = () => {
    const next = !on;
    // Synchronously inside the click handler, never from an effect keyed on the new state:
    // Safari only resumes a context from within the gesture itself, and a passive effect has
    // already left it. This click is also the gesture that unlocks audio in the first place.
    setSoundEnabled(next);
    // Feedback on the control itself, so switching sound on proves it worked.
    if (next) play('uiClick');
  };

  return (
    <button
      type="button"
      className={`cp-button sound-toggle sound-toggle--${variant}`}
      // Static, like EmotePicker's toggle and for the same reason: a label that flipped to
      // "Sound off" would double up with aria-pressed and announce as "Sound off, not pressed".
      // aria-pressed carries the state on its own.
      aria-label="Sound"
      aria-pressed={on}
      onClick={toggle}
    >
      {/* aria-hidden so a screen reader reads the button's label rather than walking the glyph
          character by character - see the same note on EmotePicker's kaomoji. */}
      <span className="sound-toggle__glyph" aria-hidden="true">{on ? '((•))' : '( x )'}</span>
    </button>
  );
}
