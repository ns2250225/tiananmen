import { RGB } from '../core/color';

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/** 简单的像素缓冲，用于大量逐像素程序化绘制 */
export class PixBuf {
  data: ImageData;
  constructor(public w: number, public h: number) {
    this.data = new ImageData(Math.max(1, w), Math.max(1, h));
  }
  set(x: number, y: number, c: RGB, a = 255) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const d = this.data.data;
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = a;
  }
  alpha(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data.data[(y * this.w + x) * 4 + 3];
  }
  toCanvas() {
    const [c, ctx] = makeCanvas(this.w, this.h);
    ctx.putImageData(this.data, 0, 0);
    return c;
  }
}

const glowCache = new Map<string, HTMLCanvasElement>();
/** 预渲染的柔光精灵（低分辨率，放大后保持像素感） */
export function glowSprite(radius: number, col: RGB, falloff = 2): HTMLCanvasElement {
  const key = `${radius}|${col.join(',')}|${falloff}`;
  let c = glowCache.get(key);
  if (c) return c;
  const s = radius * 2 + 1;
  const buf = new PixBuf(s, s);
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const d = Math.hypot(x - radius, y - radius) / radius;
      if (d >= 1) continue;
      const a = Math.pow(1 - d, falloff);
      // 4 级量化 + 有序抖动，保持像素风
      const bayer = ((x & 1) * 2 + (y & 1) * 3) % 4 / 4;
      const q = Math.floor(a * 6 + bayer) / 6;
      if (q <= 0) continue;
      buf.set(x, y, col, Math.round(q * 255));
    }
  c = buf.toCanvas();
  glowCache.set(key, c);
  return c;
}

export const CN_FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",sans-serif';

/** 把文字栅格化为硬边像素字（阈值化，无抗锯齿） */
export function pixelText(text: string, size: number, color: string, threshold = 120, weight = '700'): HTMLCanvasElement {
  const [tc, t] = makeCanvas(size * text.length * 1.3 + 8, size * 1.6);
  t.font = `${weight} ${size}px ${CN_FONT}`;
  t.textBaseline = 'top';
  t.fillStyle = '#fff';
  t.fillText(text, 2, 2);
  const img = t.getImageData(0, 0, tc.width, tc.height);
  let minX = tc.width,
    minY = tc.height,
    maxX = 0,
    maxY = 0;
  const d = img.data;
  for (let y = 0; y < tc.height; y++)
    for (let x = 0; x < tc.width; x++) {
      const i = (y * tc.width + x) * 4 + 3;
      if (d[i] >= threshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  if (maxX < minX) return makeCanvas(1, 1)[0];
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const [oc, o] = makeCanvas(w, h);
  o.fillStyle = color;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (d[((y + minY) * tc.width + x + minX) * 4 + 3] >= threshold) o.fillRect(x, y, 1, 1);
  return oc;
}

/** 5×7 像素数字字体（用于时钟、截图、入口年份） */
const GLYPHS: Record<string, string[]> = {
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ':': ['.', '#', '#', '.', '#', '#', '.'],
  '.': ['.', '.', '.', '.', '.', '#', '#'],
  '-': ['...', '...', '...', '###', '...', '...', '...'],
  '>': ['#....', '.#...', '..#..', '#####', '..#..', '.#...', '#....'],
  ' ': ['..', '..', '..', '..', '..', '..', '..'],
};

/** 生成像素数字的 SVG（DOM 中使用，保证清晰像素边缘） */
export function pixelDigitsSVG(str: string, px = 3, color = 'currentColor'): string {
  let x = 0;
  const rects: string[] = [];
  for (const ch of str) {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    const gw = g[0].length;
    for (let y = 0; y < 7; y++)
      for (let i = 0; i < gw; i++) if (g[y][i] === '#') rects.push(`<rect x="${x + i}" y="${y}" width="1" height="1"/>`);
    x += gw + 1;
  }
  const w = Math.max(1, x - 1);
  return `<svg class="pxd" width="${w * px}" height="${7 * px}" viewBox="0 0 ${w} 7" shape-rendering="crispEdges" fill="${color}">${rects.join('')}</svg>`;
}

/** 在 canvas 上绘制像素数字 */
export function drawPixelDigits(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, px: number, color: string) {
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of str) {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    const gw = g[0].length;
    for (let gy = 0; gy < 7; gy++)
      for (let i = 0; i < gw; i++) if (g[gy][i] === '#') ctx.fillRect(cx + i * px, y + gy * px, px, px);
    cx += (gw + 1) * px;
  }
  return cx - x - px;
}

export function pixelDigitsWidth(str: string, px: number) {
  let w = 0;
  for (const ch of str) w += ((GLYPHS[ch] ?? GLYPHS[' '])[0].length + 1) * px;
  return w - px;
}
