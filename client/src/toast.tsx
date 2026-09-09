import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { getSocket } from './socket';

interface Toast { id: number; kind: 'info' | 'error' | 'success'; text: string }

const Ctx = createContext<(kind: Toast['kind'], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = nextId.current++;
    setToasts(t => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4200);
  }, []);

  useEffect(() => {
    const sock = getSocket();
    const onToast = (t: { kind: Toast['kind']; text: string }) => push(t.kind, t.text);
    sock.on('toast', onToast);
    return () => { sock.off('toast', onToast); };
  }, [push]);

  // Surface Discord sign-in errors returned via the OAuth redirect hash.
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#derror=')) {
      push('error', decodeURIComponent(hash.slice('#derror='.length)));
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, [push]);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
