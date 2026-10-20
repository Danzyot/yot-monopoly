import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ChatMsg, TournamentRecord, TournamentView } from '../../../shared/types';
import { useAuth } from '../auth';
import ArchivedResults from '../components/ArchivedResults';
import AuthModal from '../components/AuthModal';
import Avatar from '../components/Avatar';
import RequirementsModal from '../components/RequirementsModal';
import InlineEdit from '../components/InlineEdit';
import SettingsModal from '../components/SettingsModal';
import Promo from '../components/Promo';
import { PropStrip } from '../components/PropRail';
import BanDialog, { type BanTarget } from '../components/BanDialog';
import CopyId, { discordIdOf } from '../components/CopyId';
import { useFeatures } from '../features';
import DmDialog, { type DmTarget } from '../components/DmDialog';
import SeatPlayerPanel from '../components/SeatPlayerPanel';
import SidePanel from '../components/SidePanel';
import WinnerModal, { type WinnerInfo } from '../components/WinnerModal';
import {
  IconEye, IconGear, IconGift, IconLink, IconPause, IconPlay, IconTrophy, IconX,
} from '../components/icons';
import { api } from '../api';
import { chips, clock, ordinal } from '../format';
import { mergeChat } from '../chatlog';
import { getSocket, withResub } from '../socket';
import { useToast } from '../toast';


