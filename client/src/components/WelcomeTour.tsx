// The first-visit welcome: shown once to a new player after they sign in
// (WelcomeHost.tsx), and again from the footer's "Replay the welcome
// tour". Three short steps: the name to play under (POST /api/auth/name),
// the Chog's colour and outfit with a live 3D preview (saved like the lobby's
// picks, so the next table puts them on), and big buttons into a game.
// Loaded only when it opens: the preview brings three.js.
import { Suspense, lazy, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { loadChogTokenPref } from '../chogTokenPref.ts';
import { toastError } from '../toast.tsx';
import { BRAND, GAMES } from '../../../shared/brand.ts';
import { getCharacter, isCharacterId, type CharacterId } from '../../../shared/characters.ts';
import { characterAvailable } from '../../../shared/season.ts';
import { PLAYER_COLORS } from '../../../shared/types.ts';
import type { Outfit } from '../../../shared/outfits.ts';
import { CloseX, Modal } from './Modal.tsx';
import OutfitPicker from './OutfitPicker.tsx';
import { loadColorPref, loadOutfitPref, saveColorPref, saveOutfitPref } from './outfitBits.tsx';
import '../styles/welcome.css';

const CharacterPreview = lazy(() => import('../three/characters/CharacterPreview.tsx'));

/** The character the tour dresses: the one picked last (in a lobby or on /characters), else the Chog. */
function prefCharacter(): CharacterId {
  try {
    const c = localStorage.getItem(CHARACTER_PREF_KEY);
    if (isCharacterId(c) && characterAvailable(c)) return c;
  } catch { /* private mode */ }
  return 'chog';
}

/** Lobby.tsx's CHARACTER_PREF_KEY (not imported: that would bring the whole lobby along). */
const CHARACTER_PREF_KEY = 'yot:character';
const NAME_MAX = 20;

const STEPS = ['Your name', 'Your Chog', "Let's play"] as const;

export default function WelcomeTour({ onClose }: { onClose: () => void }) {
  const { profile, rename } = useAuth();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [character] = useState(prefCharacter);
  const token = character === 'chog' ? loadChogTokenPref() ?? undefined : undefined;
  const [color, setColor] = useState(() => loadColorPref() ?? PLAYER_COLORS[4]);
  const [outfit, setOutfit] = useState<Outfit>(() => loadOutfitPref(character));

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    const next = name.replace(/\s+/g, ' ').trim();
    if (next && next !== profile?.name) {
      setSaving(true);
      try { await rename(next); } catch (err) { toastError(err); return; } finally { setSaving(false); }
    }
    setStep(1);
  };
  const saveLook = () => {
    saveColorPref(color);
    saveOutfitPref(outfit, character);
    setStep(2);
  };
  const go = (path: string) => { onClose(); nav(path); };

  return (
    <Modal onClose={onClose} labelledBy="welcome-title" className="welcome" dismissable={false}>
      <div className="howto-head">
        <h2 id="welcome-title">Welcome to {BRAND.name}!</h2>
        <CloseX onClick={onClose} label="Skip the welcome" />
      </div>
      <ol className="welcome-steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
            <span aria-hidden>{i < step ? '✓' : i + 1}</span> {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <form className="welcome-body" onSubmit={saveName}>
          <label htmlFor="welcome-name" className="welcome-q">What should we call you at the table?</label>
          <input id="welcome-name" className="welcome-name" value={name} maxLength={NAME_MAX} autoComplete="nickname"
            onChange={e => setName(e.target.value)} data-autofocus />
          <p className="welcome-note">Everyone sees it in games, chat and the leaderboard. Change it any time with “Replay the welcome tour” at the bottom of the page.</p>
          <div className="welcome-actions">
            <button type="submit" className="btn primary big" disabled={saving || name.trim().length < 2}>
              {saving ? 'Saving…' : 'Next'}
            </button>
          </div>
        </form>
      )}

      {step === 1 && (
        <div className="welcome-body">
          <div className="welcome-look">
            <div className="welcome-preview" aria-label={`${getCharacter(character).name} preview`} role="img">
              <Suspense fallback={<div className="welcome-preview-wait" />}>
                <CharacterPreview character={character} color={color} outfit={outfit} chogToken={token} />
              </Suspense>
            </div>
            <div className="welcome-pick">
              <div className="color-grid" role="group" aria-label="Your colour">
                {PLAYER_COLORS.map(c => (
                  <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={color === c}
                    className={`color-pick ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
                ))}
              </div>
              <OutfitPicker outfit={outfit} color={color} character={character} onChange={setOutfit} />
            </div>
          </div>
          <p className="welcome-note">
            Hold a Chog Genesis NFT? <button type="button" className="ft-link" onClick={() => go('/wallet')}>Link your wallet</button> and
            play as your own Chog.
          </p>
          <div className="welcome-actions">
            <button type="button" className="btn ghost" onClick={() => setStep(0)}>Back</button>
            <button type="button" className="btn primary big" onClick={saveLook} data-autofocus>Next</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="welcome-body">
          <p className="welcome-q">You're all set{profile ? `, ${profile.name}` : ''}. What first?</p>
          <div className="welcome-games">
            <button type="button" className="welcome-game" onClick={() => go(GAMES.monopoly.path)} data-autofocus>
              <span aria-hidden>🎩</span><b>{GAMES.monopoly.name}</b><small>Roll, buy, build with friends or bots</small>
            </button>
            <button type="button" className="welcome-game" onClick={() => go(GAMES.cards.path)}>
              <span aria-hidden>🃏</span><b>{GAMES.cards.name}</b><small>Quick rounds: match, stack, shout</small>
            </button>
            <button type="button" className="welcome-game" onClick={() => go(`${GAMES.cards.path}#daily`)}>
              <span aria-hidden>📅</span><b>Daily Challenge</b><small>One deal a day, one try, a leaderboard</small>
            </button>
            <button type="button" className="welcome-game" onClick={() => go((GAMES.poker as { path?: string }).path ?? '/poker')}>
              <span aria-hidden>♠️</span><b>{GAMES.poker.name}</b><small>Hold'em tournaments, play chips only</small>
            </button>
          </div>
          <div className="welcome-actions">
            <button type="button" className="btn ghost" onClick={() => setStep(1)}>Back</button>
            <button type="button" className="btn ghost" onClick={onClose}>Just look around</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
