import { DAY } from './math';

export type RGB = [number, number, number];

export const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const c255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

export const toHex = (c: RGB) =>
  '#' + c.map((v) => c255(v).toString(16).padStart(2, '0')).join('');

export const css = (c: RGB, a = 1) => `rgba(${c255(c[0])},${c255(c[1])},${c255(c[2])},${a})`;

export const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export const scale = (a: RGB, f: number): RGB => [a[0] * f, a[1] * f, a[2] * f];

export const lighten = (h: string, f: number) => toHex(mix(hex(h), [255, 255, 255], f));
export const darken = (h: string, f: number) => toHex(mix(hex(h), [0, 0, 0], f));

export interface Key<T> {
  t: number;
  v: T;
}

/** 在 24 小时循环的关键帧上采样（keys 需按 t 升序）。 */
export function sampleKeys<T>(keys: Key<T>[], t: number, lerpFn: (a: T, b: T, f: number) => T, period = DAY): T {
  const n = keys.length;
  let i = n - 1;
  for (let k = 0; k < n; k++) if (keys[k].t <= t) i = k;
  const a = keys[i];
  const b = keys[(i + 1) % n];
  let tb = b.t;
  let tt = t;
  if (tb <= a.t) tb += period;
  if (tt < a.t) tt += period;
  let f = (tt - a.t) / (tb - a.t);
  f = (f + f * f * (3 - 2 * f)) / 2;
  return lerpFn(a.v, b.v, f);
}

export const lerpNum = (a: number, b: number, f: number) => a + (b - a) * f;