export default function TournamentPage() {
  const feat = useFeatures();
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { profile } = useAuth();
  const toast = useToast();
  const [pendingBan, setPendingBan] = useState<(BanTarget & { playerId: string }) | null>(null);
  const [dmTarget, setDmTarget] = useState<DmTarget | null>(null);
  const [view, setView] = useState<TournamentView | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [showAuth, setShowAuth] = useState(false);
  const [showReqs, setShowReqs] = useState(false);
  const [winner, setWinner] = useState<WinnerInfo | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [startDraft, setStartDraft] = useState('');
  const [now, setNow] = useState(Date.now());
  // An old link whose live game is gone still resolves — to the results.
  const [archived, setArchived] = useState<TournamentRecord | null>(null);
  const [lookedUp, setLookedUp] = useState(false);

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const sock = getSocket();
    const onState = (v: TournamentView) => { if (v.id === id) setView(v); };
    const onChat = (m: ChatMsg) => setChat(c => mergeChat(c, m));
    const onAssigned = (info: { tableId: string }) => {
      toast('info', 'You have been seated — taking you to your table.');
      nav(`/table/${info.tableId}`);
    };
    const onFinished = (p: WinnerInfo) => { if (p.tournamentId === id) setWinner(p); };
    sock.on('tourney:state', onState);
    sock.on('tourney:chat', onChat);
    sock.on('tourney:assigned', onAssigned);
    sock.on('tourney:finished', onFinished);
    const cleanup = withResub(() => sock.emit('tourney:sub', id));
    return () => {
      cleanup();
      sock.emit('tourney:unsub', id);
      sock.off('tourney:state', onState);
      sock.off('tourney:chat', onChat);
      sock.off('tourney:assigned', onAssigned);
      sock.off('tourney:finished', onFinished);
    };
  }, [id, profile?.id, nav, toast]);

  const sendChat = useCallback((text: string, replyTo?: string) => {
    getSocket().emit('tourney:chatSend', { id, text, replyTo });
  }, [id]);

  // If no live state arrives shortly, the tournament is finished and gone from
  // memory (a deploy, or simply days later) — fall back to its record.
  useEffect(() => {
    if (view) return;
    const timer = setTimeout(() => {
      api.tournamentResult(id)
        .then(r => setArchived(r.record))
        .catch(() => { /* genuinely unknown id */ })
        .finally(() => setLookedUp(true));
    }, 1200);
    return () => clearTimeout(timer);
  }, [id, view]);

  // The operator's extra standings columns. Fetched separately and only for
  // them: the standings broadcast reaches every player, and both the ids and
  // the shared-address flags are things the room must not see about itself.
  //
  // Up here with the other hooks, NOT beside the code that uses it. Below the
  // `if (!view)` return this is a hook that only runs on some renders, and
  // React counts hooks: the first render bails out at the loading state, the
  // next one reaches this line, the count changes and the whole page dies
  // with "rendered more hooks than during the previous render" — a blank
  // screen on every tournament, which is exactly what happened.
  //
  // It cannot ask `isHost` for the same reason: that is derived from `view`,
  // which is null on the first render. It compares the ids itself instead.
  const [identities, setIdentities] = useState<Map<string, { discordId: string | null; sharesWith: string[]; sharesDeviceWith: string[] }>>(new Map());
  const viewerHosts = !!profile?.id && !!view?.hostId && profile.id === view.hostId;
  useEffect(() => {
    if (!viewerHosts || !id) { setIdentities(new Map()); return; }
    let stale = false;
    const pull = () => {
      api.standingIdentities(id)
        .then(r => {
          if (stale) return;
          setIdentities(new Map(r.identities.map(x => [x.id, {
            discordId: x.discordId, sharesWith: x.sharesWith, sharesDeviceWith: x.sharesDeviceWith ?? [],
          }])));
        })
        .catch(() => {});
    };
    pull();
    // Late registrations and address changes arrive during an event, but this
    // walks every address on the site — a minute is often enough, and it stays
    // off the several-times-a-second broadcast path.
    const iv = setInterval(pull, 60_000);
    return () => { stale = true; clearInterval(iv); };
  }, [viewerHosts, id]);

  if (!view) {
    if (archived) return <ArchivedResults record={archived} />;
    if (lookedUp) {
      return (
        <main className="page">
          <div className="empty-note">
            No tournament here. The link may be mistyped, or the event was cancelled
            before it finished.
          </div>
        </main>
      );
    }
    return <main className="page"><div className="empty-note">Loading tournament…</div></main>;
  }

  // Where the viewer is, and the event's reference clock. Every player sees
  // the start in their own local time; New York is shown alongside because
  // that is the time the announcements are written in — unless the viewer is
  // already on it, when repeating it would just be noise.
  const NY_TZ = 'America/New_York';
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const fmtWhen = (ts: number, tz?: string) => new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: tz,
  }).format(ts);
  const untilText = (ms: number) => {
    if (ms <= 0) return 'any moment';
    const mTot = Math.floor(ms / 60_000);
    const d = Math.floor(mTot / 1_440);
    const h = Math.floor((mTot % 1_440) / 60);
    const m = mTot % 60;
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    const sec = Math.floor(ms / 1_000) % 60;
    return `${m}m ${String(sec).padStart(2, '0')}s`;
  };
  // What datetime-local wants: the timestamp written in the viewer's own zone.
  const toLocalInput = (ts: number) => {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const isHost = profile?.id === view.hostId;
  const emit = (ev: string) => getSocket().emit(ev, id);
  // Host can click any text (name, prizes) and edit it in place.
  const editable = isHost && view.state !== 'finished' && view.state !== 'cancelled';
  const patchSettings = (patch: Record<string, unknown>) =>
    getSocket().emit('tourney:settings', { id, ...patch });

  const register = () => {
    if (!profile) { setShowAuth(true); return; }
    if (view.social) { setShowReqs(true); return; }
    emit('tourney:register');
  };

  // Four ways to bar someone, from the screen that lists everyone in the
  // event — a player who is not at your table has to be reachable too.
  const confirmBan = async (reason: string, discordBan = false, alsoBan: string[] = [], includeMain = true) => {
    if (!pendingBan) return;
    const { playerId, name, kind, scope } = pendingBan;
    setPendingBan(null);
    try {
      const r = await api.ban({
        kind, scope,
        gameId: scope === 'game' ? id : null,
        ...(kind === 'ip' ? { playerId } : { value: playerId }),
        name, reason, discordBan, alsoBan, skipPrimary: !includeMain,
      });
      const base = !includeMain ? `${r.alsoBanned?.length ?? 0} alt${(r.alsoBanned?.length ?? 0) === 1 ? '' : 's'} of ${name} suspended${r.alsoBanned?.length ? `: ${r.alsoBanned.join(', ')}` : ''} — ${name} was not touched` : `${name} suspended ${scope === 'game' ? `from ${view.name}` : 'for life'}` + (r.alsoBanned?.length ? `, with ${r.alsoBanned.length} more account${r.alsoBanned.length === 1 ? '' : 's'}: ${r.alsoBanned.join(', ')}` : '');
      // A Discord ban that quietly did not happen is worse than one never
      // attempted — the operator would believe they were gone.
      const failed = !!r.discordNote && /NOT on Discord/.test(r.discordNote);
      toast(failed ? 'error' : 'success', r.discordNote ? `${base}. ${r.discordNote}` : base);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not ban');
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast('success', 'Tournament link copied — invite your players!');
    } catch {
      toast('info', window.location.href);
    }
  };

  const lvl = view.level;
  const stateLabel: Record<string, string> = {
    registering: 'Registration open',
    running: `Level ${lvl.level}`,
    break: 'On break',
    paused: 'Paused',
    finished: 'Finished',
    cancelled: 'Cancelled',
  };

  return (
    <main className="page">
      <div className="page-head">
        <h2>
          <IconTrophy size={22} />{' '}
          {editable ? (
            <InlineEdit value={view.name} maxLength={48} placeholder="Tournament name"
              onSave={n => { if (n) patchSettings({ name: n }); }} />
          ) : view.name}
        </h2>
        <span className={`state-badge state-${view.state}`}>{stateLabel[view.state]}</span>
        {/* Frozen once the event is over: a finished tournament has a
            duration, not a stopwatch still running. */}
        {view.startedAt && view.state !== 'registering' && (
          <span
            className="elapsed-pill"
            title={view.endedAt
              ? `Ran for ${clock(view.endedAt - view.startedAt)}`
              : 'Time since the tournament started'}
          >
            {clock((view.endedAt ?? now) - view.startedAt)} {view.endedAt ? 'total' : 'elapsed'}
          </span>
        )}
        <div className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={() => void copyLink()}><IconLink /> Invite players</button>
        {view.tables.length > 0 && (
          <Link className="btn btn-ghost btn-sm" to={`/t/${id}/tables`}><IconEye /> Watch all tables</Link>
        )}
        {isHost && view.state === 'registering' && (
          <button className="btn btn-primary btn-sm" disabled={view.playersRegistered < view.config.minPlayers}
            onClick={() => emit('tourney:start')}>
            <IconPlay /> Start now ({view.playersRegistered})
          </button>
        )}
        {isHost && (view.state === 'running' || view.state === 'break') && (
          <button className="btn btn-sm" onClick={() => emit('tourney:pause')}><IconPause /> Pause</button>
        )}
        {isHost && view.state === 'paused' && (
          <button className="btn btn-success btn-sm" onClick={() => emit('tourney:resume')}><IconPlay /> Resume</button>
        )}
        {isHost && view.state !== 'finished' && view.state !== 'cancelled' && (
          <button className="btn btn-sm" onClick={() => setShowSettings(true)}><IconGear /> Settings</button>
        )}
        {isHost && (view.state === 'running' || view.state === 'break' || view.state === 'paused') && (
          <button
            className="btn btn-sm"
            title="Finish immediately: current hand rolled back, final ranks by chip count, prizes awarded"
            onClick={() => {
              if (window.confirm('End the tournament NOW? The current hand is rolled back and final ranks are set by chip count.')) {
                emit('tourney:endNow');
              }
            }}
          >
            <IconTrophy size={13} /> End now
          </button>
        )}
        {isHost && view.state !== 'finished' && view.state !== 'cancelled' && (
          <button
            className="btn btn-danger btn-sm"
            onClick={() => {
              if (window.confirm('Cancel the tournament? No results or prizes — it just stops.')) {
                emit('tourney:cancel');
              }
            }}
          >
            Cancel
          </button>
        )}
      </div>

      {/* The start time, in front of everyone who is waiting for it: their
          own clock, the New York clock the announcements use, and how long is
          left. The host sets or moves it from right here. */}
      {view.state === 'registering' && (view.scheduledStart || isHost) && (
        <div className="start-banner">
          {view.scheduledStart ? (
            <div className="start-banner-times">
              <span className="start-cell">
                <span className="start-k">Starts in</span>
                <strong>{view.scheduledStart > now ? untilText(view.scheduledStart - now) : 'any moment'}</strong>
              </span>
              <span className="start-cell">
                <span className="start-k">Your time</span>
                <strong>{fmtWhen(view.scheduledStart)}</strong>
              </span>
              {viewerTz !== NY_TZ && (
                <span className="start-cell">
                  <span className="start-k">New York</span>
                  <strong>{fmtWhen(view.scheduledStart, NY_TZ)}</strong>
                </span>
              )}
            </div>
          ) : (
            <div className="start-banner-times">
              <span className="start-cell">
                <span className="start-k">Start time</span>
                <strong>not set — starts when you press Start</strong>
              </span>
            </div>
          )}
          {isHost && (
            <div className="start-edit">
              <input
                className="input" type="datetime-local"
                value={startDraft || (view.scheduledStart ? toLocalInput(view.scheduledStart) : '')}
                onChange={e => setStartDraft(e.target.value)}
              />
              <button
                className="btn btn-sm"
                onClick={() => {
                  const raw = startDraft || (view.scheduledStart ? toLocalInput(view.scheduledStart) : '');
                  const ts = new Date(raw).getTime();
                  if (!raw || !Number.isFinite(ts)) { toast('error', 'Pick a date and time first.'); return; }
                  if (ts < Date.now() + 60_000) { toast('error', 'Pick a time at least a minute away.'); return; }
                  patchSettings({ scheduledStart: ts });
                  setStartDraft('');
                }}
              >
                Set start time
              </button>
              {view.scheduledStart && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => { patchSettings({ scheduledStart: null }); setStartDraft(''); }}
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* status banner */}
      {view.myStatus === 'none' && view.lateRegOpen && (
        <div className="big-status">
          {view.state === 'registering'
            ? <>
              Registration is open — <strong>{view.playersRegistered}</strong> players in.
            </>
            : <>Late registration closes in <strong>{view.lateRegEndsAt ? clock(view.lateRegEndsAt - now) : '--:--'}</strong>.</>}
          {view.social && (
            <div className="req-summary">
              Requirements:
              {view.social.xUrl && <span className="req-pill">Follow on X</span>}
              {view.social.igUrl && <span className="req-pill">Follow on Instagram</span>}
              {view.social.discordInviteUrl && <span className="req-pill">Join Discord</span>}
              {view.social.requireDiscord && <span className="req-pill">Verify Discord</span>}
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary btn-lg" onClick={register}>Register now</button>
          </div>
        </div>
      )}
      {view.myStatus === 'pending' && (
        <div className="big-status">
          Registration received — waiting for the host to approve you.
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => emit('tourney:unregister')}>Withdraw</button>
          </div>
        </div>
      )}
      {view.myStatus === 'registered' && view.state === 'registering' && (
        <div className="big-status">
          You're in! Waiting for the host to start… <strong>{view.playersRegistered}</strong> registered.
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => emit('tourney:unregister')}>Unregister</button>
          </div>
        </div>
      )}
      {/* Registered, in the field, no chips in front of them yet. Pressing
          this is what seats them — being away when the clock started used to
          mean being blinded off and told you had already finished. */}
      {view.myStatus === 'seating' && (
        <div className="big-status">
          You're in the field — take your seat to start playing.
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary btn-lg" onClick={() => emit('tourney:join')}>
              Join table →
            </button>
            <div style={{ color: 'var(--text-faint)', fontSize: '0.82rem', marginTop: 6 }}>
              {/* The server freezes this clock during a pause, but the page
                  only learns the new deadline on the next broadcast — so a
                  countdown computed against local time would appear to keep
                  draining. Saying "stopped" is both accurate and calmer. */}
              {view.state === 'paused'
                ? 'Your seat is held — the clock is stopped while the game is paused'
                : view.joinEndsAt
                  ? `Your seat is held for ${clock(view.joinEndsAt - now)}`
                  : 'Your seat is being held for you'}
            </div>
          </div>
        </div>
      )}
      {view.myStatus === 'playing' && view.myTableId && (
        <div className="big-status">
          You're in the field — <strong>{view.playersAlive}</strong> players left.
          <div style={{ marginTop: 12 }}>
            <Link className="btn btn-primary btn-lg" to={`/table/${view.myTableId}`}>Go to my table →</Link>
          </div>
        </div>
      )}
      {view.myStatus === 'busted' && (
        <div className="big-status">
          You finished <strong>{ordinal(view.standings.find(s => s.id === profile?.id)?.place ?? 0)}</strong> of {view.playersRegistered}.
          {view.myCanReenter && (
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-primary btn-lg" onClick={() => emit('tourney:reenter')}>
                Re-enter
              </button>
              <div style={{ color: 'var(--text-faint)', fontSize: '0.82rem', marginTop: 6 }}>
                Re-entries close in {view.lateRegEndsAt ? clock(view.lateRegEndsAt - now) : '--:--'} · you've used {view.myEntries - 1} of {view.config.maxReentries}
              </div>
            </div>
          )}
        </div>
      )}
      {view.myStatus === 'winner' && (
        <div className="big-status">
          <strong>Champion!</strong> You won the tournament!
          {view.config.prizeText && <> The host will contact you about: <strong>{view.config.prizeText}</strong></>}
        </div>
      )}

      {view.state === 'finished' && (() => {
        const podium = view.standings
          .filter(s => s.place !== null && s.place <= 3)
          .sort((a, b) => (a.place ?? 9) - (b.place ?? 9));
        if (podium.length === 0) return null;
        const order = [podium[1], podium[0], podium[2]].filter(Boolean); // 2nd, 1st, 3rd
        const clsFor = (p: typeof podium[number]) =>
          p.place === 1 ? 'first' : p.place === 2 ? 'second' : 'third';
        return (
          <div className="panel" style={{ marginBottom: 18 }}>
            <h3>Final Results</h3>
            <div className="podium">
              {order.map(p => (
                <div key={p.id} className={`podium-col ${clsFor(p)}`}>
                  <span className="p-avatar"><Avatar value={p.avatar} size={36} chog={p.chog} /></span>
                  <span className="p-name">{p.name}</span>
                  {p.discordTag && (
                    <span className={`discord-badge${p.discordVerified ? ' verified' : ''}`}>
                      {p.discordVerified ? '✓ ' : ''}@{p.discordTag}
                    </span>
                  )}
                  <div className="p-block">{p.place}</div>
                </div>
              ))}
            </div>
            {view.hasWebhook && (
              <p style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: '0.82rem', marginTop: 10 }}>
                Results were announced to Discord with verified identities.
              </p>
            )}
          </div>
        );
      })()}

      <div className="tourney-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="panel">
            <h3>Tournament info</h3>
            <div className="info-grid">
              <div className="info-cell"><span className="k">Players</span><span className="v">{view.playersAlive}/{view.playersRegistered}</span></div>
              {view.config.maxReentries > 0 && (
                <div className="info-cell"><span className="k">Entries</span><span className="v">{view.totalEntries}</span></div>
              )}
              <div className="info-cell"><span className="k">Starting stack</span><span className="v">{chips(view.config.startingStack)}</span></div>
              <div className="info-cell"><span className="k">Structure</span><span className="v" style={{ textTransform: 'capitalize' }}>{view.config.structure} · {view.config.levelMinutes}m</span></div>
              <div className="info-cell"><span className="k">Host</span><span className="v">{view.hostName}</span></div>
            </div>
          </div>

          {isHost && view.pending.length > 0 && (
            <div className="panel pending-panel">
              <h3>
                Waiting for approval ({view.pending.length})
                <button className="btn btn-success btn-sm" style={{ marginLeft: 'auto' }}
                  onClick={() => getSocket().emit('tourney:approveAll', id)}>
                  Approve all
                </button>
              </h3>
              <div className="pending-list">
                {view.pending.map(p => (
                  <div key={p.id} className="pending-row">
                    <Avatar value={p.avatar} size={20} />
                    <span className="pending-name">{p.name}</span>
                    <button className="btn btn-success btn-sm"
                      onClick={() => getSocket().emit('tourney:approve', { id, playerId: p.id })}>
                      Approve
                    </button>
                    <button className="btn btn-danger btn-sm"
                      onClick={() => getSocket().emit('tourney:kick', { id, playerId: p.id })}>
                      <IconX size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isHost && (view.state === 'running' || view.state === 'break' || view.state === 'paused') && (
            <SeatPlayerPanel tournamentId={id} startingStack={view.config.startingStack} />
          )}

          <div className="panel">
            <h3>{view.state === 'registering' ? `Players (${view.playersRegistered})` : 'Live standings'}</h3>
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {(() => {
                const canKick = isHost && view.state !== 'finished' && view.state !== 'cancelled';
                return (
              <table className="standings-table">
                <thead>
                  <tr>
                    <th>#</th><th>Player</th><th>Stack</th>
                    {isHost && <th>Id</th>}
                    {isHost && <th title="Shares an address with another player in this event">Shared</th>}
                    {canKick && <th />}
                  </tr>
                </thead>
                <tbody>
                  {view.standings.map(s => (
                    <tr key={s.id} className={`${s.id === profile?.id ? 'me' : ''} ${s.busted ? 'busted' : ''}`}>
                      <td className="rank">{s.busted && s.place ? ordinal(s.place) : s.rank}</td>
                      <td>
                        <Avatar value={s.avatar} size={16} chog={s.chog} /> {s.name}
                        {s.discordTag && (
                          <span
                            className={`discord-badge${s.discordVerified ? ' verified' : ''}`}
                            title={s.discordVerified
                              ? `Discord verified server member: @${s.discordTag}`
                              : `Discord linked: @${s.discordTag}`}
                          >
                            {s.discordVerified ? '✓' : '◦'} {s.discordTag}
                          </span>
                        )}
                      </td>
                      {isHost && (
                        <td className="ident-cell">
                          <CopyId value={s.id} label={(identities.get(s.id)?.discordId) ?? s.id} title="Click to copy" />
                        </td>
                      )}
                      {isHost && (
                        <td className="ident-cell">
                          {/* Same browser first, in red: that is one phone holding two
                              accounts, where a shared address may only be a household. */}
                          {(identities.get(s.id)?.sharesDeviceWith.length ?? 0) > 0 && (
                            <span
                              className="device-flag"
                              title={`Signed in from the same browser as ${identities.get(s.id)!.sharesDeviceWith.join(', ')}`}
                            >
                              📱 {identities.get(s.id)!.sharesDeviceWith.length}
                            </span>
                          )}
                          {(identities.get(s.id)?.sharesWith.length ?? 0) > 0 && (
                            <span
                              className="shared-flag"
                              style={(identities.get(s.id)?.sharesDeviceWith.length ?? 0) > 0 ? { marginLeft: 4 } : undefined}
                              title={`Shares an address with ${identities.get(s.id)!.sharesWith.join(', ')}`}
                            >
                              ⚠ {identities.get(s.id)!.sharesWith.length}
                            </span>
                          )}
                          {(identities.get(s.id)?.sharesWith.length ?? 0) === 0
                            && (identities.get(s.id)?.sharesDeviceWith.length ?? 0) === 0
                            && <span className="ident-none">—</span>}
                        </td>
                      )}
                      <td>
                        {s.busted ? '—' : chips(s.stack)}
                        {!s.busted && s.seated === false && view.state !== 'registering' && (
                          <span className="alt-reason" style={{ marginLeft: 6 }}>not seated</span>
                        )}
                      </td>
                      {canKick && (
                        <td className="kick-cell">
                          {!s.busted && s.id !== profile?.id && (
                            <button
                              className="btn btn-danger btn-sm" title={`Remove ${s.name}`}
                              onClick={() => {
                                if (window.confirm(`Remove ${s.name} from the tournament?`)) {
                                  getSocket().emit('tourney:kick', { id, playerId: s.id });
                                }
                              }}
                            ><IconX size={13} /></button>
                          )}
                          {/* Putting one player back after they were removed
                              for something that was not their doing. Not
                              re-entry: no entry is bought and the prize pool
                              does not move. */}
                          {s.busted && view.state !== 'finished' && view.state !== 'cancelled' && (
                            <button
                              className="btn btn-sm" title={`Put ${s.name} back in the tournament`}
                              onClick={() => {
                                const owed = s.lastStack ?? view.config.startingStack;
                                const raw = window.prompt(
                                  `Put ${s.name} back in with how many chips?\n\n`
                                  + `They had ${owed.toLocaleString()} when they were removed. `
                                  + `This does not cost them an entry and does not change the prize pool.`,
                                  String(owed),
                                );
                                if (raw === null) return;
                                const stack = Math.floor(Number(raw));
                                if (!Number.isFinite(stack) || stack < 1) {
                                  toast('error', 'Give a chip count above zero.');
                                  return;
                                }
                                getSocket().emit('tourney:reinstate', { id, playerId: s.id, stack });
                                toast('success', `${s.name} is back in with ${stack.toLocaleString()}.`);
                              }}
                            >Put back</button>
                          )}
                          {profile?.isAdmin && s.place !== null && (
                            <button
                              className="btn btn-sm" title={`DM ${s.name}`}
                              onClick={() => setDmTarget({
                                playerId: s.id, name: s.name, place: s.place,
                                tournamentName: view.name,
                                prizeText: view.config.prizeText,
                              })}
                            >DM</button>
                          )}
                          {profile?.isAdmin && s.id !== profile?.id && (
                            <select
                              className="ban-pick"
                              value=""
                              title={`Ban ${s.name}`}
                              onChange={e => {
                                const v = e.target.value;
                                e.target.value = '';
                                if (!v) return;
                                const [kind, scope] = v.split('-') as
                                  ['player' | 'ip', 'game' | 'lifetime'];
                                setPendingBan({
                                  playerId: s.id, name: s.name, kind, scope,
                                  discordLinked: !!identities.get(s.id)?.discordId || !!discordIdOf(s.id) || undefined,
                                });
                              }}
                            >
                              <option value="">Ban…</option>
                              <option value="player-game">From this tournament</option>
                              <option value="ip-game">IP, from this tournament</option>
                              <option value="player-lifetime">Lifetime</option>
                              <option value="ip-lifetime">Lifetime IP</option>
                            </select>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {view.standings.length === 0 && (
                    <tr><td colSpan={canKick ? 4 : 3} style={{ color: 'var(--text-faint)' }}>No players registered yet.</td></tr>
                  )}
                </tbody>
              </table>
                );
              })()}
            </div>
          </div>

          {view.tables.length > 0 && (
            <div className="panel">
              <h3>
                Tables
                <Link className="btn btn-sm" style={{ marginLeft: 'auto' }} to={`/t/${id}/tables`}>
                  <IconEye size={14} /> Watch all
                </Link>
              </h3>
              <div className="table-links">
                {view.tables.map(t => (
                  <div key={t.id} className="table-link-row">
                    <span>{t.name} · {t.players} players</span>
                    <Link className="btn btn-sm" to={`/table/${t.id}`}>Watch</Link>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {(view.state === 'running' || view.state === 'break' || view.state === 'paused') && (
            <div className="blind-clock">
              <span className="lvl">
                {view.state === 'break' ? 'Break' : `Level ${lvl.level} — ${lvl.sb}/${lvl.bb}${lvl.ante ? ` (${lvl.ante})` : ''}`}
              </span>
              <span className="time">
                {view.state === 'paused' ? 'Paused' : view.levelEndsAt ? clock(view.levelEndsAt - now) : '--:--'}
              </span>
              {view.nextLevel && (
                <span className="next">
                  Next: {view.nextLevel.sb}/{view.nextLevel.bb}{view.nextLevel.ante ? ` (${view.nextLevel.ante})` : ''}
                </span>
              )}
            </div>
          )}

          {(view.config.prizeText || editable) && (
            <div className="panel prize-panel">
              <h3><IconGift size={17} /> Prizes</h3>
              {(() => {
                const lines = (view.config.prizeText ?? '')
                  .split(/[·\n]/).map(s => s.trim()).filter(Boolean);
                const rendered = lines.length > 0 ? (
                  <div className="prize-lines">
                    {lines.map((line, i) => (
                      <div key={i} className="prize-line">
                        <span className="prize-rank">{/^\d+(st|nd|rd|th)/i.test(line) ? line.split(':')[0] : '•'}</span>
                        <span className="prize-what">
                          {/^\d+(st|nd|rd|th)/i.test(line) ? line.split(':').slice(1).join(':').trim() : line}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null;
                if (!editable) return rendered;
                return (
                  <InlineEdit
                    block multiline maxLength={500}
                    value={view.config.prizeText ?? ''}
                    placeholder="Click to add prizes — one per line, e.g. 1st: prop firm evaluation account"
                    display={rendered ?? undefined}
                    onSave={t => patchSettings({ prizeText: t || null })}
                  />
                );
              })()}
            </div>
          )}

          {/* Sits with the prizes, where people are already reading about
              what they can win — not over the felt during a hand. */}
          <Promo variant="card" />
          <PropStrip />

          {/* Height is fixed in CSS, not inline: the chat must be a window
              onto the conversation, never a block that grows with it. */}
          <div className="panel hub-chat">
            <SidePanel
              showChat={feat.chat}
              chat={chat} log={[]} onSend={sendChat} showLog={false}
              meId={profile?.id ?? null}
              people={view.standings.map(p => ({ id: p.id, name: p.name }))}
            />
          </div>
        </div>
      </div>

      {dmTarget && <DmDialog target={dmTarget} onClose={() => setDmTarget(null)} />}
      {pendingBan && (
        <BanDialog
          target={pendingBan}
          onConfirm={(r, d, _bp, alts, main) => void confirmBan(r, d, alts, main)}
          onCancel={() => setPendingBan(null)}
        />
      )}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      {showReqs && view.social && <RequirementsModal view={view} onClose={() => setShowReqs(false)} />}
      {showSettings && <SettingsModal view={view} onClose={() => setShowSettings(false)} />}
      {winner && (
        <WinnerModal
          info={winner}
          myPlace={view.standings.find(s => s.id === profile?.id)?.place ?? null}
          onClose={() => setWinner(null)}
        />
      )}
    </main>
  );
}
