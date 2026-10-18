// A reaction popping out over a character's head. Drawn as HTML pinned to the
// figure (three/overlay.ts), so the emoji uses the system's own colour glyphs
// and always faces the camera; it moves with the piece because its anchor
// lives inside the piece's group. The pop/float animation is CSS (.react-3d).
// Nothing is on the page (and nothing runs per frame) between reactions.
import { useEffect, useRef } from 'react';
import type { Group } from 'three';
import { usePins } from '../overlay.ts';

export function ReactionBubble({ emoji, seq }: { emoji?: string; seq?: number }) {
  const anchor = useRef<Group>(null);
  const pins = usePins();
  useEffect(() => {
    if (!emoji || !anchor.current) return;
    // A new element per reaction (keyed on seq), so the CSS pop plays again.
    const el = document.createElement('div');
    el.className = 'react-3d';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = emoji;
    const pin = pins.add(el, anchor.current, [5, 0]);
    return () => pins.remove(pin);
  }, [emoji, seq, pins]);
  return <group ref={anchor} position={[0, 1.65, 0]} />;
}
