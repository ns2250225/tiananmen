import { clamp, lerp, smoothstep, wrapDay } from '../core/math';
import { Layout } from './layout';

/**
 * 升旗 / 降旗仪式（60 秒级精简模式）
 * 所有状态都是时间的纯函数，因此拖动时间滑杆时国旗高度、仪仗队位置保持一致。
 *
 * 升旗（日出时刻 S 开始）：
 *  0s   天空微亮，游客逐渐停下
 *  0–14s 国旗护卫队自天安门中门出发，经金水桥、长安街走向旗杆
 *  10–18s 镜头缓慢推近（Zoom 1.0 → 1.15）
 *  15s  仪式开始，国旗系于旗杆底部
 *  20s  国歌开始，国旗随国歌缓缓升起（44s，与国歌录音时长一致）
 *  64s  国歌结束，国旗到达顶部
 *  68–84s 护卫队返回，镜头复原，广场恢复活动
 */
export const RAISE = { march: 14, attach: 15, start: 20, top: 64, back: 68, len: 86 };
export const LOWER = { march: 14, start: 20, bottom: 60, gone: 63, back: 64, len: 82 };

export interface GuardPose {
  x: number;
  y: number;
  moving: boolean;
  facing: 'front' | 'back';
  step: number;
}

export interface CeremonyState {
  kind: 'raise' | 'lower' | null;
  u: number;
  focus: number;
  hold: number;
  gather: number;
  /** 0..1 国旗高度；null 表示旗杆上无旗 */
  flagH: number | null;
  anthem: boolean;
  anthemOffset: number;
  guards: GuardPose[];
  traffic: boolean;
}

const GUARDS = 12;

function guardPoses(L: Layout, u: number, kind: 'raise' | 'lower'): GuardPose[] {
  const T = kind === 'raise' ? RAISE : LOWER;
  const res: GuardPose[] = [];
  const startY = L.baseY + 6;
  const leadEnd = L.poleBaseY - 10;
  for (let i = 0; i < GUARDS; i++) {
    const col = (i % 3) - 1;
    const row = Math.floor(i / 3);
    const side = i < 6 ? -1 : 1;
    const k = i % 6;
    const fx = i === 1 ? L.poleX + 4 : L.poleX + side * (14 + k * 6);
    const fy = i === 1 ? L.poleBaseY - 2 : L.poleBaseY - 3 + (k % 2);
    const colX = L.poleX + col * 6;
    let x: number;
    let y: number;
    let moving = false;
    let facing: 'front' | 'back' = 'front';
    if (u < T.march) {
      const p = u / T.march;
      const lead = lerp(startY, leadEnd, p);
      x = colX;
      y = Math.max(startY - row * 6, lead - row * 6);
      moving = true;
      // 后排在门洞内尚未出发
      if (lead - row * 6 < startY) moving = false;
    } else if (u < T.march + 4) {
      const p = smoothstep(0, 1, (u - T.march) / 4);
      x = lerp(colX, fx, p);
      y = lerp(leadEnd - row * 6, fy, p);
      moving = true;
    } else if (u < T.back) {
      x = fx;
      y = fy;
    } else if (u < T.back + 3) {
      const p = smoothstep(0, 1, (u - T.back) / 3);
      x = lerp(fx, colX, p);
      y = lerp(fy, leadEnd - (3 - row) * 6, p);
      moving = true;
      facing = 'back';
    } else {
      const p = clamp((u - T.back - 3) / (T.len - T.back - 3));
      const lead = lerp(leadEnd, startY - 6, p);
      x = colX;
      y = lead - (3 - row) * 6;
      moving = true;
      facing = 'back';
      if (y < startY - 2) continue;
    }
    if (y < startY - 1) continue;
    res.push({ x, y, moving, facing, step: Math.floor(u * 3.2) % 4 });
  }
  return res;
}

export function ceremonyState(t: number, sunrise: number, sunset: number, L: Layout): CeremonyState {
  const S0 = sunrise;
  const S1 = sunset;
  const ur = wrapDay(t - S0);
  const ul = wrapDay(t - S1);
  const st: CeremonyState = {
    kind: null,
    u: 0,
    focus: 0,
    hold: 0,
    gather: 0,
    flagH: null,
    anthem: false,
    anthemOffset: 0,
    guards: [],
    traffic: true,
  };
  // 白天旗帜在顶部
  if (t >= S0 + RAISE.top && t < S1 + LOWER.start) st.flagH = 1;

  // 升旗前聚集
  const before = wrapDay(S0 - t);
  if (before < 40 * 60) st.gather = smoothstep(40 * 60, 6 * 60, before);
  if (ur < 420) st.gather = 1 - smoothstep(RAISE.len - 10, 420, ur);

  if (ur < RAISE.len) {
    const u = ur;
    st.kind = 'raise';
    st.u = u;
    st.focus = smoothstep(8, 18, u) * (1 - smoothstep(70, 82, u));
    st.hold = smoothstep(0, 5, u) * (1 - smoothstep(74, 80, u));
    if (u >= RAISE.attach && u < RAISE.start) st.flagH = 0;
    else if (u >= RAISE.start && u < RAISE.top) st.flagH = (u - RAISE.start) / (RAISE.top - RAISE.start);
    else if (u >= RAISE.top) st.flagH = 1;
    st.anthem = u >= RAISE.start && u < RAISE.top + 1;
    st.anthemOffset = u - RAISE.start;
    st.guards = guardPoses(L, u, 'raise');
  } else if (ul < LOWER.len) {
    const u = ul;
    st.kind = 'lower';
    st.u = u;
    st.focus = smoothstep(8, 18, u) * (1 - smoothstep(66, 78, u)) * 0.85;
    st.hold = (smoothstep(0, 6, u) * (1 - smoothstep(70, 78, u))) * 0.85;
    if (u < LOWER.start) st.flagH = 1;
    else if (u < LOWER.bottom) st.flagH = 1 - (u - LOWER.start) / (LOWER.bottom - LOWER.start);
    else if (u < LOWER.gone) st.flagH = 0;
    else st.flagH = null;
    st.guards = guardPoses(L, u, 'lower');
  }
  // 仪式前后 1 分钟长安街暂停通行
  const nearRaise = wrapDay(t - (S0 - 40)) < 40 + RAISE.len + 20;
  const nearLower = wrapDay(t - (S1 - 40)) < 40 + LOWER.len + 20;
  if (nearRaise || nearLower) st.traffic = false;
  return st;
}

