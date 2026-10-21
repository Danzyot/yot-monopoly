// Email notification choices (GET/PUT /api/email/prefs): the /settings page,
// and one step of the welcome tour. The address comes from Discord sign-in; a
// player who signed in with a code or the Verify button has none yet and is
// offered "Sign in with Discord" to add it. Every topic is off until ticked,
// except account notices; each tick saves at once.
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { toastError } from '../toast.tsx';
import { EMAIL_TOPICS, type EmailPrefs, type EmailTopic } from '../../../shared/email.ts';
import '../styles/notifications.css';

export default function NotificationSettings({ compact = false }: { compact?: boolean }) {
  const { profile, config, signInDiscord } = useAuth();
  const [prefs, setPrefs] = useState<EmailPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<EmailTopic | null>(null);

  useEffect(() => {
    if (!profile) return;
    let live = true;
    api<EmailPrefs>('/api/email/prefs').then(p => { if (live) setPrefs(p); }).catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [profile?.id]);

  if (!profile) return null;
  if (error) return <p className="muted">{error}</p>;
  if (!prefs) return <div className="nt-box" aria-busy="true"><div className="sk sk-row" /><div className="sk sk-row" /></div>;

  const toggle = async (id: EmailTopic, on: boolean) => {
    setSaving(id);
    const before = prefs;
    setPrefs({ ...prefs, topics: { ...prefs.topics, [id]: on } });
    try {
      setPrefs(await api<EmailPrefs>('/api/email/prefs', { method: 'PUT', json: { topics: { [id]: on } } }));
    } catch (e) {
      setPrefs(before);
      toastError(e);
    } finally {
      setSaving(null);
    }
  };

  const topics = compact ? EMAIL_TOPICS.filter(t => t.id !== 'account') : EMAIL_TOPICS;
  return (
    <div className={`nt-box ${compact ? 'compact' : ''}`}>
      <div className="nt-address" role="status">
        <span className="nt-address-icon" aria-hidden>✉️</span>
        {prefs.email ? (
          <div>
            <b className="nt-email">{prefs.email}</b>
            <div className="muted small">
              {prefs.verified
                ? 'From your Discord account. Only you can see it here.'
                : 'Discord says this address is not verified yet. Verify it in Discord, then sign in with Discord again: we only email verified addresses.'}
            </div>
          </div>
        ) : (
          <div>
            <b>No email address yet</b>
            <div className="muted small">
              It comes from Discord when you sign in with Discord (signing in with a code doesn't share it).
              {config.discordEnabled && <> <button type="button" className="ft-link nt-link" onClick={signInDiscord}>Sign in with Discord</button> once to add it.</>}
              {' '}You can pick topics now; they start once there is an address.
            </div>
          </div>
        )}
      </div>
      {prefs.suppressed && (
        <p className="nt-warn" role="alert">
          {prefs.suppressed === 'bounced'
            ? 'Emails to this address bounced, so we stopped sending. Change the address in Discord and sign in again.'
            : 'This address reported one of our emails as spam, so we turned everything off. Tick a topic to start again.'}
        </p>
      )}
      <fieldset className="nt-topics">
        <legend className={compact ? 'sr-only' : 'nt-legend'}>Email me about</legend>
        {topics.map(t => (
          <label key={t.id} className={`nt-topic ${prefs.topics[t.id] ? 'on' : ''}`}>
            <input type="checkbox" checked={prefs.topics[t.id]} disabled={saving === t.id}
              onChange={e => void toggle(t.id, e.target.checked)} />
            <span className="nt-topic-text">
              <b>{t.label}</b>
              <small>{t.help}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="muted small nt-foot">
        Everything is off until you tick it. Every email has a one-click unsubscribe link. We never sell or share
        your address; it goes only to our email provider to deliver what you asked for. See the <a href="/privacy">privacy notice</a>.
        {!prefs.sending && ' (Email sending is not switched on for this site yet; your choices are saved for when it is.)'}
      </p>
    </div>
  );
}
