// The Chance and Community Chest piles, sitting on their spots in the middle
// of the board. When someone draws, the top card lifts off its pile, turns
// over and flies up to the camera; the card's text then takes over on screen
// (CardPopup waits CARD_FLIGHT_MS for it).

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BoxGeometry, CanvasTexture, Euler, Group, MeshStandardMaterial, PlaneGeometry, Quaternion,
  SRGBColorSpace, Vector3, type Mesh, type Texture,
} from 'three';
import type { Theme } from '../../../shared/themes.ts';
import type { DeckId } from '../../../shared/cards.ts';
import type { CardShown } from '../../../shared/types.ts';
import { W } from './layout.ts';
import { CARD_FLIGHT_MS, useSceneBusy } from './sequence.ts';


const S = 2048 / W; // board canvas pixels per world unit (boardTexture.ts)
const CW = 2.2, CD = 1.12; // card size, world units (the printed spot is 2.47 × 1.29)
const PILE = 0.07;

/** Where the piles sit: the board's printed spots, in the centre's 45° frame. */
function spots(withLogo: boolean): Record<DeckId, [number, number]> {
  return withLogo
    ? { chest: [-580 / S, -60 / S], chance: [580 / S, -60 / S] }
    : { chest: [0, -430 / S], chance: [0, 430 / S] };
}

function deckColors(theme: Theme, deck: DeckId): [string, string] {
  if (theme.ui) return deck === 'chance' ? [theme.palette.accent, theme.palette.accent] : [theme.ui.panelSolid, theme.ui.panelSolid];
  return deck === 'chance' ? ['#ffd27a', '#ff9f2e'] : ['#a8dcff', '#54a8f5'];
}

