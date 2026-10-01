import { RGB } from '../core/color';
import { chance, clamp, pick, rand, randInt, weighted } from '../core/math';
import { glowSprite, makeCanvas } from '../render/canvas';
import { Layout } from './layout';

/**
 * FireworkManager —— 国庆庆典艺术场景
 * 火箭升空 → 尾迹 → 爆炸 → 粒子扩散 → 粒子下落 → 逐渐熄灭
 * 11 种烟花，全部为 Pixel Particle。
 */
export type FireworkType =
  | 'peony'
  | 'chrysanthemum'
  | 'ring'
  | 'double'
  | 'willow'
  | 'red'
  | 'star'
  | 'crossette'
  | 'palm'
  | 'glitter'
  | 'heartRing';

export const FIREWORK_TYPES: FireworkType[] = [
  'peony',
  'chrysanthemum',
  'ring',
  'double',
  'willow',
  'red',
  'star',
  'crossette',
  'palm',
  'glitter',
  'heartRing',
];

const C = {
  red: [255, 52, 40] as RGB,
  gold: [255, 206, 70] as RGB,
  white: [255, 248, 228] as RGB,
  orange: [255, 140, 50] as RGB,
  pink: [255, 110, 170] as RGB,
  purple: [190, 110, 255] as RGB,
  blue: [80, 160, 255] as RGB,
  green: [110, 240, 130] as RGB,
  cyan: [100, 230, 240] as RGB,
};
const PALETTE: [RGB, number][] = [
  [C.red, 6],
  [C.gold, 5],
  [C.white, 2],
  [C.orange, 2],
  [C.pink, 2],
  [C.purple, 1.5],
  [C.blue, 1.5],
  [C.green, 1],
  [C.cyan, 1],
];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  col: RGB;
  col2: RGB | null;
  drag: number;
  g: number;
  trail: number;
  hist: number[];
  flicker: boolean;
  split: number;
  size: number;
}

interface Shell {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ty: number;
  type: FireworkType;
  col: RGB;
  col2: RGB;
  scale: number;
  t: number;
  launched: boolean;
}

interface Glow {
  x: number;
  y: number;
  col: RGB;
  life: number;
  max: number;
  r: number;
}

export interface ExplodeInfo {
  x: number;
  y: number;
  col: RGB;
  size: number;
  type: FireworkType;
}

export class FireworkManager {
  canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private L!: Layout;
  shells: Shell[] = [];
  parts: Particle[] = [];
  private glows: Glow[] = [];
  cap = 1000;
  private nextLaunch = 0;
  private nextBurst = 20;
  private wasActive = false;
  onExplode: (e: ExplodeInfo) => void = () => {};
  onLaunch: (x: number) => void = () => {};
  onBurst: () => void = () => {};

  resize(L: Layout) {
    this.L = L;
    [this.canvas, this.ctx] = makeCanvas(L.W, L.H);
  }

  get active() {
    return this.shells.length + this.parts.length > 0;
  }

  launch(type?: FireworkType, x?: number, delay = 0) {
    const L = this.L;
    const t = type ?? weighted(FIREWORK_TYPES.map((k) => [k, k === 'red' || k === 'peony' ? 2 : 1] as const));
    const sx = x ?? rand(L.W * 0.12, L.W * 0.88);
    const ty = rand(Math.max(18, L.baseY * 0.12), Math.max(40, L.baseY - 78));
    const col = weighted(PALETTE);
    let col2 = weighted(PALETTE);
    if (col2 === col) col2 = col === C.gold ? C.red : C.gold;
    this.shells.push({
      x: sx,
      y: L.baseY - 24,
      vx: rand(-6, 6),
      vy: -Math.sqrt(2 * 70 * (L.baseY - 24 - ty)) * rand(0.98, 1.04),
      ty,
      type: t,
      col,
      col2,
      scale: rand(0.85, 1.2) * Math.min(1.25, Math.max(0.8, L.W / 640)),
      t: -delay,
      launched: false,
    });
  }

  /** 烟花高潮：5～10 枚同时升空 */
  burst() {
    const n = randInt(5, 10);
    const L = this.L;
    for (let i = 0; i < n; i++) this.launch(undefined, L.W * (0.1 + (0.8 * (i + rand(0.2, 0.8))) / n), rand(0, 1.6));
    this.onBurst();
  }

  private add(p: Partial<Particle> & { x: number; y: number; vx: number; vy: number; col: RGB }) {
    if (this.parts.length >= this.cap) return;
    const max = p.max ?? rand(1.2, 2);
    this.parts.push({
      life: max,
      max,
      col2: null,
      drag: 1.3,
      g: 26,
      trail: 0,
      hist: [],
      flicker: false,
      split: -1,
      size: 1,
      ...p,
    });
  }

