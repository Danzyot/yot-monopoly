import { isOwnable, mortgageValue, unmortgageCost } from '../../../shared/board.ts';
import {
  buildProblem, manageProblem, mortgageProblem, sellProblem, unmortgageProblem,
} from '../../../shared/holdings.ts';
import { resolveTheme } from '../../../shared/themes.ts';
import type { GameView } from '../../../shared/types.ts';
import { act } from '../net.ts';
import { toastError } from '../toast.tsx';

/** Title-deed card for one space, with management buttons when it's yours. */
export default function Deed({ game, index, me, onClose }: {
  game: GameView; index: number; me: string; onClose?: () => void;
}) {
  const theme = resolveTheme(game.themeId, game.mapId);
  const s = theme.spaces[index];
  const o = game.owned[index];
  const owner = o ? game.players.find(p => p.id === o.owner) : null;
  const cur = (n: number) => `${theme.currency}${n}`;
  const mine = o?.owner === me;
  const run = (type: 'build' | 'sell' | 'mortgage' | 'unmortgage') => act({ type, space: index }).catch(toastError);
  const color = s.group ? theme.groupColors[s.group] : theme.palette.accent;
  // The engine's own rules (shared/holdings.ts): a greyed-out button says why.
  const cash = game.players.find(p => p.id === me)?.cash ?? 0;
  const blocked = game.paused ? 'The game is paused' : manageProblem(game, me, index);
  const why = {
    build: blocked ?? buildProblem(game, theme.spaces, me, index, cash),
    sell: blocked ?? sellProblem(game, theme.spaces, index),
    mortgage: blocked ?? mortgageProblem(game, theme.spaces, index),
    unmortgage: blocked ?? unmortgageProblem(game, theme.spaces, index, cash),
  };

  return (
    <div className="deed">
      <div className="deed-head" style={{ background: s.kind === 'property' ? color : '#2a3142' }}>
        <small>{s.kind === 'property' ? 'TITLE DEED' : s.kind.toUpperCase()}</small>
        <b>{s.name}</b>
        {onClose && <button className="deed-x" onClick={onClose}>✕</button>}
      </div>
      <div className="deed-body">
        {s.kind === 'property' && (
          <table>
            <tbody>
              <tr><td>Rent</td><td>{cur(s.rent![0])}</td></tr>
              <tr><td>With full set</td><td>{cur(s.rent![0] * 2)}</td></tr>
              {[1, 2, 3, 4].map(h => (
                <tr key={h} className={o?.houses === h ? 'on' : ''}><td>With {h} house{h > 1 ? 's' : ''}</td><td>{cur(s.rent![h])}</td></tr>
              ))}
              <tr className={o?.houses === 5 ? 'on' : ''}><td>With hotel</td><td>{cur(s.rent![5])}</td></tr>
              <tr className="sep"><td>House cost</td><td>{cur(s.houseCost!)}</td></tr>
            </tbody>
          </table>
        )}
        {s.kind === 'railroad' && (
          <table><tbody>
            {[1, 2, 3, 4].map(n => <tr key={n}><td>{n} owned</td><td>{cur(25 * 2 ** (n - 1))}</td></tr>)}
          </tbody></table>
        )}
        {s.kind === 'utility' && <p className="small">Rent is 4× the dice roll with one utility, 10× with both.</p>}
        {s.kind === 'tax' && <p>Pay {cur(s.tax!)}{game.rules.freeParkingPot ? ' into the Free Parking pot' : ''}.</p>}
        {(s.kind === 'chance' || s.kind === 'chest') && <p>Draw a {theme.deckNames[s.kind]} card.</p>}
        {s.kind === 'go' && <p>Collect {cur(game.rules.goSalary)} as you pass.</p>}
        {s.kind === 'parking' && (game.rules.freeParkingPot || !game.rules.arcadeParking) && (
          <p>{game.rules.freeParkingPot ? `Jackpot: ${cur(game.pot)}` : 'Nothing happens. Relax.'}</p>
        )}
        {(s.kind === 'arcade' || (s.kind === 'parking' && game.rules.arcadeParking)) && (
          <p>{game.rules.minigames ? '🎮 Arcade: play a random mini-game for a cash prize.' : 'The arcade is closed (mini-games are off).'}</p>
        )}
        {s.kind === 'jail' && <p>Just visiting — unless you were sent here.</p>}
        {s.kind === 'gotojail' && <p>Go directly to jail. Do not pass GO.</p>}

        {isOwnable(s) && (
          <div className="deed-foot">
            <div className="row between small"><span>Price</span><b>{cur(s.price!)}</b></div>
            <div className="row between small"><span>Mortgage value</span><b>{cur(mortgageValue(s))}</b></div>
            <div className="row between small">
              <span>Owner</span>
              <b style={{ color: owner?.color }}>{owner ? owner.name : 'Bank'}{o?.mortgaged ? ' (mortgaged)' : ''}</b>
            </div>
          </div>
        )}

        {mine && game.phase !== 'over' && (
          <div className="deed-actions">
            {s.kind === 'property' && (
              <>
                <button className="btn small" disabled={!!why.build} title={why.build ?? undefined} onClick={() => run('build')}>
                  {o.houses === 4 ? 'Build hotel' : 'Build house'} · {cur(s.houseCost!)}
                </button>
                <button className="btn small" disabled={!!why.sell} title={why.sell ?? undefined} onClick={() => run('sell')}>
                  Sell · +{cur(Math.floor(s.houseCost! / 2))}
                </button>
              </>
            )}
            {o.mortgaged ? (
              <button className="btn small" disabled={!!why.unmortgage} title={why.unmortgage ?? undefined}
                onClick={() => run('unmortgage')}>Unmortgage · {cur(unmortgageCost(s))}</button>
            ) : (
              <button className="btn small" disabled={!!why.mortgage} title={why.mortgage ?? undefined}
                onClick={() => run('mortgage')}>Mortgage · +{cur(mortgageValue(s))}</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
