import { Client, Room } from 'colyseus.js';
import type { GameMode } from '@crazypixel/shared';
import type { PlayerSetup } from '../PlayerSetupPicker';

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
  playerCount: number;
  mode: GameMode;
  colors: number[];
  seatSessionIds: string[];
  playerNames: string[];
  stateJson: string;
  /** Epoch ms when the current turn auto-plays - see GameRoom.ts's scheduleTurnTimeout. */
  turnDeadline: number;
}

// Only the host's own seat (colors[0], see PlayerSetupPicker's colorSeats={0} usage in
// OnlineLobby) is known pre-creation - every other seat picks its own color (a hue, 0-359)
// after joining, via setSeatColor below, synced server-authoritatively like everything else
// in this room.
export function createRoom({ config, colors }: PlayerSetup, displayName: string): Promise<Room<RoomState>> {
  const client = new Client(SERVER_URL);
  return client.create<RoomState>('game', {
    playerCount: config.playerCount,
    mode: config.mode,
    hostHue: colors[0],
    displayName,
  });
}

export function joinRoom(code: string, displayName: string): Promise<Room<RoomState>> {
  const client = new Client(SERVER_URL);
  return client.joinById<RoomState>(code.trim(), { displayName });
}

export function setSeatColor(room: Room<RoomState>, hue: number): void {
  room.send('setColor', { hue });
}
