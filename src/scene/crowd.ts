import { chance, clamp, pick, rand, randInt, weighted } from '../core/math';
import { Env } from '../core/env';
import { CeremonyState } from './ceremony';
import { Layout, depthScale } from './layout';
import { drawPerson, Look, Pose, randomLook } from './people';

/**
 * CrowdManager：NPC 生态系统
 * 状态机 IDLE → WALK → PHOTO → WAVE_FLAG → LOOK → WALK …（随机切换）
 * 结伴出行（情侣 / 家庭 / 老人），小朋友会跑动、挥旗；升旗时全体驻足面向国旗。
 */
type State = 'idle' | 'walk' | 'photo' | 'selfie' | 'wave' | 'look' | 'stand';
type Kind = 'adult' | 'child' | 'elder';

export interface NPC {
  id: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  speed: number;
  kind: Kind;
  look: Look;
  h: number;
  state: State;
  timer: number;
  dir: 1 | -1;
  view: Pose['view'];
  anim: number;
  leaving: boolean;
  leader: NPC | null;
  ox: number;
  oy: number;
  hasFlag: boolean;
  flashAt: number;
  flashPending: boolean;
  runner: boolean;
  fade: number;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface CrowdFrame {
  L: Layout;
  dt: number;
  env: Env;
  cer: CeremonyState;
  target: number;
  nd: boolean;
  fast: boolean;
}

export interface Flash {
  x: number;
  y: number;
  life: number;
}

let nextId = 1;

export class CrowdManager {
  npcs: NPC[] = [];
  flashes: Flash[] = [];
  obstacles: Rect[] = [];
  private L!: Layout;
  private spawnTimer = 0;
  private leaveTimer = 0;
  private surgeLeft = 0;
  private lastTarget = -1;
  private nd = false;
  private night = 0;

  setLayout(L: Layout, obstacles: Rect[]) {
    const old = this.L;
    this.L = L;
    this.obstacles = obstacles;
    if (old && (old.W !== L.W || old.H !== L.H)) {
      for (const n of this.npcs) {
        n.x = (n.x / old.W) * L.W;
        n.y = L.squareTop + ((n.y - old.squareTop) / (old.H - old.squareTop)) * (L.H - L.squareTop);
        this.pickTarget(n, 0);
      }
    }
  }

  get leaders() {
    return this.npcs.filter((n) => !n.leader);
  }

  private inObstacle(x: number, y: number, pad = 0) {
    return this.obstacles.some((o) => x > o.x0 - pad && x < o.x1 + pad && y > o.y0 - pad && y < o.y1 + pad);
  }

  private pickTarget(n: NPC, gather: number) {
    const L = this.L;
    for (let i = 0; i < 12; i++) {
      let x: number;
      let y: number;
      if (gather > 0 && chance(gather * 0.85)) {
        x = L.cx + rand(-120, 120);
        y = L.poleBaseY + rand(8, 72);
      } else {
        x = rand(8, L.W - 8);
        y = rand(L.squareTop + 8, L.H - 5);
      }
      y = clamp(y, L.squareTop + 6, L.H - 3);
      if (!this.inObstacle(x, y, 3)) {
        n.tx = x;
        n.ty = y;
        return;
      }
    }
    n.tx = rand(8, L.W - 8);
    n.ty = L.H - 6;
  }

  private make(kind: Kind, x: number, y: number, leader: NPC | null): NPC {
    const base = kind === 'child' ? rand(11, 12.5) : kind === 'elder' ? rand(17, 18.5) : rand(18, 20.5);
    const flagP = (kind === 'child' ? 0.5 : 0.22) * (this.nd ? 1.5 : 1);
    return {
      id: nextId++,
      x,
      y,
      tx: x,
      ty: y,
      speed: kind === 'child' ? rand(13, 17) : kind === 'elder' ? rand(5.5, 7.5) : rand(8.5, 13),
      kind,
      look: randomLook(kind),
      h: base,
      state: 'walk',
      timer: rand(4, 10),
      dir: 1,
      view: 'side',
      anim: rand(0, 4),
      leaving: false,
      leader,
      ox: leader ? rand(-9, 9) : 0,
      oy: leader ? rand(-3, 4) : 0,
      hasFlag: chance(flagP),
      flashAt: -1,
      flashPending: false,
      runner: false,
      fade: 1,
    };
  }

