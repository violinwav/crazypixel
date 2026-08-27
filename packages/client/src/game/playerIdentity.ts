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

/** Persists the player's own display name + color hue across visits - the identity strip
 * at the top of the pregame flow (PlayerIdentity.tsx) reads/writes this, and it's what
 * online hosting/joining sends as displayName/hostHue. Local hotseat leaves it alone -
 * hotseat has no single "you" (see playerName.ts's fallback-to-"Player N" comment), the
 * strip there is just a carry-over convenience for whenever you later go online. */
export function usePlayerIdentity() {
  const [identity, setIdentity] = useState<PlayerIdentity>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
    } catch {
      // Nothing to persist to - the in-memory value still works for the rest of this session.
    }
  }, [identity]);

  return [identity, setIdentity] as const;
}
