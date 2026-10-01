import { css, mix, RGB } from '../core/color';
import { Env } from '../core/env';
import { clamp, lerp } from '../core/math';
import { glowSprite, makeCanvas } from '../render/canvas';
import { CeremonyState } from './ceremony';
import { CrowdManager } from './crowd';
import { Birds, SkyEffects, Traffic } from './effects';
import { FireworkManager } from './fireworks';
import { buildFlagFrames, buildSmallFlags, FLAG_FRAMES, FLAG_H, FLAG_PAD } from './flag';
import { buildFlowerBed, buildGround, buildPlanter, drawLamp, drawPole, drawPoleBase, Lamp, layoutLamps } from './ground';
import { depthScale, Layout, makeLayout } from './layout';
import { drawPerson, GUARD_LOOK } from './people';
import { Clouds, Sky } from './sky';
import { buildStructure, StructureSprites } from './structure';

export interface Quality {
  name: 'Ultra' | 'High' | 'Medium' | 'Low';
  particles: number;
  crowd: number;
  clouds: number;
  glow: boolean;
  reflection: boolean;
}

export const QUALITIES: Quality[] = [
  { name: 'Ultra', particles: 1000, crowd: 1, clouds: 9, glow: true, reflection: true },
  { name: 'High', particles: 600, crowd: 0.85, clouds: 7, glow: true, reflection: true },
  { name: 'Medium', particles: 300, crowd: 0.65, clouds: 5, glow: true, reflection: false },
  { name: 'Low', particles: 150, crowd: 0.45, clouds: 4, glow: false, reflection: false },
];

export interface SceneFrame {
  t: number;
  dt: number;
  now: number;
  fast: boolean;
  env: Env;
  cer: CeremonyState;
  wind: number;
  flagLevel: number;
  quality: Quality;
  nd: boolean;
}

interface Drawable {
  y: number;
  draw: () => void;
}

interface LightFlash {
  col: RGB;
  i: number;
  life: number;
  max: number;
}

/** SceneManager：多 Layer 场景 + 视差 + 昼夜染色 + 灯光层 + 倒影 */
export class SceneManager {
  L!: Layout;
  canvas!: HTMLCanvasElement;
  private c!: CanvasRenderingContext2D;
  private world!: HTMLCanvasElement;
  private w!: CanvasRenderingContext2D;
  private tint!: HTMLCanvasElement;
  private tc!: CanvasRenderingContext2D;
  private vignette!: HTMLCanvasElement;
  sky = new Sky();
  clouds = new Clouds();
  fireworks = new FireworkManager();
  crowd = new CrowdManager();
  birds = new Birds();
  fx = new SkyEffects();
  traffic = new Traffic();
  private structure!: StructureSprites;
  private ground!: HTMLCanvasElement;
  private flagFrames = buildFlagFrames();
  private small = buildSmallFlags();
  private lamps: Lamp[] = [];
  private beds: { x: number; y: number; img: HTMLCanvasElement }[] = [];
  private planters: { x: number; y: number; img: HTMLCanvasElement }[] = [];
  lightLevel = 0;
  private flashes: LightFlash[] = [];
  camX = 0;
  pointerX = 0;
  private flagAnim = 0;
  private nd = false;
  private skyForce = true;
  sunCover = 0;

