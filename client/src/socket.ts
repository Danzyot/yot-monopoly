import { io, type Socket } from 'socket.io-client';
import { getToken } from './api';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      auth: cb => cb({ token: getToken() }),
      transports: ['websocket', 'polling'],
      // Aggressive, unlimited reconnection — the server keeps seats through
      // disconnects, so a returning socket resumes exactly where it was.
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 400,
      reconnectionDelayMax: 3000,
      timeout: 10000,
    });
  }
  return socket;
}

// Reconnect with a fresh token after sign-in/out. The SAME socket instance is
// kept: every mounted component's listeners stay bound, and withResub's
// connect handlers re-subscribe automatically. (Swapping instances here used
// to orphan long-lived listeners — toasts and live views died after sign-in.)
// The auth callback above reads the current token on each connect attempt,
// so a bounce is all a token change needs.
export function resetSocket() {
  if (socket) {
    socket.disconnect();
    socket.connect();
  }
}

// Subscribe helper: runs `sub` now and again after every reconnect, so pages
// automatically resync state after a network blip. Returns a cleanup fn.
export function withResub(sub: () => void): () => void {
  const sock = getSocket();
  // Only run immediately when already connected — while still connecting, the
  // 'connect' handler covers it (running both would double-send the join and
  // duplicate the chat/log backlog the server replays).
  if (sock.connected) sub();
  sock.on('connect', sub);
  return () => { sock.off('connect', sub); };
}
