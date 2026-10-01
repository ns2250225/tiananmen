import { hex, toHex, RGB, mix } from '../core/color';
import { hash2, mulberry32 } from '../core/math';
import { makeCanvas, pixelText, PixBuf } from '../render/canvas';
import { Layout } from './layout';

/**
 * 天安门主体：程序化手绘 Pixel Art。
 * 采用「基础 Sprite + 动态 Tint + 灯光 Layer」方案：
 *  - day：基础精灵，参与环境光染色
 *  - lit：夜间泛光照明版本（暖金色 + 檐口轮廓灯），按灯光强度叠加
 */
export interface StructureSprites {
  day: HTMLCanvasElement;
  lit: HTMLCanvasElement;
  trees: HTMLCanvasElement[];
  /** 灯笼位置（结构画布坐标） */
  lanterns: { x: number; y: number }[];
  /** 轮廓灯（用于夜间闪烁） */
  sparkles: { x: number; y: number }[];
  width: number;
}

type Pal = (h: string) => string;
const ident: Pal = (h) => h;
const litCache = new Map<string, string>();
const litPal: Pal = (h) => {
  let v = litCache.get(h);
  if (!v) {
    const [r, g, b] = hex(h);
    v = toHex([Math.min(255, r * 1.12 + 40), Math.min(255, g * 0.94 + 24), Math.min(255, b * 0.6 + 8)]);
    litCache.set(h, v);
  }
  return v;
};

const CHIWEN = ['.##..', '#..#.', '#.##.', '.####', '..###', '.####', '#####'];

interface Ctx {
  c: CanvasRenderingContext2D;
  P: Pal;
  lit: boolean;
  sparkles: { x: number; y: number }[];
}