  resize(W: number, H: number, nd: boolean, q: Quality) {
    const L = makeLayout(W, H);
    this.L = L;
    this.nd = nd;
    [this.canvas, this.c] = makeCanvas(W, H);
    [this.world, this.w] = makeCanvas(W, H);
    [this.tint, this.tc] = makeCanvas(W, H);
    this.structure = buildStructure(L, nd);
    this.ground = buildGround(L);
    this.lamps = layoutLamps(L);
    const bedImg = buildFlowerBed(56, 12, 5);
    this.beds = [-1, 1].map((s) => ({ x: L.cx + s * 112, y: L.baseY + 70, img: bedImg }));
    this.planters = [
      { x: -40, y: L.H - 30, img: buildPlanter(110, 34, 9) },
      { x: L.W - 70, y: L.H - 30, img: buildPlanter(110, 34, 12) },
    ];
    this.sky.resize(L);
    this.clouds.resize(L, q.clouds);
    this.fireworks.resize(L);
    this.birds.resize(L);
    this.fx.resize(L);
    this.traffic.resize(L);
    const obstacles = [
      { x0: L.poleX - 26, y0: L.poleBaseY - 10, x1: L.poleX + 26, y1: L.poleBaseY + 5 },
      ...this.beds.map((b) => ({ x0: b.x - 30, y0: b.y - 14, x1: b.x + 30, y1: b.y + 2 })),
      ...this.lamps.filter((l) => l.kind === 'tall').map((l) => ({ x0: l.x - 4, y0: l.y - 3, x1: l.x + 4, y1: l.y + 1 })),
    ];
    this.crowd.setLayout(L, obstacles);
    // 暗角
    const [vg, v] = makeCanvas(W, H);
    const g = v.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.hypot(W, H) * 0.62);
    g.addColorStop(0, 'rgba(0,0,12,0)');
    g.addColorStop(1, 'rgba(0,0,12,0.32)');
    v.fillStyle = g;
    v.fillRect(0, 0, W, H);
    this.vignette = vg;
    this.skyForce = true;
  }

  /** 烟花光照：爆炸瞬间整个环境 Tint 受影响 */
  addFlash(col: RGB, i: number, dur: number) {
    this.flashes.push({ col, i, life: dur, max: dur });
  }

  crowdTarget(env: Env, q: Quality) {
    return Math.min(150, env.crowdTarget * q.crowd * clamp(this.L.W / 640, 0.55, 1.35));
  }

  update(f: SceneFrame, crowdExtra: number) {
    const { dt, env } = f;
    // 灯光 0% → 100% 需要约 7 秒，不瞬间亮起
    const target = env.lightTarget;
    const rate = f.fast ? 2.5 : 1 / 7;
    if (this.lightLevel < target) this.lightLevel = Math.min(target, this.lightLevel + rate * dt);
    else this.lightLevel = Math.max(target, this.lightLevel - rate * dt * 1.5);

    this.camX = lerp(this.camX, Math.sin(f.now / 37) * 2.5 + this.pointerX * 6, Math.min(1, dt * 1.5));
    this.flagAnim += dt * [6, 9, 12][f.flagLevel];

    this.clouds.setCount(Math.round(f.quality.clouds * (0.5 + f.env.daylight * 0.2 + 0.6 * clamp(f.wind))));
    this.clouds.update(dt, f.wind);
    this.sunCover = lerp(this.sunCover, this.clouds.sunCover(env, this.camX), Math.min(1, dt * 1.2));
    this.fireworks.cap = f.quality.particles;
    this.fireworks.update(dt, env.fireworkLevel, f.fast);
    this.birds.update(dt);
    this.fx.update(dt, f.wind);
    this.traffic.update(dt, env.traffic, f.cer.traffic);
    this.crowd.update({ L: this.L, dt, env, cer: f.cer, target: this.crowdTarget(env, f.quality) + crowdExtra, nd: f.nd, fast: f.fast });
    for (const fl of this.flashes) fl.life -= dt;
    this.flashes = this.flashes.filter((fl) => fl.life > 0);
  }

  private ambient(env: Env): RGB {
    let a = env.ambient;
    if (this.sunCover > 0.01) a = mix(a, [a[0] * 0.9, a[1] * 0.92, a[2] * 0.96], this.sunCover);
    for (const fl of this.flashes) {
      const k = (fl.life / fl.max) * fl.i;
      a = mix(a, [Math.max(a[0], fl.col[0]), Math.max(a[1], fl.col[1]), Math.max(a[2], fl.col[2])], k);
    }
    return a;
  }

  render(f: SceneFrame) {
    const { env, now, quality: q } = f;
    const L = this.L;
    const c = this.c;
    const cam = this.camX;
    const o = (k: number) => Math.round(cam * k);

    // ——— Sky / Celestial / Cloud / Particle(sky) ———
    this.sky.render(env, now, f.fast || this.skyForce);
    this.skyForce = false;
    this.sky.draw(c, env, now, cam, q.glow);
    this.sky.drawMoon(c, env, cam, q.glow);
    this.fx.drawSky(c, env, now, cam);
    this.clouds.draw(c, env, cam);
    this.birds.draw(c, env, cam);
    this.fireworks.render(q.glow);
    c.globalCompositeOperation = 'lighter';
    c.drawImage(this.fireworks.canvas, o(0.3), 0);
    c.globalCompositeOperation = 'source-over';

    // ——— World（Background / Tiananmen / Square / Crowd / Foreground）———
    const w = this.w;
    w.clearRect(0, 0, L.W, L.H);
    const sway = Math.round(Math.sin(now * (1.1 + f.wind * 2.2)) * Math.min(1, f.wind * 1.7));
    w.drawImage(this.structure.trees[sway + 1], -L.M + o(0.55), 0);
    w.drawImage(this.structure.day, -L.M + o(0.8), 0);
    w.drawImage(this.ground, -L.M + o(1), 0);
    this.traffic.draw(w, o(1));

    const ox = o(1);
    const sil = clamp(env.evening * 0.8 + env.night * 0.12);
    const lampFlag = this.small.lamp[Math.floor(now * (2 + f.wind * 5)) & 1];
    const handFlag = this.small.hand[0];
    const items: Drawable[] = [];
    for (const l of this.lamps)
      items.push({
        y: l.y,
        draw: () => {
          drawLamp(w, l, ox);
          if (l.kind === 'avenue') {
            w.fillStyle = '#B5B0A4';
            w.fillRect(Math.round(l.x + ox) + 1, l.y - 18, 1, 1);
            w.drawImage(lampFlag, Math.round(l.x + ox) + 1, l.y - 19);
          }
        },
      });
    for (const b of this.beds) items.push({ y: b.y, draw: () => w.drawImage(b.img, Math.round(b.x + ox - b.img.width / 2), b.y - b.img.height) });
    items.push({
      y: L.poleBaseY + 2,
      draw: () => {
        drawPole(w, L, ox);
        const fh = f.cer.flagH;
        if (fh !== null) {
          const top = L.poleTopY + 1;
          const bot = L.poleBaseY - 12 - FLAG_H;
          const fy = Math.round(lerp(bot, top, fh));
          const frames = this.flagFrames[f.flagLevel];
          w.globalAlpha = 0.5;
          w.fillStyle = '#D8D8D8';
          w.fillRect(L.poleX + ox + 2, fy + FLAG_H, 1, L.poleBaseY - 8 - fy - FLAG_H);
          w.globalAlpha = 1;
          w.drawImage(frames[Math.floor(this.flagAnim) % FLAG_FRAMES], L.poleX + ox + 2, fy - FLAG_PAD);
        }
        drawPoleBase(w, L, ox);
      },
    });
    for (const n of this.crowd.npcs) items.push({ y: n.y, draw: () => this.crowd.drawNPC(w, n, ox, sil, env.shadowDx, handFlag) });
    for (const g of f.cer.guards)
      items.push({
        y: g.y,
        draw: () => {
          const h = 19 * depthScale(L, Math.max(g.y, L.squareTop));
          w.fillStyle = 'rgba(40,28,40,0.22)';
          w.fillRect(Math.round(g.x + ox - 3), Math.round(g.y) - 1, 7, 2);
          drawPerson(w, g.x + ox, g.y, h, GUARD_LOOK, { view: g.facing, dir: 1, leg: g.moving ? g.step : -1, arm: 'down', armFrame: 0 }, sil * 0.6);
        },
      });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
    this.fx.drawLeaves(w, ox);
    for (const p of this.planters) w.drawImage(p.img, Math.round(p.x + o(1.3)), p.y);

    // ——— 环境光染色（multiply，保留透明度）———
    const amb = this.ambient(env);
    const tc = this.tc;
    tc.globalCompositeOperation = 'source-over';
    tc.clearRect(0, 0, L.W, L.H);
    tc.drawImage(this.world, 0, 0);
    if (amb[0] < 254 || amb[1] < 254 || amb[2] < 254) {
      tc.globalCompositeOperation = 'multiply';
      tc.fillStyle = css(amb);
      tc.fillRect(0, 0, L.W, L.H);
      tc.globalCompositeOperation = 'destination-in';
      tc.drawImage(this.world, 0, 0);
      tc.globalCompositeOperation = 'source-over';
    }
    c.drawImage(this.tint, 0, 0);

    // ——— Light Layer ———
    const light = this.lightLevel * (this.nd ? 1 : 0.92);
    if (light > 0.01) {
      const sx = -L.M + o(0.8);
      c.globalAlpha = Math.min(1, light) * 0.93;
      c.drawImage(this.structure.lit, sx, 0);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'lighter';
      const boost = this.nd ? 1.25 : 1;
      if (q.glow) {
        const lg = glowSprite(7, [255, 90, 40], 1.8);
        c.globalAlpha = light * 0.55 * boost;
        for (const p of this.structure.lanterns) c.drawImage(lg, p.x + sx - 7, p.y - 7);
        const bg = glowSprite(36, [255, 190, 100], 2.2);
        c.globalAlpha = light * 0.16 * boost;
        c.drawImage(bg, L.cx + o(0.8) - 120, L.baseY - 100, 240, 90);
      }
      // 轮廓灯闪烁
      c.fillStyle = '#FFF6D0';
      const sp = this.structure.sparkles;
      for (let i = 0; i < sp.length; i++) {
        const tw = Math.sin(now * 2.3 + i * 1.7);
        if (tw > 0.92) {
          c.globalAlpha = light * (tw - 0.9) * 8;
          c.fillRect(sp[i].x + sx, sp[i].y, 1, 1);
        }
      }
      // 路灯
      const lampGlow = glowSprite(9, [255, 214, 140], 2);
      const pool = glowSprite(16, [255, 200, 130], 1.6);
      for (const l of this.lamps) {
        const lx = Math.round(l.x + ox);
        c.globalAlpha = light;
        c.globalCompositeOperation = 'source-over';
        c.fillStyle = '#FFF2C4';
        for (const b of l.bulbs) c.fillRect(lx + b.dx - (b.s > 1 ? 1 : 0), l.y + b.dy, b.s + 1, b.s + 1);
        c.globalCompositeOperation = 'lighter';
        if (q.glow) {
          c.globalAlpha = light * 0.5 * boost;
          const hb = l.bulbs[0];
          c.drawImage(lampGlow, lx + hb.dx - 9, l.y + hb.dy - 6);
          c.globalAlpha = light * (l.kind === 'tall' ? 0.3 : 0.2);
          const pw = l.kind === 'tall' ? 60 : 36;
          c.drawImage(pool, lx - pw / 2, l.y - 4, pw, l.kind === 'tall' ? 16 : 8);
        }
      }
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
    }
    this.traffic.drawLights(c, ox, env.night);

    // 摄影闪光：1 帧白色 Flash（50～100ms）
    if (this.crowd.flashes.length) {
      c.globalCompositeOperation = 'lighter';
      const r = env.night > 0.5 ? 7 : 4;
      const fg = glowSprite(r, [255, 255, 255], 1.5);
      for (const fl of this.crowd.flashes) {
        const x = Math.round(fl.x + ox);
        const y = Math.round(fl.y);
        c.globalAlpha = 0.5 + env.night * 0.5;
        c.drawImage(fg, x - r, y - r);
        c.globalAlpha = 1;
        c.fillStyle = '#FFFFFF';
        c.fillRect(x - 1, y, 3, 1);
        c.fillRect(x, y - 1, 1, 3);
      }
      c.globalCompositeOperation = 'source-over';
    }

    // ——— 烟花倒影 ———
    if (q.reflection && this.fireworks.active) {
      c.save();
      c.beginPath();
      c.rect(0, L.squareTop, L.W, L.H - L.squareTop);
      c.clip();
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = 0.13;
      c.translate(o(0.3), L.squareTop * 2 + 30);
      c.scale(1, -1);
      c.drawImage(this.fireworks.canvas, 0, 0);
      c.globalAlpha = 0.07;
      c.drawImage(this.fireworks.canvas, 1, 2);
      c.restore();
    }

    c.drawImage(this.vignette, 0, 0);
  }

  // ——— 交互命中测试（逻辑像素坐标） ———
  isSky(lx: number, ly: number) {
    const L = this.L;
    if (ly > L.baseY - 34) return false;
    if (Math.abs(lx - L.cx) < 132 && ly > L.baseY - 112) return false;
    return true;
  }
}
