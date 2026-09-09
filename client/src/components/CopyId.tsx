// An identifier you can take with you.
//
// Every operator task that starts with "this player" — a ban, a lookup, a
// question to me — starts with their id, and reading a Discord snowflake off
// a screen and retyping it is nineteen digits of chances to get it wrong. So
// the id is shown, and clicking it copies it.
//
// Discord accounts carry two: the site id, which is the Discord snowflake
// with a `dc_` in front, and the snowflake itself, which is what Discord and
// its moderation tools want. Both are offered because both get asked for.
import { useEffect, useRef, useState } from 'react';

// The snowflake behind a Discord-linked account, if this is one.
export function discordIdOf(playerId: string): string | null {
  return playerId.startsWith('dc_') ? playerId.slice(3) : null;
}

export default function CopyId({ value, label, title }: {
  value: string;
  // What to show. Defaults to the value itself.
  label?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // A blocked clipboard must not leave the operator with nothing: select
      // the text instead so it can be copied by hand.
      const el = document.createElement('textarea');
      el.value = value;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      try { document.execCommand('copy'); } catch { /* nothing more to try */ }
      document.body.removeChild(el);
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      className={`copy-id${copied ? ' copied' : ''}`}
      title={title ?? `Click to copy ${value}`}
      onClick={e => { e.stopPropagation(); void copy(); }}
    >
      <span className="copy-id-text">{copied ? 'Copied' : (label ?? value)}</span>
    </button>
  );
}