  spawnGroup(where: 'edge' | 'inside' | 'bottom', gather = 0) {
    const L = this.L;
    let x: number;
    let y: number;
    if (where === 'inside') {
      do {
        x = rand(6, L.W - 6);
        y = rand(L.squareTop + 6, L.H - 4);
      } while (this.inObstacle(x, y, 3));
    } else if (where === 'bottom') {
      x = rand(10, L.W - 10);
      y = L.H + 12;
    } else {
      x = chance(0.5) ? -14 : L.W + 14;
      y = rand(L.squareTop + 8, L.H - 4);
    }
    const type = weighted([
      ['single', 40],
      ['couple', 24],
      ['family', 26],
      ['elders', 10],
    ] as const);
    const lead = this.make(type === 'elders' ? 'elder' : 'adult', x, y, null);
    this.pickTarget(lead, gather);
    const group = [lead];
    if (type === 'couple') group.push(this.make('adult', x + rand(-5, 5), y + rand(-2, 2), lead));
    if (type === 'elders') group.push(this.make('elder', x + 4, y + 1, lead));
    if (type === 'family') {
      if (chance(0.7)) group.push(this.make('adult', x + 4, y + 2, lead));
      const kids = randInt(1, 2);
      for (let i = 0; i < kids; i++) group.push(this.make('child', x + rand(-6, 6), y + rand(-2, 3), lead));
    }
    for (const n of group) {
      if (n.leader) {
        n.x = lead.x + n.ox;
        n.y = clamp(lead.y + n.oy, L.squareTop + 4, L.H + 14);
      }
      if (where === 'inside') {
        n.state = pick(['idle', 'look', 'walk'] as State[]);
        n.timer = rand(0.5, 6);
        if (n.state !== 'walk') n.view = 'back';
      }
      this.npcs.push(n);
    }
    return group;
  }

  /** 大量游客进入 */
  surge() {
    this.surgeLeft = randInt(4, 7);
  }

  /** 小朋友跑过 */
  kidRun() {
    const L = this.L;
    const fromLeft = chance(0.5);
    const y = rand(L.squareTop + 30, L.H - 8);
    const kid = this.make('child', fromLeft ? -10 : L.W + 10, y, null);
    kid.runner = true;
    kid.hasFlag = true;
    kid.speed = rand(24, 30);
    kid.tx = fromLeft ? L.W + 20 : -20;
    kid.ty = y + rand(-10, 10);
    kid.leaving = true;
    this.npcs.push(kid);
  }

  /** 游客挥旗 */
  waveAll() {
    for (const n of this.npcs) {
      if (n.state === 'stand' || n.leaving) continue;
      if (!n.hasFlag && chance(0.35)) n.hasFlag = true;
      if (n.hasFlag && chance(0.75)) {
        n.state = 'wave';
        n.timer = rand(3, 6);
      }
    }
  }

  /** 摄影闪光 */
  photoSpree() {
    for (const n of this.npcs) {
      if (n.state === 'stand' || n.leaving || n.kind === 'child') continue;
      if (chance(0.25)) this.startPhoto(n);
    }
  }

  private startPhoto(n: NPC) {
    const selfie = chance(0.3);
    n.state = selfie ? 'selfie' : 'photo';
    n.timer = rand(2, 4);
    n.flashAt = n.timer * rand(0.2, 0.6);
    n.view = selfie ? 'front' : 'back';
  }

