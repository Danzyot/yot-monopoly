import { createPortal } from 'react-dom';
import type { TableLogEntry } from '../../../shared/types';
import { IconDownload, IconReplay } from './icons';

const hhmm = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// Rough classification for PokerNow-style colored lines.
function lineClass(text: string): string {
  if (/wins|splits, takes/.test(text)) return 'log-win';
  if (/: (Bet|Raise|All-in)|shows /.test(text)) return 'log-bet';
  if (/: (Call|Check)/.test(text)) return 'log-call';
  if (/^Hand #|^Flop|^Turn|^River/.test(text)) return 'log-street';
  return '';
}

export default function SessionLogModal({ log, tableName, onClose, onOpenReplayer }: {
  log: TableLogEntry[];
  tableName: string;
  onClose: () => void;
  onOpenReplayer: () => void;
}) {
  const download = () => {
    const body = log
      .map(e => `[${new Date(e.ts).toISOString()}] ${e.text}`)
      .join('\n');
    const blob = new Blob([body], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tableName.replace(/[^\w-]+/g, '_')}-session-log.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const newestFirst = [...log].reverse();

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
        <h3>Session Log</h3>
        <div className="session-log">
          {newestFirst.map((e, i) => (
            <div key={`${e.ts}-${i}`} className={`session-log-row ${lineClass(e.text)}`}>
              <span className="log-time">{hhmm(e.ts)}</span>
              <span className="log-text">{e.text}</span>
            </div>
          ))}
          {log.length === 0 && (
            <div className="session-log-row"><span className="log-text" style={{ color: 'var(--text-faint)' }}>
              Nothing yet — the log fills up as hands are played.
            </span></div>
          )}
        </div>
        <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
          <button className="btn btn-success" onClick={download}><IconDownload /> Download</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onOpenReplayer}><IconReplay /> Replayer</button>
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