function cardCanvas(theme: Theme, deck: DeckId, text?: string): HTMLCanvasElement {
  const w = 640, h = Math.round((640 * CD) / CW);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  const [a, b] = deckColors(theme, deck);
  const display = theme.ui?.display ?? '"Lilita One", sans-serif';
  const font = theme.ui?.font ?? 'Nunito, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.roundRect(0, 0, w, h, 36); ctx.fill();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, a); g.addColorStop(1, b);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.roundRect(14, 14, w - 28, h - 28, 26); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const name = theme.deckNames[deck].toUpperCase();
  if (text === undefined) {
    // The back: a big faint glyph behind the deck's name.
    ctx.globalAlpha = 0.22; ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${h * 0.9}px ${display}`;
    if (deck === 'chance') {
      ctx.fillText('?', w * 0.18, h * 0.55);
      ctx.fillText('?', w * 0.82, h * 0.55);
    } else {
      // A little treasure chest each side.
      for (const x of [w * 0.15, w * 0.85]) {
        ctx.beginPath(); ctx.roundRect(x - 50, h * 0.42, 100, 70, 8); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x, h * 0.42, 50, 30, 0, Math.PI, 0); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    let size = 64;
    do { ctx.font = `400 ${size}px ${display}`; size -= 2; } while (ctx.measureText(name).width > w * 0.62 && size > 20);
    ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineJoin = 'round';
    ctx.strokeText(name, w / 2, h / 2 + 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, w / 2, h / 2);
  } else {
    // The face: the deck's name and what the card says.
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.roundRect(34, 78, w - 68, h - 112, 18); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `400 40px ${display}`;
    ctx.fillText(name, w / 2, 46);
    ctx.fillStyle = '#1a1a2e';
    let size = 34, lines: string[] = [];
    for (; size >= 16; size -= 2) {
      ctx.font = `800 ${size}px ${font}`;
      lines = wrapLines(ctx, text, w - 110);
      if (lines.length * size * 1.25 <= h - 140) break;
    }
    const top = 78 + (h - 112) / 2 - ((lines.length - 1) * size * 1.25) / 2;
    lines.forEach((l, i) => ctx.fillText(l, w / 2, top + i * size * 1.25));
  }
  return cv;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(next).width > max && cur) { out.push(cur); cur = word; } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

function texture(cv: HTMLCanvasElement): Texture {
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const pileGeo = new BoxGeometry(CW, PILE, CD);
const looseGeo = new BoxGeometry(CW, 0.008, CD);
const faceGeo = new PlaneGeometry(CW, CD);
const edgeMat = new MeshStandardMaterial({ color: '#f1ece0', roughness: 0.85 });

function Pile({ theme, deck, back }: { theme: Theme; deck: DeckId; back: Texture }) {
  const top = useMemo(() => new MeshStandardMaterial({ map: back, roughness: 0.55 }), [back]);
  useEffect(() => () => top.dispose(), [top]);
  const mats = [edgeMat, edgeMat, top, edgeMat, edgeMat, edgeMat];
  // A couple of loose cards on top, not quite square, so it reads as a pile.
  const jitter = deck === 'chance' ? [0.04, -0.03] : [-0.035, 0.05];
  return (
    <group>
      <mesh castShadow receiveShadow geometry={pileGeo} material={mats} position={[0, PILE / 2, 0]} />
      <mesh castShadow receiveShadow geometry={looseGeo} material={mats} position={[0.02, PILE + 0.004, -0.015]} rotation={[0, jitter[0], 0]} />
      <mesh castShadow receiveShadow geometry={looseGeo} material={mats} position={[-0.01, PILE + 0.012, 0.01]} rotation={[0, jitter[1], 0]} />
    </group>
  );
}

const FRAME = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4);
// Lying face down on the pile with the back reading the same way as the pile's top.
const LIE = new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, Math.PI));
const tmpV = new Vector3();
const tmpQ = new Quaternion();

/** The card in flight: a two-sided card from the pile to just in front of the camera. */
function Flyer({ theme, card, from, back }: { theme: Theme; card: CardShown | null; from: Vector3; back: Texture }) {
  const group = useRef<Group>(null);
  const front = useRef<Mesh>(null);
  const backMesh = useRef<Mesh>(null);
  const start = useRef(0);
  const { camera } = useThree();
  const startQ = useMemo(() => FRAME.clone().multiply(LIE), []);
  const faceTex = useMemo(() => (card ? texture(cardCanvas(theme, card.deck, card.text)) : null), [card, theme]);
  useEffect(() => () => faceTex?.dispose(), [faceTex]);
  useEffect(() => { if (card) start.current = performance.now(); }, [card]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = card ? (performance.now() - start.current) / CARD_FLIGHT_MS : 2;
    g.visible = t < 1.15;
    if (!g.visible) return;
    const k = Math.min(1, t);
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    // End point: where the on-screen card appears (about its size, a little above
    // the middle), so one hands over to the other.
    const end = tmpV.set(0, 0.73, -7.3).applyQuaternion(camera.quaternion).add(camera.position);
    g.position.lerpVectors(from, end, e);
    g.position.y += Math.sin(Math.PI * k) * 0.8; // lift off before flying
    g.quaternion.slerpQuaternions(startQ, tmpQ.copy(camera.quaternion), Math.min(1, k * 1.25));
    const fade = t > 1 ? 1 - (t - 1) / 0.15 : 1;
    for (const m of [front.current, backMesh.current]) {
      const mat = m?.material as MeshStandardMaterial | undefined;
      if (mat) mat.opacity = fade;
    }
  });

  return (
    <group ref={group} visible={false}>
      <mesh ref={front} geometry={faceGeo}>
        <meshBasicMaterial map={faceTex} transparent toneMapped={false} />
      </mesh>
      <mesh ref={backMesh} geometry={faceGeo} rotation={[0, Math.PI, 0]}>
        <meshBasicMaterial map={back} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

export function CardDecks({ theme, withLogo, lastCard }: { theme: Theme; withLogo: boolean; lastCard: CardShown | null }) {
  const backs = useMemo(() => ({
    chance: texture(cardCanvas(theme, 'chance')),
    chest: texture(cardCanvas(theme, 'chest')),
  }), [theme]);
  useEffect(() => () => { backs.chance.dispose(); backs.chest.dispose(); }, [backs]);
  const at = useMemo(() => spots(withLogo), [withLogo]);

  // Fly a card once the piece has arrived; ignore whatever card was showing when we mounted.
  const busy = useSceneBusy();
  const seen = useRef(lastCard?.seq ?? 0);
  const flying = useRef<CardShown | null>(null);
  if (lastCard && lastCard.seq > seen.current && !busy) {
    seen.current = lastCard.seq;
    flying.current = lastCard;
  }
  const card = flying.current;
  const from = useMemo(() => {
    if (!card) return new Vector3();
    const [x, z] = at[card.deck];
    return new Vector3(x, PILE + 0.03, z).applyQuaternion(FRAME);
  }, [card, at]);

  return (
    <>
      <group rotation={[0, Math.PI / 4, 0]}>
        {(['chest', 'chance'] as const).map(d => (
          <group key={d} position={[at[d][0], 0, at[d][1]]}>
            <Pile theme={theme} deck={d} back={backs[d]} />
          </group>
        ))}
      </group>
      <Flyer theme={theme} card={card} from={from} back={card ? backs[card.deck] : backs.chance} />
    </>
  );
}
