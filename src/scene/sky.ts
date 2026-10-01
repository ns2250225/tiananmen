import { RGB, css } from '../core/color';
import { Env } from '../core/env';
import { clamp, mulberry32, rand, randInt, pick, chance } from '../core/math';
import { glowSprite, makeCanvas, PixBuf } from '../render/canvas';
import { Layout } from './layout';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16);
const LEVELS = 30;

interface Star {
  x: number;
  y: number;
  b: number;
  tw: number;
  ph: number;
  big: boolean;
  col: RGB;
}

/** 天空：逐像素插值 + Bayer 有序抖动，呈现像素风连续渐变 */
export class Sky {
  canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private img!: ImageData;
  private L!: Layout;
  private stars: Star[] = [];
  private lastRender = -1;
  private h = 0;

  resize(L: Layout) {
    this.L = L;
    this.h = L.baseY + 12;
    [this.canvas, this.ctx] = makeCanvas(L.W, this.h);
    this.img = this.ctx.createImageData(L.W, this.h);
    const rng = mulberry32(42);
    this.stars = [];
    const n = Math.round((L.W * L.baseY) / 900);
    for (let i = 0; i < n; i++) {
      const warm = rng();
      this.stars.push({
        x: Math.floor(rng() * L.W),
        y: Math.floor(Math.pow(rng(), 1.4) * (L.baseY - 30)),
        b: 0.35 + rng() * 0.65,
        tw: 0.6 + rng() * 2.4,
        ph: rng() * 6.28,
        big: rng() < 0.06,
        col: warm < 0.15 ? [255, 226, 190] : warm < 0.35 ? [200, 220, 255] : [255, 255, 255],
      });
    }
    this.lastRender = -1;
  }

