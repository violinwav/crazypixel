import { Client, Room } from 'colyseus.js';
import type { Card, GameMode, PlayerId } from '@crazypixel/shared';

// Hardcoding 'localhost' breaks whenever the page isn't loaded from the dev machine itself
// (LAN IP, or a VS Code/Codespaces forwarded-port tunnel viewed on a phone) - 'localhost'
// on the client device means the client device's own loopback, not the dev machine. Derive
// the server's address from wherever the page was actually loaded from instead.
const CLIENT_DEV_PORT = '5173'; // vite.config.ts's server.port
const SERVER_PORT = '2567'; // packages/server's default PORT

function resolveServerUrl(): string {
  // Production deploys (e.g. client on Vercel, server on Railway/Render/Fly) put the two on
  // completely unrelated domains - there's no hostname trick that can derive one from the
  // other, so an explicit build-time override wins when set. Vite only exposes env vars
  // prefixed VITE_ to client code; set VITE_SERVER_URL to the server's wss:// URL.
  const explicitUrl = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (explicitUrl) return explicitUrl;

  const { protocol, hostname } = window.location;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  // Forwarded-port tunnels (VS Code Ports panel, Codespaces, devtunnels) encode the
  // forwarded port in the hostname, e.g. abc123-5173.app.github.dev - swap in the server's
  // port so the request targets that port's own forwarded tunnel instead of the client's.
  // Matched on the client's *known* dev port, not `window.location.port`: tunnel URLs are
  // https with an implicit :443, so `location.port` is empty and can't tell us which
  // forwarded port we're looking at.
  if (hostname.includes(`-${CLIENT_DEV_PORT}`)) {
    return `${wsProtocol}//${hostname.replace(`-${CLIENT_DEV_PORT}`, `-${SERVER_PORT}`)}`;
  }
  return `${wsProtocol}//${hostname}:${SERVER_PORT}`;
}

const SERVER_URL = resolveServerUrl();

export interface RoomState {
  phase: 'waiting' | 'playing';
  mode: GameMode;
  colors: number[];
  seatSessionIds: string[];
  playerNames: string[];
  /** The short code shown in the UI to share (see GameRoom.ts's generateCode) - distinct
   * from room.id, colyseus's own long internal id. */
  code: string;
  stateJson: string;
  /** Epoch ms when the current turn auto-plays - see GameRoom.ts's scheduleTurnTimeout. */
  turnDeadline: number;
}

/** Broadcast by GameRoom the moment the current player picks whose hand to reach into,
 * ahead of picking which card - see GameRoom.handleStealIntent. There's no retract: choosing
 * a target is final, and the intent ends only when the next real GameState arrives. `card`
 * is the one being spent on the steal, so every client can lay it on the discard pile right
 * away rather than at the end of the thief's reveal animation. */
export interface StealIntentMessage {
  by: PlayerId;
  target: PlayerId;
  card: Card;
}

/** What Lobby.tsx hands up to App.tsx once a room's game has actually started - the room
 * itself plus the viewer's own seat and everyone's starting colors/names, snapshotted at
 * that moment (App.tsx.OnlineGameView reads the room's live state for everything after). */
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

// Every seat's color is just whatever that player's own profile (PlayerIdentity.tsx) has
// set - sent at join time as `hue` here and in joinRoom below, so there's exactly one place
// (the profile strip) a player's color ever gets chosen, matching what the roster then
// shows. No player count here anymore - the room adapts to however many actually join (see
// GameRoom.ts's MAX_PLAYERS/handleStartGame).
export function createRoom({ mode, hue, displayName }: HostOptions): Promise<Room<RoomState>> {
  const client = new Client(SERVER_URL);
  return client.create<RoomState>('game', { mode, hue, displayName });
}

// client.join (not joinById) - matches an existing room by metadata via filterBy(['code'])
// on the server's room definition (index.ts), so this only ever needs the short code the
// host shared, never colyseus's own long internal room id.
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

/** Tells everyone else that this client's player has singled out `targetPlayer`'s hand for
 * a steal, before the blind position is picked. The server keeps it only until the turn
 * commits (see GameRoom.handleStealIntent) - clients drop it on their own the moment the
 * next real state arrives (see useOnlineGameState). */
export function sendStealIntent(room: Room<RoomState>, targetPlayer: PlayerId, card: Card): void {
  room.send('stealIntent', { targetPlayer, card });
}

/** Host-only server-side (see GameRoom.handleRematch) - sending this from any other seat is
 * silently ignored, same as every other message here. The new game arrives through the
 * ordinary onStateChange path, so there's nothing to await. */
export function requestRematch(room: Room<RoomState>): void {
  room.send('rematch');
}
