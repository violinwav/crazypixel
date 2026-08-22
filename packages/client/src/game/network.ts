import { Client, Room } from 'colyseus.js';
import type { GameMode } from '@crazypixel/shared';
import type { PlayerSetup } from '../PlayerSetupPicker';

const SERVER_URL = 'ws://localhost:2567';

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