  render(env: Env, now: number, force: boolean) {
    if (!force && now - this.lastRender < 0.33) return;
    this.lastRender = now;
    const { W, baseY } = this.L;
    const d = this.img.data;
    const h = this.h;
    const top = env.skyTop;
    const hor = env.skyHor;
    const g = env.glowCol;
    const sunI = env.sunVis * (0.28 + env.warm * 0.55);
    const sunR = 30 + env.warm * 40;
    const sunR2 = sunR * sunR;
    const horBand = env.warm * env.sunVis * 0.75 + env.warm * 0.25;
    const moonI = env.moonVis * env.night * 0.22;
    const colF = new Float32Array(W);
    for (let x = 0; x < W; x++) colF[x] = Math.exp(-(((x - env.sunX) / (W * 0.38)) ** 2));
    // 城市夜间天光：地平线略带暖色
    const cityGlow = env.night * 0.18;
    for (let y = 0; y < h; y++) {
      const ty = clamp(y / baseY);
      const f = Math.pow(ty, 1.7);
      const br = top[0] + (hor[0] - top[0]) * f;
      const bg = top[1] + (hor[1] - top[1]) * f;
      const bb = top[2] + (hor[2] - top[2]) * f;
      const band = Math.pow(ty, 3.5);
      const city = cityGlow * Math.pow(ty, 6);
      const dy = y - env.sunY;
      const dym = y - env.moonY;
      for (let x = 0; x < W; x++) {
        let r = br,
          gg = bg,
          b = bb;
        let k = horBand * band * colF[x];
        const dx = x - env.sunX;
        const d2 = dx * dx + dy * dy;
        if (sunI > 0.01 && d2 < sunR2 * 9) k += sunI * Math.exp(-d2 / sunR2);
        if (k > 0.001) {
          r += (g[0] - r) * Math.min(1, k);
          gg += (g[1] - gg) * Math.min(1, k);
          b += (g[2] - b) * Math.min(1, k);
        }
        if (moonI > 0.01) {
          const mx = x - env.moonX;
          const m2 = mx * mx + dym * dym;
          if (m2 < 2500) {
            const mk = moonI * Math.exp(-m2 / 380);
            r += (200 - r) * mk;
            gg += (215 - gg) * mk;
            b += (255 - b) * mk;
          }
        }
        if (city > 0.001) {
          r += (120 - r) * city;
          gg += (80 - gg) * city;
          b += (90 - b) * city;
        }
        const bay = BAYER[(x & 3) + ((y & 3) << 2)];
        const i = (y * W + x) * 4;
        d[i] = Math.min(255, Math.floor((r / 255) * (LEVELS - 1) + bay) * (255 / (LEVELS - 1)));
        d[i + 1] = Math.min(255, Math.floor((gg / 255) * (LEVELS - 1) + bay) * (255 / (LEVELS - 1)));
        d[i + 2] = Math.min(255, Math.floor((b / 255) * (LEVELS - 1) + bay) * (255 / (LEVELS - 1)));
        d[i + 3] = 255;
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  }

  draw(c: CanvasRenderingContext2D, env: Env, now: number, ox: number, glow: boolean) {
    c.drawImage(this.canvas, 0, 0);
    // 星星
    if (env.starAlpha > 0.01) {
      for (const s of this.stars) {
        const a = env.starAlpha * s.b * (0.55 + 0.45 * Math.sin(now * s.tw + s.ph));
        if (a < 0.05) continue;
        const x = Math.round(s.x + ox * 0.1);
        c.fillStyle = css(s.col, a);
        c.fillRect(x, s.y, 1, 1);
        if (s.big && a > 0.4) {
          c.fillStyle = css(s.col, a * 0.45);
          c.fillRect(x - 1, s.y, 1, 1);
          c.fillRect(x + 1, s.y, 1, 1);
          c.fillRect(x, s.y - 1, 1, 1);
          c.fillRect(x, s.y + 1, 1, 1);
        }
      }
    }
    // 太阳
    if (env.sunVis > 0.01) {
      const x = Math.round(env.sunX + ox * 0.15);
      const y = Math.round(env.sunY);
      const R = Math.round(6 + (1 - env.sunAlt) * 3);
      if (glow) {
        const gs = glowSprite(R * 3, env.glowCol, 2.2);
        c.globalAlpha = 0.5 * env.sunVis;
        c.globalCompositeOperation = 'lighter';
        c.drawImage(gs, x - R * 3, y - R * 3);
        c.globalCompositeOperation = 'source-over';
        c.globalAlpha = 1;
      }
      disc(c, x, y, R + 1, css(env.glowCol, 0.55 * env.sunVis));
      disc(c, x, y, R, css(env.sunCol, env.sunVis));
      disc(c, x - 1, y - 1, Math.max(2, R - 3), css([255, 252, 236], env.sunVis * (0.4 + env.sunAlt * 0.6)));
    }
  }

  /** 月亮（像素月面 + 真实月相） */
  drawMoon(c: CanvasRenderingContext2D, env: Env, ox: number, glow: boolean) {
    if (env.moonVis < 0.01) return;
    const a = env.moonVis * clamp(env.night * 1.4);
    if (a < 0.01) return;
    const x = Math.round(env.moonX + ox * 0.15);
    const y = Math.round(env.moonY);
    const R = 7;
    if (glow) {
      c.globalAlpha = 0.35 * a;
      c.globalCompositeOperation = 'lighter';
      c.drawImage(glowSprite(22, [150, 170, 230], 2.5), x - 22, y - 22);
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 1;
    }
    // 至少保留月牙，保证画面中始终有 🌙
    let p = env.moonPhase;
    if (p < 0.12) p = 0.12;
    if (p > 0.88) p = 0.88;
    const k = Math.cos(p * Math.PI * 2);
    const waxing = p < 0.5;
    for (let dy = -R; dy <= R; dy++) {
      const w = Math.sqrt(Math.max(0, R * R - (dy + 0.5) ** 2));
      for (let dx = -R; dx <= R; dx++) {
        const fx = dx + 0.5;
        if (Math.abs(fx) > w) continue;
        const lit = waxing ? fx > k * w : fx < -k * w;
        let col: RGB;
        if (!lit) col = [44, 52, 86];
        else {
          const crater = (dx === -2 && dy === -2) || (dx === 2 && dy === 1) || (dx === -1 && dy === 3) || (dx === 3 && dy === -3) || (dx === -3 && dy === 1);
          col = crater ? [214, 208, 184] : dx + dy < -3 ? [255, 252, 232] : [240, 234, 210];
        }
        c.fillStyle = css(col, a * (lit ? 1 : 0.6));
        c.fillRect(x + dx, y + dy, 1, 1);
      }
    }
  }

  hitMoon(env: Env, lx: number, ly: number, ox: number) {
    if (env.moonVis < 0.2 || env.night < 0.5) return false;
    return Math.hypot(lx - (env.moonX + ox * 0.15), ly - env.moonY) < 11;
  }
}

function disc(c: CanvasRenderingContext2D, x: number, y: number, R: number, fill: string) {
  c.fillStyle = fill;
  for (let dy = -R; dy <= R; dy++) {
    const w = Math.round(Math.sqrt(Math.max(0, R * R - dy * dy)));
    c.fillRect(x - w, y + dy, w * 2 + 1, 1);
  }
}

// ———————————————————————————— 云 ————————————————————————————

interface CloudShape {
  w: number;
  h: number;
  mask: Uint8Array;
}

interface Cloud {
  shape: CloudShape;
  sprite: HTMLCanvasElement | null;
  key: string;
  x: number;
  y: number;
  speed: number;
  layer: number;
  jiggle: number;
}

/** 4 种基础云形 cloud_01..04，加随机变体 */
function genCloud(w: number, h: number, seed: number): CloudShape {
  const rng = mulberry32(seed);
  const occ = new Uint8Array(w * h);
  const blobs = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < blobs; i++) {
    const t = (i + 0.5) / blobs;
    const bx = w * (0.15 + t * 0.7) + (rng() - 0.5) * w * 0.12;
    const r = h * (0.32 + rng() * 0.3) * (1 - Math.abs(t - 0.5) * 0.7);
    const by = h - 2 - r * 0.85;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const dx = (x - bx) / (r * 1.25);
        const dy = (y - by) / r;
        if (dx * dx + dy * dy <= 1 && y < h - 1) occ[y * w + x] = 1;
      }
  }
  const mask = new Uint8Array(w * h);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : occ[y * w + x]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!occ[y * w + x]) continue;
      if (!at(x, y - 2) || !at(x, y - 1)) mask[y * w + x] = 3;
      else if (!at(x, y + 2) || y > h * 0.78) mask[y * w + x] = 1;
      else mask[y * w + x] = 2;
    }
  return { w, h, mask };
}

