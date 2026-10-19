// Connection presence: which player ids currently have at least one live socket.
const counts = new Map<string, number>();

export function playerConnected(playerId: string) {
  counts.set(playerId, (counts.get(playerId) ?? 0) + 1);
}

export function playerDisconnected(playerId: string) {
  const n = (counts.get(playerId) ?? 1) - 1;
  if (n <= 0) counts.delete(playerId);
  else counts.set(playerId, n);
}

export function isOnline(playerId: string): boolean {
  return (counts.get(playerId) ?? 0) > 0;
}
