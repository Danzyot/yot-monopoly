// Player avatar: either an emoji string or an image URL (Discord pfp).
export default function Avatar({ value, size = 20 }: { value: string; size?: number }) {
  if (value.startsWith('http')) {
    return (
      <img
        className="avatar-img"
        src={value}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }
  return <span className="avatar" style={{ fontSize: size * 0.8 }}>{value}</span>;
}
