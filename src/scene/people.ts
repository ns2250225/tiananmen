import { hex, mix, toHex } from '../core/color';
import { pick, weighted, chance } from '../core/math';

export interface Look {
  skin: string;
  hair: string;
  top: string;
  bottom: string;
  shoes: string;
  hat: string | null;
  bag: string | null;
  guard?: boolean;
}

export interface Pose {
  view: 'side' | 'front' | 'back';
  dir: 1 | -1;
  /** 步态帧 0..3，-1 为站立 */
  leg: number;
  arm: 'down' | 'phone' | 'flag' | 'selfie';
  armFrame: number;
}

const SKIN = ['#F1C8A0', '#EBBC92', '#E0AD82', '#CF9A6E', '#F5D2B0'];
const HAIR = ['#1A1414', '#201816', '#2A201C', '#382A22', '#1A1414', '#4A3426'];
const ELDER_HAIR = ['#BDB8B2', '#9C968E', '#D4D0CA'];
const TOPS: [string, number][] = [
  ['#D9302A', 5],
  ['#E8473A', 3],
  ['#F4F1EA', 4],
  ['#2F5DA8', 2],
  ['#F2C14E', 2],
  ['#3A3A44', 2],
  ['#6E8E4A', 1],
  ['#E87AA0', 1],
  ['#4AA0C8', 2],
  ['#C8642A', 1],
  ['#8A4AA0', 1],
  ['#FFFFFF', 2],
];
const BOTTOMS = ['#2D3E66', '#1E2430', '#4A4A52', '#8A7A5A', '#2A5A8A', '#D8D2C4', '#3A3036'];
const HATS: [string | null, number][] = [
  [null, 14],
  ['#D9302A', 2],
  ['#E8D8A8', 1],
  ['#F4F1EA', 1],
  ['#2F5DA8', 1],
];
const BAGS = ['#3A3A44', '#5A4A3A', '#2F5DA8', '#8A2A2A'];

export function randomLook(kind: 'adult' | 'child' | 'elder'): Look {
  return {
    skin: pick(SKIN),
    hair: kind === 'elder' ? pick(ELDER_HAIR) : pick(HAIR),
    top: weighted(TOPS),
    bottom: pick(BOTTOMS),
    shoes: chance(0.3) ? '#E8E4DC' : '#2A2626',
    hat: kind === 'child' && chance(0.3) ? '#D9302A' : weighted(HATS),
    bag: kind !== 'child' && chance(0.3) ? pick(BAGS) : null,
  };
}

export const GUARD_LOOK: Look = {
  skin: '#EBBC92',
  hair: '#1A1414',
  top: '#3F5A35',
  bottom: '#354D2D',
  shoes: '#141414',
  hat: '#3F5A35',
  bag: null,
  guard: true,
};

/** 剪影调色：傍晚游客逐渐变成 Pixel Silhouette */
const colCache = new Map<string, string>();
const SIL: [number, number, number] = [40, 24, 44];
export function silhouette(h: string, s: number) {
  if (s <= 0.02) return h;
  const q = Math.round(s * 10);
  const key = h + q;
  let v = colCache.get(key);
  if (!v) {
    v = toHex(mix(hex(h), SIL, q / 10));
    colCache.set(key, v);
  }
  return v;
}

export interface PersonResult {
  /** 手机 / 小旗位置，用于闪光 */
  hx: number;
  hy: number;
}

/**
 * 程序化像素人物。h 为像素高度（随透视变化）。
 * 返回手部道具位置。
 */
