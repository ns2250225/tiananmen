import { DAY, HOUR, clamp, easeInOut, wrapDay } from './math';
import { moonPhase, sunTimes } from './solar';

export type Phase = 'predawn' | 'sunrise' | 'morning' | 'noon' | 'afternoon' | 'dusk' | 'night' | 'fireworks' | 'latenight';

export const PHASE_LABEL: Record<Phase, string> = {
  predawn: '黎明前',
  sunrise: '日出',
  morning: '上午',
  noon: '正午',
  afternoon: '下午',
  dusk: '黄昏',
  night: '夜景',
  fireworks: '烟花庆典',
  latenight: '深夜',
};

const TABLE: [number, Phase][] = [
  [4.5 * HOUR, 'predawn'],
  [5.5 * HOUR, 'sunrise'],
  [7 * HOUR, 'morning'],
  [11 * HOUR, 'noon'],
  [14 * HOUR, 'afternoon'],
  [17 * HOUR, 'dusk'],
  [19 * HOUR, 'night'],
  [21 * HOUR, 'fireworks'],
  [23 * HOUR, 'latenight'],
];

export function phaseOf(t: number): Phase {
  let p: Phase = 'latenight';
  for (const [s, ph] of TABLE) if (t >= s) p = ph;
  return p;
}

export interface BJDate {
  year: number;
  month: number;
  day: number;
}

interface Transition {
  from: number;
  delta: number;
  start: number;
  dur: number;
  toReal: boolean;
  target: number;
}

const nowSec = () => performance.now() / 1000;

/** 选择过渡方向：4 小时以内的回退走反向，否则一律向前（像延时摄影一样经过中间时段）。 */
function pickDelta(from: number, to: number) {
  const fwd = wrapDay(to - from);
  const back = fwd - DAY;
  return -back < 4 * HOUR ? back : fwd;
}

/**
 * TimeManager：北京时间 / 模拟时间 / 日出日落 / 场景阶段。
 * 始终以 Asia/Shanghai 为准，不依赖用户电脑所在时区。
 */
export class TimeManager {
  private fmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  });
  mode: 'real' | 'sim' = 'real';
  private simAnchor = 0;
  private simAnchorAt = 0;
  private trans: Transition | null = null;
  private jumpAt = -1e9;
  private cur = 0;
  private real = 0;
  private lastDateKey = '';
  date: BJDate = { year: 2026, month: 10, day: 1 };
  sunrise = 6 * HOUR;
  sunset = 18 * HOUR;
  moonPhase = 0.5;

  constructor(private dateOverride: BJDate | null = null, startAt: number | null = null) {
    this.update();
    if (startAt !== null) this.setSimulationTime(startAt);
  }

  private readReal(): number {
    const parts = this.fmt.formatToParts(new Date());
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const d = this.dateOverride ?? { year: get('year'), month: get('month'), day: get('day') };
    const key = `${d.year}-${d.month}-${d.day}`;
    if (key !== this.lastDateKey) {
      this.lastDateKey = key;
      this.date = d;
      const s = sunTimes(d.year, d.month, d.day);
      this.sunrise = s.sunrise;
      this.sunset = s.sunset;
      this.moonPhase = moonPhase(d.year, d.month, d.day);
    }
    return (get('hour') % 24) * HOUR + get('minute') * 60 + get('second') + (Date.now() % 1000) / 1000;
  }

  update(): number {
    const now = nowSec();
    this.real = this.readReal();
    if (this.trans) {
      const tr = this.trans;
      const p = clamp((now - tr.start) / tr.dur);
      this.cur = wrapDay(tr.from + tr.delta * easeInOut(p));
      if (p >= 1) {
        if (tr.toReal) this.mode = 'real';
        else {
          this.mode = 'sim';
          this.simAnchor = tr.target;
          this.simAnchorAt = now;
        }
        this.trans = null;
        this.jumpAt = now;
      }
    } else if (this.mode === 'real') this.cur = this.real;
    else this.cur = wrapDay(this.simAnchor + (now - this.simAnchorAt));
    return this.cur;
  }

  getCurrentTime() {
    return this.cur;
  }
  getRealTime() {
    return this.real;
  }
  getTimeProgress() {
    return this.cur / DAY;
  }
  getScenePhase() {
    return phaseOf(this.cur);
  }
  /** 是否处于模拟时间（包括正在过渡到某个模拟时间） */
  get simulated() {
    return this.trans ? !this.trans.toReal : this.mode === 'sim';
  }
  /** 时间正在被快速推进（过渡 / 拖动）——此时不触发仪式与音频事件 */
  get fast() {
    return this.trans !== null || nowSec() - this.jumpAt < 0.6;
  }
  get transitioning() {
    return this.trans !== null;
  }

  setSimulationTime(t: number, transition = 0) {
    const now = nowSec();
    t = wrapDay(t);
    if (transition > 0) {
      this.trans = { from: this.cur, delta: pickDelta(this.cur, t), start: now, dur: transition, toReal: false, target: t };
    } else {
      this.trans = null;
      this.mode = 'sim';
      this.simAnchor = t;
      this.simAnchorAt = now;
      this.cur = t;
      this.jumpAt = now;
    }
  }

  resetToRealTime(transition = 1.6) {
    const real = this.readReal();
    if (this.mode === 'real' && !this.trans) return;
    this.trans = { from: this.cur, delta: pickDelta(this.cur, real), start: nowSec(), dur: transition, toReal: true, target: real };
  }

  get isNationalDay() {
    return this.date.month === 10 && this.date.day === 1;
  }
}
