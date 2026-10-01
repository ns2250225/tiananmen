import { css, mix, RGB } from '../core/color';
import { Env } from '../core/env';
import { chance, pick, rand, randInt } from '../core/math';
import { Layout } from './layout';

// ———————————————————— 鸽子 ————————————————————
const BIRD_FRAMES = [
  ['#...#', '.#.#.', '..#..'],
  ['.....', '#####', '..#..'],
  ['..#..', '.###.', '#...#'],
  ['.....', '#####', '..#..'],
];

interface Bird {
  ox: number;
  oy: number;
  ph: number;
  big: boolean;
}

interface Flock {
  x: number;
  y: number;
  vx: number;
  birds: Bird[];
  t: number;
}

export class Birds {
  flocks: Flock[] = [];
  private L!: Layout;
  resize(L: Layout) {
    this.L = L;
  }

  /** 2～8 只鸽子从天空飞过 */
  spawn(n = randInt(2, 8), y?: number) {
    const L = this.L;
    const dir = chance(0.5) ? 1 : -1;
    const birds: Bird[] = [];
    for (let i = 0; i < n; i++) birds.push({ ox: -i * rand(5, 9) + rand(-3, 3), oy: rand(-8, 8), ph: rand(0, 4), big: chance(0.3) });
    this.flocks.push({
      x: dir > 0 ? -20 : L.W + 20,
      y: y ?? rand(28, Math.max(40, L.baseY - 70)),
      vx: dir * rand(32, 46),
      birds,
      t: 0,
    });
  }

  update(dt: number) {
    for (const f of this.flocks) {
      f.t += dt;
      f.x += f.vx * dt;
    }
    this.flocks = this.flocks.filter((f) => f.x > -120 && f.x < this.L.W + 120);
  }

  draw(c: CanvasRenderingContext2D, env: Env, ox: number) {
    const day: RGB = [244, 244, 240];
    const dusk: RGB = [52, 36, 56];
    const col = mix(dusk, day, Math.max(0, env.daylight - env.warm * 0.6));
    const shade = mix(col, [60, 70, 90], 0.4);
    for (const f of this.flocks) {
      const dir = Math.sign(f.vx);
      for (const b of f.birds) {
        const frame = BIRD_FRAMES[Math.floor(f.t * 9 + b.ph) & 3];
        const bx = Math.round(f.x + b.ox * dir + ox * 0.35);
        const by = Math.round(f.y + b.oy + Math.sin(f.t * 2 + b.ph) * 2);
        for (let y = 0; y < 3; y++)
          for (let x = 0; x < 5; x++) {
            if (frame[y][x] !== '#') continue;
            c.fillStyle = css(y === 2 && x === 2 ? shade : col);
            c.fillRect(bx + x, by + y, 1, 1);
            if (b.big && y === 1) c.fillRect(bx + x, by + y + 1, 1, 1);
          }
      }
    }
  }
}

// ———————————————————— 飞机 / 流星 / 落叶 ————————————————————
interface Plane {
  x: number;
  y: number;
  vx: number;
  t: number;
  trail: number[];
}
interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}
interface Leaf {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ph: number;
  col: string;
  life: number;
  ground: number;
}

export class SkyEffects {
  planes: Plane[] = [];
  meteors: Meteor[] = [];
  leaves: Leaf[] = [];
  private L!: Layout;
  resize(L: Layout) {
    this.L = L;
  }

  plane() {
    const dir = chance(0.5) ? 1 : -1;
    this.planes.push({ x: dir > 0 ? -10 : this.L.W + 10, y: rand(14, Math.max(20, this.L.baseY * 0.3)), vx: dir * rand(10, 15), t: 0, trail: [] });
  }

  meteor(x?: number, y?: number) {
    const L = this.L;
    const dir = chance(0.5) ? 1 : -1;
    this.meteors.push({ x: x ?? rand(L.W * 0.1, L.W * 0.9), y: y ?? rand(5, L.baseY * 0.3), vx: dir * rand(90, 140), vy: rand(40, 70), life: rand(0.6, 0.9) });
  }

