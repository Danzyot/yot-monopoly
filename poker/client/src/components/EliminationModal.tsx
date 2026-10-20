import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Avatar from './Avatar';
import type { ChogBadge } from '../../../shared/types';
import Promo from './Promo';
import { PropStrip } from './PropRail';
import { ordinal } from '../format';

export interface EliminationInfo {
  tournamentId: string;
  tournamentName: string;
  name: string;
  avatar: string;
  chog?: ChogBadge;
  place: number;
  prize: number | null;
  entrants: number;
  prizeText: string | null;
}

// The busted player's send-off: their final rank, prize if they cashed, and
// a real choice about what happens next — instead of silently turning into
// a spectator as if nothing happened.
export default function EliminationModal({ info, onClose }: {
  info: EliminationInfo;
  onClose: () => void;
}) {
  const nav = useNavigate();
  const cashed = info.prize !== null && info.prize > 0;
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal winner-modal" onClick={e => e.stopPropagation()}>
        <div className="elim-avatar"><Avatar value={info.avatar} size={54} chog={info.chog} /></div>
        <h2 className="winner-title">{cashed ? 'In the money!' : 'Eliminated'}</h2>
        <div className="winner-champ">
          <div className="winner-champ-name">{info.name}</div>
          <div className="winner-champ-sub">
            finished <strong>{ordinal(info.place)}</strong> of {info.entrants} in {info.tournamentName}
          </div>
        </div>
        {cashed && (
          <div className="winner-mine">
            You win <strong>{info.prize!.toLocaleString()}</strong> 🏆
          </div>
        )}
        {cashed && info.prizeText && <div className="winner-prizes">{info.prizeText}</div>}
        <Promo variant="card" />
        <PropStrip title="Out early? Put the time into a funded account instead" />
        <div className="modal-actions" style={{ justifyContent: 'center' }}>
          <button
            className="btn"
            onClick={() => { onClose(); nav(`/t/${info.tournamentId}`); }}
          >
            Back to lobby
          </button>
          <button className="btn btn-primary" onClick={onClose}>Keep spectating</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
