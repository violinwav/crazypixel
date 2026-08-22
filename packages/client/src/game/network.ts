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
  stateJson: string;
  /** Epoch ms when the current turn auto-plays - see GameRoom.ts's scheduleTurnTimeout. */
  turnDeadline: number;
}

export function createRoom({ config, colors }: PlayerSetup): Promise<Room<RoomState>> {
  const client = new Client(SERVER_URL);
  return client.create<RoomState>('game', {
    playerCount: config.playerCount,
    mode: config.mode,
    colors,
  });
}

export function joinRoom(code: string): Promise<Room<RoomState>> {
  const client = new Client(SERVER_URL);
  return client.joinById<RoomState>(code.trim());
}
