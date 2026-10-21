// A character's face in 2D: its rendered face (Chog's, tools/blender/chog_face.py)
// where it has one, else its emoji. Sized in em, so it fills whatever disc or
// line the emoji would have.
import { getCharacter } from '../../../shared/characters.ts';

export function Face({ emoji, image }: { emoji: string; image?: string }) {
  return image ? <img className="face-img" src={image} alt="" width={64} height={64} draggable={false} /> : <>{emoji}</>;
}

export function CharacterFace({ id }: { id: string }) {
  const c = getCharacter(id);
  return <Face emoji={c.emoji} image={c.face} />;
}
