// The VPN door, from the dashboard.
//
// Its own panel rather than a row among the feature switches, because it is
// not the same kind of thing. Those decide what a signed-in player can see;
// this decides who is allowed to load the page at all, and getting it wrong
// locks the operator out of the screen they would use to undo it.
//
// So the panel does the arguing before the switch moves: it names the people
// already on record who would be refused, and refuses to be armed quietly
// when there is no way back in.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useToast } from '../toast';

type Status = Awaited<ReturnType<typeof api.vpnGet>>;

export default function VpnBlock() {
  const [s, setS] = useState<Status | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();

  const refresh = useCallback(() => {
    api.vpnGet().then(setS).catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);

  const apply = async (enabled: boolean) => {
    if (saving) return;
    setConfirming(false);
    setSaving(true);
    try {
      await api.vpnSet(enabled);
      toast('success', enabled
        ? 'VPN block ON. Anyone on a VPN or datacenter address is now refused at the front page.'
        : 'VPN block off. Everyone can reach the site again.');
      refresh();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const toggle = () => {
    if (!s) return;
    // Turning it OFF is always safe and immediate. Turning it ON is the one
    // that needs a second look, so that is the only direction that stops.
    if (s.enabled) { void apply(false); return; }
    setConfirming(true);
  };

  if (!s) return <p className="tag">Loading…</p>;

  const noWayBack = !s.bypassKeySet;

  return (
    <div className="panel feature-admin">
      <label className="feature-row">
        <input
          type="checkbox" checked={s.enabled} disabled={saving || s.envForcedOff}
          onChange={toggle}
        />
        <span className="fr-text">
          <span className="fr-label">Block VPN and datacenter connections</span>
          <span className="fr-hint">
            Anyone on a commercial VPN or a hosting network gets an “Access denied”
            page instead of the site — nothing loads and they cannot sign in.
            Residential proxies are not detected and never will be, so treat this
            as a deterrent rather than proof of anything.
          </span>
        </span>
      </label>

      {s.envForcedOff && (
        <p className="vpn-panel-note">
          <code>VPN_BLOCK=0</code> is set in this deployment, which forces the block off
          and cannot be overridden from here. Remove it and restart to use this switch.
        </p>
      )}

      {!s.envForcedOff && (
        <p className="vpn-panel-note">
          {s.wouldBlock.length > 0 ? (
            <>
              <strong>{s.wouldBlock.length}</strong> of {s.players} accounts on record are on a
              VPN or datacenter address: {s.wouldBlock.map(p => p.name).join(', ')}.
              {s.enabled ? ' They are being refused right now.' : ' They would be refused.'}
            </>
          ) : (
            <>None of the {s.players} accounts on record are on a VPN or datacenter address.</>
          )}
          {' '}
          {s.bypassKeySet
            ? 'A bypass key is set, so you can let yourself back in.'
            : 'No VPN_BYPASS_KEY is set — if this refuses you, you cannot get back in without changing it in Railway.'}
        </p>
      )}

      {confirming && (
        <div className="vpn-confirm">
          <p>
            <strong>Turn the block on?</strong>{' '}
            {s.wouldBlock.length > 0
              ? `${s.wouldBlock.length} account${s.wouldBlock.length === 1 ? '' : 's'} on record `
                + `(${s.wouldBlock.map(p => p.name).join(', ')}) would stop being able to reach the site.`
              : 'Nobody on record is affected right now, but anyone who connects over a VPN will be.'}
          </p>
          {noWayBack && (
            <p className="vpn-danger">
              There is no <code>VPN_BYPASS_KEY</code> set. If you are on a VPN yourself, or the
              detection is wrong about your address, this will lock you out of this dashboard and
              the only way back is editing the variables in Railway. Set one first.
            </p>
          )}
          <div className="vpn-confirm-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>Cancel</button>
            <button className="btn btn-danger btn-sm" disabled={saving} onClick={() => void apply(true)}>
              {noWayBack ? 'Turn it on anyway' : 'Turn it on'}
            </button>
          </div>
        </div>
      )}

      <p className="vpn-panel-foot">
        {s.ranges.vpn.toLocaleString()} VPN ranges · {s.ranges.datacenter.toLocaleString()} datacenter
        ranges{s.apiKeySet ? ' · proxycheck key set' : ''}
        {s.allowList.length > 0 && ` · ${s.allowList.length} address${s.allowList.length === 1 ? '' : 'es'} allowlisted`}
      </p>
    </div>
  );
}