  leavesBurst(n: number) {
    const L = this.L;
    for (let i = 0; i < n; i++)
      this.leaves.push({
        x: rand(-20, L.W),
        y: rand(L.baseY - 60, L.baseY - 36),
        vx: rand(14, 30),
        vy: rand(4, 10),
        ph: rand(0, 6),
        col: pick(['#D9A43A', '#B8632A', '#8AA04A', '#E2B848', '#9A4A22']),
        life: rand(5, 9),
        ground: rand(L.squareTop, L.H - 4),
      });
  }

  update(dt: number, wind: number) {
    for (const p of this.planes) {
      p.t += dt;
      p.x += p.vx * dt;
      if (Math.floor(p.t * 4) !== Math.floor((p.t - dt) * 4)) {
        p.trail.push(p.x, p.y);
        if (p.trail.length > 60) p.trail.splice(0, 2);
      }
    }
    this.planes = this.planes.filter((p) => p.x > -60 && p.x < this.L.W + 60);
    for (const m of this.meteors) {
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.life -= dt;
    }
    this.meteors = this.meteors.filter((m) => m.life > 0);
    for (const l of this.leaves) {
      l.ph += dt * 4;
      if (l.y < l.ground) {
        l.x += (l.vx * (0.5 + wind) + Math.sin(l.ph) * 8) * dt;
        l.y += (l.vy + Math.cos(l.ph * 0.7) * 6) * dt;
      }
      l.life -= dt;
    }
    this.leaves = this.leaves.filter((l) => l.life > 0 && l.x < this.L.W + 20);
  }

  drawSky(c: CanvasRenderingContext2D, env: Env, now: number, ox: number) {
    for (const p of this.planes) {
      const x = Math.round(p.x + ox * 0.15);
      const y = Math.round(p.y);
      if (env.daylight > 0.4) {
        for (let i = 0; i < p.trail.length; i += 2) {
          const a = (i / p.trail.length) * 0.35 * env.daylight;
          c.fillStyle = `rgba(255,255,255,${a})`;
          c.fillRect(Math.round(p.trail[i] + ox * 0.15), Math.round(p.trail[i + 1]), 2, 1);
        }
        c.fillStyle = '#C8CDD4';
        c.fillRect(x - 2, y, 5, 1);
        c.fillRect(x, y - 1, 1, 1);
      } else {
        c.fillStyle = '#3A4060';
        c.fillRect(x - 2, y, 5, 1);
        if (Math.floor(now * 1.5) % 2 === 0) {
          c.fillStyle = '#FF4040';
          c.fillRect(x - 2, y, 1, 1);
        }
        if (Math.floor(now * 1.5 + 0.5) % 2 === 0) {
          c.fillStyle = '#FFFFFF';
          c.fillRect(x + 2, y, 1, 1);
        }
      }
    }
    for (const m of this.meteors) {
      const a = Math.min(1, m.life * 3);
      for (let i = 0; i < 14; i++) {
        const t = i / 14;
        c.fillStyle = `rgba(255,${240 - i * 6},${210 - i * 8},${a * (1 - t)})`;
        c.fillRect(Math.round(m.x - m.vx * t * 0.12 + ox * 0.1), Math.round(m.y - m.vy * t * 0.12), 1, 1);
      }
    }
  }

  drawLeaves(c: CanvasRenderingContext2D, ox: number) {
    for (const l of this.leaves) {
      c.globalAlpha = Math.min(1, l.life);
      c.fillStyle = l.col;
      const flip = Math.sin(l.ph) > 0;
      c.fillRect(Math.round(l.x + ox), Math.round(l.y), flip ? 2 : 1, 1);
    }
    c.globalAlpha = 1;
  }
}

// ———————————————————— 长安街车流 ————————————————————
interface Car {
  x: number;
  lane: 0 | 1;
  dir: 1 | -1;
  speed: number;
  kind: 'sedan' | 'bus' | 'taxi' | 'suv';
  col: string;
}

const CAR_COLS = ['#1A1C22', '#2A2E38', '#E8E8E4', '#8A9098', '#3A4A6A', '#7A1E1E', '#C0C4C8'];

