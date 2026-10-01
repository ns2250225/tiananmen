export const DAY = 86400;
export const HOUR = 3600;

export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a: number, b: number) => Math.floor(a + Math.random() * (b - a + 1));
export const chance = (p: number) => Math.random() < p;
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

export function weighted<T>(items: readonly (readonly [T, number])[]): T {
  let total = 0;
  for (const [, w] of items) total += w;
  let r = Math.random() * total;
  for (const [v, w] of items) {
    r -= w;
    if (r <= 0) return v;
  }
  return items[items.length - 1][0];
}

export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 确定性二维哈希，0..1 */
export const hash2 = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const hash1 = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** 平滑一维值噪声，0..1 */
export function noise1(x: number, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i + seed * 1013), hash1(i + 1 + seed * 1013), u);
}

export const wrapDay = (t: number) => ((t % DAY) + DAY) % DAY;

/** "HH:MM" -> 秒 */
export const hm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * HOUR + m * 60;
};

export const fmtHM = (t: number) => {
  const s = Math.floor(wrapDay(t));
  const h = Math.floor(s / HOUR);
  const m = Math.floor((s % HOUR) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/** 高斯钟形 */
export const bump = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2));
