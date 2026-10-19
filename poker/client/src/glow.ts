// The pink aura that follows the cursor across Chog's primary buttons.
//
// The halo outside the button slides left and right with the pointer, and the
// face of the button picks up a soft cream sheen under it — the mascot's own
// highlight colour, which is the one thing that reads as light on pink.
//
// This is done from one document-level listener rather than per-button React
// state on purpose. Buttons appear and disappear constantly on a live table —
// the dock rebuilds every street — and a listener per button would mean
// mounting and tearing down handlers mid-hand. One listener that asks
// `closest()` where the pointer is costs a single call per move and survives
// any amount of re-rendering underneath it.
//
// It writes three custom properties on the hovered button, which the CSS in
// index.css reads:
//   --gx, --gy  the pointer's position over the button, as a percentage
//   --gxn       the same horizontally, as -1 … 1, for the halo's offset

const SELECTOR = '.btn-primary, .btn-lit';

export function installButtonGlow(): () => void {
  // Touch and pen have no hover, so there is nothing to follow and no reason
  // to run a move handler at all.
  if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) {
    return () => {};
  }

  let lit: HTMLElement | null = null;

  const release = () => {
    if (!lit) return;
    lit.classList.remove('is-glowing');
    lit.style.removeProperty('--gx');
    lit.style.removeProperty('--gy');
    lit.style.removeProperty('--gxn');
    lit = null;
  };

  const onMove = (e: PointerEvent) => {
    const target = e.target as Element | null;
    const btn = target?.closest?.(SELECTOR) as HTMLElement | null;
    // A disabled button is not offering anything, so it does not light up.
    if (!btn || (btn as HTMLButtonElement).disabled) {
      release();
      return;
    }
    if (btn !== lit) {
      release();
      lit = btn;
      btn.classList.add('is-glowing');
    }
    const r = btn.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const fx = (e.clientX - r.left) / r.width;
    btn.style.setProperty('--gx', `${(fx * 100).toFixed(1)}%`);
    btn.style.setProperty('--gy', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
    // Clamped, so a pointer just past the edge cannot fling the halo away.
    btn.style.setProperty('--gxn', (Math.max(0, Math.min(1, fx)) * 2 - 1).toFixed(3));
  };

  // A button can vanish while lit — the dock rebuilds between streets, modals
  // close under the cursor. `pointerdown` and the scroll/blur pair catch the
  // cases where no further move event will arrive to clear it.
  const onLeave = () => release();

  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerleave', onLeave);
  window.addEventListener('blur', onLeave);
  window.addEventListener('scroll', onLeave, { passive: true, capture: true });

  return () => {
    release();
    window.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('blur', onLeave);
    window.removeEventListener('scroll', onLeave, { capture: true } as EventListenerOptions);
  };
}
