// Server entry point. One room type, one WebSocket transport, no persistence.

import { createServer } from 'http';
import express from 'express';
import { Server, matchMaker } from 'colyseus';
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

/**
 * The server browser's data source: every live room, waiting or already playing.
 *
 * Deliberately not colyseus's own /matchmake listing (what client.getAvailableRooms reads):
 * that only ever returns rooms which are unlocked and public, and handleStartGame locks a room
 * the moment play begins - so the games a browser most wants to show would all be missing.
 * matchMaker.query has no such filter.
 *
 * Only what a row displays crosses the wire: code, mode, phase, host name, headcount. Anything
 * a player shouldn't see before sitting down (hands, colors, the board) stays in room state,
 * which still needs a real join.
 */
app.get('/rooms', async (_req, res) => {
  // The client is served from a different origin than this server in every deployment shape
  // this project has (vite on :5173 in dev, unrelated domains in production), so a plain
  // fetch needs this header. Read-only public data, hence the open origin.
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const listings = await matchMaker.query({ name: 'game' });
    const rooms = listings
      .map((listing) => {
        const meta = (listing.metadata ?? {}) as Record<string, unknown>;
        return {
          code: typeof meta.code === 'string' ? meta.code : '',
          mode: meta.mode === 'teams' ? 'teams' : 'ffa',
          phase: meta.phase === 'playing' ? 'playing' : 'waiting',
          host: typeof meta.host === 'string' ? meta.host : '',
          seats: typeof meta.seats === 'number' ? meta.seats : 0,
          maxSeats: listing.maxClients,
        };
      })
      // A room that has published no code yet is one mid-onCreate, not something a player can
      // act on - showing it would offer a Join button that can't resolve to a room.
      .filter((room) => room.code !== '');
    res.json({ rooms });
  } catch {
    res.status(500).json({ rooms: [] });
  }
});

const port = Number(process.env.PORT) || DEFAULT_PORT;
httpServer.listen(port, () => {
  console.log(`crazypixel server listening on ws://localhost:${port}`);
});
