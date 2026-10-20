import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../auth';
import { loadMyChogs, pickMyChog, useMyChogs } from '../chog';
import { useToast } from '../toast';
import { ChogArt } from './Avatar';

// "Your Chog": pick one of the Chogs your linked wallets hold, and its art is
// your avatar at the table, in chat and in results. The list is what the Chog
// Games hub says you hold (wallets are linked there); the server checks again
// before taking the pick, and keeps checking.
export default function ChogPicker({ onClose }: { onClose: () => void }) {
  const { hubUrl } = useAuth();
  const toast = useToast();
  const s = useMyChogs();
  const [busy, setBusy] = useState<number | 'none' | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Open = re-ask (the server rate-limits the real re-read).
  useEffect(() => { void loadMyChogs(true); }, []);

  const d = s.data;
  const base = d?.artBase ?? hubUrl;
  const choose = async (token: number | null) => {
    setBusy(token ?? 'none');
    try {
      await pickMyChog(token);
      toast('success', token === null ? 'Back to your usual avatar' : `Chog #${token} is your avatar`);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not set that Chog');
    } finally {
      setBusy(null);
    }
  };
  const refresh = async () => {
    setRefreshing(true);
    await loadMyChogs(true);
    setRefreshing(false);
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal chog-picker" onClick={e => e.stopPropagation()}>
        <h3>Your Chog</h3>
        <p className="chog-picker-lede">
          Hold a Chog Genesis? Pick one and it becomes your avatar at the table, in chat and in results,
          glowing in its Aura colour.
        </p>
        {!s.loaded ? (
          <p className="chog-picker-note">Checking your Chogs…</p>
        ) : !d || !d.enabled ? (
          <p className="chog-picker-note">Chog avatars are not set up on this room.</p>
        ) : !d.reachable ? (
          <p className="chog-picker-note">
            Could not reach Chog Games just now, so your Chogs cannot be checked. Your pick is kept and
            shows again once it answers.{' '}
            <button className="btn btn-ghost btn-sm" disabled={refreshing} onClick={() => void refresh()}>Try again</button>
          </p>
        ) : (
          <>
            <div className="chog-grid" role="radiogroup" aria-label="Your Chog">
              <button
                type="button" role="radio" aria-checked={d.pick === null}
                className={`chog-opt none${d.pick === null ? ' sel' : ''}`}
                disabled={busy !== null}
                onClick={() => void choose(null)}
              >
                <span className="chog-opt-none">None</span>
                <span className="chog-opt-id">usual avatar</span>
              </button>
              {base && d.chogs.map(c => (
                <button
                  key={c.chogToken} type="button" role="radio" aria-checked={d.pick === c.chogToken}
                  className={`chog-opt${d.pick === c.chogToken ? ' sel' : ''}`}
                  disabled={busy !== null}
                  onClick={() => void choose(c.chogToken)}
                >
                  <ChogArt chog={c} base={base} size={64} />
                  <span className="chog-opt-id">#{c.chogToken}{c.legendary ? ' · 1:1' : ''}</span>
                </button>
              ))}
            </div>
            {d.chogs.length === 0 && (
              <p className="chog-picker-note">
                No Chogs found in your linked wallets.
                {hubUrl && <> Link a wallet on <a href={`${hubUrl}/wallet`} target="_blank" rel="noopener noreferrer">Chog Games</a>, then come back.</>}
              </p>
            )}
          </>
        )}
        <div className="modal-actions">
          {d?.enabled && d.reachable && (
            <button className="btn btn-ghost" disabled={refreshing} onClick={() => void refresh()}>
              {refreshing ? 'Checking…' : 'Re-check wallets'}
            </button>
          )}
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
