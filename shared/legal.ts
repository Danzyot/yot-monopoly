// The site's info pages: /terms, /privacy and /fair-play.
//
// The words below are the defaults. An operator can rewrite any page from the
// dashboard (Dashboard → Pages, server/src/legal.ts keeps the edits on the data
// volume), so changing a sentence does not need a deploy. To change the
// defaults themselves, edit this file.
//
// The body is plain text with a tiny markup, rendered by client/src/pages/LegalPage.tsx
// (never as HTML):
//   ## Heading          a section heading
//   - item              a bullet (consecutive lines make one list)
//   **bold**            bold
//   [words](/path)      a link: a site path, an https:// address, or (discord:) for the Discord invite
//   a blank line        a new paragraph
//
// Plain language on purpose. None of it is legal advice: have it checked if
// that matters to you.

export type LegalSlug = 'terms' | 'privacy' | 'fair-play';
export const LEGAL_SLUGS: LegalSlug[] = ['terms', 'privacy', 'fair-play'];

export interface LegalPage {
  slug: LegalSlug;
  title: string;
  /** "2026-10-20": when the words last changed. */
  updated: string;
  body: string;
}

export const LEGAL_LIMITS = { title: 60, body: 20_000 } as const;

const UPDATED = '2026-10-21';

const TERMS = `Chog Games is a free, community-run site for playing Monopoly-style board games, Chog Cards and poker with friends in the browser. By using it you agree to these terms. If you don't agree, please don't use the site.

These terms are written in plain language. They are not legal advice.

## Who can play
- You sign in with Discord, so you need to meet Discord's minimum age (13, or older where your country requires it).
- One account per person. Don't use someone else's account, and don't make new accounts to get around a ban.

## No money, no gambling
- Chog Games is free. There is nothing to buy, and no entry fees.
- Poker is played with play chips. They have no cash value and cannot be bought, sold or exchanged for anything.
- Monopoly money and Chog Cards points exist only inside the game.
- Sometimes a tournament has a prize. A prize is only what the admins post for that event, it is given at their discretion, and it can be withdrawn if the event is cancelled or the rules were broken.

## Chog Genesis holders
- Linking a wallet lets the site check whether it holds a Chog Genesis NFT, which unlocks things like hosting tables and playing as your own Chog.
- We only read public blockchain data. Linking never moves your tokens and never asks you to pay us. The self-transfer check sends a tiny amount from your wallet back to itself; the network keeps the fee for that, not us.
- Chog Genesis is bought and sold on other sites such as [OpenSea](https://opensea.io/collection/chog-genesis). We don't sell NFTs, aren't responsible for those sites, and nothing here is financial advice.

## Be kind, play fair
- Follow the [fair play rules](/fair-play).
- No harassment, hate, threats, spam, or sharing anyone's personal information, in chat or in names.
- Keep your name and outfit fine for everyone.

## Moderation
Admins may warn, mute, kick or ban accounts and IP addresses that break these rules, end or reset games, and remove results won by cheating. We try to be fair. If you think we got it wrong, ask in [our Discord](discord:).

## What you write
Your name, chat and anything else you type stays yours, but you let us show it to other players as part of the games.

## The site comes as it is
Chog Games is run by the community as a hobby. Games can glitch, servers restart, stats can be lost, and features can change or be switched off at any time. As far as the law allows, we aren't liable for any loss that comes from using the site.

## Names and trademarks
Chog Games is a fan-made community project. Monopoly is a trademark of Hasbro, and Chog Games is not affiliated with or endorsed by Hasbro. Discord and OpenSea belong to their owners.

## Changes
We may update these terms. The date at the top shows when they last changed, and playing after a change means you accept the new version.

## Questions
Ask in [our Discord](discord:). See also the [privacy notice](/privacy).`;

