/**
 * A seat's display name, falling back to "Player N". Local hotseat has no display-name
 * concept at all (everyone shares one screen) and online play may not have heard a name for
 * a seat yet, so the fallback is the common case, not an error path.
 */
export function playerLabel(playerNames: string[] | undefined, seat: number): string {
  return playerNames?.[seat]?.trim() || `Player ${seat + 1}`;
}
