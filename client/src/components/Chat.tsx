import { useEffect, useRef, useState } from 'react';
import { call, type ChatMsg } from '../net.ts';
import { toastError } from '../toast.tsx';

export default function Chat({ chat }: { chat: ChatMsg[] }) {
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [chat.length]);
  const send = () => {
    if (!text.trim()) return;
    call('chat', { text }).catch(toastError);
    setText('');
  };
  return (
    <div className="chat">
      <div className="chat-lines">
        {chat.length === 0 && <div className="muted small">Say hi 👋</div>}
        {chat.map((m, i) => (
          <div key={i} className="chat-line"><b style={{ color: m.color }}>{m.name}</b> {m.text}</div>
        ))}
        <div ref={end} />
      </div>
      <form className="row" onSubmit={e => { e.preventDefault(); send(); }}>
        <input value={text} maxLength={300} placeholder="Message" onChange={e => setText(e.target.value)} />
        <button className="btn small" type="submit">Send</button>
      </form>
    </div>
  );
}
