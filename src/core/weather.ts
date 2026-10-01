import { clamp, noise1, rand } from './math';

/** 可切换的天气：auto = 按时间自动变化（默认，无降水） */
export type WeatherId = 'auto' | 'sunny' | 'cloudy' | 'overcast' | 'rain' | 'snow';

export const WEATHER_LABEL: Record<WeatherId, string> = {
  auto: '自动',
  sunny: '晴',
  cloudy: '多云',
  overcast: '阴',
  rain: '雨',
  snow: '雪',
};

/** 每帧生效的天气状态（模式切换后 2~4 秒平滑过渡） */
export interface WeatherState {
  /** 云量系数：1 附近为平常，阴雨可达 1.6（乘到云数量上） */
  cloud: number;
  /** 阴沉度 0..1：压暗去饱和天空、遮蔽日星月、环境光变灰 */
  gloom: number;
  /** 降水：0 无 / 1 雨 / 2 雪 */
  precip: 0 | 1 | 2;
  /** 降水强度 0..1 */
  precipI: number;
}

const PRESETS: Record<Exclude<WeatherId, 'auto'>, WeatherState> = {
  sunny: { cloud: 0.12, gloom: 0, precip: 0, precipI: 0 },
  cloudy: { cloud: 0.9, gloom: 0.32, precip: 0, precipI: 0 },
  overcast: { cloud: 1.5, gloom: 0.72, precip: 0, precipI: 0 },
  rain: { cloud: 1.6, gloom: 0.88, precip: 1, precipI: 0.85 },
  snow: { cloud: 1.05, gloom: 0.55, precip: 2, precipI: 0.7 },
};

const approach = (v: number, target: number, step: number) =>
  v < target ? Math.min(target, v + step) : Math.max(target, v - step);

/** WeatherManager：风力（影响国旗、树、云、落叶）、云量与可切换天气 */
export class WeatherManager {
  wind = 0.35;
  cloudiness = 0.45;
  mode: WeatherId = 'auto';
  state: WeatherState = { cloud: 0.45, gloom: 0, precip: 0, precipI: 0 };
  private gust = 0;
  private gustT = 0;
  private t = rand(0, 1000);

  setMode(mode: WeatherId) {
    this.mode = mode;
  }

  update(dt: number) {
    this.t += dt;
    if (this.gustT > 0) {
      this.gustT -= dt;
      this.gust = Math.min(1, this.gust + dt * 1.5);
    } else this.gust = Math.max(0, this.gust - dt * 0.4);
    const base = 0.15 + noise1(this.t / 40, 3) * 0.55 + (noise1(this.t / 6, 7) - 0.5) * 0.12;
    // 雨天风更急，雪天更静
    const bias = this.state.precip === 1 ? 0.18 : this.state.precip === 2 ? -0.12 : 0;
    this.wind = clamp(base + this.gust * 0.5 + bias * (this.mode === 'auto' ? 0 : 1), 0.05, 1);
    this.cloudiness = clamp(0.25 + noise1(this.t / 300, 11) * 0.6);

    const target = this.mode === 'auto' ? this.autoState() : PRESETS[this.mode];
    const s = this.state;
    const step = dt * 0.45;
    // 降水类型切换：先把当前降水收敛到 0，再换类型渐入，避免雨雪同帧混出
    if (s.precip !== target.precip && s.precipI > 0.02) {
      s.precipI = Math.max(0, s.precipI - dt * 0.6);
    } else {
      s.precip = target.precip;
      s.precipI = approach(s.precipI, target.precipI, step);
    }
    s.cloud = approach(s.cloud, target.cloud, step);
    s.gloom = approach(s.gloom, target.gloom, step);
  }

  /** 自动模式：延续原本的噪声云量，无降水 */
  private autoState(): WeatherState {
    return { cloud: 0.25 + this.cloudiness * 0.9, gloom: this.cloudiness * 0.18, precip: 0, precipI: 0 };
  }

  /** 一阵风 */
  gustNow(dur = rand(4, 8)) {
    this.gustT = dur;
  }

  /** 国旗动画档位：微风 / 中风 / 强风 */
  get flagLevel() {
    return this.wind < 0.38 ? 0 : this.wind < 0.66 ? 1 : 2;
  }
}