  private explode(s: Shell) {
    const q = clamp(this.cap / 1000, 0.25, 1);
    const n = (k: number) => Math.max(8, Math.round(k * q));
    const v = 56 * s.scale;
    const { x, y } = s;
    const sphere = (count: number, speed: number, col: RGB, extra: Partial<Particle> = {}) => {
      for (let i = 0; i < count; i++) {
        const th = Math.random() * Math.PI * 2;
        const z = Math.random() * 2 - 1;
        const r2 = Math.sqrt(1 - z * z);
        const sp = speed * rand(0.9, 1.05);
        this.add({ x, y, vx: Math.cos(th) * r2 * sp, vy: Math.sin(th) * r2 * sp, col, ...extra });
      }
    };
    let size = 1;
    switch (s.type) {
      case 'peony':
        sphere(n(randInt(55, 80)), v, s.col);
        break;
      case 'red':
        sphere(n(70), v * 1.05, C.red, { col2: C.gold });
        sphere(n(18), v * 0.35, C.white, { max: 0.9 });
        break;
      case 'chrysanthemum':
        sphere(n(70), v, s.col, { trail: 4, col2: C.gold, max: rand(1.8, 2.4) });
        size = 1.2;
        break;
      case 'ring': {
        const cnt = n(46);
        const tilt = rand(0.35, 1);
        const rot = rand(0, Math.PI);
        for (let i = 0; i < cnt; i++) {
          const a = (i / cnt) * Math.PI * 2;
          const ex = Math.cos(a) * v;
          const ey = Math.sin(a) * v * tilt;
          this.add({ x, y, vx: ex * Math.cos(rot) - ey * Math.sin(rot), vy: ex * Math.sin(rot) + ey * Math.cos(rot), col: s.col, drag: 1.1 });
        }
        sphere(n(10), v * 0.2, C.white, { max: 0.7 });
        break;
      }
      case 'double':
        sphere(n(36), v * 0.5, s.col2);
        sphere(n(60), v * 1.05, s.col);
        size = 1.3;
        break;
      case 'willow':
        sphere(n(56), v * 0.8, C.gold, { drag: 2.1, g: 16, max: rand(3, 3.8), trail: 6, col2: [200, 110, 30] });
        size = 1.3;
        break;
      case 'star': {
        const cnt = n(60);
        const rot = -Math.PI / 2 + rand(-0.3, 0.3);
        const pts: [number, number][] = [];
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? 1 : 0.42;
          const a = rot + (i * Math.PI) / 5;
          pts.push([Math.cos(a) * r, Math.sin(a) * r]);
        }
        for (let i = 0; i < cnt; i++) {
          const f = (i / cnt) * 10;
          const k = Math.floor(f);
          const t = f - k;
          const a = pts[k];
          const b = pts[(k + 1) % 10];
          this.add({ x, y, vx: (a[0] + (b[0] - a[0]) * t) * v * 1.1, vy: (a[1] + (b[1] - a[1]) * t) * v * 1.1, col: C.gold, drag: 1.2, g: 14 });
        }
        break;
      }
      case 'crossette':
        for (let i = 0; i < n(16); i++) {
          const a = (i / 16) * Math.PI * 2 + rand(-0.1, 0.1);
          this.add({ x, y, vx: Math.cos(a) * v * 0.9, vy: Math.sin(a) * v * 0.9, col: s.col, trail: 3, split: rand(0.5, 0.7), max: 1.0, drag: 0.9 });
        }
        break;
      case 'palm':
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2 + rand(-0.15, 0.15);
          this.add({ x, y, vx: Math.cos(a) * v * 0.85, vy: Math.sin(a) * v * 0.85 - 10, col: s.col, col2: C.gold, trail: 7, size: 2, max: 2.0, drag: 0.8, g: 30 });
        }
        sphere(n(20), v * 0.3, C.gold, { max: 1.0 });
        break;
      case 'glitter':
        sphere(n(70), v * 0.95, C.white, { flicker: true, max: rand(1.6, 2.2), drag: 1.6, g: 22 });
        break;
      case 'heartRing': {
        sphere(n(54), v, C.red, { col2: C.gold });
        const cnt = n(36);
        for (let i = 0; i < cnt; i++) {
          const a = (i / cnt) * Math.PI * 2;
          this.add({ x, y, vx: Math.cos(a) * v * 0.55, vy: Math.sin(a) * v * 0.55, col: C.gold, drag: 1.2 });
        }
        size = 1.3;
        break;
      }
    }
    const main = s.type === 'willow' || s.type === 'star' ? C.gold : s.type === 'red' || s.type === 'heartRing' ? C.red : s.type === 'glitter' ? C.white : s.col;
    this.glows.push({ x, y, col: main, life: 0.5, max: 0.5, r: Math.round(30 * s.scale * size) });
    this.onExplode({ x, y, col: main, size: size * s.scale, type: s.type });
  }

  update(dt: number, level: number, fast: boolean) {
    // 自动燃放调度
    if (level > 0) {
      if (!this.wasActive) {
        this.nextLaunch = 0.3;
        this.nextBurst = level >= 1 ? 2 : rand(30, 60);
      }
      this.nextLaunch -= dt;
      if (this.nextLaunch <= 0) {
        this.launch();
        if (chance(0.3 * level)) this.launch(undefined, undefined, rand(0.1, 0.5));
        this.nextLaunch = rand(1.4, 4) / Math.max(0.3, level);
      }
      if (level >= 0.9) {
        this.nextBurst -= dt;
        if (this.nextBurst <= 0) {
          this.burst();
          this.nextBurst = rand(30, 60);
        }
      }
    }
    this.wasActive = level > 0;
    if (fast && level === 0) {
      this.shells.length = 0;
    }

    // 火箭
    for (const s of this.shells) {
      s.t += dt;
      if (s.t < 0) continue;
      if (!s.launched) {
        s.launched = true;
        this.onLaunch(s.x);
      }
      s.vy += 70 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (Math.random() < 0.8) this.add({ x: s.x + rand(-0.5, 0.5), y: s.y + 1, vx: rand(-4, 4), vy: rand(4, 14), col: [255, 200, 140], max: rand(0.25, 0.5), g: 10, drag: 2 });
      if (s.vy >= -8 || s.y <= s.ty) {
        s.t = 1e9;
        this.explode(s);
      }
    }
    this.shells = this.shells.filter((s) => s.t < 1e8);

    // 粒子
    const born: Particle[] = [];
    for (const p of this.parts) {
      if (p.trail) {
        p.hist.push(p.x, p.y);
        if (p.hist.length > p.trail * 2) p.hist.splice(0, 2);
      }
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr;
      p.vy = p.vy * dr + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.split > 0 && p.max - p.life >= p.split) {
        p.life = 0;
        for (let k = 0; k < 4; k++) {
          const a = (k * Math.PI) / 2 + Math.atan2(p.vy, p.vx) + Math.PI / 4;
          born.push({ ...p, hist: [], trail: 0, split: -1, vx: Math.cos(a) * 22, vy: Math.sin(a) * 22, life: 0.8, max: 0.8, flicker: true, col: C.gold });
        }
      }
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const b of born) if (this.parts.length < this.cap) this.parts.push(b);
    for (const g of this.glows) g.life -= dt;
    this.glows = this.glows.filter((g) => g.life > 0);
  }

  render(glow: boolean) {
    const c = this.ctx;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.globalCompositeOperation = 'lighter';
    if (glow)
      for (const g of this.glows) {
        const a = (g.life / g.max) ** 2 * 0.55;
        c.globalAlpha = a;
        c.drawImage(glowSprite(g.r, g.col, 1.6), Math.round(g.x - g.r), Math.round(g.y - g.r));
      }
    for (const p of this.parts) {
      const k = p.life / p.max;
      const age = 1 - k;
      let col = p.col;
      if (age < 0.12) col = mixc(C.white, p.col, age / 0.12);
      else if (p.col2 && age > 0.5) col = mixc(p.col, p.col2, (age - 0.5) / 0.5);
      let a = k < 0.45 ? k / 0.45 : 1;
      if (p.flicker && Math.random() < 0.45) a *= 0.15;
      c.globalAlpha = a;
      c.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
      const sz = p.size + (age < 0.15 ? 1 : 0);
      c.fillRect(Math.round(p.x), Math.round(p.y), sz, sz);
      if (p.hist.length) {
        const n = p.hist.length / 2;
        for (let i = 0; i < n; i++) {
          c.globalAlpha = a * ((i + 1) / (n + 1)) * 0.6;
          c.fillRect(Math.round(p.hist[i * 2]), Math.round(p.hist[i * 2 + 1]), p.size, p.size);
        }
      }
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  clear() {
    this.shells = [];
    this.parts = [];
    this.glows = [];
  }

  randomType() {
    return pick(FIREWORK_TYPES);
  }
}

function mixc(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
