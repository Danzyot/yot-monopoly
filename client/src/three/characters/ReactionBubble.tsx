// A reaction popping out over a character's head. Drawn as HTML pinned to the
// figure (drei <Html>), so the emoji uses the system's own colour glyphs and
// always faces the camera; it moves with the piece because it lives inside
// the piece's group. The pop/float animation is CSS (.react-3d).
import { Html } from '@react-three/drei';

export function ReactionBubble({ emoji, seq }: { emoji: string; seq: number }) {
  return (
    <Html key={seq} center position={[0, 1.65, 0]} zIndexRange={[5, 0]} pointerEvents="none">
      <div className="react-3d" aria-hidden>{emoji}</div>
    </Html>
  );
}
