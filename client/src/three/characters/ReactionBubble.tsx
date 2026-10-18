// A reaction popping out over a character's head. Drawn as HTML pinned to the
// figure (drei <Html>), so the emoji uses the system's own colour glyphs and
// always faces the camera; it moves with the piece because it lives inside
// the piece's group. The pop/float animation is CSS (.react-3d).
import { Html } from '@react-three/drei';

// The <Html> stays mounted for the piece's lifetime and only its content
// changes: mounting and unmounting drei portals mid-update can trip React's
// DOM bookkeeping ("removeChild … not a child").
export function ReactionBubble({ emoji, seq }: { emoji?: string; seq?: number }) {
  return (
    <Html center position={[0, 1.65, 0]} zIndexRange={[5, 0]} pointerEvents="none">
      {emoji && <div key={seq} className="react-3d" aria-hidden>{emoji}</div>}
    </Html>
  );
}
