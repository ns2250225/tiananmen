import { hex, mix, RGB } from '../core/color';
import { hash2, mulberry32 } from '../core/math';
import { PixBuf } from '../render/canvas';
import { Layout } from './layout';

/** 长安街 + 天安门广场地面（含透视地砖） */
export function buildGround(L: Layout): HTMLCanvasElement {
  const SW = L.W + L.M * 2;
  const H = L.H;
  const by = L.baseY;
  const gcx = SW / 2;
  const buf = new PixBuf(SW, H);
  const rng = mulberry32(77);
  const fill = (x0: number, y0: number, w: number, h: number, c: RGB) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) buf.set(x, y, c);
  };

  fill(0, by + 9, SW, 1, hex('#B5AD9F'));
  // 长安街
  const asphalt = hex('#55555C');
  for (let y = by + 10; y < by + 28; y++)
    for (let x = 0; x < SW; x++) {
      const n = hash2(x, y);
      buf.set(x, y, n > 0.92 ? hex('#5F5F67') : n < 0.08 ? hex('#4C4C53') : asphalt);
    }
  for (const ly of [by + 14, by + 23]) for (let x = 0; x < SW; x++) if (x % 12 < 6) buf.set(x, ly, hex('#C8C8C4'));
  for (let x = 0; x < SW; x++) {
    buf.set(x, by + 18, hex('#D8D4C8'));
    buf.set(x, by + 19, hex('#4A4A50'));
  }
  fill(0, by + 28, SW, 1, hex('#E2DCD0'));
  fill(0, by + 29, SW, 1, hex('#A8A090'));

  // 广场
  const far = hex('#D3CBBB');
  const near = hex('#C4BBAA');
  const axis = hex('#DAD3C4');
  const line = hex('#B8AF9E');
  for (let y = L.squareTop; y < H; y++) {
    const f = (y - L.squareTop) / Math.max(1, H - L.squareTop);
    const base = mix(far, near, f);
    const hw = 5 + 18 * f;
    for (let x = 0; x < SW; x++) {
      let c = Math.abs(x - gcx) < hw ? axis : base;
      const n = hash2(x * 1.7, y * 2.3);
      if (n > 0.96) c = mix(c, [255, 255, 255], 0.12);
      else if (n < 0.04) c = mix(c, [60, 50, 40], 0.08);
      buf.set(x, y, c);
    }
  }
  // 横向砖缝（透视渐宽）
  let y = L.squareTop + 2;
  let gap = 3;
  while (y < H) {
    for (let x = 0; x < SW; x++) buf.set(x, Math.round(y), line);
    y += gap;
    gap *= 1.11;
  }
  // 纵向砖缝（汇聚至灭点）
  for (let j = -60; j <= 60; j++) {
    const xb = gcx + j * 26;
    for (let yy = L.squareTop; yy < H; yy++) {
      const x = gcx + (xb - gcx) * ((yy - L.vy) / (H - L.vy));
      if (x >= 0 && x < SW) buf.set(Math.round(x), yy, line);
    }
  }
  for (let i = 0; i < SW * 2; i++) {
    const x = Math.floor(rng() * SW);
    const yy = L.squareTop + Math.floor(rng() * (H - L.squareTop));
    buf.set(x, yy, mix(near, [90, 80, 70], 0.1));
  }
  return buf.toCanvas();
}

/** 花坛（国庆花卉布置） */
export function buildFlowerBed(w: number, h: number, seed: number): HTMLCanvasElement {
  const buf = new PixBuf(w, h + 8);
  const rng = mulberry32(seed);
  const cx = w / 2;
  const cy = h / 2 + 4;
  const flowers = [hex('#E8302A'), hex('#FF5A3C'), hex('#D41F1A'), hex('#F2C14E'), hex('#FFD86A')];
  for (let y = 0; y < h + 8; y++)
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / (w / 2);
      const dy = (y - cy) / (h / 2);
      const d = dx * dx + dy * dy;
      // 花丘：中间隆起
      const mound = 4 * (1 - Math.min(1, dx * dx));
      const dy2 = (y + mound - cy) / (h / 2);
      const d2 = dx * dx + dy2 * dy2;
      if (d2 < 0.8) {
        const n = rng();
        let c: RGB;
        const ring = Math.sqrt(d2);
        if (ring < 0.28) c = n < 0.7 ? flowers[3] : flowers[4];
        else if (ring < 0.4) c = n < 0.6 ? hex('#3D7A3A') : hex('#4E9248');
        else c = n < 0.45 ? flowers[0] : n < 0.75 ? flowers[1] : n < 0.92 ? flowers[2] : hex('#3D7A3A');
        if (dy2 > 0.4 && n < 0.3) c = mix(c, [40, 20, 20], 0.25);
        buf.set(x, y, c);
      } else if (d < 1 && dy > 0) {
        buf.set(x, y, dy > 0.75 ? hex('#B5AE9F') : hex('#ECE8DF'));
      }
    }
  return buf.toCanvas();
}