function r(k: Ctx, x: number, y: number, w: number, h: number, col: string) {
  k.c.fillStyle = k.P(col);
  k.c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function archShape(k: Ctx, cx: number, by: number, w: number, h: number, col: string) {
  const rad = w / 2;
  for (let yy = 0; yy < h; yy++) {
    const y = by - h + yy;
    let half = rad;
    if (yy < rad) {
      const dy = rad - yy - 0.5;
      half = Math.sqrt(Math.max(0, rad * rad - dy * dy));
    }
    const l = Math.round(cx - half);
    const rr = Math.round(cx + half);
    if (rr > l) r(k, l, y, rr - l, 1, col);
  }
}

/** 中式屋顶（正视）：凹曲面 + 翼角起翘 + 琉璃瓦垄 */
function roof(k: Ctx, gx: number, yTop: number, yEave: number, hwTop: number, hwEave: number, lift: number) {
  const H = yEave - yTop;
  const corner = 20;
  for (let x = -hwEave; x <= hwEave; x++) {
    const ax = Math.abs(x);
    let yt: number;
    if (ax <= hwTop) yt = yTop;
    else yt = yTop + Math.pow((ax - hwTop) / (hwEave - hwTop), 1 / 1.7) * H;
    const lf = ax > hwEave - corner ? Math.pow((ax - (hwEave - corner)) / corner, 2) * lift : 0;
    const yb = Math.round(yEave - lf);
    const ytr = Math.round(Math.min(yt - lf * 0.5, yb - 2));
    for (let y = ytr; y <= yb; y++) {
      let col: string;
      if (y === yb) col = '#74470F';
      else if (y === yb - 1) col = x & 1 ? '#F5C850' : '#A87218';
      else if (y === ytr && ax > hwTop) col = '#FBDA78';
      else {
        const v = (y - yTop) / H;
        col = x & 1 ? (v < 0.28 ? '#F6CA58' : '#E4AC38') : v < 0.28 ? '#E2B044' : '#C68E26';
      }
      k.c.fillStyle = k.P(col);
      k.c.fillRect(gx + x, y, 1, 1);
      if (k.lit && y === yb && (x & 1) === 0) {
        k.c.fillStyle = '#FFF0B0';
        k.c.fillRect(gx + x, y, 1, 1);
        if (x % 6 === 0) k.sparkles.push({ x: gx + x, y });
      }
      if (k.lit && y === ytr && ax > hwTop && ax % 3 === 0) {
        k.c.fillStyle = '#FFE9A0';
        k.c.fillRect(gx + x, y, 1, 1);
      }
    }
  }
  // 翼角尖
  for (const s of [-1, 1]) {
    r(k, gx + s * (hwEave + 1) - (s < 0 ? 0 : 0), yEave - lift - 2, 1, 2, '#F5C850');
    r(k, gx + s * (hwEave + 2), yEave - lift - 3, 1, 1, '#E4AC38');
  }
}

function bracketBand(k: Ctx, gx: number, y: number, hw: number) {
  r(k, gx - hw, y, hw * 2, 3, '#2E6E6A');
  for (let x = gx - hw; x < gx + hw; x += 4) {
    r(k, x, y, 2, 1, '#2B4F9A');
    r(k, x + 1, y + 1, 1, 1, '#E3B341');
  }
  r(k, gx - hw, y + 2, hw * 2, 1, '#1E4846');
}

function latticePanels(k: Ctx, gx: number, hw: number, top: number, bot: number, bays: number, base: string, grid: string) {
  const bayW = (hw * 2) / bays;
  for (let i = 0; i < bays; i++) {
    const x0 = Math.round(gx - hw + i * bayW + 3);
    const w = Math.round(bayW - 5);
    for (let y = top; y < bot; y++)
      for (let x = x0; x < x0 + w; x++) {
        const lat = (x + y) % 3 === 0 || (x - y + 300) % 3 === 0;
        r(k, x, y, 1, 1, lat ? grid : base);
      }
  }
  for (let i = 0; i <= bays; i++) {
    const x = Math.round(gx - hw + i * bayW);
    r(k, x - 1, top - 2, 2, bot - top + 2, '#C0392B');
    r(k, x - 1, top - 2, 1, bot - top + 2, '#DA5A4A');
  }
}

function lantern(k: Ctx, x: number, y: number) {
  r(k, x, y, 1, 1, '#D9A441');
  r(k, x - 2, y + 1, 5, 1, '#D9A441');
  r(k, x - 2, y + 2, 5, 1, '#D8231A');
  r(k, x - 3, y + 3, 7, 3, '#D8231A');
  r(k, x - 2, y + 6, 5, 1, '#D8231A');
  r(k, x - 2, y + 3, 1, 2, '#FF6040');
  r(k, x + 2, y + 3, 1, 3, '#A8160F');
  r(k, x - 1, y + 7, 3, 1, '#D9A441');
  r(k, x, y + 8, 1, 2, '#F2C14E');
}

function huabiao(k: Ctx, x: number, base: number) {
  r(k, x - 3, base - 2, 7, 2, '#CFC8BA');
  r(k, x - 2, base - 3, 5, 1, '#E2DDD2');
  r(k, x - 1, base - 31, 3, 28, '#EEEAE1');
  r(k, x + 1, base - 31, 1, 28, '#C6BFB1');
  for (let i = 0; i < 6; i++) r(k, x - 1 + (i & 1), base - 24 + i * 3, 1, 2, '#CFC8BA');
  r(k, x - 5, base - 27, 11, 2, '#F4F0E8');
  r(k, x - 5, base - 26, 11, 1, '#C9C2B4');
  r(k, x - 2, base - 32, 5, 1, '#DAD4C8');
  r(k, x - 1, base - 34, 3, 2, '#E8E3DA');
  r(k, x, base - 35, 1, 1, '#E8E3DA');
}

function lion(k: Ctx, x: number, base: number, dir: number) {
  r(k, x - 2, base - 2, 5, 2, '#B9B2A4');
  r(k, x - 2, base - 6, 4, 4, '#A39C8E');
  r(k, x - 1 + dir, base - 8, 3, 3, '#A39C8E');
  r(k, x + dir * 2, base - 7, 1, 1, '#7F786C');
}

function drawStructure(k: Ctx, L: Layout, SW: number, nd: boolean, lanterns: { x: number; y: number }[]) {
  const gx = Math.round(SW / 2);
  const by = L.baseY;
  const rng = mulberry32(1949);

  // —— 两侧红墙（皇城墙） ——
  const wallTop = by - 31;
  r(k, 0, wallTop, SW, 3, '#E3AE3B');
  r(k, 0, wallTop, SW, 1, '#F6CF62');
  for (let x = 0; x < SW; x += 2) r(k, x, wallTop + 1, 1, 2, '#C9922C');
  r(k, 0, wallTop + 3, SW, 1, '#74470F');
  r(k, 0, wallTop + 4, SW, by - wallTop - 4, '#9A2A21');
  r(k, 0, by - 3, SW, 3, '#7C2019');
  for (let i = 0; i < SW * 0.6; i++) r(k, rng() * SW, wallTop + 5 + rng() * (by - wallTop - 9), 2, 1, rng() < 0.5 ? '#8E251D' : '#A63128');
  if (k.lit) for (let x = 0; x < SW; x += 2) r(k, x, wallTop, 1, 1, '#FFE6A0');

  // —— 观礼台 ——
  for (const s of [-1, 1]) {
    const x0 = gx + s * 142;
    const x1 = gx + s * 242;
    const l = Math.min(x0, x1);
    const w = Math.abs(x1 - x0);
    for (let i = 0; i < 5; i++) {
      const y = by - 15 + i * 3;
      r(k, l + (s < 0 ? 0 : 0), y, w, 1, '#DDD5C4');
      r(k, l, y + 1, w, 2, '#B4AA96');
    }
    r(k, l, by - 16, w, 1, '#C9C0AD');
  }

  // —— 国庆特别横幅 ——
  if (nd) {
    const texts = ['欢度国庆', '祝福祖国'];
    [-1, 1].forEach((s, i) => {
      const txt = pixelText(texts[i], 10, k.lit ? '#FFF0A0' : '#FFD75A', 130, '600');
      const bw = txt.width + 8;
      const bh = 14;
      const x = Math.round(gx + s * 192 - bw / 2);
      const y = wallTop + 3;
      r(k, x, y, bw, bh, '#F2C14E');
      r(k, x + 1, y + 1, bw - 2, bh - 2, '#D42A1E');
      r(k, x + 1, y + bh - 2, bw - 2, 1, '#A81E14');
      k.c.drawImage(txt, x + 4, y + Math.round((bh - txt.height) / 2));
      r(k, x, y + bh, 1, 2, '#F2C14E');
      r(k, x + bw - 1, y + bh, 1, 2, '#F2C14E');
    });
  }

  // —— 城台 ——
  const pw2 = 134;
  const pTop = by - 38;
  for (let i = 0; i < 38; i++) {
    const y = pTop + i;
    const sh = Math.round((38 - i) / 13);
    const hw = pw2 - sh;
    r(k, gx - hw, y, hw * 2, 1, '#A8291F');
    r(k, gx - hw, y, 1, 1, '#7E1F18');
    r(k, gx + hw - 1, y, 1, 1, '#7E1F18');
  }
  for (let i = 0; i < 520; i++) {
    const x = gx - 130 + rng() * 260;
    const y = pTop + 2 + rng() * 32;
    r(k, x, y, 2, 1, rng() < 0.55 ? '#9A251C' : '#B33126');
  }
  r(k, gx - pw2 + 3, pTop, (pw2 - 3) * 2, 1, '#8A2219');
  r(k, gx - pw2, by - 3, pw2 * 2, 1, '#A39888');
  r(k, gx - pw2, by - 2, pw2 * 2, 2, '#8C8173');

  // —— 五个券门 ——
  const arches: [number, number, number][] = [
    [0, 14, 24],
    [-38, 11, 19],
    [38, 11, 19],
    [-74, 9, 15],
    [74, 9, 15],
  ];
  for (const [dx, w, h] of arches) {
    archShape(k, gx + dx, by - 2, w + 2, h + 1, '#781C15');
    archShape(k, gx + dx, by - 2, w, h, '#2A1512');
    r(k, gx + dx - w / 2 + 1, by - 6, w - 2, 4, '#3A1E16');
  }

  // —— 标语 ——
  const s1 = pixelText('中华人民共和国万岁', 9, '#F4F0E6', 140, '600');
  const s2 = pixelText('世界人民大团结万岁', 9, '#F4F0E6', 140, '600');
  const sy = by - 37;
  k.c.drawImage(s1, gx - 26 - s1.width, sy);
  k.c.drawImage(s2, gx + 26, sy);
  if (k.lit) {
    const s1l = pixelText('中华人民共和国万岁', 9, '#FFFFFF', 140, '600');
    const s2l = pixelText('世界人民大团结万岁', 9, '#FFFFFF', 140, '600');
    k.c.drawImage(s1l, gx - 26 - s1.width, sy);
    k.c.drawImage(s2l, gx + 26, sy);
  }

  // —— 汉白玉栏杆 ——
  const bw2 = 131;
  r(k, gx - bw2, by - 41, bw2 * 2, 1, '#ECE8DE');
  for (let x = gx - bw2; x < gx + bw2; x++) r(k, x, by - 40, 1, 2, (x - gx) % 4 === 0 ? '#E2DDD2' : '#6E1A15');
  if (k.lit) for (let x = gx - bw2; x < gx + bw2; x += 2) r(k, x, by - 41, 1, 1, '#FFF4C8');

  // —— 城楼一层 ——
  const fw = 107;
  const fTop = by - 58;
  const fBot = by - 42;
  r(k, gx - fw, fTop, fw * 2, fBot - fTop, '#6E1A15');
  latticePanels(k, gx, fw, fTop + 5, fBot - 1, 9, k.lit ? '#E8A040' : '#B8432E', k.lit ? '#FFE08A' : '#D9A441');
  r(k, gx - fw, fTop, fw * 2, 2, '#3E100C');
  r(k, gx - fw - 2, fBot, fw * 2 + 4, 1, '#D2CBBE');
  const bayW = (fw * 2) / 9;
  for (let i = 0; i < 9; i++) {
    if (i === 4) continue;
    const lx = Math.round(gx - fw + (i + 0.5) * bayW);
    lantern(k, lx, fTop + 2);
    lanterns.push({ x: lx, y: fTop + 6 });
  }

  // —— 下檐 ——
  bracketBand(k, gx, by - 61, 111);
  roof(k, gx, by - 71, by - 62, 104, 126, 3);

  // —— 城楼二层 ——
  const uw = 98;
  r(k, gx - uw, by - 80, uw * 2, 9, '#6E1A15');
  latticePanels(k, gx, uw, by - 78, by - 72, 9, k.lit ? '#E8A040' : '#B8432E', k.lit ? '#FFE08A' : '#D9A441');
  bracketBand(k, gx, by - 83, 101);

  // —— 上檐（重檐歇山顶） ——
  roof(k, gx, by - 104, by - 84, 66, 120, 5);
  r(k, gx - 68, by - 106, 136, 2, '#B98422');
  r(k, gx - 68, by - 106, 136, 1, '#F6CF62');
  if (k.lit) for (let x = gx - 68; x < gx + 68; x += 2) r(k, x, by - 106, 1, 1, '#FFF4C8');
  for (const s of [-1, 1]) {
    for (let y = 0; y < CHIWEN.length; y++)
      for (let x = 0; x < 5; x++) {
        if (CHIWEN[y][x] !== '#') continue;
        const px = s < 0 ? gx - 70 + x : gx + 70 - x - 1;
        r(k, px, by - 112 + y, 1, 1, x < 2 ? '#E4B046' : '#B98422');
      }
  }
  // 垂兽
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) r(k, gx + s * (108 - i * 4), by - 88 - i * 1, 1, 1, '#8A5A16');

  // —— 金水河与金水桥 ——
  r(k, 0, by, SW, 1, '#8C8173');
  r(k, 0, by + 1, SW, 5, '#2E4F57');
  for (let i = 0; i < SW / 3; i++) r(k, rng() * SW, by + 2 + rng() * 3, 2, 1, '#41707A');
  r(k, 0, by + 6, SW, 1, '#EAE6DC');
  for (let x = 0; x < SW; x += 4) r(k, x, by + 7, 1, 1, '#EAE6DC');
  r(k, 0, by + 7, SW, 1, '#8E877A');
  for (let x = 0; x < SW; x += 4) r(k, x, by + 7, 1, 1, '#EAE6DC');
  r(k, 0, by + 8, SW, 1, '#BDB6A8');
  for (const [dx, w] of arches) {
    const bw = w + 8;
    const l = Math.round(gx + dx - bw / 2);
    r(k, l, by + 1, bw, 8, '#E4DFD4');
    r(k, l + 2, by + 2, bw - 4, 6, '#D6D0C4');
    r(k, l, by + 1, 1, 8, '#F4F1EA');
    r(k, l + bw - 1, by + 1, 1, 8, '#B5AE9F');
    r(k, l, by + 8, bw, 1, '#BDB6A8');
  }

  // —— 华表、石狮 ——
  for (const s of [-1, 1]) {
    huabiao(k, gx + s * 98, by + 9);
    lion(k, gx + s * 15, by + 9, -s);
  }
}

