// Who this browser is, independently of who is signed in.
//
// An alt account does not need a VPN. It needs a second sign-in, and the
// cheapest way to get one is the same phone: sign out, sign in as somebody
// else. Addresses do not see that — same address, or a hotspot, either way
// nothing links the two accounts — but the browser is the same browser. So
// two things are sent with every connection:
//
//   device: a random id minted once and kept in this browser's storage. It
//     survives signing out and back in as another account, which is exactly
//     the move it is there to catch. It does not survive a cleared browser or
//     a private window, so it is a strong signal when it matches and says
//     nothing when it does not.
//
//   print: a hash of traits the browser reports about itself — screen,
//     timezone, language, platform, cores, memory, and how it draws a canvas.
//     It survives cleared storage, but two identical phones on the same OS
//     version produce the same hash, so on its own it is a hint. Together with
//     an address, or a device id, it is a lot more than a hint.
//
// Neither is a fingerprint of a PERSON: no account, name or address goes into
// either. The audit joins them to accounts server-side, for the operator only.

const DEVICE_KEY = 'wawa.device';

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

let deviceMemo: string | null = null;

export function deviceId(): string {
  if (deviceMemo) return deviceMemo;
  let id: string | null = null;
  try { id = localStorage.getItem(DEVICE_KEY); } catch { /* storage blocked */ }
  if (!id || !/^[0-9a-f]{32}$/.test(id)) {
    id = randomId();
    try { localStorage.setItem(DEVICE_KEY, id); } catch { /* falls back to a per-load id */ }
  }
  deviceMemo = id;
  return id;
}

// FNV-1a over a string, 32-bit, hex. Not cryptographic — it only has to be
// stable and cheap, and collisions between different devices merely make the
// hint weaker, never wrong about the device id.
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function canvasTrait(): string {
  try {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 40;
    const g = c.getContext('2d');
    if (!g) return 'nocanvas';
    g.textBaseline = 'top';
    g.font = '14px "Arial"';
    g.fillStyle = '#f60';
    g.fillRect(100, 1, 62, 20);
    g.fillStyle = '#069';
    g.fillText('wawa ♠♥♦♣ 0123', 2, 15);
    g.fillStyle = 'rgba(102, 204, 0, 0.7)';
    g.fillText('wawa ♠♥♦♣ 0123', 4, 17);
    return fnv1a(c.toDataURL());
  } catch {
    return 'nocanvas';
  }
}

let printMemo: string | null = null;

export function devicePrint(): string {
  if (printMemo) return printMemo;
  const n = navigator as Navigator & { deviceMemory?: number; userAgentData?: { platform?: string } };
  const traits = [
    n.userAgent,
    n.language,
    (n.languages ?? []).join(','),
    n.platform,
    n.userAgentData?.platform ?? '',
    String(n.hardwareConcurrency ?? ''),
    String(n.deviceMemory ?? ''),
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    String(window.devicePixelRatio),
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
    String(new Date().getTimezoneOffset()),
    String(n.maxTouchPoints ?? ''),
    canvasTrait(),
  ];
  printMemo = fnv1a(traits.join('|'));
  return printMemo;
}
