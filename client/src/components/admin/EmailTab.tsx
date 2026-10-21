// Dashboard → Email (server/src/routes/email.ts): whether sending is set up,
// who would get each topic, the queue and recent sends (player ids, never
// addresses), a test email, the subscriber export, the template previews, and
// an announcement with a preview and a confirm step.
import { useState } from 'react';
import { getToken } from '../../api.ts';
import { toast, toastError } from '../../toast.tsx';
import { askConfirm } from '../Modal.tsx';
import { RelTime, Refresh } from './bits.tsx';
import { act, post, usePoll } from './adminApi.ts';
import { EMAIL_TOPICS, topicInfo, type AnnouncementPreview, type EmailAdminOverview, type EmailLogRow } from '../../../../shared/email.ts';

const SAMPLES: [string, string][] = [
  ['tournament', 'Tournament reminder'],
  ['streak', 'Streak reminder'],
  ['invite', 'Friend invite'],
  ['digest', 'Weekly digest'],
  ['announcement', 'Announcement'],
  ['test', 'Test email'],
];

const STATUS: Record<EmailLogRow['status'], [string, string]> = {
  sent: ['✅', 'Sent'],
  failed: ['⚠️', 'Failed'],
  'not-configured': ['⚪', 'Not configured'],
  dropped: ['🚫', 'Dropped'],
  retrying: ['⏳', 'Retrying'],
};

/** A GET with the session that answers something other than JSON (HTML, CSV). */
async function fetchText(path: string): Promise<{ text: string; type: string }> {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
  const text = await res.text();
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = (JSON.parse(text) as { error?: string }).error ?? msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return { text, type: res.headers.get('content-type') ?? '' };
}

