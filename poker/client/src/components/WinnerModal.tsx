import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import Avatar from './Avatar';
import Promo from './Promo';
import { IconTrophy } from './icons';
import { ordinal } from '../format';

export interface WinnerInfo {
  tournamentId: string;
  name: string;
  entrants: number;
  prizeText: string | null;
  places: { playerId: string; place: number; name: string; avatar: string }[];
}

export default function WinnerModal({ info, myPlace, onClose }: {
  info: WinnerInfo;
  myPlace?: number | null;
  onClose: () => void;
}) {
  const champ = info.places.find(p => p.place === 1);
  const rest = info.places.filter(p => p.place !== 1).sort((a, b) => a.place - b.place);
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal winner-modal" onClick={e => e.stopPropagation()}>
        <div className="winner-burst" aria-hidden><IconTrophy size={44} /></div>
        <h2 className="winner-title">Tournament finished!</h2>
        {champ && (
          <div className="winner-champ">
            <span className="winner-champ-avatar"><Avatar value={champ.avatar} size={54} /></span>
            <div className="winner-champ-name">{champ.name}</div>
            <div className="winner-champ-sub">wins {info.name}</div>
          </div>
        )}
        {rest.length > 0 && (
          <div className="winner-places">
            {rest.map(p => (
              <div key={p.playerId} className="winner-place-row">
                <span className="wp-rank">{ordinal(p.place)}</span>
                <Avatar value={p.avatar} size={20} />
                <span className="wp-name">{p.name}</span>
              </div>
            ))}
          </div>
        )}
        {typeof myPlace === 'number' && myPlace > 0 && (
          <div className="winner-mine">
            You finished <strong>{ordinal(myPlace)}</strong> of {info.entrants} players.
          </div>
        )}
        {info.prizeText && <div className="winner-prizes">{info.prizeText}</div>}
        <Promo variant="card" />
        <div className="modal-actions" style={{ justifyContent: 'center' }}>
          <Link className="btn" to={`/t/${info.tournamentId}`} onClick={onClose}>Tournament overview</Link>
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