export function drawPerson(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  look: Look,
  pose: Pose,
  sil: number,
  child = false,
  flagSprite?: HTMLCanvasElement,
): PersonResult {
  const C = (col: string) => silhouette(col, sil);
  const H = Math.max(7, Math.round(h));
  const hs = Math.max(2, Math.round(H * (child ? 0.27 : 0.2)));
  const th = Math.max(3, Math.round(H * 0.36));
  const lh = Math.max(2, H - hs - th);
  const bw = Math.max(3, Math.round(H * 0.3));
  const X = Math.round(x);
  const Y = Math.round(y);
  const top = Y - H;
  const bx = X - (bw >> 1);
  const tTop = top + hs;
  const legTop = tTop + th;
  const rect = (rx: number, ry: number, rw: number, rh: number, col: string) => {
    c.fillStyle = C(col);
    c.fillRect(rx, ry, rw, rh);
  };

  // —— 腿 ——
  const lw = Math.max(1, Math.floor(bw / 2));
  const stride = Math.max(1, Math.round(H / 12));
  const o = pose.leg < 0 ? 0 : [0, stride, 0, -stride][pose.leg & 3];
  const upper = Math.ceil(lh / 2);
  const lower = lh - upper;
  const lx = X - lw;
  const rx = X + (bw & 1 ? 0 : 0);
  rect(lx, legTop, lw, upper, look.bottom);
  rect(rx, legTop, lw, upper, look.bottom);
  if (pose.view === 'side') {
    rect(lx + o, legTop + upper, lw, lower, look.bottom);
    rect(rx - o, legTop + upper, lw, lower, look.bottom);
    rect(lx + o, Y - 1, lw, 1, look.shoes);
    rect(rx - o, Y - 1, lw, 1, look.shoes);
  } else {
    const liftL = pose.leg === 1 ? 1 : 0;
    const liftR = pose.leg === 3 ? 1 : 0;
    rect(lx, legTop + upper, lw, lower - liftL, look.bottom);
    rect(rx, legTop + upper, lw, lower - liftR, look.bottom);
    rect(lx, Y - 1 - liftL, lw, 1, look.shoes);
    rect(rx, Y - 1 - liftR, lw, 1, look.shoes);
  }

  // —— 背包（身后） ——
  if (look.bag && pose.view === 'side') rect(pose.dir > 0 ? bx - 1 : bx + bw, tTop + 1, 1, Math.max(2, th - 2), look.bag);

  // —— 躯干 ——
  rect(bx, tTop, bw, th, look.top);
  rect(pose.dir > 0 ? bx : bx + bw - 1, tTop + 1, 1, th - 1, darkenCol(look.top));
  if (look.guard) {
    rect(bx, tTop + Math.floor(th * 0.6), bw, 1, '#C9A040');
    rect(bx, tTop, bw, 1, '#2E4428');
  }
  if (look.bag && pose.view === 'back') rect(bx + 1, tTop + 1, Math.max(1, bw - 2), Math.max(2, th - 2), look.bag);

  // —— 手臂 ——
  const hand = look.guard ? '#F4F4F0' : look.skin;
  let hx = X;
  let hy = top;
  if (pose.arm === 'phone') {
    // 举手机拍照：背对观者时手机举过头顶
    if (pose.view === 'back' || pose.view === 'front') {
      rect(bx - 1, tTop - 1, 1, 2, hand);
      rect(bx + bw, tTop - 1, 1, 2, hand);
      rect(X - 1, top - 2, 3, 2, '#22262E');
      hx = X;
      hy = top - 2;
    } else {
      const fx = pose.dir > 0 ? bx + bw : bx - 2;
      rect(fx, tTop + 1, 2, 1, look.top);
      rect(pose.dir > 0 ? fx + 2 : fx - 1, tTop - 1, 1, 2, '#22262E');
      hx = pose.dir > 0 ? fx + 2 : fx - 1;
      hy = tTop - 1;
    }
  } else if (pose.arm === 'selfie') {
    const sx = pose.dir > 0 ? bx + bw + 1 : bx - 2;
    rect(pose.dir > 0 ? bx + bw : bx - 1, tTop - 1, 1, 2, hand);
    rect(sx, top - 1, 1, 2, '#22262E');
    hx = sx;
    hy = top - 1;
  } else if (pose.arm === 'flag') {
    const up = pose.armFrame & 1;
    const ax = pose.dir > 0 ? bx + bw : bx - 1;
    rect(ax, tTop - 1 - up, 1, 2, hand);
    rect(ax, tTop - 4 - up, 1, 3, '#8A7A60');
    if (flagSprite) c.drawImage(flagSprite, pose.dir > 0 ? ax + 1 : ax - 3, tTop - 4 - up);
    hx = ax;
    hy = tTop - 4;
  } else {
    if (pose.view === 'side') {
      const sw = pose.leg < 0 ? 0 : pose.leg === 1 ? 1 : pose.leg === 3 ? -1 : 0;
      rect(X + sw * pose.dir - (pose.dir > 0 ? 0 : 0), tTop + 1, 1, th - 1, darkenCol(look.top));
      rect(X + sw * pose.dir, tTop + th - 1, 1, 1, hand);
    } else {
      rect(bx - 1, tTop + 1, 1, th - 1, look.top);
      rect(bx + bw, tTop + 1, 1, th - 1, look.top);
      rect(bx - 1, tTop + th - 1, 1, 1, hand);
      rect(bx + bw, tTop + th - 1, 1, 1, hand);
    }
  }

  // —— 头 ——
  const hw = hs + (H > 15 ? 1 : 0);
  const hxl = X - (hw >> 1);
  if (pose.view === 'back') {
    rect(hxl, top, hw, hs, look.hair);
  } else {
    rect(hxl, top, hw, hs, look.skin);
    rect(hxl, top, hw, Math.max(1, Math.floor(hs / 3)), look.hair);
    if (pose.view === 'side') rect(pose.dir > 0 ? hxl : hxl + hw - 1, top, 1, Math.max(1, hs - 1), look.hair);
    else {
      rect(hxl, top, 1, Math.max(1, hs - 1), look.hair);
      rect(hxl + hw - 1, top, 1, Math.max(1, hs - 1), look.hair);
      if (hs >= 4 && sil < 0.5) {
        rect(hxl + 1, top + 2, 1, 1, '#2A2020');
        rect(hxl + hw - 2, top + 2, 1, 1, '#2A2020');
      }
    }
  }
  if (look.hat) {
    rect(hxl, top - 1, hw, 1, look.hat);
    if (pose.view === 'side') rect(pose.dir > 0 ? hxl + hw : hxl - 1, top, 1, 1, look.hat);
    else rect(hxl - 1, top, hw + 2, 1, look.guard ? '#2E4428' : look.hat);
    if (look.guard) rect(X, top - 1, 1, 1, '#E8402E');
  }
  return { hx, hy };
}

const dk = new Map<string, string>();
function darkenCol(h: string) {
  let v = dk.get(h);
  if (!v) {
    v = toHex(mix(hex(h), [20, 10, 20], 0.22));
    dk.set(h, v);
  }
  return v;
}