/** 前景花箱（大尺寸、轻微视差） */
export function buildPlanter(w: number, h: number, seed: number): HTMLCanvasElement {
  const buf = new PixBuf(w, h);
  const rng = mulberry32(seed);
  const top = Math.round(h * 0.45);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (y >= top) {
        const edge = y === top || y === top + 1;
        const c = edge ? hex('#9C8E7A') : (x + y) % 9 === 0 ? hex('#6A5E50') : hex('#7A6E5E');
        buf.set(x, y, c);
      } else {
        const mound = Math.sin((x / w) * Math.PI) * top * 0.9;
        if (top - y < mound) {
          const n = rng();
          const c =
            n < 0.12 ? hex('#2D5A2E') : n < 0.5 ? hex('#C8201A') : n < 0.8 ? hex('#E8402E') : n < 0.92 ? hex('#F2C14E') : hex('#9A1812');
          buf.set(x, y, c);
        }
      }
    }
  return buf.toCanvas();
}

export interface Lamp {
  x: number;
  y: number;
  kind: 'avenue' | 'tall';
  /** 发光点（相对 x,y） */
  bulbs: { dx: number; dy: number; s: number }[];
}

export function layoutLamps(L: Layout): Lamp[] {
  const lamps: Lamp[] = [];
  for (let k = 0; ; k++) {
    const off = 44 + k * 76;
    if (off > L.W / 2 + L.M + 10) break;
    for (const s of [-1, 1])
      lamps.push({
        x: L.cx + s * off,
        y: L.avenueBot,
        kind: 'avenue',
        bulbs: [
          { dx: 0, dy: -28, s: 2 },
          { dx: -4, dy: -25, s: 1 },
          { dx: 4, dy: -25, s: 1 },
          { dx: -3, dy: -22, s: 1 },
          { dx: 3, dy: -22, s: 1 },
        ],
      });
  }
  for (const s of [-1, 1])
    lamps.push({
      x: L.cx + s * 172,
      y: L.baseY + 92,
      kind: 'tall',
      bulbs: [
        { dx: -4, dy: -56, s: 2 },
        { dx: 0, dy: -57, s: 2 },
        { dx: 4, dy: -56, s: 2 },
      ],
    });
  return lamps;
}

export function drawLamp(c: CanvasRenderingContext2D, lamp: Lamp, ox: number) {
  const x = Math.round(lamp.x + ox);
  const y = lamp.y;
  if (lamp.kind === 'avenue') {
    c.fillStyle = '#BDB6A8';
    c.fillRect(x - 1, y - 2, 3, 2);
    c.fillStyle = '#E8E5DC';
    c.fillRect(x, y - 24, 1, 22);
    c.fillStyle = '#D2CEC4';
    c.fillRect(x - 4, y - 24, 9, 1);
    c.fillRect(x - 3, y - 21, 7, 1);
    c.fillStyle = '#F6F3EA';
    for (const b of lamp.bulbs) c.fillRect(x + b.dx - (b.s > 1 ? 1 : 0), y + b.dy, b.s + (b.s > 1 ? 1 : 1), b.s + 1);
  } else {
    c.fillStyle = '#8F949A';
    c.fillRect(x - 2, y - 3, 5, 3);
    c.fillStyle = '#B9BEC4';
    c.fillRect(x - 1, y - 54, 2, 51);
    c.fillStyle = '#DDE1E6';
    c.fillRect(x - 1, y - 54, 1, 51);
    c.fillStyle = '#A9AEB4';
    c.fillRect(x - 6, y - 54, 13, 2);
    c.fillStyle = '#F3F1EA';
    for (const b of lamp.bulbs) c.fillRect(x + b.dx - 1, y + b.dy, 3, 2);
  }
}

/** 旗杆基座（汉白玉台 + 金色护栏） */
export function drawPoleBase(c: CanvasRenderingContext2D, L: Layout, ox: number) {
  const x = L.poleX + ox;
  const y = L.poleBaseY;
  c.fillStyle = '#A9A293';
  c.fillRect(x - 24, y + 1, 48, 3);
  c.fillStyle = '#E8E3D8';
  c.fillRect(x - 24, y - 5, 48, 6);
  c.fillStyle = '#F4F0E8';
  c.fillRect(x - 22, y - 5, 44, 1);
  c.fillStyle = '#CFC8BA';
  c.fillRect(x - 24, y, 48, 1);
  // 金色护栏
  c.fillStyle = '#C99A32';
  c.fillRect(x - 22, y - 8, 44, 1);
  for (let i = -22; i <= 22; i += 3) c.fillRect(x + i, y - 8, 1, 4);
  c.fillStyle = '#F2C14E';
  for (let i = -22; i <= 22; i += 6) c.fillRect(x + i, y - 9, 1, 1);
  // 旗杆底座
  c.fillStyle = '#B5AE9F';
  c.fillRect(x - 3, y - 7, 7, 3);
  c.fillStyle = '#E2DDD2';
  c.fillRect(x - 2, y - 8, 5, 1);
}

export function drawPole(c: CanvasRenderingContext2D, L: Layout, ox: number) {
  const x = L.poleX + ox;
  c.fillStyle = '#ECEEF2';
  c.fillRect(x, L.poleTopY, 1, L.poleBaseY - L.poleTopY - 7);
  c.fillStyle = '#9AA1AA';
  c.fillRect(x + 1, L.poleTopY, 1, L.poleBaseY - L.poleTopY - 7);
  c.fillStyle = '#F2C14E';
  c.fillRect(x - 1, L.poleTopY - 3, 3, 3);
  c.fillStyle = '#FFE38A';
  c.fillRect(x - 1, L.poleTopY - 3, 1, 1);
}