const PRIVACY = `This page explains what Chog Games stores about you, why, and who can see it. It is written in plain language and is not legal advice.

## What we store
- **Your Discord basics.** When you sign in with Discord we keep your Discord user id, username, display name and avatar. We never see your Discord password.
- **Your email address.** Signing in with Discord also gives us the email address on your Discord account and whether Discord has verified it. It is stored on our server only: other players never see it, and it is never on your profile, the leaderboard, share cards or Discord bot replies. We use it only to send the emails you turn on in your [notification settings](/settings) (tournament reminders, Daily Challenge streak reminders, friend invites, the weekly digest, announcements), plus rare notices about your account itself. Everything else is off until you turn it on, every email has a one-click unsubscribe link, and we only ever email addresses Discord has verified.
- **Your Discord servers and roles.** Some tables are only open to members of a server or role. To check, we ask Discord which servers you are in and your roles there. We keep the list of servers while you're signed in, not your messages.
- **The name you choose.** If you pick a name to play under (the welcome tour), we keep it with your account so it stays when you sign in again.
- **Friends.** Who you are friends with and the friend requests you send and receive, until you or they remove them.
- **Your games.** Results of finished games (who played, placings, scores, the board, your character) and tournament sign-ups and results. They power the leaderboard and your public profile.
- **Chat.** What you write at a table is shown to that table and kept with the game while it runs, so admins can deal with abuse.
- **Linked wallets.** The wallet addresses you link and which Chog Genesis tokens they hold, read from the public blockchain.
- **IP address and country.** Each time you connect we record your IP address and the country it comes from. We use it only against abuse: spotting duplicate accounts, enforcing bans and limiting floods of requests.
- **Logs.** A log of game events, admin actions and error reports, used to fix problems and settle disputes.
- **Visit counts.** We count page loads per page per day, and roughly how many different visitors came, using a code made from your IP address and browser that changes every day and cannot be turned back into either; only the totals are kept, for 90 days.

## In your browser
We don't use tracking cookies. Your browser's local storage keeps your sign-in and your preferences: sound and music, camera and graphics settings, your character and outfit, and which tips you've already seen. Clearing this site's data removes them.

## What we don't do
- No ads, no analytics or tracking scripts, and we never sell or trade your data. Your email address is never sold or shared with anyone except our email provider, and only to deliver the emails you chose.
- No tracking pixels or tracked links in our emails.
- No payments, so we never ask for card or bank details.

## Who sees what
- **Everyone:** your name, avatar, results, profile, badges and leaderboard place. A badge shows that you have linked a wallet, never which one.
- **Players at your table:** your name, avatar, character and chat.
- **Your friends:** whether you are online and which game you are in. They see your table's code only when it is public with a seat free.
- **Admins:** all of the above plus IP addresses, countries and linked wallets, for moderation only. Operators can also see how many players chose each email topic and can export the list of subscribers' addresses, only to run the emails you asked for; every export is logged.
- **Services we use:** Discord (sign-in), Resend (our email provider: it receives your address and the email to deliver only when we send you one you asked for), our hosting provider (it runs the servers that hold this data), a Monad blockchain node (we ask it which tokens a linked address holds) and Google Fonts (your browser fetches two fonts from Google, which sees your IP address).

## How long we keep it
We keep game results for the leaderboard and history for as long as the site runs. Connection records and logs are kept while they're useful against abuse. Bans and the evidence behind them are kept as long as the ban lasts. Your email address is updated each time you sign in with Discord and kept until you ask us to delete your data, which removes it together with your notification choices.

## Your choices
- Turn emails on or off any time in your [notification settings](/settings), or with the unsubscribe link in any email.
- Unlink a wallet any time on the [wallet page](/wallet).
- Remove a friend, or decline or cancel a request, any time on the [friends page](/friends).
- Sign out and clear this site's data to remove what's stored in your browser.
- To see what we hold about you, or to have it deleted (your email address and notification choices included), ask an admin in [our Discord](discord:). We may keep the minimum needed to keep a ban in place.

## Children
Chog Games is not meant for children under 13.

## Changes
If this notice changes, the date at the top changes with it. See also the [terms of use](/terms).`;

