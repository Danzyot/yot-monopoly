// Every email the site sends, as HTML (tables and inline styles, so it looks
// right in Gmail, Outlook and phone apps) with a plain-text twin. One layout:
// the Chog mark, a heading, a few blocks, one big button, and a footer that
// says why you got it with a one-click unsubscribe link. All text is escaped;
// templates take plain strings, never HTML.
import { BRAND, GAMES } from '../../../shared/brand.ts';
import { topicInfo, type EmailTopic } from '../../../shared/email.ts';

export type Block =
  | { p: string }
  | { list: { label: string; detail?: string }[] }
  | { note: string };

export interface EmailContent {
  subject: string;
  /** The grey line inbox lists show after the subject. */
  preheader: string;
  heading: string;
  blocks: Block[];
  button?: { label: string; url: string };
}

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

export interface FooterInfo {
  origin: string;
  topic: EmailTopic | 'test';
  unsubscribeUrl: string | null;
}

const C = {
  bg: '#0f1420', card: '#161c2a', line: '#273049', text: '#eef1f7', muted: '#95a0b5', accent: '#e1251b', gold: '#ffcf4a',
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Plain text a player or operator typed, flattened to one bounded line or paragraph. */
export function plain(raw: unknown, max = 2000): string {
  return String(raw ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, max).trim();
}

function blockHtml(b: Block): string {
  if ('p' in b) {
    return b.p.split(/\n{2,}/).map(par =>
      `<p style="margin:0 0 14px;font:16px/1.55 ${FONT};color:${C.text}">${esc(par).replace(/\n/g, '<br>')}</p>`).join('');
  }
  if ('note' in b) return `<p style="margin:0 0 14px;font:13px/1.5 ${FONT};color:${C.muted}">${esc(b.note)}</p>`;
  const rows = b.list.map((it, i) => `<tr><td style="padding:10px 14px;border-top:${i ? `1px solid ${C.line}` : '0'};font:15px/1.4 ${FONT};color:${C.text}">
<b>${esc(it.label)}</b>${it.detail ? `<br><span style="font-size:13px;color:${C.muted}">${esc(it.detail)}</span>` : ''}</td></tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;background:${C.bg};border:1px solid ${C.line};border-radius:10px">${rows}</table>`;
}

function blockText(b: Block): string {
  if ('p' in b) return b.p;
  if ('note' in b) return b.note;
  return b.list.map(it => `- ${it.label}${it.detail ? ` (${it.detail})` : ''}`).join('\n');
}

function why(topic: EmailTopic | 'test'): string {
  if (topic === 'test') return 'This is a test email sent from the dashboard.';
  if (topic === 'account') return 'You get this because it is about your account.';
  return `You get this because you turned on "${topicInfo(topic).label}" in your notification settings.`;
}

export function render(c: EmailContent, f: FooterInfo): Rendered {
  const manage = `${f.origin}/settings`;
  const logo = `${f.origin}/brand/icon-192.png`;
  const button = c.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 18px"><tr><td style="border-radius:10px;background:${C.accent}">
<a href="${esc(c.button.url)}" style="display:inline-block;padding:13px 24px;font:700 16px ${FONT};color:#ffffff;text-decoration:none;border-radius:10px">${esc(c.button.label)}</a></td></tr></table>`
    : '';
  const unsub = f.unsubscribeUrl
    ? ` <a href="${esc(f.unsubscribeUrl)}" style="color:${C.muted};text-decoration:underline">Unsubscribe</a> &middot;`
    : '';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light"><title>${esc(c.subject)}</title></head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(c.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 16px">
<a href="${esc(f.origin)}" style="text-decoration:none;font:800 20px ${FONT};color:${C.text}">
<img src="${esc(logo)}" width="36" height="36" alt="" style="vertical-align:middle;border-radius:9px;margin-right:10px">${esc(BRAND.name)}</a>
</td></tr>
<tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:16px;padding:28px 26px">
<div style="height:4px;width:56px;background:${C.accent};border-radius:2px;margin:0 0 18px"></div>
<h1 style="margin:0 0 16px;font:800 24px/1.25 ${FONT};color:${C.text}">${esc(c.heading)}</h1>
${c.blocks.map(blockHtml).join('\n')}
${button}
</td></tr>
<tr><td style="padding:18px 6px 0;font:12px/1.6 ${FONT};color:${C.muted}">
${esc(why(f.topic))}<br>${unsub} <a href="${esc(manage)}" style="color:${C.muted};text-decoration:underline">Notification settings</a> &middot; <a href="${esc(f.origin)}/privacy" style="color:${C.muted};text-decoration:underline">Privacy</a><br>
${esc(BRAND.name)}: ${esc(GAMES.monopoly.name)}, ${esc(GAMES.cards.name)} and ${esc(GAMES.poker.name)} with the Chog crew. Free to play, no real money.
</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    BRAND.name,
    '',
    c.heading,
    '',
    ...c.blocks.map(b => `${blockText(b)}\n`),
    ...(c.button ? [`${c.button.label}: ${c.button.url}`, ''] : []),
    '--',
    why(f.topic),
    ...(f.unsubscribeUrl ? [`Unsubscribe: ${f.unsubscribeUrl}`] : []),
    `Notification settings: ${manage}`,
  ].join('\n');
  return { subject: c.subject, html, text };
}

// ---- the messages -----------------------------------------------------------------------

const timeUtc = (t: number) => new Date(t).toISOString().slice(11, 16) + ' UTC';
const dayUtc = (t: number) => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export function tournamentReminder(o: { origin: string; name: string; start: number; now: number; href: string; registered: boolean; prize?: string; opensAt?: number }): EmailContent {
  const mins = Math.max(1, Math.round((o.start - o.now) / 60_000));
  return {
    subject: o.registered ? `${o.name} starts in about an hour` : `${o.name} starts soon: sign up now`,
    preheader: `${o.name} starts at ${timeUtc(o.start)}.`,
    heading: o.registered ? 'Your tournament starts soon' : 'A tournament starts soon',
    blocks: [
      { p: o.registered
        ? `${o.name} starts at ${timeUtc(o.start)} (in about ${mins} minutes). Be at the site a few minutes early: tables are seated at the start and a seat left empty is a no-show.`
        : o.opensAt && o.opensAt > o.now
          ? `${o.name} starts at ${timeUtc(o.start)} (in about ${mins} minutes). Registration opens at ${timeUtc(o.opensAt)} and stays open until it starts.`
          : `${o.name} starts at ${timeUtc(o.start)} (in about ${mins} minutes). Registration is open until it starts.` },
      ...(o.prize ? [{ list: [{ label: 'Prize', detail: o.prize }] }] : []),
    ],
    button: { label: o.registered ? 'Open the tournament' : 'Sign up', url: `${o.origin}${o.href}` },
  };
}

export function streakReminder(o: { origin: string; name: string; dailies: { label: string; streak: number; path: string }[] }): EmailContent {
  const best = Math.max(...o.dailies.map(d => d.streak));
  const one = o.dailies.length === 1 ? o.dailies[0] : null;
  return {
    subject: one ? `Keep your ${one.streak}-day ${one.label} streak going 🔥` : `Keep your Daily streaks going 🔥`,
    preheader: "Today's Daily Challenge closes at midnight UTC.",
    heading: `Don't break the streak, ${o.name}`,
    blocks: [
      { p: `You haven't played today's Daily Challenge yet. It closes at midnight UTC${best > 1 ? `, and your streak is at ${best} days` : ''}.` },
      { list: o.dailies.map(d => ({ label: `${d.label} Daily`, detail: `🔥 ${d.streak} day${d.streak === 1 ? '' : 's'} in a row` })) },
    ],
    button: { label: "Play today's Daily", url: `${o.origin}${(one ?? o.dailies[0]).path}` },
  };
}

export function friendInvite(o: { origin: string; from: string; game: string; url: string }): EmailContent {
  return {
    subject: `${o.from} invited you to a ${o.game} table`,
    preheader: `${o.from} saved you a seat.`,
    heading: `${o.from} saved you a seat`,
    blocks: [
      { p: `Your friend ${o.from} invited you to their ${o.game} table while you were away. The seat stays open while the table waits in its lobby.` },
    ],
    button: { label: 'Take the seat', url: o.url },
  };
}

export interface DigestData {
  weekOf: string;
  games: number;
  players: number;
  top: { name: string; wins: number; games: number }[];
  tournaments: { name: string; start: number }[];
  you?: { games: number; wins: number };
}

export function weeklyDigest(o: { origin: string; name: string; d: DigestData }): EmailContent {
  const { d } = o;
  return {
    subject: `Your ${BRAND.name} week: ${d.top[0] ? `${d.top[0].name} led the way` : 'what is coming up'}`,
    preheader: `${d.games} games last week, ${d.tournaments.length} tournament${d.tournaments.length === 1 ? '' : 's'} coming up.`,
    heading: `The week in ${BRAND.name}`,
    blocks: [
      { p: `Hi ${o.name}! Last week ${d.players} players finished ${d.games} games.${d.you ? ` You played ${d.you.games} and won ${d.you.wins}.` : ''}` },
      ...(d.top.length ? [{ p: 'Top players' }, { list: d.top.map((t, i) => ({ label: `${['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`} ${t.name}`, detail: `${t.wins} win${t.wins === 1 ? '' : 's'} in ${t.games} game${t.games === 1 ? '' : 's'}` })) }] : []),
      ...(d.tournaments.length
        ? [{ p: 'Tournaments this week' }, { list: d.tournaments.map(t => ({ label: t.name, detail: `${dayUtc(t.start)}, ${timeUtc(t.start)}` })) }]
        : [{ note: 'No tournaments on the calendar yet this week. Keep an eye on the Tournaments page.' }]),
    ],
    button: { label: 'Play now', url: `${o.origin}/` },
  };
}

export function announcement(o: { origin: string; subject: string; body: string; buttonLabel?: string; buttonUrl?: string }): EmailContent {
  const subject = plain(o.subject, 120);
  const body = plain(o.body, 5000);
  const url = o.buttonUrl && /^https:\/\/|^\//.test(o.buttonUrl) ? (o.buttonUrl.startsWith('/') ? `${o.origin}${o.buttonUrl}` : o.buttonUrl) : `${o.origin}/`;
  return {
    subject,
    preheader: body.split('\n')[0].slice(0, 120),
    heading: subject,
    blocks: [{ p: body }],
    button: { label: plain(o.buttonLabel, 40) || `Open ${BRAND.name}`, url },
  };
}

export function testEmail(o: { origin: string; by: string }): EmailContent {
  return {
    subject: `${BRAND.name} test email`,
    preheader: 'If you can read this, sending works.',
    heading: 'Sending works 🎉',
    blocks: [
      { p: `${o.by} sent this from the dashboard's Email tab to check that ${BRAND.name} can send mail.` },
      { note: 'If this landed in spam, check the SPF and DKIM records for the sending domain (docs/CHOGGAMES-DEPLOY.md).' },
    ],
    button: { label: `Open ${BRAND.name}`, url: `${o.origin}/` },
  };
}