  private chooseNext(n: NPC, gather: number) {
    const r = Math.random();
    const nightPhoto = this.night > 0.5 ? 0.12 : 0;
    if (n.kind === 'child') {
      if (n.hasFlag && r < 0.45) {
        n.state = 'wave';
        n.timer = rand(2.5, 5);
      } else if (r < 0.65) {
        n.state = 'idle';
        n.timer = rand(1, 3);
      } else {
        n.state = 'walk';
        this.pickTarget(n, gather);
      }
      return;
    }
    if (r < 0.22) {
      n.state = 'idle';
      n.timer = rand(2, 6);
      n.view = chance(0.5) ? 'front' : 'side';
    } else if (r < 0.46 + nightPhoto) this.startPhoto(n);
    else if (r < 0.6 + nightPhoto && n.hasFlag) {
      n.state = 'wave';
      n.timer = rand(3, 6);
    } else if (r < 0.78) {
      n.state = 'look';
      n.timer = rand(3, 8);
      n.view = chance(0.75) ? 'back' : 'side';
    } else {
      n.state = 'walk';
      this.pickTarget(n, gather);
      n.timer = rand(6, 14);
    }
  }

  private moveToward(n: NPC, tx: number, ty: number, speed: number, dt: number) {
    const dx = tx - n.x;
    const dy = ty - n.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.6) return true;
    const s = Math.min(d, speed * dt);
    n.x += (dx / d) * s;
    n.y += (dy / d) * s * 0.8;
    if (Math.abs(dx) > 0.3) n.dir = dx > 0 ? 1 : -1;
    n.view = Math.abs(dx) > Math.abs(dy) * 0.6 ? 'side' : dy < 0 ? 'back' : 'front';
    n.anim += dt * speed * 0.55;
    // 绕开花坛与旗杆基座
    for (const o of this.obstacles) {
      if (n.x > o.x0 && n.x < o.x1 && n.y > o.y0 && n.y < o.y1) {
        const dl = n.x - o.x0,
          dr = o.x1 - n.x,
          dtp = n.y - o.y0,
          db = o.y1 - n.y;
        const m = Math.min(dl, dr, dtp, db);
        if (m === dl) n.x = o.x0;
        else if (m === dr) n.x = o.x1;
        else if (m === dtp) n.y = o.y0;
        else n.y = o.y1;
      }
    }
    return false;
  }

