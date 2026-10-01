import { HOUR, rand, wrapDay } from './math';

export type GameEvent =
  | 'SUNRISE'
  | 'FLAG_RISING'
  | 'FLAG_TOP'
  | 'MORNING'
  | 'NOON'
  | 'SUNSET'
  | 'FLAG_LOWERING'
  | 'NIGHT'
  | 'FIREWORK'
  | 'FIREWORK_BURST';

type Fn = (data?: unknown) => void;

/**
 * EventManager：在时间自然流逝经过关键时刻时派发事件。
 * 拖动滑杆 / 快速过渡时（fast）不触发，避免仪式在快进中被反复播放。
 */
export class EventManager {
  private listeners = new Map<GameEvent, Fn[]>();
  private prev = -1;

  on(e: GameEvent, fn: Fn) {
    const arr = this.listeners.get(e) ?? [];
    arr.push(fn);
    this.listeners.set(e, arr);
  }

  emit(e: GameEvent, data?: unknown) {
    for (const fn of this.listeners.get(e) ?? []) fn(data);
  }

  update(t: number, fast: boolean, sched: { sunrise: number; sunset: number; raiseTop: number; lightsOn: number }) {
    const prev = this.prev;
    this.prev = t;
    if (prev < 0 || fast) return;
    const d = wrapDay(t - prev);
    if (d > 5) return;
    const crossed = (at: number) => {
      const k = wrapDay(at - prev);
      return k > 0 && k <= d;
    };
    const pts: [number, GameEvent[]][] = [
      [sched.sunrise, ['SUNRISE', 'FLAG_RISING']],
      [sched.sunrise + sched.raiseTop, ['FLAG_TOP']],
      [7 * HOUR, ['MORNING']],
      [11 * HOUR, ['NOON']],
      [sched.sunset, ['SUNSET', 'FLAG_LOWERING']],
      [sched.lightsOn, ['NIGHT']],
      [21 * HOUR, ['FIREWORK']],
    ];
    for (const [at, evs] of pts) if (crossed(at)) for (const e of evs) this.emit(e);
  }
}

interface RandomEvent {
  name: string;
  min: number;
  max: number;
  cond: () => boolean;
  run: () => void;
  next: number;
}

/** RandomEventManager：让页面打开 30 分钟也不会感觉重复 */
export class RandomEventManager {
  private events: RandomEvent[] = [];

  add(name: string, min: number, max: number, cond: () => boolean, run: () => void) {
    this.events.push({ name, min, max, cond, run, next: rand(min * 0.3, max * 0.6) });
  }

  update(dt: number, paused: boolean) {
    if (paused) return;
    for (const e of this.events) {
      e.next -= dt;
      if (e.next <= 0) {
        if (e.cond()) e.run();
        e.next = rand(e.min, e.max);
      }
    }
  }

  trigger(name: string) {
    this.events.find((e) => e.name === name)?.run();
  }
}
