// In-game menu on a player's row: anyone can open a player's profile; the host
// can make someone else the host, hand them to autopilot or remove them from
// the game; operators can also ban them (room or site) through the ban dialog.
// Renders nothing when there is nothing to offer, so the game screen can mount it freely.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { call } from '../net.ts';
import { useAuth } from '../auth.tsx';
import { toast, toastError } from '../toast.tsx';
import { profilePath } from '../community.tsx';
import type { PlayerState, RoomView } from '../../../shared/types.ts';
import BanDialog from './admin/BanDialog.tsx';
import { askConfirm } from './Modal.tsx';

export default function PlayerMenu({ room, player, me }: { room: RoomView; player: PlayerState; me: string }) {
  const { profile, config } = useAuth();
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

  const self = player.id === me;
  const hostPowers = room.hostId === me || isAdmin;
  const seat = room.seats.find(s => s.id === player.id);
  const canRemove = !self && hostPowers && !player.bankrupt && room.game?.phase !== 'over';
  const canBan = !self && isAdmin && !player.isBot;
  const canMakeHost = !self && hostPowers && !player.isBot && !!seat?.connected && player.id !== room.hostId && room.status !== 'finished';
  const canProfile = !player.isBot && config.features.leaderboard;
  // Autopilot for a player who is connected but not at the screen; they take
  // back control just by acting.
  const canAutopilot = canRemove && !player.isBot && room.status === 'playing';
  const onAutopilot = !!seat?.autopilot || !!player.afk;
  if (!canRemove && !canBan && !canMakeHost && !canProfile) return null;

  const toggle = () => {
    if (open) { setOpen(null); return; }
    const r = btn.current!.getBoundingClientRect();
    // A portal, not an absolutely placed child: the player strip scrolls
    // sideways on phones and would clip the menu.
    setOpen({ x: Math.min(r.right, window.innerWidth - 8), y: r.bottom + 4 });
  };

  const autopilot = () => {
    setOpen(null);
    call('room:autopilot', { id: player.id, on: !onAutopilot })
      .then(() => toast(onAutopilot ? `${player.name} is off autopilot` : `Autopilot is playing for ${player.name}`), toastError);
  };

  const remove = async () => {
    setOpen(null);
    if (!(await askConfirm({
      title: `Remove ${player.name}?`, body: 'They leave the game and their property goes back to the bank.', confirm: 'Remove', danger: true,
    }))) return;
    call('room:kick', { id: player.id }).then(() => toast(`Removed ${player.name}`), toastError);
  };

  const makeHost = async () => {
    setOpen(null);
    if (room.hostId === me && !(await askConfirm({
      title: `Make ${player.name} the host?`, body: 'They get the host controls and you lose them.', confirm: 'Make host',
    }))) return;
    call('room:host', { id: player.id }).catch(toastError);
  };

  // A new tab: following the link must never take a player away from their game.
  const viewProfile = () => {
    setOpen(null);
    window.open(profilePath(player.id), '_blank', 'noopener');
  };

  return (
    <>
      <button ref={btn} className="btn tiny ghost pmenu-btn" aria-label={`Options for ${player.name}`} aria-expanded={!!open} onClick={toggle}>⋯</button>
      {open && createPortal(
        <div className="pmenu" role="menu" style={{ left: open.x, top: open.y }}>
          {canProfile && <button role="menuitem" onClick={viewProfile}>View profile ↗</button>}
          {canMakeHost && <button role="menuitem" onClick={makeHost}>Make host</button>}
          {canAutopilot && (
            <button role="menuitem" onClick={autopilot} title="Autopilot never buys, builds or trades; they take over again by acting">
              {onAutopilot ? 'Take off autopilot' : 'Hand to autopilot'}
            </button>
          )}
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
