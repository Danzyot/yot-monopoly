// Does DATA_DIR actually survive a restart?
//
// Every other check answers a weaker question. "Is DATA_DIR set" is satisfied
// by a path that points inside the container. "Can it be written to" is
// satisfied by any writable directory, and an ephemeral one is perfectly
// writable — right up until the deploy that throws it away. Neither notices
// the failure that costs an operator their results, their bans and everyone's
// sign-in, and the symptom people actually report is "my settings keep
// resetting", days later and with nothing linking the two.
//
// So the server leaves a mark and looks for it next time. A boot that finds no
// mark is either the first boot ever — fine — or a boot onto a disk that threw
// the last one away. That ambiguity only exists once: from the second deploy
// onward, a missing mark is conclusive, and the operator is told in the deploy
// log rather than by a player.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './paths.ts';

const FILE = join(DATA_DIR, 'boot.json');

export interface BootMark {
  /** How many boots this directory has seen, including the current one. */
  boots: number;
  /** When the previous boot happened; null when there was no record. */
  previousBootAt: number | null;
  /** True when no record was found — first boot ever, or a wiped disk. */
  noRecordFound: boolean;
  /** Set when the mark itself could not be written. */
  error?: string;
}

export function recordBoot(dir: string = DATA_DIR): BootMark {
  const file = dir === DATA_DIR ? FILE : join(dir, 'boot.json');
  let boots = 0;
  let previousBootAt: number | null = null;
  try {
    if (existsSync(file)) {
      const p = JSON.parse(readFileSync(file, 'utf8')) as { boots?: number; at?: number };
      if (Number.isFinite(p?.boots)) boots = Math.max(0, Math.trunc(p!.boots!));
      if (Number.isFinite(p?.at)) previousBootAt = p!.at!;
    }
  } catch {
    // A corrupt mark is the same as no mark: it cannot prove a previous boot.
  }
  const mark: BootMark = {
    boots: boots + 1,
    previousBootAt,
    noRecordFound: previousBootAt === null,
  };
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ boots: mark.boots, at: Date.now() }));
    renameSync(tmp, file);
  } catch (e) {
    mark.error = e instanceof Error ? e.message : String(e);
  }
  return mark;
}
