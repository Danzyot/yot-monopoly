import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast } from '../toast';

// The operator's chat switch — asked for after the first live event, where
// there was no way to quiet a chat that needed quieting. Off refuses every
// send server-side (tables and tournament lobbies alike); people who already
// have the page open learn at their next send, everyone else sees the compose
// box replaced by a note.
export default function ChatSwitch() {
  const toast = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    api.chatGet().then(r => setEnabled(r.enabled)).catch(() => {});
  }, []);

  const flip = async () => {
    if (enabled === null) return;
    try {
      const r = await api.chatSet(!enabled);
      setEnabled(r.enabled);
      toast('success', r.enabled ? 'Chat is on' : 'Chat is off — sends are refused site-wide');
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not change chat');
    }
  };

  return (
    <div className="panel chat-switch">
      <div>
        <h3 style={{ margin: 0 }}>Chat</h3>
        <p className="field-hint" style={{ margin: '4px 0 0' }}>
          Site-wide. Off refuses every message at the server; hand logs and
          events are unaffected.
        </p>
      </div>
      <button
        className={`btn btn-sm ${enabled === false ? 'btn-danger' : ''}`}
        disabled={enabled === null}
        onClick={() => void flip()}
      >
        {enabled === null ? '…' : enabled ? 'Turn chat off' : 'Chat is OFF — turn on'}
      </button>
    </div>
  );
}
