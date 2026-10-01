import { RGB, hex, mix, sampleKeys, Key, lerpNum } from './color';
import { DAY, HOUR, bump, clamp, hm, smoothstep, wrapDay } from './math';
import { Phase, phaseOf } from './time';
import { Layout } from '../scene/layout';

/** 每帧由时间推导出的环境参数（昼夜光影系统的核心） */
export interface Env {
  t: number;
  phase: Phase;
  daylight: number;
  night: number;
  /** 晨昏暖色强度 */
  warm: number;
  /** 傍晚（区别于清晨）——用于人物剪影 */
  evening: number;
  skyTop: RGB;
  skyHor: RGB;
  ambient: RGB;
  sunCol: RGB;
  glowCol: RGB;
  sunX: number;
  sunY: number;
  sunAlt: number;
  sunVis: number;
  moonX: number;
  moonY: number;
  moonVis: number;
  moonPhase: number;
  starAlpha: number;
  cloudHi: RGB;
  cloudMid: RGB;
  cloudLo: RGB;
  lightTarget: number;
  crowdTarget: number;
  traffic: number;
  fireworkLevel: number;
  /** 阴影水平偏移方向 */
  shadowDx: number;
}

type Anchor = 'm' | 'e' | '-';
// 时间, 锚点(m=相对日出 e=相对日落), 天顶色, 地平线色, 环境光（multiply 染色）
const RAW: [string, Anchor, string, string, string][] = [
  ['00:00', '-', '#050B1D', '#0E1A3A', '#3C4878'],
  ['04:30', 'm', '#071126', '#16224A', '#3C4878'],
  ['05:15', 'm', '#141C48', '#33315E', '#4E5488'],
  ['05:40', 'm', '#26346C', '#7A5578', '#6E6894'],
  ['06:00', 'm', '#3E5A9A', '#D8786E', '#B08890'],
  ['06:15', 'm', '#5276B2', '#FF9966', '#EAA488'],
  ['06:45', 'm', '#62A0DA', '#FFC48E', '#FCD2B0'],
  ['08:00', '-', '#70C5FF', '#C6E9FF', '#FFF4E6'],
  ['12:00', '-', '#49B9FF', '#A9E0FF', '#FFFFFF'],
  ['15:00', '-', '#54B8E8', '#C0E4F2', '#FFF8EA'],
  ['16:50', 'e', '#5CA4D8', '#FFE2AC', '#FFEACC'],
  ['17:30', 'e', '#6A84BE', '#FFB15A', '#FFCC96'],
  ['17:55', 'e', '#7A5A8E', '#F4774F', '#F29A72'],
  ['18:15', 'e', '#4A3A72', '#E06A4E', '#B47A88'],
  ['18:40', 'e', '#252C5E', '#814A78', '#6E6492'],
  ['19:30', 'e', '#162A54', '#2A3666', '#4A5486'],
  ['22:00', '-', '#050B1D', '#0F1E40', '#3C4878'],
];

const CROWD: [string, number][] = [
  ['00:00', 10],
  ['05:00', 20],
  ['07:00', 60],
  ['10:00', 100],
  ['14:00', 120],
  ['18:00', 100],
  ['21:00', 70],
  ['23:50', 14],
];
const TRAFFIC: [string, number][] = [
  ['00:00', 0.25],
  ['05:30', 0.35],
  ['07:30', 1],
  ['20:00', 0.85],
  ['23:00', 0.45],
];

interface SkyKeys {
  top: Key<RGB>[];
  hor: Key<RGB>[];
  amb: Key<RGB>[];
}
let cacheKey = '';
let cached: SkyKeys | null = null;

function buildKeys(sunrise: number, sunset: number): SkyKeys {
  const k = `${sunrise | 0}|${sunset | 0}`;
  if (cached && k === cacheKey) return cached;
  const dm = sunrise - hm('06:10');
  const de = sunset - hm('18:00');
  const rows = RAW.map(([t, a, top, hor, amb]) => ({
    t: wrapDay(hm(t) + (a === 'm' ? dm : a === 'e' ? de : 0)),
    top: hex(top),
    hor: hex(hor),
    amb: hex(amb),
  })).sort((a, b) => a.t - b.t);
  cached = {
    top: rows.map((r) => ({ t: r.t, v: r.top })),
    hor: rows.map((r) => ({ t: r.t, v: r.hor })),
    amb: rows.map((r) => ({ t: r.t, v: r.amb })),
  };
  cacheKey = k;
  return cached;
}

const numKeys = (rows: [string, number][]): Key<number>[] => rows.map(([t, v]) => ({ t: hm(t), v }));
const crowdKeys = numKeys(CROWD);
const trafficKeys = numKeys(TRAFFIC);

const C_DAY_HI = hex('#FFFFFF'),
  C_DAY_MID = hex('#EDF3FA'),
  C_DAY_LO = hex('#C2D4E8');
