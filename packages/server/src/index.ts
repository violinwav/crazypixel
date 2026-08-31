// Server entry point. One room type, one WebSocket transport, no persistence.

import { createServer } from 'http';
import express from 'express';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom';

const DEFAULT_PORT = 2567;

const app = express();
const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

// filterBy(['code']) is what makes client.join('game', { code }) find THAT specific room
// rather than colyseus's default "any open room of this name" matchmaking - a join request
// only matches a room whose listing.code (set in GameRoom.onCreate) equals the option.
gameServer.define('game', GameRoom).filterBy(['code']);

const port = Number(process.env.PORT) || DEFAULT_PORT;
httpServer.listen(port, () => {
  console.log(`crazypixel server listening on ws://localhost:${port}`);
});
