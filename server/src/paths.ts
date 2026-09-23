// Single source of truth for where durable data lives. On Railway, attach a
// volume and set DATA_DIR to its mount path (e.g. /data) so results, the
// login secret and live-game snapshots survive deploys and restarts.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = process.env.DATA_DIR && process.env.DATA_DIR.trim()
  ? process.env.DATA_DIR.trim()
  : join(__dir, '..', 'data');