const C_WARM_HI = hex('#FFE6BC'),
  C_WARM_MID = hex('#F7A57C'),
  C_WARM_LO = hex('#9A5A7C');
const C_NIGHT_HI = hex('#46557F'),
  C_NIGHT_MID = hex('#2A3762'),
  C_NIGHT_LO = hex('#1A2448');

export function computeEnv(t: number, sunrise: number, sunset: number, moonPhase: number, L: Layout, nd: boolean): Env {
  const keys = buildKeys(sunrise, sunset);
  const skyTop = sampleKeys(keys.top, t, mix);
  const skyHor = sampleKeys(keys.hor, t, mix);
  const ambient = sampleKeys(keys.amb, t, mix);

  const dr = smoothstep(sunrise - 45 * 60, sunrise + 30 * 60, t);
  const ds = 1 - smoothstep(sunset - 30 * 60, sunset + 45 * 60, t);
  const daylight = Math.min(dr, ds);
  const night = 1 - daylight;
  const morningWarm = bump(t, sunrise + 8 * 60, 50 * 60);
  const eveningWarm = bump(t, sunset - 6 * 60, 55 * 60);
  const warm = Math.max(morningWarm, eveningWarm);

  // 太阳：天安门坐北朝南，从广场向北看，东方在画面右侧
  const p = (t - sunrise) / (sunset - sunrise);
  const pc = clamp(p, -0.12, 1.12);
  const sunAlt = Math.sin(pc * Math.PI);
  // 正午略偏右，避免与国旗重叠
  const sunX = L.cx + (0.5 - pc) * L.W * 0.9 + L.W * 0.17 * Math.max(0, sunAlt);
  const sunY = L.baseY - 54 - sunAlt * (L.baseY - 84);
  const sunVis = smoothstep(-0.06, 0.0, p) * (1 - smoothstep(1.0, 1.06, p));
  const sunCol = mix(hex('#FF6A34'), hex('#FFF6D8'), smoothstep(0.0, 0.35, sunAlt));
  const glowCol = mix(hex('#FF8A4C'), hex('#FFF0C4'), smoothstep(0.02, 0.45, sunAlt));

  // 月亮：日落 20 分钟后自东方升起，次日日出前落下
  const nStart = sunset + 20 * 60;
  const nLen = DAY - (sunset - sunrise) - 40 * 60;
  const q = wrapDay(t - nStart) / nLen;
  const moonVis = q <= 1 ? smoothstep(0, 0.03, q) * (1 - smoothstep(0.97, 1, q)) : 0;
  const qc = clamp(q);
  const moonX = L.cx + (0.42 - qc * 0.84) * L.W;
  const moonY = L.baseY - 20 - Math.sin(qc * Math.PI) * (L.baseY - 60);

  const starAlpha = smoothstep(0.55, 0.95, night);

  let cloudHi = mix(C_NIGHT_HI, C_DAY_HI, daylight);
  let cloudMid = mix(C_NIGHT_MID, C_DAY_MID, daylight);
  let cloudLo = mix(C_NIGHT_LO, C_DAY_LO, daylight);
  const w = warm * 0.85;
  cloudHi = mix(cloudHi, C_WARM_HI, w);
  cloudMid = mix(cloudMid, C_WARM_MID, w);
  cloudLo = mix(cloudLo, C_WARM_LO, w);

  // 建筑灯光：日落后 15 分钟亮起，23:30 后转为深夜低亮度
  let lightTarget = 0;
  if (t > sunset + 15 * 60 || t < sunrise - 20 * 60) lightTarget = t >= 23.5 * HOUR || t < 5 * HOUR ? 0.42 : 1;

  let crowdTarget = sampleKeys(crowdKeys, t, lerpNum);
  if (nd) crowdTarget *= 1.3;
  const traffic = sampleKeys(trafficKeys, t, lerpNum);

  // 烟花：21:00–23:00 国庆庆典；国庆特别模式 19:30 起零星燃放
  let fireworkLevel = 0;
  if (t >= 21 * HOUR && t < 23 * HOUR + 5 * 60) fireworkLevel = 1 - smoothstep(23 * HOUR - 60, 23 * HOUR + 5 * 60, t);
  else if (nd && t >= 19.5 * HOUR && t < 21 * HOUR) fireworkLevel = 0.35;

  const shadowDx = daylight > 0.2 ? -(sunX - L.cx) / L.W * 6 : 0;

  return {
    t,
    phase: phaseOf(t),
    daylight,
    night,
    warm,
    evening: eveningWarm * (t > 12 * HOUR ? 1 : 0),
    skyTop,
    skyHor,
    ambient,
    sunCol,
    glowCol,
    sunX,
    sunY,
    sunAlt,
    sunVis,
    moonX,
    moonY,
    moonVis,
    moonPhase,
    starAlpha,
    cloudHi,
    cloudMid,
    cloudLo,
    lightTarget,
    crowdTarget,
    traffic,
    fireworkLevel,
    shadowDx,
  };
}