export class Traffic {
  cars: Car[] = [];
  private L!: Layout;
  private timer = [0, 0];
  resize(L: Layout) {
    this.L = L;
    this.cars = [];
  }

  laneY(lane: 0 | 1) {
    return lane === 0 ? this.L.baseY + 16 : this.L.baseY + 26;
  }

  update(dt: number, rate: number, allowed: boolean) {
    const L = this.L;
    for (const lane of [0, 1] as const) {
      this.timer[lane] -= dt;
      if (allowed && this.timer[lane] <= 0) {
        const dir: 1 | -1 = lane === 0 ? -1 : 1;
        const kind = pick(['sedan', 'sedan', 'sedan', 'taxi', 'suv', 'bus'] as const);
        this.cars.push({
          x: dir > 0 ? -30 : L.W + 30,
          lane,
          dir,
          speed: kind === 'bus' ? rand(26, 32) : rand(34, 48),
          kind,
          col: kind === 'taxi' ? pick(['#E8B830', '#2E8A5A']) : kind === 'bus' ? pick(['#C8302A', '#2E6EB8']) : pick(CAR_COLS),
        });
        this.timer[lane] = rand(1.2, 4.5) / Math.max(0.15, rate);
      }
    }
    for (const c of this.cars) c.x += c.dir * c.speed * dt;
    this.cars = this.cars.filter((c) => c.x > -40 && c.x < L.W + 40);
  }

  private dims(c: Car) {
    return c.kind === 'bus' ? { w: 24, h: 8 } : c.kind === 'suv' ? { w: 14, h: 6 } : { w: 13, h: 5 };
  }

  draw(ctx: CanvasRenderingContext2D, ox: number) {
    for (const c of this.cars) {
      const { w, h } = this.dims(c);
      const x = Math.round(c.x + ox - w / 2);
      const y = this.laneY(c.lane) - h;
      ctx.fillStyle = 'rgba(20,20,26,0.35)';
      ctx.fillRect(x + 1, y + h, w - 1, 1);
      ctx.fillStyle = c.col;
      if (c.kind === 'bus') {
        ctx.fillRect(x, y, w, h - 1);
        ctx.fillStyle = '#9CC4E4';
        for (let i = 2; i < w - 2; i += 4) ctx.fillRect(x + i, y + 1, 3, 3);
        ctx.fillStyle = '#F4F1EA';
        ctx.fillRect(x, y + 5, w, 1);
      } else {
        const roofL = c.dir > 0 ? 3 : 4;
        ctx.fillRect(x, y + 2, w, h - 3);
        ctx.fillRect(x + roofL, y, w - 7, 2);
        ctx.fillStyle = '#8FB4D8';
        ctx.fillRect(x + roofL + 1, y + 1, w - 9, 1);
        if (c.kind === 'taxi') {
          ctx.fillStyle = '#F4F1EA';
          ctx.fillRect(x + Math.floor(w / 2), y - 1, 2, 1);
        }
      }
      ctx.fillStyle = '#111114';
      ctx.fillRect(x + 2, y + h - 1, 2, 1);
      ctx.fillRect(x + w - 4, y + h - 1, 2, 1);
    }
  }

  /** 夜间车灯（发光层） */
  drawLights(ctx: CanvasRenderingContext2D, ox: number, night: number) {
    if (night < 0.3) return;
    for (const c of this.cars) {
      const { w, h } = this.dims(c);
      const x = Math.round(c.x + ox - w / 2);
      const y = this.laneY(c.lane) - h + Math.floor(h / 2);
      const front = c.dir > 0 ? x + w : x - 1;
      const back = c.dir > 0 ? x - 1 : x + w;
      ctx.globalAlpha = night;
      ctx.fillStyle = '#FFF4C8';
      ctx.fillRect(front, y, 1, 1);
      ctx.globalAlpha = night * 0.22;
      ctx.fillRect(c.dir > 0 ? front + 1 : front - 8, y - 1, 8, 3);
      ctx.globalAlpha = night * 0.9;
      ctx.fillStyle = '#FF3020';
      ctx.fillRect(back, y, 1, 1);
    }
    ctx.globalAlpha = 1;
  }
}
