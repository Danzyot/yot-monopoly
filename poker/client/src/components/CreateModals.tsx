import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type AppConfig } from '../api';
import { useAuth } from '../auth';
import { useToast } from '../toast';
import BlindEditor, { niceChip, type LevelRow } from './BlindEditor';
import ThemePicker from './ThemePicker';
import type { TableTheme } from '../../../shared/types';
import LateClockField, { lateClockState, lateClockValue } from './LateClockField';

// Left blank on purpose. The Discord pair below fills itself in from
// /api/config the moment it arrives — the server already knows the guild and
// invite this deployment is wired to — and the two social links are whatever
// the host types on the form. Hardcoding a guess here is how a fork ends up
// advertising the account of the site it was copied from.
const DEFAULT_X = '';
const DEFAULT_IG = '';
const DEFAULT_DISCORD = '';
const DEFAULT_GUILD_ID = '';

export function CreateTournamentModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const { profile } = useAuth();
  const [name, setName] = useState('');
  const [startingStack, setStartingStack] = useState(10000);
  const [stackCustom, setStackCustom] = useState(false);
  const [levelMinutes, setLevelMinutes] = useState(5);
  const [levelMinutesCustom, setLevelMinutesCustom] = useState(false);
  const [structure, setStructure] = useState<'turbo' | 'regular' | 'deep'>('regular');
  const [maxPlayers, setMaxPlayers] = useState(500);
  const [maxPlayersCustom, setMaxPlayersCustom] = useState(false);
  // Custom blind schedule (PokerNow-style rows). Last row minutes 0 = forever.
  const [customBlinds, setCustomBlinds] = useState(false);
  const [levels, setLevels] = useState<LevelRow[]>([
    { sb: 25, bb: 50, minutes: 5 },
    { sb: 50, bb: 100, minutes: 0 },
  ]);
  const [prizeText, setPrizeText] = useState('');
  const [actionSeconds, setActionSeconds] = useState(20);
  const [actionCustom, setActionCustom] = useState(false);
  const [seatsPerTable, setSeatsPerTable] = useState(9);
  const [timebankSeconds, setTimebankSeconds] = useState(0);
  const [scheduledStart, setScheduledStart] = useState(''); // datetime-local, optional
  const [lateRegMinutes, setLateRegMinutes] = useState(15);
  const [joinMinutes, setJoinMinutes] = useState(15);
  // Off unless the host asks for it.
  const [betCapOn, setBetCapOn] = useState(false);
  const [betCapMinutes, setBetCapMinutes] = useState(15);
  // Extra time near the end: off unless the host asks for it.
  const [lateClock, setLateClock] = useState(lateClockState(null));
  const [lateRegCustom, setLateRegCustom] = useState(false);
  const [approveRegistrations, setApproveRegistrations] = useState(false);
  const [speedHelp, setSpeedHelp] = useState(false);
  const [rabbitHunting, setRabbitHunting] = useState(false);
  const [displayMode, setDisplayMode] = useState<'chips' | 'bb'>('chips');
  const [breakEveryLevels, setBreakEveryLevels] = useState(0);
  const [maxReentries, setMaxReentries] = useState(0);
  const [theme, setTheme] = useState<TableTheme | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSocial, setShowSocial] = useState(false);
  // Prefilled so the host does not retype them for every
  // event. Still editable per tournament.
  const [xUrl, setXUrl] = useState(DEFAULT_X);
  const [igUrl, setIgUrl] = useState(DEFAULT_IG);
  const [discordInviteUrl, setDiscordInviteUrl] = useState(DEFAULT_DISCORD);
  const [discordGuildId, setDiscordGuildId] = useState(DEFAULT_GUILD_ID);
  const [discordRoleId, setDiscordRoleId] = useState('');
  const [discordRoleName, setDiscordRoleName] = useState('');
  const [requireDiscord, setRequireDiscord] = useState(false);
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('');
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [roles, setRoles] = useState<{ id: string; name: string }[] | null>(null);

  // Prefill the Discord server defaults from this app's config.
  useEffect(() => {
    api.config().then(c => {
      setCfg(c);
      setDiscordGuildId(g => g || (c.discord.guildId ?? ''));
      setDiscordInviteUrl(u => u || (c.discord.inviteUrl ?? ''));
    }).catch(() => {});
  }, []);

  // With the bot available, load the server's roles for a proper picker.
  useEffect(() => {
    if (!showSocial || !cfg?.discord.botEnabled) return;
    const guildId = discordGuildId.trim();
    if (!/^\d{5,25}$/.test(guildId)) { setRoles(null); return; }
    let stale = false;
    api.discordRoles(guildId)
      .then(r => { if (!stale) setRoles(r.roles); })
      .catch(() => { if (!stale) setRoles(null); });
    return () => { stale = true; };
  }, [showSocial, cfg?.discord.botEnabled, discordGuildId]);

  const create = async () => {
    // Names are how the operator tells games apart in the dashboard and the
    // audit, so a blank one is not filled in silently any more.
    if (!name.trim()) {
      toast('error', 'Give the tournament a name first.');
      return;
    }
    setBusy(true);
    try {
      const { id } = await api.createTournament({
        name: name.trim(), startingStack, levelMinutes, structure,
        maxPlayers, prizeText, lateRegMinutes, joinMinutes, approveRegistrations,
        betCapMinutes: betCapOn ? betCapMinutes : null,
        lateClock: lateClockValue(lateClock),
        breakEveryLevels, maxReentries, minPlayers: 2, seatsPerTable,
        rabbitHunting, displayMode, actionSeconds, timebankSeconds,
        theme: theme ?? undefined,
        scheduledStart: scheduledStart ? new Date(scheduledStart).getTime() : undefined,
        customLevels: customBlinds
          ? levels.map(r => ({ sb: r.sb, bb: r.bb, ante: 0, minutes: r.minutes, isBreak: !!r.isBreak }))
          : undefined,
        social: showSocial
          ? { xUrl, igUrl, discordInviteUrl, discordGuildId, discordRoleId, discordRoleName, requireDiscord }
          : undefined,
        discordWebhookUrl: showSocial ? discordWebhookUrl : undefined,
      });
      toast('success', 'Tournament created — share the link to invite players!');
      nav(`/t/${id}`);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not create tournament');
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>New tournament</h3>
        <div className="field">
          <label>Tournament name</label>
          <input className="input" placeholder="e.g. Sunday Major" value={name}
            maxLength={48} onChange={e => setName(e.target.value)} autoFocus required />
        </div>
        <div className="row">
          <div className="field">
            <label>Starting stack</label>
            <select
              className="input"
              value={stackCustom ? 'custom' : String(startingStack)}
              onChange={e => {
                if (e.target.value === 'custom') { setStackCustom(true); return; }
                setStackCustom(false);
                setStartingStack(Number(e.target.value));
              }}
            >
              {[5000, 10000, 20000, 30000, 50000, 100000].map(v => (
                <option key={v} value={v}>{v.toLocaleString('en-US')}</option>
              ))}
              <option value="custom">Custom…</option>
            </select>
            {stackCustom && (
              <input className="input" type="number" min={100} max={100000000} value={startingStack}
                onChange={e => setStartingStack(Math.max(100, Math.floor(Number(e.target.value) || 0)))} />
            )}
          </div>
          {!customBlinds && (
          <div className="field">
            <label>
              Blind speed{' '}
              <button
                type="button" className="help-dot" aria-label="What do the blind speeds mean?"
                onClick={() => setSpeedHelp(s => !s)}
              >?</button>
            </label>
            {speedHelp && (
              <div className="help-pop">
                <p>Every speed starts at blinds <strong>25/50</strong>, with antes joining from
                level 4 (about an eighth of the big blind). The speed sets how hard each new
                level hits:</p>
                <p><strong>Turbo</strong> — blinds grow ~55% per level (25/50 → 40/75 → 60/120 …).
                With 5-minute levels a 100-player field wraps in roughly 1–1.5 hours. Short,
                aggressive, shove-heavy endings.</p>
                <p><strong>Regular</strong> — ~40% per level (25/50 → 35/70 → 50/100 …). The
                standard pace: real play early, pressure building through the middle.</p>
                <p><strong>Slow</strong> — ~30% per level (25/50 → 30/65 → 40/85 …). Deep stacks
                stay deep; skill matters longest, and the event runs longest too.</p>
                <p>Want exact numbers instead? Turn on <strong>custom blind levels</strong> below
                and write the schedule yourself.</p>
              </div>
            )}
            <select className="input" value={structure} onChange={e => setStructure(e.target.value as 'turbo' | 'regular' | 'deep')}>
              <option value="turbo">Turbo</option>
              <option value="regular">Regular</option>
              <option value="deep">Slow</option>
            </select>
            <p className="field-hint">
              Every preset brings antes in from level 4 (about an eighth of the
              big blind, posted by every player). The custom editor has its own
              ante column.
            </p>
          </div>
          )}
        </div>
        <LateClockField value={lateClock} onChange={setLateClock} />
        <label className="check-row">
          <input type="checkbox" checked={customBlinds} onChange={e => setCustomBlinds(e.target.checked)} />
          <span>Custom blind levels (write the exact schedule yourself)</span>
        </label>
        {customBlinds && <BlindEditor levels={levels} onChange={setLevels} />}
        <div className="row">
          {!customBlinds && (
            <div className="field">
              <label>Minutes per level</label>
              <select
                className="input"
                value={levelMinutesCustom ? 'custom' : String(levelMinutes)}
                onChange={e => {
                  if (e.target.value === 'custom') { setLevelMinutesCustom(true); return; }
                  setLevelMinutesCustom(false);
                  setLevelMinutes(Number(e.target.value));
                }}
              >
                {[3, 5, 8, 10, 12, 15, 20].map(m => <option key={m} value={m}>{m} min</option>)}
                <option value="custom">Custom…</option>
              </select>
              {levelMinutesCustom && (
                <input className="input" type="number" min={1} max={60} value={levelMinutes}
                  onChange={e => setLevelMinutes(Math.max(1, Math.min(60, Math.floor(Number(e.target.value) || 1))))} />
              )}
            </div>
          )}
          <div className="field">
            <label>Max players</label>
            <select
              className="input"
              value={maxPlayersCustom ? 'custom' : String(maxPlayers)}
              onChange={e => {
                if (e.target.value === 'custom') { setMaxPlayersCustom(true); return; }
                setMaxPlayersCustom(false);
                setMaxPlayers(Number(e.target.value));
              }}
            >
              {[9, 18, 45, 90, 180, 300, 500, 1000].map(m => <option key={m} value={m}>{m}</option>)}
              <option value="custom">Custom…</option>
            </select>
            {maxPlayersCustom && (
              <input className="input" type="number" min={2} max={1000} value={maxPlayers}
                onChange={e => setMaxPlayers(Math.max(2, Math.min(1000, Math.floor(Number(e.target.value) || 2))))} />
            )}
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>Time limit per turn</label>
            <select
              className="input"
              value={actionCustom ? 'custom' : String(actionSeconds)}
              onChange={e => {
                if (e.target.value === 'custom') { setActionCustom(true); return; }
                setActionCustom(false);
                setActionSeconds(Number(e.target.value));
              }}
            >
              {[10, 15, 20, 30, 45, 60].map(s => <option key={s} value={s}>{s} seconds</option>)}
              <option value="custom">Custom…</option>
            </select>
            {actionCustom && (
              <input className="input" type="number" min={5} max={120} value={actionSeconds}
                onChange={e => setActionSeconds(Math.max(5, Math.min(120, Math.floor(Number(e.target.value) || 5))))} />
            )}
          </div>
          <div className="field">
            <label>Seats per table</label>
            <select className="input" value={seatsPerTable} onChange={e => setSeatsPerTable(Number(e.target.value))}>
              {[2, 3, 4, 5, 6, 7, 8, 9].map(s => <option key={s} value={s}>{s}-max</option>)}
            </select>
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Late registration</label>
            <select
              className="input"
              value={lateRegCustom ? 'custom' : String(lateRegMinutes)}
              onChange={e => {
                if (e.target.value === 'custom') { setLateRegCustom(true); return; }
                setLateRegCustom(false);
                setLateRegMinutes(Number(e.target.value));
              }}
            >
              <option value="0">None</option>
              {[5, 10, 15, 20, 30].map(m => <option key={m} value={m}>{m} minutes</option>)}
              <option value="custom">Custom…</option>
            </select>
          </div>
          {lateRegCustom && (
            <div className="field">
              <label>Custom (minutes)</label>
              <input
                className="input" type="number" min={1} max={240} value={lateRegMinutes}
                onChange={e => setLateRegMinutes(Math.max(0, Math.min(240, Math.floor(Number(e.target.value) || 0))))}
              />
            </div>
          )}
        </div>
        <div className="row">
          <div className="field">
            <label>Time to join a table</label>
            <input
              className="input" type="number" min={1} max={240} value={joinMinutes}
              onChange={e => setJoinMinutes(Math.max(1, Math.min(240, Math.floor(Number(e.target.value) || 1))))}
            />
            <div className="field-hint">
              Registering reserves a place; players press <strong>Join table</strong> to
              claim it. Minutes from the start before an unclaimed place is given up.
            </div>
          </div>
          <div className="field">
            <label>Opening bet cap</label>
            <div className="cap-row">
              <label className="cap-toggle">
                <input
                  type="checkbox" checked={betCapOn}
                  onChange={e => setBetCapOn(e.target.checked)}
                />
                <span>On</span>
              </label>
              <input
                className="input" type="number" min={1} max={240}
                value={betCapMinutes} disabled={!betCapOn}
                onChange={e => setBetCapMinutes(Math.max(1, Math.min(240, Math.floor(Number(e.target.value) || 1))))}
              />
            </div>
            <div className="field-hint">
              For this many minutes from the start, nobody may put more than
              half the chips behind them into one bet or raise. Calling is
              never capped, and blinds and antes are unaffected.
            </div>
          </div>
        </div>
        <div className="field">
          <label>Scheduled start (optional — starts automatically when the time comes)</label>
          <input className="input" type="datetime-local" value={scheduledStart}
            onChange={e => setScheduledStart(e.target.value)} />
        </div>
        <label className="check-row">
          <input type="checkbox" checked={approveRegistrations} onChange={e => setApproveRegistrations(e.target.checked)} />
          <span>Approve each registration (players wait in a queue until you accept them)</span>
        </label>
        <div className="field">
          <label>Show stacks and bets as</label>
          <select className="input" value={displayMode} onChange={e => setDisplayMode(e.target.value as 'chips' | 'bb')}>
            <option value="chips">Chip amounts</option>
            <option value="bb">Big blinds</option>
          </select>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={rabbitHunting} onChange={e => setRabbitHunting(e.target.checked)} />
          <span>Rabbit hunting (show the board that would have come when a hand ends early)</span>
        </label>
        <div className="field">
          <label>Prizes (shown to players and in the winner announcement)</label>
          <textarea
            className="input" rows={2} maxLength={500}
            placeholder="e.g. 1st: prop firm evaluation account · 2nd: ..."
            value={prizeText} onChange={e => setPrizeText(e.target.value)}
          />
        </div>
        <div className="row">
          <div className="field">
            <label>Re-entries</label>
            <select className="input" value={maxReentries} onChange={e => setMaxReentries(Number(e.target.value))}>
              <option value={0}>No</option>
              {[1, 2, 3, 5, 10].map(m => <option key={m} value={m}>Up to {m}</option>)}
            </select>
          </div>
        </div>

        <label className="check-row">
          <input type="checkbox" checked={showSocial} onChange={e => setShowSocial(e.target.checked)} />
          <span>Require social follows / Discord to register</span>
        </label>
        {showSocial && (
          <div className="social-config">
            <div className="field">
              <label>X (Twitter) profile to follow</label>
              <input className="input" placeholder="https://x.com/yourhandle" value={xUrl}
                onChange={e => setXUrl(e.target.value)} />
            </div>
            <div className="field">
              <label>Instagram profile to follow</label>
              <input className="input" placeholder="https://instagram.com/yourhandle" value={igUrl}
                onChange={e => setIgUrl(e.target.value)} />
            </div>
            <div className="field">
              <label>Discord invite link</label>
              <input className="input" placeholder="https://discord.gg/yourserver" value={discordInviteUrl}
                onChange={e => setDiscordInviteUrl(e.target.value)} />
            </div>
            <div className="row">
              <div className="field">
                <label>Discord server ID (for verification)</label>
                <input className="input" placeholder="e.g. 1093761234567890123" value={discordGuildId}
                  onChange={e => setDiscordGuildId(e.target.value)} />
              </div>
            </div>
            {roles ? (
              <div className="field">
                <label>Required role (optional)</label>
                <select
                  className="input"
                  value={discordRoleId}
                  onChange={e => {
                    const id = e.target.value;
                    setDiscordRoleId(id);
                    setDiscordRoleName(roles.find(r => r.id === id)?.name ?? '');
                  }}
                >
                  <option value="">No role required</option>
                  {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            ) : (
              <div className="row">
                <div className="field">
                  <label>Required role ID (optional)</label>
                  <input className="input" placeholder="role id from your server" value={discordRoleId}
                    onChange={e => setDiscordRoleId(e.target.value)} />
                </div>
                <div className="field">
                  <label>Role name (shown to players)</label>
                  <input className="input" placeholder="e.g. VIP" value={discordRoleName}
                    onChange={e => setDiscordRoleName(e.target.value)} />
                </div>
              </div>
            )}
            <label className="check-row">
              <input type="checkbox" checked={requireDiscord} onChange={e => setRequireDiscord(e.target.checked)} />
              <span>Players must connect their Discord account</span>
            </label>
            <div className="field">
              <label>
                Discord webhook URL {cfg?.discord.announceConfigured
                  ? '(optional — winners already announced via the bot)'
                  : '(announce winners)'}
              </label>
              <input className="input" placeholder="https://discord.com/api/webhooks/…" value={discordWebhookUrl}
                onChange={e => setDiscordWebhookUrl(e.target.value)} />
            </div>
            <p style={{ color: 'var(--text-faint)', fontSize: '0.78rem', lineHeight: 1.5 }}>
              Discord membership is verified automatically when Discord sign-in is configured.
              X / Instagram follows use a click-through checklist (their APIs don't allow follow checks).
            </p>
          </div>
        )}
        <ThemePicker value={theme} onChange={setTheme} />
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void create()}>
            {busy ? 'Creating…' : 'Create tournament'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CreateCashModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const { profile } = useAuth();
  const [name, setName] = useState('');
  const [blinds, setBlinds] = useState('5/10');
  const [customBlinds, setCustomBlinds] = useState(false);
  const [customSb, setCustomSb] = useState(5);
  const [customBb, setCustomBb] = useState(10);
  const [ante, setAnte] = useState(0);
  const [maxSeats, setMaxSeats] = useState(9);
  const [buyInBb, setBuyInBb] = useState(100); // starting stack, in big blinds
  // A cash game can run a rising schedule, written with the same editor the
  // tournament form uses. Off means the blinds stay where the host set them.
  const [risingBlinds, setRisingBlinds] = useState(false);
  const [levels, setLevels] = useState<LevelRow[]>([
    { sb: 5, bb: 10, ante: 0, minutes: 20 },
    { sb: 10, bb: 20, ante: 0, minutes: 0 },
  ]);
  const [displayMode, setDisplayMode] = useState<'chips' | 'bb'>('chips');
  const [actionSeconds, setActionSeconds] = useState(20);
  const [actionCustom, setActionCustom] = useState(false);
  // Cash tables have always supported a time bank server-side; only the
  // tournament form ever offered it, so every cash game silently ran with
  // none. Same options and the same wording as the tournament form.
  const [timebankSeconds, setTimebankSeconds] = useState(0);
  const [rabbitHunting, setRabbitHunting] = useState(false);
  const [theme, setTheme] = useState<TableTheme | null>(null);
  const [busy, setBusy] = useState(false);

  const BLIND_OPTS = ['1/2', '2/5', '5/10', '10/25', '25/50', '50/100', '100/200'];

  // What the table will actually be built with — the same arithmetic the
  // create call uses, so the form can show it rather than leaving the host to
  // work it out after the fact.
  const [sbNow, bbNow] = customBlinds ? [customSb, customBb] : blinds.split('/').map(Number);
  const minBuyNow = bbNow * Math.max(10, Math.round(buyInBb / 2));
  const maxBuyNow = bbNow * buyInBb * 2;
  // The server clamps an ante to the big blind and a big blind to at least the
  // small blind. It did that silently, so a table could come back with limits
  // nobody chose; the form now says so before anything is created.
  const blindsBackwards = customBlinds && customBb < customSb;
  const anteTooBig = ante > bbNow;
  // Tournaments bring antes in at about an eighth of the big blind, chip
  // rounded. A cash game that wants one has no reason to pick differently.
  const suggestedAnte = Math.max(1, niceChip(Math.round(bbNow / 8)));

  const create = async () => {
    if (!name.trim()) {
      toast('error', 'Give the table a name first.');
      return;
    }
    if (blindsBackwards) {
      toast('error', 'The big blind has to be at least the small blind.');
      return;
    }
    setBusy(true);
    try {
      // With a schedule the first level IS the opening blinds — otherwise the
      // table would deal one hand at the fixed pair before the clock caught up.
      const first = risingBlinds ? levels.find(l => !l.isBreak) : null;
      const [sb, bb] = first
        ? [first.sb, first.bb]
        : customBlinds
          ? [customSb, customBb]
          : blinds.split('/').map(Number);
      const { id } = await api.createTable({
        name: name.trim(),
        sb, bb, ante,
        // Buy-in range brackets the chosen starting stack.
        minBuy: bb * Math.max(10, Math.round(buyInBb / 2)),
        maxBuy: bb * Math.max(buyInBb, Math.round(buyInBb * 2)),
        maxSeats, actionSeconds, timebankSeconds, rabbitHunting, displayMode,
        customLevels: risingBlinds ? levels : undefined,
        theme: theme ?? undefined,
      });
      toast('success', 'Table created — share the link to invite players!');
      nav(`/table/${id}`);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not create table');
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>New cash table</h3>
        <div className="field">
          <label>Table name</label>
          <input className="input" placeholder="e.g. Friday Night Cash" value={name}
            maxLength={40} onChange={e => setName(e.target.value)} autoFocus required />
        </div>
        <div className="row">
          <div className="field">
            <label>Blinds</label>
            <select
              className="input"
              value={customBlinds ? 'custom' : blinds}
              onChange={e => {
                if (e.target.value === 'custom') { setCustomBlinds(true); return; }
                setCustomBlinds(false);
                setBlinds(e.target.value);
              }}
            >
              {BLIND_OPTS.map(b => <option key={b} value={b}>{b}</option>)}
              <option value="custom">Custom…</option>
            </select>
          </div>
          <div className="field">
            <label>Seats</label>
            <select className="input" value={maxSeats} onChange={e => setMaxSeats(Number(e.target.value))}>
              {[2, 6, 9].map(s => <option key={s} value={s}>{s}-max</option>)}
            </select>
          </div>
        </div>
        {customBlinds && (
          <>
            <div className="row">
              <div className="field">
                <label>Small blind</label>
                <input
                  className="input" type="number" min={1} value={customSb}
                  onChange={e => {
                    const sb = Math.max(1, Math.floor(Number(e.target.value) || 1));
                    setCustomSb(sb);
                    // The big blind follows the small one unless it has been
                    // moved off the standard double — otherwise every custom
                    // game starts by silently disagreeing with itself.
                    if (customBb === customSb * 2) setCustomBb(sb * 2);
                  }}
                />
              </div>
              <div className="field">
                <label>Big blind</label>
                <input className="input" type="number" min={1} value={customBb}
                  onChange={e => setCustomBb(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
              </div>
            </div>
            {blindsBackwards && (
              <p className="field-hint warn">
                The big blind is smaller than the small blind. Raise it to at
                least {customSb} — otherwise the table is built with both at {customSb}.
              </p>
            )}
          </>
        )}
        <div className="row">
          <div className="field">
            <label>Starting stack</label>
            <select className="input" value={buyInBb} onChange={e => setBuyInBb(Number(e.target.value))}>
              {[40, 60, 100, 150, 200, 300].map(b => <option key={b} value={b}>{b} BB</option>)}
            </select>
          </div>
          <div className="field">
            <label>Ante <span className="label-opt">optional</span></label>
            <input className="input" type="number" min={0} max={bbNow} value={ante} placeholder="0"
              onChange={e => setAnte(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Action time</label>
            <select
              className="input"
              value={actionCustom ? 'custom' : String(actionSeconds)}
              onChange={e => {
                if (e.target.value === 'custom') { setActionCustom(true); return; }
                setActionCustom(false);
                setActionSeconds(Number(e.target.value));
              }}
            >
              {[10, 15, 20, 30, 45, 60].map(sec => <option key={sec} value={sec}>{sec} seconds</option>)}
              <option value="custom">Custom…</option>
            </select>
            {actionCustom && (
              <input className="input" type="number" min={5} max={120} value={actionSeconds}
                onChange={e => setActionSeconds(Math.max(5, Math.min(120, Math.floor(Number(e.target.value) || 5))))} />
            )}
          </div>
          <div className="field">
            <label htmlFor="cash-timebank">Extra time bank <span className="hint-dot" title="Optional extra seconds a player may use once per decision, on top of the action time. 0 means the action time is exactly what they get.">?</span></label>
            <select id="cash-timebank" className="input" value={timebankSeconds}
              onChange={e => setTimebankSeconds(Number(e.target.value))}>
              <option value={0}>None — action time is final</option>
              {[5, 10, 15, 30, 60].map(v => <option key={v} value={v}>+{v} seconds</option>)}
            </select>
          </div>
        </div>
        <p className="field-hint">
          <strong>Ante</strong> = an extra chip everyone tosses into the pot before each deal,
          on top of the blinds. It makes pots bigger and punishes waiting for premium hands.
          Leave it at <strong>0</strong> for a normal game.{' '}
          {ante === 0
            ? <>Tournaments use about an eighth of the big blind — that would be{' '}
              <button type="button" className="link-btn" onClick={() => setAnte(suggestedAnte)}>
                {suggestedAnte}
              </button> here.</>
            : anteTooBig
              ? <span className="warn-text">An ante cannot exceed the big blind — this will be cut to {bbNow}.</span>
              : <>Every player posts {ante} before each deal, on top of the {sbNow}/{bbNow} blinds.</>}
        </p>
        <label className="check-row">
          <input type="checkbox" checked={risingBlinds} onChange={e => setRisingBlinds(e.target.checked)} />
          <span>Rising blinds (write the exact schedule yourself)</span>
        </label>
        {risingBlinds && (
          <>
            <BlindEditor levels={levels} onChange={setLevels} />
            <p className="field-hint">
              Blinds move between hands, never inside one. Leave the last row's
              minutes at <strong>0</strong> and that level plays for as long as
              the table is up.
            </p>
          </>
        )}
        <div className="field">
          <label>Show stacks and bets as</label>
          <select className="input" value={displayMode}
            onChange={e => setDisplayMode(e.target.value === 'bb' ? 'bb' : 'chips')}>
            <option value="chips">Chip amounts</option>
            <option value="bb">Big blinds</option>
          </select>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={rabbitHunting} onChange={e => setRabbitHunting(e.target.checked)} />
          <span>Rabbit hunting</span>
        </label>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
          Blinds {sbNow}/{bbNow}{ante > 0 && !anteTooBig ? ` with a ${ante} ante` : ''} — players buy in
          for {minBuyNow.toLocaleString()} to {maxBuyNow.toLocaleString()} chips
          ({Math.round(minBuyNow / bbNow)}–{Math.round(maxBuyNow / bbNow)} BB) and join with a shareable link.
        </p>
        <ThemePicker value={theme} onChange={setTheme} />
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void create()}>
            {busy ? 'Creating…' : 'Create table'}
          </button>
        </div>
      </div>
    </div>
  );
}