export default function EmailTab() {
  const { data: o, reload, at, loading } = usePoll<EmailAdminOverview>('/api/admin/email', 15_000);
  const [testTo, setTestTo] = useState('');
  const [sample, setSample] = useState<string | null>(null);
  const [sampleHtml, setSampleHtml] = useState('');

  const showSample = (kind: string) => {
    setSample(kind);
    setSampleHtml('');
    fetchText(`/api/admin/email/sample/${kind}`).then(r => setSampleHtml(r.text)).catch(toastError);
  };

  const exportCsv = async () => {
    const ok = await askConfirm({
      title: 'Export the subscriber list?',
      body: 'A CSV with every subscriber\'s email address, name and topics. The export is written to the operator log. Keep the file private and delete it when you are done.',
      confirm: 'Download CSV',
    });
    if (!ok) return;
    try {
      const { text } = await fetchText('/api/admin/email/export.csv');
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `email-subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Export downloaded');
    } catch (e) { toastError(e); }
  };

  return (
    <div className="adm-stack">
      <div className="row wrap between">
        <h2 className="adm-h2">Email</h2>
        <Refresh at={at} every={15_000} loading={loading} />
      </div>

      {o && (o.configured ? (
        <div className="adm-alert good" role="status">
          <span aria-hidden>✅</span>
          <div><b>Sending is on</b> through Resend, from <code>{o.from}</code>. Links point at <code>{o.publicUrl}</code>.
            <div className="small muted">{o.webhook ? 'Bounce and spam-report webhook: on.' : 'Bounce and spam-report webhook: off (optional: set RESEND_WEBHOOK_SECRET).'}</div>
          </div>
        </div>
      ) : (
        <div className="adm-alert warn" role="alert">
          <span aria-hidden>⚠️</span>
          <div><b>Sending is not configured.</b> Set <code>RESEND_API_KEY</code> and <code>EMAIL_FROM</code> on the hub
            (docs/CHOGGAMES-DEPLOY.md, “Email”). Until then nothing is sent: each email is logged as “not configured”, and
            players can still choose their topics.</div>
        </div>
      ))}

      {o && (
        <div className="adm-stats">
          <div className="adm-stat"><span className="adm-stat-label">Addresses on file</span><b>{o.withEmail}</b><span className="muted small">{o.verified} verified by Discord</span></div>
          {EMAIL_TOPICS.map(t => (
            <div key={t.id} className="adm-stat" title={t.help}>
              <span className="adm-stat-label">{t.label}</span><b>{o.topics[t.id]}</b>
              <span className="muted small">{t.defaultOn ? 'on by default' : 'opted in'}</span>
            </div>
          ))}
          <div className="adm-stat"><span className="adm-stat-label">Sent today</span><b>{o.queue.sentToday}</b><span className="muted small">{o.queue.pending} waiting · {o.queue.failedToday} failed</span></div>
          <div className="adm-stat"><span className="adm-stat-label">Stopped</span><b>{o.suppressed}</b><span className="muted small">bounced or reported as spam</span></div>
        </div>
      )}
      {o && <p className="muted small">At most {o.limits.perUserPerDay} emails per player per day and {o.limits.perSecond} a second. Only Discord-verified addresses get mail, and only for topics the player turned on.</p>}

      <div className="adm-grid">
        <form className="adm-card adm-stack" onSubmit={e => {
          e.preventDefault();
          void act(async () => {
            const r = await post('/api/admin/email/test', testTo.trim() ? { to: testTo.trim() } : {}) as { configured: boolean };
            if (!r.configured) toast('Queued, but sending is not configured: it will show as "not configured" below.');
          }, { ok: 'Test email queued', after: () => setTimeout(() => void reload(), 1500) });
        }}>
          <h3>Send a test email</h3>
          <p className="muted small">Goes to the address on your own account (from Discord sign-in), or to one you type.</p>
          <input type="email" value={testTo} aria-label="Send to" placeholder="Your own address (leave blank)" onChange={e => setTestTo(e.target.value)} />
          <div><button className="btn small primary">Send test</button></div>
        </form>

        <section className="adm-card adm-stack">
          <h3>Subscribers</h3>
          <p className="muted small">Email, name and topics of everyone with a verified address and at least one topic on. Operators only; every export is logged.</p>
          <div><button type="button" className="btn small" onClick={() => void exportCsv()}>Export CSV</button></div>
        </section>
      </div>

      <Announcement recipients={o?.topics.announcements ?? 0} after={() => void reload()} />

      <section className="adm-card adm-stack">
        <h3>Templates</h3>
        <p className="muted small">Each email with sample data, as players see it.</p>
        <div className="row wrap">
          {SAMPLES.map(([k, label]) => (
            <button key={k} type="button" className={`btn tiny ${sample === k ? 'primary' : ''}`} onClick={() => showSample(k)}>{label}</button>
          ))}
        </div>
        {sample && (sampleHtml
          ? <iframe className="adm-email-frame" title={`${sample} email preview`} sandbox="" srcDoc={sampleHtml} />
          : <div className="sk sk-card" />)}
      </section>

      <section className="adm-card adm-stack">
        <h3>Recent</h3>
        {!o?.recent.length ? <p className="muted small">Nothing sent since the server started.</p> : (
          <div className="adm-scroll">
            <table className="table adm-table">
              <thead><tr><th>When</th><th>Status</th><th>Topic</th><th>Player</th><th>Subject</th></tr></thead>
              <tbody>
                {o.recent.map((r, i) => (
                  <tr key={i}>
                    <td className="nowrap"><RelTime ts={r.at} /></td>
                    <td className="nowrap" title={r.note}><span aria-hidden>{STATUS[r.status][0]}</span> {STATUS[r.status][1]}{r.note && <div className="muted small">{r.note}</div>}</td>
                    <td className="nowrap">{r.topic === 'test' ? 'Test' : topicInfo(r.topic).label}</td>
                    <td>{r.name ?? r.to}</td>
                    <td>{r.subject}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Announcement({ recipients, after }: { recipients: number; after: () => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [buttonLabel, setButtonLabel] = useState('');
  const [buttonUrl, setButtonUrl] = useState('');
  const [preview, setPreview] = useState<AnnouncementPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const input = { subject, body, buttonLabel, buttonUrl };

  const doPreview = async () => {
    setBusy(true);
    try { setPreview(await post('/api/admin/email/announcement/preview', input) as AnnouncementPreview); } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const send = async () => {
    if (!preview) return;
    const ok = await askConfirm({
      title: `Send to ${preview.recipients} ${preview.recipients === 1 ? 'player' : 'players'}?`,
      body: `“${preview.subject}” goes to everyone who turned on Announcements. It cannot be called back once sent.`,
      confirm: 'Send announcement',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await post('/api/admin/email/announcement', { ...input, confirm: preview.recipients }) as { queued: number; skipped: number };
      toast(`Announcement queued for ${r.queued} ${r.queued === 1 ? 'player' : 'players'}${r.skipped ? ` (${r.skipped} skipped: daily cap or no longer subscribed)` : ''}`);
      setPreview(null);
      setSubject('');
      setBody('');
      after();
    } catch (e) {
      toastError(e);
      setPreview(null);
    } finally { setBusy(false); }
  };

  return (
    <section className="adm-card adm-stack">
      <h3>Send an announcement</h3>
      <p className="muted small">To the {recipients} {recipients === 1 ? 'player' : 'players'} who turned on “{topicInfo('announcements').label}”: new boards or modes, season news. Plain text; blank lines start paragraphs.</p>
      <input value={subject} maxLength={120} aria-label="Subject" placeholder="Subject" onChange={e => { setSubject(e.target.value); setPreview(null); }} />
      <textarea value={body} rows={6} maxLength={5000} aria-label="Message" placeholder="Message" onChange={e => { setBody(e.target.value); setPreview(null); }} />
      <div className="row wrap">
        <input className="grow" value={buttonLabel} maxLength={40} aria-label="Button label" placeholder="Button label (optional)" onChange={e => { setButtonLabel(e.target.value); setPreview(null); }} />
        <input className="grow" value={buttonUrl} maxLength={300} aria-label="Button link" placeholder="Button link: /cards or https://… (optional)" onChange={e => { setButtonUrl(e.target.value); setPreview(null); }} />
      </div>
      <div className="row wrap">
        <button type="button" className="btn small" disabled={busy || !subject.trim() || !body.trim()} onClick={() => void doPreview()}>Preview</button>
        <button type="button" className="btn small primary" disabled={busy || !preview || preview.recipients === 0} onClick={() => void send()}>
          {preview ? `Send to ${preview.recipients}…` : 'Send…'}
        </button>
        {!preview && <span className="muted small">Preview first, then send.</span>}
      </div>
      {preview && <iframe className="adm-email-frame" title="Announcement preview" sandbox="" srcDoc={preview.html} />}
    </section>
  );
}
