// derive the full set of rail accent css vars from a single user-picked hex.
// the named palettes hand-tune each var; here we approximate them with
// lighten/darken mixes so the rail still has the user/assistant tint pattern
// instead of going flat one-color.

function clamp(n: number, lo = 0, hi = 255): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function parseHex(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6) return [163, 163, 163];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b))
    return [163, 163, 163];
  return [r, g, b];
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => clamp(Math.round(n)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

// blend toward white (t > 0) or black (t < 0). t in -1..1.
function shade(rgb: [number, number, number], t: number): [number, number, number] {
  const target = t > 0 ? 255 : 0;
  const k = Math.abs(t);
  return [
    rgb[0] + (target - rgb[0]) * k,
    rgb[1] + (target - rgb[1]) * k,
    rgb[2] + (target - rgb[2]) * k,
  ];
}

// approximate luminance — used to pick a contrasting foreground color.
function luminance(rgb: [number, number, number]): number {
  return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
}

export interface AccentVars {
  "--m-user": string;
  "--m-asst": string;
  "--m-user-active": string;
  "--m-asst-active": string;
  "--accent": string;
  "--accent-hover": string;
  "--accent-soft": string;
  "--accent-fg": string;
}

export function deriveAccentVars(hex: string): AccentVars {
  const base = parseHex(hex);
  const lighter = shade(base, 0.18);
  const lighterMore = shade(base, 0.4);
  const darker = shade(base, -0.25);
  const fg = luminance(base) > 0.6 ? "#0a0a0a" : "#fafafa";
  return {
    "--m-user": rgbToHex(...lighter),
    "--m-asst": rgbToHex(...darker),
    "--m-user-active": rgbToHex(...lighterMore),
    "--m-asst-active": rgbToHex(...base),
    "--accent": rgbToHex(...base),
    "--accent-hover": rgbToHex(...lighter),
    "--accent-soft": `rgba(${Math.round(base[0])},${Math.round(base[1])},${Math.round(base[2])},0.28)`,
    "--accent-fg": fg,
  };
}

// builds the box-shadow value used by the highlight halo on jump. mirrors
// the per-accent rule in cleanup.ts.
export function deriveHaloShadow(hex: string): string {
  const [r, g, b] = parseHex(hex);
  const rr = Math.round(r);
  const gg = Math.round(g);
  const bb = Math.round(b);
  return `0 0 20px -4px rgba(${rr},${gg},${bb},0.50),0 0 36px 0 rgba(${rr},${gg},${bb},0.12)`;
}
