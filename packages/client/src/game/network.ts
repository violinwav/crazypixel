// Colyseus wiring: server address resolution, the room state shape, and one thin sender per
// message the server accepts. Every send is fire-and-forget - the result always comes back
// through room state or a broadcast, never a return value.

import { Client, Room } from 'colyseus.js';
import type { Card, GameMode, PlayerId } from '@crazypixel/shared';

const CLIENT_DEV_PORT = '5173'; // vite.config.ts's server.port
const SERVER_PORT = '2567'; // packages/server's default PORT

/**
 * Where the game server lives, derived from wherever the page was actually loaded from.
 * Hardcoding 'localhost' breaks whenever that isn't the dev machine itself (a LAN IP, or a
 * forwarded-port tunnel opened on a phone) - on the client device, 'localhost' means that
 * device's own loopback.
 */
function resolveServerUrl(): string {
  // Production puts client and server on unrelated domains (e.g. Vercel and Railway), where
  // no hostname trick can derive one from the other, so an explicit build-time override
  // wins. Vite only exposes VITE_-prefixed env vars to client code.
  const explicitUrl = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (explicitUrl) return explicitUrl;

  const { protocol, hostname } = window.location;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  // Forwarded-port tunnels (VS Code Ports, Codespaces, devtunnels) encode the port in the
  // hostname, e.g. abc123-5173.app.github.dev - swap in the server's port so the request
  // targets that port's own tunnel. Matched on the *known* client dev port rather than
  // window.location.port: tunnel URLs are https with an implicit :443, so location.port is
  // empty and can't say which forwarded port this is.
  if (hostname.includes(`-${CLIENT_DEV_PORT}`)) {
    return `${wsProtocol}//${hostname.replace(`-${CLIENT_DEV_PORT}`, `-${SERVER_PORT}`)}`;
  }
  return `${wsProtocol}//${hostname}:${SERVER_PORT}`;
}

const SERVER_URL = resolveServerUrl();

/** Mirror of GameRoom.ts's RoomState. */
export interface RoomState {
  phase: 'waiting' | 'playing';
  mode: GameMode;
  colors: number[];
  seatSessionIds: string[];
  playerNames: string[];
  /** The short code shown in the UI to share - not room.id, colyseus's long internal id. */
  code: string;
  stateJson: string;
  /**
   * The `Move` behind the current stateJson, as JSON ('' for a pass or a fresh deal).
   * Changes in the same patch as stateJson, so useOnlineGameState can plan a real movement
   * animation against the snapshot the move actually applied to.
   */
  lastMoveJson: string;
  /** Epoch ms when the current turn auto-plays - see GameRoom.scheduleTurnTimeout. */
  turnDeadline: number;
}

/**
 * Broadcast the moment the current player picks whose hand to reach into, ahead of picking
 * which card. There is no retract: choosing a target is final, and the intent ends only when
 * the next real GameState arrives. `card` is the one being spent, so every client can lay it
 * on the discard pile right away rather than at the end of the thief's reveal animation.
 */
export interface StealIntentMessage {
  by: PlayerId;
  target: PlayerId;
  card: Card;
}

/**
 * Broadcast whenever a seated player fires off an emote. `emoteId` indexes the shared EMOTES
 * catalogue rather than carrying glyphs, and `id` is the server's monotonic counter, so two
 * identical emotes in a row stay two distinct feed entries.
 */
export interface EmoteMessage {
  id: number;
  by: PlayerId;
  emoteId: string;
}

/**
 * What Lobby.tsx hands to App.tsx once a room's game has started: the room itself plus the
 * viewer's seat and everyone's starting colors/names, snapshotted at that moment.
 * OnlineGameView reads the room's live state for everything after.
 */
export interface OnlineSession {
  room: Room<RoomState>;
  mySeat: PlayerId;
  colors: number[];
  playerNames: string[];
}

interface HostOptions {
  mode: GameMode;
  hue: number;
  displayName: string;
}

/**
 * Opens a room. No player count: the room adapts to however many actually join (see
 * GameRoom's MAX_PLAYERS/handleStartGame). `hue` comes from the player's own profile, the
 * one place a color is ever chosen.
 */
export function createRoom({ mode, hue, displayName }: HostOptions): Promise<Room<RoomState>> {
  const client = new Client(SERVER_URL);
  return client.create<RoomState>('game', { mode, hue, displayName });
}

/**
 * Joins by short code. client.join, not joinById - the server's filterBy(['code']) (see
 * index.ts) matches on room metadata, so this only ever needs the code the host shared.
 */
export function joinRoom(code: string, displayName: string, hue: number): Promise<Room<RoomState>> {
  const client = new Client(SERVER_URL);
  return client.join<RoomState>('game', { code: code.trim(), displayName, hue });
}

export function setSeatColor(room: Room<RoomState>, hue: number): void {
  room.send('setColor', { hue });
}

export function startGame(room: Room<RoomState>): void {
  room.send('startGame');
}

/**
 * Announces that this client's player has singled out `targetPlayer`'s hand, before the
 * blind position is picked. The server holds it only until the turn commits; clients drop it
 * themselves when the next state arrives.
 */
export function sendStealIntent(room: Room<RoomState>, targetPlayer: PlayerId, card: Card): void {
  room.send('stealIntent', { targetPlayer, card });
}

/**
 * Host-only server-side (see GameRoom.handleRematch) - sent from any other seat it is
 * silently ignored. The new game arrives through the ordinary state path.
 */
export function requestRematch(room: Room<RoomState>): void {
  room.send('rematch');
}

/**
 * Fires an emote at the whole room, including back to this client - which is what makes the
 * sender's own message appear in the same feed, in the same order, as everyone else's rather
 * than being echoed locally out of step. The server enforces its own cooldown and silently
 * drops anything over quota, so the feed is the only confirmation a send landed.
 */
export function sendEmote(room: Room<RoomState>, emoteId: string): void {
  room.send('emote', { emoteId });
}
