// Lobby: what the table plays on, in two steps.
//
//   1. Board — the layout and the world around it (Classic, Speedway,
//      Metropolis): how many spaces, the economy, the 3D setting.
//   2. Look — how it is printed (Original, Takeprofit TV, Chog): names,
//      colours, money, cards. Original is each board's own look; a branded
//      look reskins any board.
//
// Each look card shows that look on the chosen board, painted by the same
// code as the 3D board, so the pair is visible before the game starts.
// (In code a board is a map, `mapId`, and a look a theme/edition, `themeId`;
// tableLabel() in shared/themes.ts has the words players see.)

import { THEMES, resolveTheme, tableLabel, type RuleConfig } from '../../../shared/themes.ts';
import { mapThumbUrl, themeAvailable } from '../../../shared/season.ts';
import { MAPS, getMap } from '../../../shared/maps.ts';
import type { RoomView } from '../../../shared/types.ts';
import BoardPreview from '../three/BoardPreview.tsx';

/** House rules a look switches on by default, in a few words. */
const RULE_WORDS: Partial<Record<keyof RuleConfig, string>> = {
  freeParkingPot: 'Free Parking jackpot',
  doubleOnGo: 'double on GO',
  auctions: 'auctions',
  speedDie: 'Speed Die',
};

function themeRules(rules: Partial<RuleConfig>): string {
  return Object.entries(rules)
    .filter(([k, v]) => v === true && RULE_WORDS[k as keyof RuleConfig])
    .map(([k]) => RULE_WORDS[k as keyof RuleConfig])
    .join(', ');
}

/** The looks on offer (one during the Chog season, so there is nothing to pick and the step is hidden). */
const LOOKS = THEMES.filter(t => themeAvailable(t.id));
export const LOOK_STEP = LOOKS.length > 1;

export default function BoardPicker({ room, isHost, configure }: {
  room: RoomView;
  isHost: boolean;
  configure: (p: { themeId?: string; mapId?: string }) => void;
}) {
  const map = getMap(room.mapId);
  const current = resolveTheme(room.themeId, room.mapId);
  const groups = [...new Set(map.spaces.filter(s => s.kind === 'property').map(s => s.group!))];
  const hostOnly = !isHost && ' Only the host can change it.';

  return (
    <div className="bp">
      <h3 className="bp-step"><span className="bp-num" aria-hidden>1</span>Board</h3>
      <p className="pick-hint muted small">The layout and the world around the table: how many spaces, prices, and the 3D setting.{hostOnly}</p>
      <div className="edition-pick bp-maps" role="group" aria-label="Board">
        {MAPS.map(m => {
          const on = m.id === room.mapId;
          return (
            <button key={m.id} disabled={!isHost} className={`edition small map-card ${on ? 'on' : ''}`}
              aria-pressed={on} onClick={() => configure({ mapId: m.id })}>
              {on && <span className="pick-selected">✓ Selected</span>}
              <img className="map-thumb" src={mapThumbUrl(m.id)} alt="" loading="lazy" />
              <b>{m.name}</b>
              <span className="bp-facts small">{m.spaces.length} spaces · {m.players[0]}–{m.players[1]} players</span>
              <span className="small muted">{m.description}</span>
            </button>
          );
        })}
      </div>

      {LOOK_STEP && <>
      <h3 className="bp-step"><span className="bp-num" aria-hidden>2</span>Look</h3>
      <p className="pick-hint muted small">
        How the {map.name} board is printed: names, colours, money and cards. Original is the board’s own look; the others reskin it.{hostOnly}
      </p>
      <div className="edition-pick bp-themes" role="group" aria-label="Look">
        {LOOKS.map(t => {
          const on = t.id === room.themeId;
          const rt = resolveTheme(t.id, room.mapId);
          const rules = themeRules(t.rules);
          return (
            <button key={t.id} disabled={!isHost} className={`edition small bp-theme ${on ? 'on' : ''}`} aria-pressed={on}
              style={{ background: rt.palette.board, color: rt.palette.boardText, borderColor: on ? rt.palette.accent : rt.palette.boardLine }}
              onClick={() => configure({ themeId: t.id })}>
              {on && <span className="pick-selected">✓ Selected</span>}
              <BoardPreview themeId={t.id} mapId={room.mapId} />
              <span className="bp-name">
                {t.logoUrl && <img className="edition-logo" src={t.logoUrl} alt="" />}
                <b>{t.name}</b>
              </span>
              <span className="swatches" aria-hidden>
                {groups.map(g => <i key={g} style={{ background: rt.groupColors[g] }} />)}
              </span>
              <span className="small">{t.tagline}</span>
              {rules && <span className="bp-rules small">Brings: {rules}</span>}
            </button>
          );
        })}
      </div>
      </>}
      <p className="bp-summary small" aria-live="polite">
        <b>{tableLabel(map.name, current.name)}</b>
        {' '}— {map.spaces.length} spaces, {current.deckNames.chance} &amp; {current.deckNames.chest} cards.
      </p>
    </div>
  );
}
