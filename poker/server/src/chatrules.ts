// Shared chat rules for tables and the tournament lobby: how often someone
// may speak, what they may not say, whether chat is on at all, and who they
// are allowed to tag.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './paths.ts';

// The operator's chat switch. Off means the server refuses sends everywhere
// (tables and tournament lobbies) with a message people actually see — the
// client also hides the compose box, but enforcement lives here, where it
// cannot be worked around by an old tab.
const CHAT_FILE = join(DATA_DIR, 'chatcfg.json');
let enabled = true;
try {
  if (existsSync(CHAT_FILE)) {
    enabled = JSON.parse(readFileSync(CHAT_FILE, 'utf8')).enabled !== false;
  }
} catch { /* default on */ }

export function chatEnabled(): boolean { return enabled; }
export function setChatEnabled(v: boolean): void {
  enabled = v;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(CHAT_FILE, JSON.stringify({ enabled: v }));
  } catch { /* keep the in-memory value */ }
}

// One message per this long, per player. Slow enough to kill spam, fast
// enough that table talk still flows. Defined in shared/ and re-exported here
// so the countdown the chat box shows is the same number this is enforced
// with — a timer that disagrees with the rule is worse than no timer.
export { CHAT_COOLDOWN_MS } from '../../shared/types.ts';

// The maximum @mentions a single message may carry — without a cap, one
// message can ping the whole table.
export const MAX_MENTIONS = 3;

// Blocked language. The patterns allow separators and common letter swaps
// (n1gg3r, n i g g e r) but require the doubled g, so real words and place
// names like Niger and Nigeria are never caught.
const SEP = '[^a-z0-9]{0,3}';
const BLOCKED = [
  new RegExp(`n${SEP}[i1!|]${SEP}g${SEP}g+${SEP}[e3]*${SEP}r`, 'i'),
  // The trailing (?!rd) keeps "niggardly" — a real word meaning stingy —
  // out of the filter while still catching nigga/niggas/niggah.
  new RegExp(`n${SEP}[i1!|]${SEP}g${SEP}g+${SEP}a(?!rd)`, 'i'),
];

export function isBlocked(text: string): boolean {
  const flat = text.toLowerCase();
  return BLOCKED.some(re => re.test(flat));
}

// Resolve @mentions against the people actually present.
//
// A tag runs to the first space and has to match a name outright. Both halves
// of that matter: allowing spaces inside a tag meant "@yo t" and "@y ot"
// normalised to the same thing as "@yot" and pinged them, and matching on a
// prefix meant "@yotter" — a different name entirely — pinged Yot too.
// Names containing spaces are tagged without them ("@BigSlick"), which is
// exactly what the picker in the compose box inserts.
export function resolveMentions(
  text: string,
  people: { id: string; name: string }[],
): { ids: string[]; count: number } {
  const tags = text.match(/@[\p{L}\p{N}_.-]{1,32}/gu) ?? [];
  if (tags.length === 0) return { ids: [], count: 0 };
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const ids = new Set<string>();
  for (const tag of tags) {
    const want = norm(tag.slice(1));
    if (!want) continue;
    const hit = people.find(p => norm(p.name) === want);
    if (hit) ids.add(hit.id);
  }
  return { ids: [...ids], count: tags.length };
}

// Resolve a reply reference against the log the message is going into. The
// sender only ever names an id: the quoted name and text come from the stored
// message, so nobody can put words in someone else's mouth by hand-crafting a
// socket payload. An id that is not in the log (already scrolled off, or made
// up) simply means the message is not a reply.
export function resolveReply(
  raw: unknown,
  log: { id: string; from: { id: string; name: string; avatar: string } | 'system'; text: string }[],
): { id: string; name: string; text: string } | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const target = log.find(m => m.id === raw);
  if (!target || target.from === 'system') return undefined;
  return {
    id: target.id,
    name: target.from.name,
    // Enough to recognise which message is meant, without rebuilding it.
    text: target.text.length > 120 ? `${target.text.slice(0, 119)}…` : target.text,
  };
}
