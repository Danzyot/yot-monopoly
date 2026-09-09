// Chog's lockup, set into the bottom-left corner of the table page.
//
// Purely decorative, and deliberately so. The sibling sites put the operator's
// homepage behind this mark, which meant a piece of artwork the size of a
// hand chart sat beside a live table one stray tap away from navigating a
// player out of a pot they were still in. There is nothing here to click.
import ChogLogo from './ChogLogo';

export default function ChogMark() {
  return (
    <div className="cg-mark" aria-hidden>
      <span className="cg-mark-glow" />
      <ChogLogo className="cg-mark-img" height={128} />
    </div>
  );
}