export class Clouds {
  private shapes: CloudShape[] = [];
  list: Cloud[] = [];
  private L!: Layout;
  private count = 6;

  constructor() {
    const dims: [number, number][] = [
      [70, 20],
      [48, 15],
      [96, 24],
      [36, 12],
    ];
    for (let i = 0; i < 12; i++) {
      const [w, h] = dims[i % 4];
      this.shapes.push(genCloud(w + randInt(-6, 10), h + randInt(-2, 3), 100 + i * 17));
    }
  }

  resize(L: Layout, count: number) {
    const fresh = !this.L;
    this.L = L;
    this.count = count;
    if (fresh || this.list.length === 0) {
      this.list = [];
      for (let i = 0; i < count; i++) this.list.push(this.make(rand(-60, L.W)));
    }
    for (const c of this.list) c.y = Math.min(c.y, L.baseY - 60);
  }

  setCount(n: number) {
    this.count = n;
  }

  private make(x: number): Cloud {
    const layer = chance(0.45) ? 0 : 1;
    const shape = pick(this.shapes);
    return {
      shape,
      sprite: null,
      key: '',
      x,
      y: Math.round(rand(10, Math.max(30, this.L.baseY - 70 - shape.h * 0.3)) * (layer ? 1 : 0.7)),
      speed: layer ? rand(3, 5) : rand(1, 2.5),
      layer,
      jiggle: 0,
    };
  }

  /** 云遮太阳事件 */
  coverSun(env: Env) {
    const sh = pick(this.shapes.filter((s) => s.w > 60)) ?? this.shapes[2];
    this.list.push({
      shape: sh,
      sprite: null,
      key: '',
      x: env.sunX - sh.w - 40,
      y: Math.round(env.sunY - sh.h / 2),
      speed: 4,
      layer: 1,
      jiggle: 0,
    });
  }

  update(dt: number, wind: number) {
    const L = this.L;
    for (const c of this.list) {
      c.x += c.speed * (0.6 + wind * 0.8) * dt;
      if (c.jiggle > 0) c.jiggle = Math.max(0, c.jiggle - dt);
    }
    this.list = this.list.filter((c) => c.x < L.W + 40);
    while (this.list.length < this.count) this.list.push(this.make(-110 - rand(0, 80)));
    if (this.list.length > this.count + 2) {
      const i = this.list.findIndex((c) => c.x < -100);
      if (i >= 0) this.list.splice(i, 1);
    }
  }

  private colorize(c: Cloud, env: Env, key: string) {
    const { w, h, mask } = c.shape;
    const buf = new PixBuf(w, h);
    const cols: RGB[] = [env.cloudLo, env.cloudLo, env.cloudMid, env.cloudHi];
    for (let i = 0; i < mask.length; i++) {
      const m = mask[i];
      if (!m) continue;
      buf.set(i % w, Math.floor(i / w), cols[m]);
    }
    c.sprite = buf.toCanvas();
    c.key = key;
  }

  draw(ctx: CanvasRenderingContext2D, env: Env, ox: number) {
    const key = [env.cloudHi, env.cloudMid, env.cloudLo].map((c) => c.map((v) => v >> 3).join(',')).join('|');
    const alpha = 0.55 + env.daylight * 0.4;
    ctx.globalAlpha = alpha;
    for (const c of this.list) {
      if (c.key !== key) this.colorize(c, env, key);
      const jx = c.jiggle > 0 ? Math.round(Math.sin(c.jiggle * 40) * 1.5) : 0;
      const jy = c.jiggle > 0 ? Math.round(Math.cos(c.jiggle * 33)) : 0;
      ctx.drawImage(c.sprite!, Math.round(c.x + ox * (0.2 + c.layer * 0.1)) + jx, c.y + jy);
    }
    ctx.globalAlpha = 1;
  }

  /** 点击云：轻轻抖动 */
  hit(lx: number, ly: number, ox: number): boolean {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      const x = lx - Math.round(c.x + ox * (0.2 + c.layer * 0.1));
      const y = ly - c.y;
      if (x >= 0 && y >= 0 && x < c.shape.w && y < c.shape.h && c.shape.mask[Math.floor(y) * c.shape.w + Math.floor(x)]) {
        c.jiggle = 0.6;
        return true;
      }
    }
    return false;
  }

  /** 太阳被云遮挡的程度 0..1 */
  sunCover(env: Env, ox: number) {
    if (env.sunVis < 0.05) return 0;
    let cover = 0;
    for (const c of this.list) {
      const x = Math.round(env.sunX - (c.x + ox * (0.2 + c.layer * 0.1)));
      const y = Math.round(env.sunY - c.y);
      if (x >= 0 && y >= 0 && x < c.shape.w && y < c.shape.h && c.shape.mask[y * c.shape.w + x]) cover = 1;
    }
    return cover;
  }
}
