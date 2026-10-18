// Styled hover notes for the whole site. Any element with a `title` gets the
// game's own tooltip instead of the browser's grey system one: on hover (after
// a short beat) or keyboard focus, the title moves to data-tip (so the system
// tooltip never shows) and a themed bubble appears above it, or below when
// there is no room. Touch screens get nothing, as before.

const DELAY_MS = 350;
let tip: HTMLDivElement | null = null;
let owner: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** The element's note, taking it over from `title` the first time. */
function noteOf(el: HTMLElement): string {
  const t = el.getAttribute('title');
  if (t) {
    el.dataset.tip = t;
    el.removeAttribute('title');
    // Keep an accessible name for icon-only buttons that relied on the title.
    if (!el.getAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', t);
  }
  return el.dataset.tip ?? '';
}

function hide() {
  if (timer) { clearTimeout(timer); timer = null; }
  tip?.remove();
  tip = null;
  owner = null;
}

function place(el: HTMLElement, box: HTMLDivElement) {
  const r = el.getBoundingClientRect();
  const w = box.offsetWidth, h = box.offsetHeight, gap = 8;
  const below = r.top - h - gap < 4;
  box.classList.toggle('below', below);
  const left = Math.min(window.innerWidth - w - 6, Math.max(6, r.left + r.width / 2 - w / 2));
  box.style.left = `${left}px`;
  box.style.top = `${below ? r.bottom + gap : r.top - h - gap}px`;
  box.style.setProperty('--arrow-x', `${Math.min(w - 12, Math.max(12, r.left + r.width / 2 - left))}px`);
}

function show(el: HTMLElement, now = false) {
  const text = noteOf(el);
  if (!text) return;
  hide();
  owner = el;
  timer = setTimeout(() => {
    if (owner !== el || !el.isConnected) return;
    const box = document.createElement('div');
    box.className = 'yot-tip';
    box.setAttribute('role', 'tooltip');
    box.textContent = text;
    document.body.appendChild(box);
    tip = box;
    place(el, box);
  }, now ? 0 : DELAY_MS);
}

const target = (e: Event) => (e.target instanceof Element ? e.target.closest<HTMLElement>('[title],[data-tip]') : null);

export function installTooltips() {
  if (typeof document === 'undefined' || (window as unknown as { __yotTips?: boolean }).__yotTips) return;
  (window as unknown as { __yotTips?: boolean }).__yotTips = true;
  document.addEventListener('pointerover', e => {
    const el = target(e);
    if ((e as PointerEvent).pointerType === 'touch') {
      // No hover notes on touch, but still stop the system one.
      if (el) noteOf(el);
      return;
    }
    if (el === owner) return;
    if (el) show(el); else hide();
  });
  document.addEventListener('pointerout', e => {
    if (!owner) return;
    const to = (e as PointerEvent).relatedTarget;
    if (!(to instanceof Node) || !owner.contains(to)) hide();
  });
  document.addEventListener('focusin', e => {
    const el = target(e);
    if (el && (e.target as HTMLElement).matches(':focus-visible')) show(el, true);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
}
