/** Discord avatar URL or an emoji. */
export function Avatar({ src, size = 28 }: { src: string; size?: number }) {
  if (/^https:\/\//.test(src)) {
    return <img className="avatar" src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" />;
  }
  return <span className="avatar emoji" style={{ width: size, height: size, fontSize: size * 0.6 }}>{src}</span>;
}