function buildTrees(L: Layout, SW: number): HTMLCanvasElement[] {
  const by = L.baseY;
  const wallTop = by - 31;
  const rng = mulberry32(1001);
  const trees: { x: number; y: number; r: number; base: RGB }[] = [];
  for (let x = -6; x < SW + 8; x += 5 + rng() * 6) {
    const dist = Math.abs(x - SW / 2);
    const rr = 6 + rng() * 7 + (dist > 150 ? 2 : 0);
    const kind = rng();
    const base = kind < 0.08 ? hex('#B39634') : kind < 0.14 ? hex('#C9A63E') : kind < 0.55 ? hex('#2E5B35') : hex('#264B30');
    trees.push({ x, y: wallTop - rr * 0.45 + rng() * 3, r: rr, base });
  }
  // 远景：故宫殿顶（雾化）
  const halls = [-175, 175, -255, 255, -320, 320];
  const frames: HTMLCanvasElement[] = [];
  for (const sway of [-1, 0, 1]) {
    const buf = new PixBuf(SW, by);
    for (const hx of halls) {
      const cx = Math.round(SW / 2 + hx);
      const top = wallTop - 26 - (Math.abs(hx) > 200 ? 0 : 6);
      for (let y = 0; y < 10; y++) {
        const hw = 14 + y * 2;
        for (let x = -hw; x <= hw; x++) buf.set(cx + x, top + y, y === 9 ? hex('#8E7A56') : x & 1 ? hex('#C2A66C') : hex('#B49860'));
      }
      for (let y = 10; y < 18; y++) for (let x = -24; x <= 24; x++) buf.set(cx + x, top + y, hex('#8A5A4E'));
    }
    for (const t of trees) {
      const ri = Math.ceil(t.r);
      for (let dy = -ri; dy <= ri; dy++) {
        const shift = dy < 0 ? Math.round(sway * (-dy / ri) * 1.2) : 0;
        for (let dx = -ri; dx <= ri; dx++) {
          if (dx * dx + dy * dy > t.r * t.r) continue;
          const px = Math.round(t.x + dx + shift);
          const py = Math.round(t.y + dy);
          if (py >= wallTop + 2) continue;
          const n = (-dx * 0.5 - dy) / t.r;
          const noise = hash2(px * 0.7 + t.x, py * 1.3);
          let c: RGB;
          if (n > 0.45 || (n > 0.2 && noise < 0.25)) c = mix(t.base, [255, 250, 200], 0.18);
          else if (n < -0.35 || (n < -0.1 && noise < 0.3)) c = mix(t.base, [10, 20, 20], 0.3);
          else c = t.base;
          if (noise > 0.93) c = mix(c, [10, 20, 20], 0.25);
          buf.set(px, py, c);
        }
      }
    }
    frames.push(buf.toCanvas());
  }
  return frames;
}

export function buildStructure(L: Layout, nd: boolean): StructureSprites {
  const SW = L.W + L.M * 2;
  const H = L.baseY + 10;
  const [day, dc] = makeCanvas(SW, H);
  const [lit, lc] = makeCanvas(SW, H);
  const lanterns: { x: number; y: number }[] = [];
  const sparkles: { x: number; y: number }[] = [];
  drawStructure({ c: dc, P: ident, lit: false, sparkles }, L, SW, nd, lanterns);
  drawStructure({ c: lc, P: litPal, lit: true, sparkles }, L, SW, nd, []);
  // 泛光自下而上：顶部稍暗
  lc.globalCompositeOperation = 'source-atop';
  const g = lc.createLinearGradient(0, L.baseY - 112, 0, L.baseY);
  g.addColorStop(0, 'rgba(30,10,30,0.28)');
  g.addColorStop(0.5, 'rgba(30,10,30,0.05)');
  g.addColorStop(1, 'rgba(255,200,120,0.08)');
  lc.fillStyle = g;
  lc.fillRect(0, 0, SW, H);
  lc.globalCompositeOperation = 'source-over';
  return { day, lit, trees: buildTrees(L, SW), lanterns, sparkles, width: SW };
}
