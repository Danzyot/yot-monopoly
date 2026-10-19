// Operator-only editor for the promo advert. The copy lives on the
// server's volume, not in the build, so the code or the offer can change
// between tournaments without a deploy.
import { useEffect, useState } from 'react';
import { api, type FirmConfig, type PromoConfig } from '../api';
import { PromoView, refreshPromo } from './Promo';
import { useToast } from '../toast';

export default function PromoManager() {
  const [promo, setPromo] = useState<PromoConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    let stale = false;
    api.promoGet()
      .then(p => { if (!stale) setPromo(p); })
      .catch(e => { if (!stale) setError(e instanceof Error ? e.message : 'Could not load'); });
    return () => { stale = true; };
  }, []);

  if (error) return <p className="tag">{error}</p>;
  if (!promo) return <p className="tag">Loading…</p>;

  const set = (patch: Partial<PromoConfig>) => setPromo(p => (p ? { ...p, ...patch } : p));

  const setFirm = (i: number, patch: Partial<FirmConfig>) =>
    setPromo(p => (p ? { ...p, firms: p.firms.map((f, j) => (j === i ? { ...f, ...patch } : f)) } : p));
  const removeFirm = (i: number) =>
    setPromo(p => (p ? { ...p, firms: p.firms.filter((_, j) => j !== i) } : p));
  // A fresh row needs an id the server will not collide with an existing one.
  const addFirm = () =>
    setPromo(p => (p ? {
      ...p,
      firms: [...p.firms, {
        id: `firm${p.firms.length + 1}${p.firms.length}`,
        name: '', offer: '', url: '', accent: 'purple' as const,
      }],
    } : p));

  const save = async () => {
    setSaving(true);
    try {
      const saved = await api.promoSave(promo);
      setPromo(saved);
      refreshPromo(); // next advert to mount fetches the new copy
      toast('success', 'Advert updated');
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel promo-admin">
      <label className="check-row">
        <input type="checkbox" checked={promo.enabled}
          onChange={e => set({ enabled: e.target.checked })} />
        <span>Show the advert across the site</span>
      </label>

      <div className="promo-fields">
        <div className="field">
          <label htmlFor="promo-code">Code</label>
          <input id="promo-code" value={promo.code} maxLength={32} placeholder="CHOG"
            onChange={e => set({ code: e.target.value.toUpperCase() })} />
        </div>
        <div className="field">
          <label htmlFor="promo-cta">Button label</label>
          <input id="promo-cta" value={promo.ctaLabel} maxLength={32} placeholder="Get the discount"
            onChange={e => set({ ctaLabel: e.target.value })} />
        </div>
        <div className="field wide">
          <label htmlFor="promo-headline">Headline</label>
          <input id="promo-headline" value={promo.headline} maxLength={90}
            placeholder="Trading a prop firm challenge?"
            onChange={e => set({ headline: e.target.value })} />
        </div>
        <div className="field wide">
          <label htmlFor="promo-blurb">Detail line</label>
          <input id="promo-blurb" value={promo.blurb} maxLength={140}
            placeholder="Use code CHOG at checkout for a discount."
            onChange={e => set({ blurb: e.target.value })} />
        </div>
        <div className="field wide">
          <label htmlFor="promo-url">Link (optional — must start with https://)</label>
          <input id="promo-url" value={promo.url} maxLength={300} placeholder="https://…"
            onChange={e => set({ url: e.target.value })} />
        </div>
      </div>

      <div className="section-title" style={{ marginTop: 4 }}>
        Prop firms on the in-game rail
      </div>
      <label className="check-row">
        <input type="checkbox" checked={promo.railEnabled}
          onChange={e => set({ railEnabled: e.target.checked })} />
        <span>Show the firm rail beside the table</span>
      </label>
      <p className="tag">
        Paste each partner&apos;s affiliate link. A firm with no link
        still shows the code — it just is not clickable.
      </p>
      <div className="firm-rows">
        {promo.firms.map((f, i) => (
          <div key={f.id} className="firm-row">
            <input className="fr-name" value={f.name} maxLength={40} placeholder="Firm name"
              onChange={e => setFirm(i, { name: e.target.value })} />
            <input className="fr-offer" value={f.offer} maxLength={20} placeholder="40% OFF"
              onChange={e => setFirm(i, { offer: e.target.value.toUpperCase() })} />
            <input className="fr-url" value={f.url} maxLength={300} placeholder="https://…"
              onChange={e => setFirm(i, { url: e.target.value })} />
            <select value={f.accent} onChange={e => setFirm(i, { accent: e.target.value as FirmConfig['accent'] })}>
              <option value="purple">Purple</option>
              <option value="green">Green</option>
              <option value="gold">Gold</option>
              <option value="blue">Blue</option>
            </select>
            <button className="btn btn-sm btn-danger" onClick={() => removeFirm(i)}>Remove</button>
          </div>
        ))}
      </div>
      <button className="btn btn-sm" onClick={addFirm} disabled={promo.firms.length >= 12}>
        Add a firm
      </button>

      <div className="section-title" style={{ marginTop: 4 }}>Preview</div>
      <div className={promo.enabled ? undefined : 'promo-off'}>
        <PromoView promo={promo} />
      </div>

      <div className="modal-actions">
        <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save advert'}
        </button>
      </div>
    </div>
  );
}
