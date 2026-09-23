import { useEffect, useState } from 'react';

type Toast = { id: number; text: string; kind: 'error' | 'info' };
let seq = 0;
const listeners = new Set<(t: Toast) => void>();

export function toast(text: string, kind: Toast['kind'] = 'info') {
  const t = { id: ++seq, text, kind };
  listeners.forEach(f => f(t));
}

export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : String(e), 'error');

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const add = (t: Toast) => {
      setItems(i => [...i.slice(-3), t]);
      setTimeout(() => setItems(i => i.filter(x => x.id !== t.id)), 3500);
    };
    listeners.add(add);
    return () => { listeners.delete(add); };
  }, []);
  return (
    <div className="toasts">
      {items.map(t => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
    </div>
  );
}
