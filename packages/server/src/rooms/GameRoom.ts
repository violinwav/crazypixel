import { Room, Client } from 'colyseus';
import { createInitialState } from '@crazypixel/shared';
import type { GameState } from '@crazypixel/shared';

/**
 * Session scaffold only - not wired to real games yet.
 *
 * Colyseus expects room state to be a `@colyseus/schema` Schema subclass for its
 * binary-diff sync; `GameState` (from @crazypixel/shared) is currently a plain object, so
 * this room can't sync state to clients yet. Deliberately not schema-fying it in this pass:
 * that's a real design decision (mirror every field into Schema classes vs. serialize the
 * whole state as one JSON string field) that deserves its own pass once local play against
 * the shared engine is validated. The room exists now so that pass is additive - moves will
 * run through the same `getLegalMoves` / `applyMove` used client-side today.
 */
export class GameRoom extends Room {
  maxClients = 4;
  // Placeholder config until room creation actually takes options from the lobby (see
  // Lobby.tsx client-side) - matches maxClients above, not a real networking decision yet.
  gameState: GameState = createInitialState({ playerCount: 4, mode: 'ffa' });

  onCreate() {
    console.log('GameRoom created');
  }

  onJoin(client: Client) {
    console.log(`${client.sessionId} joined`);
  }

  onLeave(client: Client) {
    console.log(`${client.sessionId} left`);
  }
}
