import { RGB } from '../core/color';
import { PixBuf } from '../render/canvas';

/**
 * 国旗系统
 * 五星红旗严格按《国旗法》规定比例（3:2，大星位于左上 1/4 区 (5,5)，四颗小星各一角正对大星中心）栅格化。
 * 动画：每种风力 8 帧预渲染 Sprite，仅做柔和、庄重的布面波动，图案始终保持完整可辨。
 */
const RED: RGB = [222, 41, 16];
const YELLOW: RGB = [255, 222, 0];

export const FLAG_W = 45;
export const FLAG_H = 30;
export const WIND_LEVELS = 3;
export const FLAG_FRAMES = 8;
const PAD = 4;

function starPolygon(cx: number, cy: number, R: number, rot: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? R : R * 0.382;
    const a = rot + (i * Math.PI) / 5;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

function inPoly(x: number, y: number, pts: [number, number][]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 平面国旗像素（W×H） */
export function rasterFlag(W: number, H: number): RGB[][] {
  const u = W / 30;
  const stars: [number, number][][] = [];
  stars.push(starPolygon(5 * u, 5 * u, 3 * u, -Math.PI / 2));
  for (const [sx, sy] of [
    [10, 2],
    [12, 4],
    [12, 7],
    [10, 9],
  ]) {
    const rot = Math.atan2(5 - sy, 5 - sx);
    stars.push(starPolygon(sx * u, sy * u, Math.max(1.05, u), rot));
  }
  const out: RGB[][] = [];
  for (let y = 0; y < H; y++) {
    const row: RGB[] = [];
    for (let x = 0; x < W; x++) {
      let cov = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const px = x + (sx + 0.5) / 4;
          const py = y + (sy + 0.5) / 4;
          if (stars.some((s) => inPoly(px, py, s))) cov++;
        }
      row.push(cov >= 5 ? YELLOW : RED);
    }
    out.push(row);
  }
  return out;
}

const AMP = [0.7, 1.4, 2.2];

/** 生成 [风力][帧] 的旗面 Sprite */
export function buildFlagFrames(): HTMLCanvasElement[][] {
  const flat = rasterFlag(FLAG_W, FLAG_H);
  const res: HTMLCanvasElement[][] = [];
  for (let lv = 0; lv < WIND_LEVELS; lv++) {
    const frames: HTMLCanvasElement[] = [];
    const A = AMP[lv];
    const waves = 1.1 + lv * 0.25;
    for (let f = 0; f < FLAG_FRAMES; f++) {
      const ph = (f / FLAG_FRAMES) * Math.PI * 2;
      const buf = new PixBuf(FLAG_W, FLAG_H + PAD * 2);
      for (let x = 0; x < FLAG_W; x++) {
        const q = x / (FLAG_W - 1);
        const arg = Math.PI * 2 * q * waves - ph;
        const dy = A * Math.pow(q, 0.8) * Math.sin(arg);
        const slope = Math.cos(arg) * Math.min(1, q * 3);
        const shade = 1 + slope * (0.1 + lv * 0.04);
        const off = Math.round(dy);
        for (let y = 0; y < FLAG_H; y++) {
          const c = flat[y][x];
          buf.set(x, y + PAD + off, [Math.min(255, c[0] * shade), Math.min(255, c[1] * shade), Math.min(255, c[2] * shade)]);
        }
      }
      frames.push(buf.toCanvas());
    }
    res.push(frames);
  }
  return res;
}

export const FLAG_PAD = PAD;

/** 小国旗（灯杆旗、游客手持旗）2 帧 */
export function buildSmallFlags(): { lamp: HTMLCanvasElement[]; hand: HTMLCanvasElement[] } {
  const mk = (w: number, h: number, wave: number) => {
    const frames: HTMLCanvasElement[] = [];
    for (let f = 0; f < 2; f++) {
      const buf = new PixBuf(w, h + 2);
      for (let x = 0; x < w; x++) {
        const off = wave && x > 1 && ((x + f) & 1) ? 1 : 0;
        for (let y = 0; y < h; y++) {
          const star = (w >= 6 && x === 1 && y === 1) || (w < 6 && x === 0 && y === 0);
          const small = w >= 6 && x === 3 && (y === 0 || y === 2);
          buf.set(x, y + off, star || small ? YELLOW : RED);
        }
      }
      frames.push(buf.toCanvas());
    }
    return frames;
  };
  return { lamp: mk(6, 4, 1), hand: mk(3, 2, 0) };
}
