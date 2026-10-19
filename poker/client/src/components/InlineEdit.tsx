import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconPencil } from './icons';

// Host-only click-to-edit text. Shows the normal content with a pencil hint;
// clicking swaps in an input (or textarea). Enter saves, Esc cancels, and
// clicking away saves too, so editing feels immediate.
export default function InlineEdit({
  value, onSave, multiline = false, maxLength, placeholder, display, block = false,
}: {
  value: string;
  onSave: (v: string) => void;
  multiline?: boolean;
  maxLength?: number;
  placeholder?: string;
  // What to render when not editing; defaults to the raw value.
  display?: ReactNode;
  block?: boolean; // stretch to full width (panels), vs inline (headings)
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) { ref.current?.focus(); ref.current?.select(); }
  }, [editing]);

  const open = () => { setDraft(value); setEditing(true); };
  const save = () => {
    setEditing(false);
    if (draft.trim() !== value.trim()) onSave(draft.trim());
  };
  const cancel = () => setEditing(false);

  if (!editing) {
    return (
      <span
        className={`inline-edit${block ? ' block' : ''}`}
        role="button" tabIndex={0} title="Click to edit"
        onClick={open}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
      >
        {display ?? (value || <span className="inline-edit-empty">{placeholder ?? 'Click to edit…'}</span>)}
        <IconPencil size={14} className="inline-edit-pen" />
      </span>
    );
  }

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
  };

  return (
    <span className={`inline-edit editing${block ? ' block' : ''}`} onClick={e => e.stopPropagation()}>
      {multiline ? (
        <textarea
          ref={ref} className="input" rows={3} maxLength={maxLength}
          value={draft} placeholder={placeholder}
          onChange={e => setDraft(e.target.value)} onKeyDown={keys} onBlur={save}
        />
      ) : (
        <input
          ref={ref} className="input" maxLength={maxLength}
          value={draft} placeholder={placeholder}
          onChange={e => setDraft(e.target.value)} onKeyDown={keys} onBlur={save}
        />
      )}
    </span>
  );
}
