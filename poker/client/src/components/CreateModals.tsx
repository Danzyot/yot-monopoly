import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type AppConfig } from '../api';
import { useAuth } from '../auth';
import { useToast } from '../toast';
import BlindEditor, { type LevelRow } from './BlindEditor';
import ThemePicker from './ThemePicker';
import type { TableTheme } from '../../../shared/types';
import { BRAND } from '../../../shared/brand';
import { MAX_PLAYER_CAP, PLAYER_HOST_LIMITS as LIMITS } from '../../../shared/hosting';
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
  // A Chog holder or approved player rather than an operator: a bounded
  // length, an open field, and none of the operator-only parts (the server
  // clamps the same way; this just never offers what it would refuse).
  const playerHost = !profile?.isAdmin;
  const [name, setName] = useState('');
  const [startingStack, setStartingStack] = useState(10000);
  const [stackCustom, setStackCustom] = useState(false);
  const [levelMinutes, setLevelMinutes] = useState(5);
  const [levelMinutesCustom, setLevelMinutesCustom] = useState(false);
  const [structure, setStructure] = useState<'turbo' | 'regular' | 'deep'>('regular');
  // No limit unless an operator sets one; a player host's event is always open.
  const [maxPlayers, setMaxPlayers] = useState<number | null>(null);
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
      if (playerHost && scheduledStart && new Date(scheduledStart).getTime() > Date.now() + LIMITS.scheduleAheadMs) {
        toast('error', 'Pick a start time within the next 7 days.');
        setBusy(false);
        return;
      }
      const { id } = await api.createTournament({
        name: name.trim(), startingStack, levelMinutes, structure,
        maxPlayers: playerHost ? null : maxPlayers, prizeText, lateRegMinutes, joinMinutes, approveRegistrations,
        betCapMinutes: betCapOn ? betCapMinutes : null,
        lateClock: lateClockValue(lateClock),
        breakEveryLevels, maxReentries, minPlayers: 2, seatsPerTable,
        rabbitHunting, displayMode, actionSeconds, timebankSeconds,
        theme: theme ?? undefined,
        scheduledStart: scheduledStart ? new Date(scheduledStart).getTime() : undefined,
        customLevels: customBlinds && !playerHost
          ? levels.map(r => ({ sb: r.sb, bb: r.bb, ante: 0, minutes: r.minutes, isBreak: !!r.isBreak }))
          : undefined,
        social: showSocial && !playerHost
          ? { xUrl, igUrl, discordInviteUrl, discordGuildId, discordRoleId, discordRoleName, requireDiscord }
          : undefined,
        discordWebhookUrl: showSocial && !playerHost ? discordWebhookUrl : undefined,
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
        {playerHost && (
          <p className="host-disclaimer">
            You are hosting as a player: open to everyone, levels up to {LIMITS.levelMinutes} minutes,
            one tournament at a time. You can start, pause and cancel it and write the prizes; an operator handles
            removing players. <strong>Any prizes are yours to hand out — {BRAND.hub} does not hold or pay them.</strong>
          </p>
        )}
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
              {[5000, 10000, 20000, 30000, 50000, 100000].filter(v => !playerHost || v <= LIMITS.startingStack).map(v => (
                <option key={v} value={v}>{v.toLocaleString('en-US')}</option>
              ))}
              <option value="custom">Custom…</option>
            </select>
            {stackCustom && (
              <input className="input" type="number" min={100} max={playerHost ? LIMITS.startingStack : 100000000} value={startingStack}
                onChange={e => setStartingStack(Math.max(100, Math.min(playerHost ? LIMITS.startingStack : 100000000, Math.floor(Number(e.target.value) || 0))))} />
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
                {!playerHost && (
                  <p>Want exact numbers instead? Turn on <strong>custom blind levels</strong> below
                  and write the schedule yourself.</p>
                )}
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
        {!playerHost && (
          <label className="check-row">
            <input type="checkbox" checked={customBlinds} onChange={e => setCustomBlinds(e.target.checked)} />
            <span>Custom blind levels (write the exact schedule yourself)</span>
          </label>
        )}
        {customBlinds && !playerHost && <BlindEditor levels={levels} onChange={setLevels} />}
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
                <input className="input" type="number" min={1} max={playerHost ? LIMITS.levelMinutes : 60} value={levelMinutes}
                  onChange={e => setLevelMinutes(Math.max(1, Math.min(playerHost ? LIMITS.levelMinutes : 60, Math.floor(Number(e.target.value) || 1))))} />
              )}
            </div>
          )}
          {/* Only an operator caps the field; empty means everyone may register. */}
          {!playerHost && (
            <div className="field">
              <label>Max players</label>
              <select
                className="input"
                value={maxPlayersCustom ? 'custom' : String(maxPlayers ?? '')}
                onChange={e => {
                  if (e.target.value === 'custom') { setMaxPlayersCustom(true); setMaxPlayers(m => m ?? 100); return; }
                  setMaxPlayersCustom(false);
                  setMaxPlayers(e.target.value ? Number(e.target.value) : null);
                }}
              >
                <option value="">No limit</option>
                {[9, 18, 45, 90, 180, 300, 500, MAX_PLAYER_CAP].map(m => <option key={m} value={m}>{m}</option>)}
                <option value="custom">Custom…</option>
              </select>
              {maxPlayersCustom && (
                <input className="input" type="number" min={2} max={MAX_PLAYER_CAP} value={maxPlayers ?? ''} placeholder="No limit"
                  onChange={e => {
                    const n = Math.floor(Number(e.target.value));
                    setMaxPlayers(e.target.value === '' || !n ? null : Math.max(2, Math.min(MAX_PLAYER_CAP, n)));
                  }} />
              )}
            </div>
          )}
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
                className="input" type="number" min={1} max={playerHost ? LIMITS.lateRegMinutes : 240} value={lateRegMinutes}
                onChange={e => setLateRegMinutes(Math.max(0, Math.min(playerHost ? LIMITS.lateRegMinutes : 240, Math.floor(Number(e.target.value) || 0))))}
              />
            </div>
          )}
        </div>
        <div className="row">
          <div className="field">
            <label>Time to join a table</label>
            <input
              className="input" type="number" min={1} max={playerHost ? LIMITS.joinMinutes : 240} value={joinMinutes}
              onChange={e => setJoinMinutes(Math.max(1, Math.min(playerHost ? LIMITS.joinMinutes : 240, Math.floor(Number(e.target.value) || 1))))}
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
                className="input" type="number" min={1} max={playerHost ? LIMITS.betCapMinutes : 240}
                value={betCapMinutes} disabled={!betCapOn}
                onChange={e => setBetCapMinutes(Math.max(1, Math.min(playerHost ? LIMITS.betCapMinutes : 240, Math.floor(Number(e.target.value) || 1))))}
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
          <label>Scheduled start (optional — starts automatically when the time comes{playerHost ? '; within 7 days' : ''})</label>
          <input className="input" type="datetime-local" value={scheduledStart}
            onChange={e => setScheduledStart(e.target.value)} />
        </div>
        {!playerHost && (
          <label className="check-row">
            <input type="checkbox" checked={approveRegistrations} onChange={e => setApproveRegistrations(e.target.checked)} />
            <span>Approve each registration (players wait in a queue until you accept them)</span>
          </label>
        )}
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
          <label>{playerHost
            ? `Prizes (shown to players; you hand them out, not ${BRAND.hub})`
            : 'Prizes (shown to players and in the winner announcement)'}</label>
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
              {[1, 2, 3, 5, 10].filter(m => !playerHost || m <= LIMITS.maxReentries).map(m => <option key={m} value={m}>Up to {m}</option>)}
            </select>
          </div>
        </div>

        {/* Entry requirements and Discord announcements are an operator's. */}
        {!playerHost && (
          <label className="check-row">
            <input type="checkbox" checked={showSocial} onChange={e => setShowSocial(e.target.checked)} />
            <span>Require social follows / Discord to register</span>
          </label>
        )}
        {showSocial && !playerHost && (
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
