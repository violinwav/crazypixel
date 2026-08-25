import { createServer } from 'http';
import express from 'express';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom';

const app = express();
const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});
// filterBy(['code']) is what makes client.join('game', { code }) (see network.ts's
// joinRoom) find THIS specific room instead of colyseus's default "any open room of this
// name" matchmaking - a join request only matches a room whose metadata.code (set in
// GameRoom.onCreate) equals the option's code.
gameServer.define('game', GameRoom).filterBy(['code']);

const port = Number(process.env.PORT) || 2567;
httpServer.listen(port, () => {
  console.log(`crazypixel server listening on ws://localhost:${port}`);
});
