/** 场景布局：所有元素以天安门城台底部 baseY 为锚点，适配横屏 / 竖屏。 */
export interface Layout {
  W: number;
  H: number;
  cx: number;
  baseY: number;
  /** 视差余量 */
  M: number;
  avenueTop: number;
  avenueBot: number;
  squareTop: number;
  poleX: number;
  poleBaseY: number;
  poleTopY: number;
  /** 透视灭点 */
  vy: number;
  portrait: boolean;
}

export function makeLayout(W: number, H: number): Layout {
  const portrait = H > W * 1.05;
  const baseY = Math.round(H * (portrait ? 0.42 : 0.5));
  return {
    W,
    H,
    cx: Math.round(W / 2),
    baseY,
    M: 28,
    avenueTop: baseY + 10,
    avenueBot: baseY + 28,
    squareTop: baseY + 30,
    poleX: Math.round(W / 2),
    poleBaseY: baseY + 112,
    poleTopY: baseY - 150,
    vy: baseY - 40,
    portrait,
  };
}

/** 透视缩放：越靠近画面底部的人物越大 */
export const depthScale = (L: Layout, y: number) => {
  const f = (y - L.squareTop) / 150;
  return Math.max(0.6, Math.min(1.3, 0.62 + 0.5 * f));
};
