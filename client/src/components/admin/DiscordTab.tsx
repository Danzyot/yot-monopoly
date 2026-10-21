// Discord bot tools and the two diagnostics that answer "why does Discord
// sign-in / the Verify button not work here?".
import { useState } from 'react';
import { api } from '../../api.ts';
import { act, post, usePoll, type Overview } from './adminApi.ts';

const DIAGNOSTICS: [string, string, string][] = [
  ['/api/auth/discord/check', 'Sign-in redirect check', 'Which OAuth redirect URL to register for this domain, and what is missing.'],
  ['/api/discord/interactions', 'Interactions endpoint check', 'Whether the Verify button endpoint is ready (public key set and valid).'],
];

export default function DiscordTab() {
  const { data: o } = usePoll<Overview>('/api/admin/overview');
  const [channel, setChannel] = useState('');
  const [to, setTo] = useState('');
  const [text, setText] = useState('');

  return (
    <div className="adm-stack">
      <h2 className="adm-h2">Discord</h2>
      {o && !o.discordBot && <div className="adm-alert warn" role="alert">⚠️ No Discord bot token is configured — posting and DMs will fail until DISCORD_BOT_TOKEN is set.</div>}
      <div className="adm-grid">
        <form className="adm-card adm-stack" onSubmit={e => {
          e.preventDefault();
          void act(() => post('/api/admin/discord/verify-panel', channel.trim() ? { channelId: channel.trim() } : {}), {
            confirm: `Post the Verify panel in ${channel.trim() ? `channel ${channel.trim()}` : 'the default verify channel'}?`,
            ok: 'Verify panel posted',
          });
        }}>
          <h3>Verify panel</h3>
          <p className="muted small">Posts the message with the “Verify” button members click to sign in with a code.</p>
          <input value={channel} aria-label="Channel id" inputMode="numeric" placeholder="Channel id (blank = DISCORD_VERIFY_CHANNEL_ID)" onChange={e => setChannel(e.target.value.replace(/\D/g, ''))} />
          <div><button className="btn small primary">Post panel</button></div>
        </form>

        <form className="adm-card adm-stack" onSubmit={e => {
          e.preventDefault();
          void act(() => post('/api/admin/dm', { discordId: to.trim(), text }), { ok: 'DM sent' }).then(ok => { if (ok) setText(''); });
        }}>
          <h3>Direct message</h3>
          <p className="muted small">Sent by the bot. Find a player's Discord id on the Players tab.</p>
          <input value={to} aria-label="Discord user id" inputMode="numeric" placeholder="Discord user id" onChange={e => setTo(e.target.value.replace(/\D/g, ''))} />
          <textarea value={text} aria-label="Message" rows={3} maxLength={1800} placeholder="Message" onChange={e => setText(e.target.value)} />
          <div><button className="btn small primary" disabled={!to.trim() || !text.trim()}>Send DM</button></div>
        </form>
      </div>

      <SlashCommands />

      <section className="adm-card adm-stack">
        <h3>Diagnostics</h3>
        {DIAGNOSTICS.map(([path, title, hint]) => <Diagnostic key={path} path={path} title={title} hint={hint} />)}
      </section>
    </div>
  );
}

/** Where the bot's slash commands stand (server/src/discordRegister.ts). */
interface CommandSyncStatus {
  state: 'idle' | 'syncing' | 'registered' | 'unchanged' | 'failed' | 'not-configured';
  message: string;
  at: number | null;
  commands: string[];
  guildId: string | null;
  registeredAt: number | null;
}

const SYNC_LABEL: Record<CommandSyncStatus['state'], [string, string]> = {
  idle: ['⏳', 'Not checked yet'],
  syncing: ['⏳', 'Registering…'],
  registered: ['✅', 'Registered'],
  unchanged: ['✅', 'Up to date'],
  failed: ['⚠️', 'Failed'],
  'not-configured': ['⚪', 'Off'],
};

const SYNC_TONE: Record<CommandSyncStatus['state'], string> = {
  idle: 'info', syncing: 'info', registered: 'good', unchanged: 'good', failed: 'warn', 'not-configured': 'info',
};

function SlashCommands() {
  const { data: s, reload } = usePoll<CommandSyncStatus>('/api/admin/discord/commands');
  const [busy, setBusy] = useState(false);
  const [icon, label] = s ? SYNC_LABEL[s.state] : ['…', 'Loading'];
  return (
    <section className="adm-card adm-stack">
      <h3>Slash commands</h3>
      <p className="muted small">
        /play, /stats, /leaderboard, /tables, /daily and /chog, registered in the Chog server.
        They register by themselves on startup and when the leaderboard switch changes; press the button after
        re-inviting the bot or if they are missing in Discord.
      </p>
      {s && (
        <div className={`adm-alert ${SYNC_TONE[s.state]}`} role={s.state === 'failed' ? 'alert' : undefined}>
          <span aria-hidden>{icon}</span>
          <div>
            <b>{label}</b>: {s.message}
            {s.commands.length > 0 && <div className="small">{s.commands.join('  ')}</div>}
            <div className="muted small">
              {s.registeredAt ? `Last accepted by Discord: ${new Date(s.registeredAt).toLocaleString()}` : 'Never accepted by Discord on this data volume.'}
              {s.guildId ? ` · server ${s.guildId}` : ''}
            </div>
          </div>
        </div>
      )}
      <div>
        <button className="btn small primary" disabled={busy} onClick={() => {
          setBusy(true);
          void act(async () => {
            const r = await post('/api/admin/discord/commands') as CommandSyncStatus;
            if (r.state === 'failed' || r.state === 'not-configured') throw new Error(r.message);
          }, { ok: 'Discord commands registered' })
            .finally(() => { setBusy(false); void reload(); });
        }}>{busy ? 'Registering…' : 'Re-register Discord commands'}</button>
      </div>
    </section>
  );
}

function Diagnostic({ path, title, hint }: { path: string; title: string; hint: string }) {
  const [out, setOut] = useState<string | null>(null);
  const run = () => {
    setOut('…');
    api<unknown>(path).then(d => setOut(JSON.stringify(d, null, 2))).catch((e: Error) => setOut(`Error: ${e.message}`));
  };
  return (
    <div className="adm-diag">
      <div className="row wrap between">
        <div><b>{title}</b><br /><span className="muted small">{hint}</span></div>
        <div className="row">
          <button className="btn tiny" onClick={run}>Run</button>
          <a className="btn tiny ghost" href={path} target="_blank" rel="noreferrer">Open ↗</a>
        </div>
      </div>
      {out !== null && <pre className="adm-pre">{out}</pre>}
    </div>
  );
}
