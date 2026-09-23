// In-game moderation on a player's row: the host can remove someone from
// the game; operators can also ban them (room or site) through the ban dialog.
// Renders nothing for anyone else, so the game screen can mount it freely.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { call } from '../net.ts';
import { useAuth } from '../auth.tsx';
import { toast, toastError } from '../toast.tsx';
import type { PlayerState, RoomView } from '../../../shared/types.ts';
import BanDialog from './admin/BanDialog.tsx';

export default function PlayerMenu({ room, player, me }: { room: RoomView; player: PlayerState; me: string }) {
  const { profile } = useAuth();
  const isAdmin = !!profile?.isAdmin;
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const [banning, setBanning] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);

  // Close on any outside click, scroll or resize (the menu is fixed-positioned).
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Element;
      if (e.type === 'pointerdown' && (t.closest?.('.pmenu') || btn.current?.contains(t))) return;
      setOpen(null);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const canRemove = (room.hostId === me || isAdmin) && !player.bankrupt && room.game?.phase !== 'over';
  const canBan = isAdmin && !player.isBot;
  if (player.id === me || (!canRemove && !canBan)) return null;

  const toggle = () => {
    if (open) { setOpen(null); return; }
    const r = btn.current!.getBoundingClientRect();
    // A portal, not an absolutely placed child: the player strip scrolls
    // sideways on phones and would clip the menu.
    setOpen({ x: Math.min(r.right, window.innerWidth - 8), y: r.bottom + 4 });
  };

  const remove = () => {
    setOpen(null);
    if (!confirm(`Remove ${player.name} from the game? Their property goes back to the bank.`)) return;
    call('room:kick', { id: player.id }).then(() => toast(`Removed ${player.name}`), toastError);
  };

  return (
    <>
      <button ref={btn} className="btn tiny ghost pmenu-btn" aria-label={`Moderate ${player.name}`} aria-expanded={!!open} onClick={toggle}>⋯</button>
      {open && createPortal(
        <div className="pmenu" role="menu" style={{ left: open.x, top: open.y }}>
          {canRemove && <button role="menuitem" onClick={remove}>Remove from game</button>}
          {canBan && <button role="menuitem" className="danger" onClick={() => { setOpen(null); setBanning(true); }}>Ban…</button>}
        </div>,
        document.body,
      )}
      {banning && (
        <BanDialog
          target={{ kind: 'player', value: player.id, accountId: player.id, name: player.name, scope: 'room', gameId: room.code }}
          onClose={() => setBanning(false)}
        />
      )}
    </>
  );
}
