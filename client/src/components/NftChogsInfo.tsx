// "What are NFT Chogs?": the Characters page's explainer, under the Chog
// picker. A Chog Genesis holder who links a wallet plays as their own Chog,
// built in 3D from its traits; a few real tokens show the NFT art beside the
// figure the game makes of it, and the two ways to link a wallet are listed.
//
// The art is the hub's thumbnails (client/public/chogs/<id>.webp); the 3D
// renders are client/public/chogs/examples/<id>.webp, made by
// tools/blender/chog_examples.sh (rerun it after changing the trait parts;
// keep its token list in step with EXAMPLES).
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { GAMES } from '../../../shared/brand.ts';
import { chogName } from '../../../shared/chogs/traits.ts';
import { CloseX, Modal } from './Modal.tsx';

/** Picked to look different from each other: hats, outfits, a Skull, laser eyes, a held prop. */
const EXAMPLES: { id: number; note: string }[] = [
  { id: 1, note: 'MCGA cap, Bitcoin glasses and a Fwog in hand' },
  { id: 597, note: 'Crown and a black tracksuit' },
  { id: 61, note: 'A Skull with fire lasers and a CEO vest' },
  { id: 124, note: 'Shark suit, tired eyes' },
  { id: 1089, note: 'Horny cap, glasses, farmer shirt' },
  { id: 425, note: 'Robber mask and a Chug Life tee' },
];

function NftChogsDialog({ onClose, onShow }: { onClose: () => void; onShow?: (token: number) => void }) {
  return (
    <Modal onClose={onClose} labelledBy="nftc-title" className="nftc">
      <div className="howto-head">
        <h2 id="nftc-title">NFT Chogs</h2>
        <CloseX onClick={onClose} />
      </div>
      <p className="nftc-lead">
        Hold a Chog from the <b>Chog Genesis</b> collection? Link the wallet it is in and you can play as <b>your own Chog</b> at {GAMES.monopoly.name} and {GAMES.cards.name} tables.
        The game builds it in 3D from its traits: skin, eyes, mouth, hat, outfit, what it holds and its aura.
      </p>

      <h3 className="nftc-sub">From the art to the table</h3>
      <ul className="nftc-examples">
        {EXAMPLES.map(e => (
          <li key={e.id}>
            <div className="nftc-pair">
              <img className="nftc-art" src={`/chogs/${e.id}.webp`} alt={`${chogName(e.id)}, the NFT art`} width={128} height={128} loading="lazy" decoding="async" />
              <span className="nftc-arrow" aria-hidden>→</span>
              <img className="nftc-3d" src={`/chogs/examples/${e.id}.webp`} alt={`${chogName(e.id)} in 3D`} width={150} height={172} loading="lazy" decoding="async" />
            </div>
            <span className="nftc-name">
              {onShow
                ? <button type="button" className="nftc-show" onClick={() => { onShow(e.id); onClose(); }} title={`Show ${chogName(e.id)} on the turntable`}>{chogName(e.id)}</button>
                : <b>{chogName(e.id)}</b>}
            </span>
            <small className="nftc-note">{e.note}</small>
          </li>
        ))}
      </ul>
      {onShow && <p className="small muted nftc-tip">Tap a name to spin that Chog on the turntable.</p>}

      <h3 className="nftc-sub">Link your wallet</h3>
      <ol className="nftc-steps">
        <li><b>Connect and sign.</b> On the Wallet page, connect the wallet that holds your Chog and sign the message it shows. Signing is free: no transaction, no gas.</li>
        <li><b>Or prove it another way.</b> If that wallet can’t connect here, the Wallet page shows how to prove you hold it without connecting.</li>
      </ol>
      <p className="small muted">Your Chogs then show up here and in the lobby’s character picker. Holding is checked on-chain, so a Chog you sell leaves your list.</p>

      <div className="nftc-cta">
        <Link className="btn primary" to="/wallet" onClick={onClose} data-autofocus>Link your wallet →</Link>
        <button type="button" className="btn ghost" onClick={onClose}>Got it</button>
      </div>
    </Modal>
  );
}

/** The button under the Chog picker, and its dialog (on <body>, above the page's 3D stage). */
export default function NftChogsInfo({ onShow }: { onShow?: (token: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn small ghost nftc-open" onClick={() => setOpen(true)}>💎 What are NFT Chogs?</button>
      {open && createPortal(<NftChogsDialog onClose={() => setOpen(false)} onShow={onShow} />, document.body)}
    </>
  );
}
