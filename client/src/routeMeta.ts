// Keeps the tab title and the share tags in step with the page as the player
// moves around the app. The server already sent the right ones for the first
// page (server/src/seo.ts); the table (shared/seo.ts) loads on the first
// navigation, so it never weighs on the home page's first download.
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

function setMeta(attr: 'name' | 'property', key: string, value: string | null) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (value === null) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = value;
}

function setCanonical(href: string | null) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (href === null) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  el.href = href;
}

/** The title this file (or the server) last set; a page that sets its own (a tournament's name) keeps it. */
let autoTitle = typeof document === 'undefined' ? '' : document.title;

export function useRouteMeta(): void {
  const path = useLocation().pathname;
  useEffect(() => {
    let live = true;
    void import('../../shared/seo.ts').then(({ routeMeta, SITE_URL, SITE_NAME }) => {
      if (!live) return;
      const m = routeMeta(path);
      const url = SITE_URL + m.path;
      if (document.title === autoTitle || document.title === SITE_NAME) document.title = autoTitle = m.title;
      setMeta('name', 'description', m.description);
      setMeta('name', 'robots', m.noindex ? 'noindex' : null);
      setMeta('property', 'og:title', m.title);
      setMeta('property', 'og:description', m.description);
      setMeta('property', 'og:url', url);
      setMeta('name', 'twitter:title', m.title);
      setMeta('name', 'twitter:description', m.description);
      setCanonical(m.status === 200 ? url : null);
    }).catch(() => { /* an old tab after a deploy: the title just stays */ });
    return () => { live = false; };
  }, [path]);
}
