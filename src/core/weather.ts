import { clamp, noise1, rand } from './math';

/** WeatherManager：风力（影响国旗、树、云、落叶）与云量 */
export class WeatherManager {
  wind = 0.35;
  cloudiness = 0.45;
  private gust = 0;
  private gustT = 0;
  private t = rand(0, 1000);

  update(dt: number) {
    this.t += dt;
    if (this.gustT > 0) {
      this.gustT -= dt;
      this.gust = Math.min(1, this.gust + dt * 1.5);
    } else this.gust = Math.max(0, this.gust - dt * 0.4);
    const base = 0.15 + noise1(this.t / 40, 3) * 0.55 + (noise1(this.t / 6, 7) - 0.5) * 0.12;
    this.wind = clamp(base + this.gust * 0.5, 0.05, 1);
    this.cloudiness = clamp(0.25 + noise1(this.t / 300, 11) * 0.6);
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
