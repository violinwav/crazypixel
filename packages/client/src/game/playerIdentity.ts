// The player's own profile - display name and color hue - persisted across visits.

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'crazypixel:identity';

export interface PlayerIdentity {
  name: string;
  hue: number;
}

function randomHue(): number {
  return Math.floor(Math.random() * 360);
}

function load(): PlayerIdentity {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PlayerIdentity>;
      if (typeof parsed.name === 'string' && typeof parsed.hue === 'number') {
        return { name: parsed.name, hue: parsed.hue };
      }
    }
  } catch {
    // Storage unavailable (private browsing, disabled cookies) - fall through to a fresh,
    // in-memory-only identity for this session.
  }
  return { name: '', hue: randomHue() };
}

/**
 * Reads and writes the persisted profile. The identity strip at the top of the pregame flow
 * (PlayerIdentity.tsx) owns it, and it is what online hosting/joining sends as
 * displayName/hostHue. Local hotseat ignores it - there is no single "you" there (see
 * playerName.ts) - and only carries it along for whenever the player later goes online.
 */
export function usePlayerIdentity() {
  const [identity, setIdentity] = useState<PlayerIdentity>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
    } catch {
      // Nothing to persist to - the in-memory value still works for this session.
    }
  }, [identity]);

  return [identity, setIdentity] as const;
}
