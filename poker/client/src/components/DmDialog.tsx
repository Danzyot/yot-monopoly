// Send a player a Discord DM from the bot — normally a winner, to tell them
// how to claim.
//
// The message is prefilled and editable rather than sent on one click: the
// operator is about to appear in someone's Discord inbox, and a template that
// cannot be read before it goes is a good way to send the wrong prize to the
// wrong person.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { draftFor, type DmTarget } from '../dmdraft';
import { useToast } from '../toast';

export type { DmTarget };

export default function DmDialog({ target, onClose }: { target: DmTarget; onClose: () => void }) {
  const [message, setMessage] = useState(() => draftFor(target));
  const [sending, setSending] = useState(false);
  const toast = useToast();

  const send = async () => {
    if (!message.trim()) { toast('error', 'Write something first'); return; }
    setSending(true);
    try {
      await api.dm(target.playerId, message);
      toast('success', `Sent to ${target.name}`);
      onClose();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not send');
    } finally {
      setSending(false);
    }
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Message {target.name}</h3>
        <p className="tag">
          Sent as a Discord DM from the bot. It only reaches them if they share
          a server with the bot and have not closed their DMs.
        </p>
        <div className="field">
          <label htmlFor="dm-body">Message</label>
          <textarea
            id="dm-body" rows={7} maxLength={1900} value={message}
            placeholder="Write your message…"
            onChange={e => setMessage(e.target.value)}
          />
          <span className="field-hint">{message.length}/1900</span>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={sending} onClick={() => void send()}>
            {sending ? 'Sending…' : 'Send DM'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
