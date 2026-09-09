// Which parts of the site are switched on.
//
// The point of this room is a clean, simple table, so the extras are opt-in
// rather than opt-out. Each switch turns the feature off on the server too,
// not just in the browser — the button disappearing and the action being
// refused are the same setting.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { Features } from '../features';
import { useToast } from '../toast';

const ROWS: { key: keyof Features; label: string; hint: string }[] = [
  { key: 'chat', label: 'Chat', hint: 'Table and tournament-lobby chat, with @mentions.' },
  { key: 'handLog', label: 'Session log', hint: 'The running list of what happened at a table.' },
  { key: 'replay', label: 'Hand replayer', hint: 'Step back through finished hands. Off means hand history is not served at all.' },
  { key: 'music', label: 'Music player', hint: 'The in-page player and its library.' },
  { key: 'rabbitHunting', label: 'Rabbit hunting', hint: 'Let players see the board that never came.' },
  { key: 'leaderboard', label: 'Leaderboard', hint: 'The all-time standings page across tournaments.' },
];

export default function FeatureManager() {
  const [features, setFeatures] = useState<Features | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const refresh = useCallback(() => {
    api.featuresGet().then(setFeatures).catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);

  // Saved on the click rather than behind a Save button: one switch is one
  // decision, and a half-applied panel is a confusing thing to walk away from.
  const toggle = async (key: keyof Features) => {
    if (!features || saving) return;
    const next = { ...features, [key]: !features[key] };
    setFeatures(next);
    setSaving(true);
    try {
      setFeatures(await api.featuresSave(next));
    } catch (e) {
      setFeatures(features); // put the switch back
      toast('error', e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  if (!features) return <p className="tag">Loading…</p>;

  return (
    <div className="panel feature-admin">
      {ROWS.map(r => (
        <label key={r.key} className="feature-row">
          <input
            type="checkbox" checked={features[r.key]} disabled={saving}
            onChange={() => void toggle(r.key)}
          />
          <span className="fr-text">
            <span className="fr-label">{r.label}</span>
            <span className="fr-hint">{r.hint}</span>
          </span>
          <span className={`fr-state ${features[r.key] ? 'on' : 'off'}`}>
            {features[r.key] ? 'On' : 'Off'}
          </span>
        </label>
      ))}
    </div>
  );
}
