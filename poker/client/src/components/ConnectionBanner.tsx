import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../socket';

// Connection health, made visible: a banner when the socket has been down
// for more than a beat, and a brief "reconnected" flash when it returns.
// Without this, a dropped connection just looks like a frozen table.
export default function ConnectionBanner() {
  const [state, setState] = useState<'ok' | 'down' | 'back'>('ok');
  const downTimer = useRef<number | null>(null);
  const backTimer = useRef<number | null>(null);

  useEffect(() => {
    const sock = getSocket();
    const onDisconnect = () => {
      // Sign-in bounces the socket deliberately — only surface outages that
      // last long enough to matter.
      if (downTimer.current === null) {
        downTimer.current = window.setTimeout(() => setState('down'), 1_500);
      }
    };
    const onConnect = () => {
      if (downTimer.current !== null) { clearTimeout(downTimer.current); downTimer.current = null; }
      setState(prev => {
        if (prev !== 'down') return 'ok';
        if (backTimer.current !== null) clearTimeout(backTimer.current);
        backTimer.current = window.setTimeout(() => setState('ok'), 2_000);
        return 'back';
      });
    };
    sock.on('disconnect', onDisconnect);
    sock.on('connect', onConnect);
    return () => {
      sock.off('disconnect', onDisconnect);
      sock.off('connect', onConnect);
      if (downTimer.current !== null) clearTimeout(downTimer.current);
      if (backTimer.current !== null) clearTimeout(backTimer.current);
    };
  }, []);

  if (state === 'ok') return null;
  return (
    <div className={`conn-banner ${state}`} role="status">
      {state === 'down' ? 'Connection lost — reconnecting…' : 'Reconnected ✓'}
    </div>
  );
}