const FAIR_PLAY = `Chog Games is for fun, and it only stays fun if every game is a fair one.

## Do
- Play on your own account, one account per person.
- Be a good sport in chat, win or lose.
- Report bugs and cheating to the admins in [our Discord](discord:).

## Don't
- **No alts.** Don't use a second account, or play for someone else.
- **No teaming up.** Don't collude with other players: no feeding deeds or cash in Monopoly, no soft-playing or chip dumping in poker, no swapping information about hands.
- **No bots or tools** that play for you or show you anything the game keeps hidden.
- **No bug abuse.** Found a bug that helps you? Report it rather than use it. We're grateful for every report.
- **No griefing.** Don't stall on purpose, leave to spoil a game, or flood the chat.

## Tournaments
- Hosts may set who can join, such as members of a Discord server or Chog holders.
- Prizes are only what the admins post for that event. There are no entry fees.
- Results can be reviewed. If the rules were broken, admins may remove results, disqualify players and pass a prize to the next eligible player.

## What happens if you break the rules
Depending on how serious it is: a warning, a mute, removal from a table or tournament, removed results, or a temporary or permanent ban of the account and its IP address. To appeal, ask in [our Discord](discord:).

See also the [terms of use](/terms).`;

export const DEFAULT_LEGAL: Record<LegalSlug, LegalPage> = {
  terms: { slug: 'terms', title: 'Terms of use', updated: UPDATED, body: TERMS },
  privacy: { slug: 'privacy', title: 'Privacy', updated: UPDATED, body: PRIVACY },
  'fair-play': { slug: 'fair-play', title: 'Fair play', updated: UPDATED, body: FAIR_PLAY },
};

export function isLegalSlug(s: unknown): s is LegalSlug {
  return typeof s === 'string' && (LEGAL_SLUGS as string[]).includes(s);
}

// ---- the markup ------------------------------------------------------------------

export type LegalInline = { text: string; bold?: boolean; href?: string };
export type LegalBlock =
  | { kind: 'h2'; text: string }
  | { kind: 'p'; parts: LegalInline[] }
  | { kind: 'ul'; items: LegalInline[][] };

/** "discord:" → the invite (or nothing), site paths and https only; anything else is dropped. */
export function safeHref(raw: string, discordUrl: string | null): string | undefined {
  const h = raw.trim();
  if (h === 'discord:') return discordUrl ?? undefined;
  if (/^\/(?!\/)[\w\-/.#?=&%]*$/.test(h)) return h;
  if (/^https:\/\/[^\s"'<>]+$/.test(h)) return h;
  return undefined;
}

function inline(line: string, discordUrl: string | null): LegalInline[] {
  const out: LegalInline[] = [];
  // **bold** and [text](href); everything else is plain text.
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let at = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > at) out.push({ text: line.slice(at, m.index) });
    if (m[1] !== undefined) out.push({ text: m[1], bold: true });
    else out.push({ text: m[2], href: safeHref(m[3], discordUrl) });
    at = m.index + m[0].length;
  }
  if (at < line.length) out.push({ text: line.slice(at) });
  return out;
}

/** The body as blocks, ready to render as elements (no HTML involved). */
export function parseLegal(body: string, discordUrl: string | null = null): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  let para: string[] = [];
  let list: LegalInline[][] | null = null;
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', parts: inline(para.join(' '), discordUrl) });
    para = [];
    if (list) blocks.push({ kind: 'ul', items: list });
    list = null;
  };
  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith('## ')) { flush(); blocks.push({ kind: 'h2', text: line.slice(3).trim() }); continue; }
    if (/^[-*] /.test(line)) {
      if (para.length) { blocks.push({ kind: 'p', parts: inline(para.join(' '), discordUrl) }); para = []; }
      (list ??= []).push(inline(line.slice(2).trim(), discordUrl));
      continue;
    }
    if (list) { blocks.push({ kind: 'ul', items: list }); list = null; }
    para.push(line);
  }
  flush();
  return blocks;
}

