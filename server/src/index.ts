import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { attachSockets } from './sockets.ts';

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);

const app = express();
const http = createServer(app);
const io = new Server(http, { cors: { origin: false } });
const registry = attachSockets(io);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, rooms: registry.rooms.size, uptime: Math.round(process.uptime()) });
});

// In production the server also serves the built client.
const dist = join(__dir, '../../client/dist');
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')));
}

http.listen(PORT, () => console.log(`Yot Monopoly server on :${PORT}`));
