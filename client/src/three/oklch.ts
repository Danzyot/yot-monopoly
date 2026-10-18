// OKLCH → sRGB, for colour ramps planned in a perceptual space (even
// lightness and chroma across hues, unlike HSL). Out-of-gamut colours lose
// chroma until they fit, so a ramp keeps its lightness and hue.

const gamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toLinear(L: number, C: number, h: number): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** CSS colour for an OKLCH triple (L 0–1, C ~0–0.37, h degrees), with optional alpha. */
export function oklch(L: number, C: number, h: number, alpha = 1): string {
  let c = C;
  let rgb = toLinear(L, c, h);
  while (c > 0.001 && rgb.some(v => v < -1e-4 || v > 1.0001)) {
    c -= 0.004;
    rgb = toLinear(L, c, h);
  }
  const [r, g, b] = rgb.map(v => Math.round(gamma(Math.min(1, Math.max(0, v))) * 255));
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

/** Relative luminance of a #rrggbb colour (WCAG). */
export function luminance(hex: string): number {
  const lin = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5);
}