  update(f: CrowdFrame) {
    const { L, dt, cer } = f;
    this.nd = f.nd;
    this.night = f.env.night;
    const hold = cer.hold > 0.5;
    const target = Math.round(f.target);

    // —— 人数调节 ——
    const leaders = this.npcs.filter((n) => !n.leaving).length;
    if (f.fast && Math.abs(target - leaders) > 18 && Math.abs(target - this.lastTarget) > 4) {
      // 时间跳转：立即调整人群密度
      while (this.npcs.filter((n) => !n.leaving).length < target - 4) this.spawnGroup('inside', cer.gather);
      let excess = this.npcs.length - target;
      while (excess > 4) {
        this.npcs.splice(Math.floor(Math.random() * this.npcs.length), 1);
        excess--;
      }
      for (const n of this.npcs) if (n.leader && !this.npcs.includes(n.leader)) n.leader = null;
    } else if (!hold) {
      this.spawnTimer -= dt;
      if ((leaders < target - 1 || this.surgeLeft > 0) && this.spawnTimer <= 0) {
        this.spawnGroup(chance(0.25) ? 'bottom' : 'edge', cer.gather);
        if (this.surgeLeft > 0) this.surgeLeft--;
        this.spawnTimer = this.surgeLeft > 0 ? rand(0.2, 0.5) : rand(0.5, 1.6) * (leaders < target * 0.7 ? 0.4 : 1);
      }
      this.leaveTimer -= dt;
      if (leaders > target + 3 && this.leaveTimer <= 0) {
        const cands = this.npcs.filter((n) => !n.leader && !n.leaving);
        if (cands.length) {
          const n = pick(cands);
          n.leaving = true;
          n.state = 'walk';
          n.tx = n.x < L.W / 2 ? -20 : L.W + 20;
          n.ty = n.y + rand(-10, 10);
        }
        this.leaveTimer = rand(0.6, 2.2);
      }
    }
    this.lastTarget = target;

    // —— 个体行为 ——
    for (const n of this.npcs) {
      if (hold && !n.runner) {
        if (n.state !== 'stand') {
          n.state = 'stand';
          n.view = 'back';
          n.timer = rand(0.5, 2);
        }
        continue;
      }
      if (n.state === 'stand') {
        n.state = 'idle';
        n.timer = rand(0.5, 3);
      }
      if (n.leader && !n.leaving) {
        const ld = n.leader;
        if (ld.leaving) {
          n.leaving = true;
          n.tx = ld.tx + n.ox;
          n.ty = ld.ty + n.oy;
        } else if (ld.state === 'walk') {
          const done = this.moveToward(n, ld.x + n.ox, ld.y + n.oy, ld.speed * 1.2 + (n.kind === 'child' ? 3 : 0), dt);
          n.state = done ? 'idle' : 'walk';
          continue;
        } else {
          const d = Math.hypot(ld.x + n.ox - n.x, ld.y + n.oy - n.y);
          if (d > 3) {
            this.moveToward(n, ld.x + n.ox, ld.y + n.oy, ld.speed * 1.2, dt);
            n.state = 'walk';
            continue;
          }
          if (n.state === 'walk') this.chooseNext(n, 0);
        }
      }
      if (n.leaving) {
        n.state = 'walk';
        this.moveToward(n, n.tx, n.ty, n.speed * (n.runner ? 1 : 1.1), dt);
        continue;
      }
      n.timer -= dt;
      switch (n.state) {
        case 'walk': {
          const done = this.moveToward(n, n.tx, n.ty, n.speed, dt);
          if (done || n.timer < -20) this.chooseNext(n, cer.gather);
          break;
        }
        case 'photo':
        case 'selfie':
          if (n.flashAt > 0 && n.timer < n.flashAt) {
            n.flashAt = -1;
            n.flashPending = true;
          }
          if (n.timer <= 0) this.chooseNext(n, cer.gather);
          break;
        case 'wave':
          n.anim += dt * 6;
          if (n.timer <= 0) this.chooseNext(n, cer.gather);
          break;
        default:
          if (n.timer <= 0) this.chooseNext(n, cer.gather);
      }
    }

    // 移除离开画面的游客
    this.npcs = this.npcs.filter((n) => !(n.leaving && (n.x < -18 || n.x > L.W + 18 || n.y > L.H + 16)));
    for (const n of this.npcs) if (n.leader && !this.npcs.includes(n.leader)) n.leader = null;
    // 底部进入的游客走入画面后才开始正常决策
    for (const n of this.npcs) if (n.y > L.H - 3 && !n.leaving) n.ty = Math.min(n.ty, L.H - 4);

    for (const fl of this.flashes) fl.life -= dt;
    this.flashes = this.flashes.filter((fl) => fl.life > 0);
  }

  drawNPC(c: CanvasRenderingContext2D, n: NPC, ox: number, sil: number, shadowDx: number, handFlag: HTMLCanvasElement) {
    const s = depthScale(this.L, n.y);
    const h = n.h * s;
    const moving = n.state === 'walk';
    const pose: Pose = {
      view: n.view,
      dir: n.dir,
      leg: moving ? Math.floor(n.anim) & 3 : -1,
      arm:
        n.state === 'photo' ? 'phone' : n.state === 'selfie' ? 'selfie' : n.state === 'wave' || (n.runner && n.hasFlag) ? 'flag' : 'down',
      armFrame: Math.floor(n.anim * 1.5),
    };
    const x = n.x + ox;
    // 阴影
    const sw = Math.max(3, Math.round(h * 0.42));
    c.fillStyle = 'rgba(40,28,40,0.22)';
    c.fillRect(Math.round(x - sw / 2 + shadowDx * 0.5), Math.round(n.y) - 1, sw + Math.round(Math.abs(shadowDx)), 2);
    const res = drawPerson(c, x, n.y, h, n.look, pose, sil, n.kind === 'child', handFlag);
    if (n.flashPending) {
      n.flashPending = false;
      this.flashes.push({ x: res.hx - ox, y: res.hy, life: rand(0.05, 0.1) });
    }
  }
}
