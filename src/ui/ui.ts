import { buildFlagFrames, FLAG_FRAMES, FLAG_PAD } from '../scene/flag';
import { fmtHM, HOUR, wrapDay, DAY, clamp } from '../core/math';
import { pixelDigitsSVG } from '../render/canvas';
import { icon, IconName } from './icons';
import { Levels } from '../audio/audio';
import { WeatherId } from '../core/weather';

export type PresetId = 'now' | 'dawn' | 'morning' | 'afternoon' | 'dusk' | 'night' | 'fireworks';

const PRESETS: { id: PresetId; icon: IconName; label: string; note?: string }[] = [
  { id: 'now', icon: 'now', label: '现在' },
  { id: 'dawn', icon: 'sunrise', label: '清晨', note: '升旗' },
  { id: 'morning', icon: 'sun', label: '上午' },
  { id: 'afternoon', icon: 'cloudSun', label: '下午' },
  { id: 'dusk', icon: 'sunset', label: '黄昏' },
  { id: 'night', icon: 'moon', label: '夜晚' },
  { id: 'fireworks', icon: 'firework', label: '烟花', note: '庆典' },
];

const WEATHERS: { id: WeatherId; icon: IconName; label: string; note?: string }[] = [
  { id: 'auto', icon: 'now', label: '自动', note: '随时间' },
  { id: 'sunny', icon: 'sun', label: '晴' },
  { id: 'cloudy', icon: 'cloudSun', label: '多云' },
  { id: 'overcast', icon: 'cloud', label: '阴' },
  { id: 'rain', icon: 'rain', label: '雨' },
  { id: 'snow', icon: 'snow', label: '雪' },
];

export interface UIHooks {
  onEnter(): void;
  onPreset(id: PresetId): void;
  onWeather(id: WeatherId): void;
  onScrub(sec: number): void;
  onFirework(): void;
  onShot(): void;
  onFullscreen(): void;
  onMuteCycle(): 0 | 1 | 2;
  onLevel(key: keyof Levels, v: number): void;
  presetTime(id: PresetId): number;
}

export interface UIState {
  t: number;
  simulated: boolean;
  phaseLabel: string;
  nd: boolean;
  fireworks: boolean;
  caption: string | null;
  ceremony: boolean;
  sunrise: number;
  sunset: number;
}

const SLIDER_MIN = 4 * HOUR;
const SLIDER_MAX = 28 * HOUR;

export class UIManager {
  private root: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private cache: Record<string, string> = {};
  private idleTimer = 0;
  private scrubbing = false;
  private open: 'time' | 'audio' | 'weather' | null = null;
  private introFlag: { frames: HTMLCanvasElement[]; ctx: CanvasRenderingContext2D; raf: number } | null = null;
  private shotUrl: string | null = null;

  constructor(
    root: HTMLElement,
    private hooks: UIHooks,
    private info: { nd: boolean; year: number; levels: Levels; mobile: boolean },
  ) {
    this.root = root;
    this.build();
    this.bindIdle();
  }

  private $(id: string) {
    return this.els[id] ?? (this.els[id] = this.root.querySelector(`#${id}`) as HTMLElement);
  }

  private build() {
    const { nd, year } = this.info;
    const years = year - 1949;
    this.root.innerHTML = `
      <div id="intro" class="intro">
        <div class="intro-glow"></div>
        <div class="intro-inner">
          <canvas id="introFlag" class="intro-flag" width="50" height="40"></canvas>
          <div class="intro-date reveal" style="--d:.25s">十月一日 <i></i> 国庆节</div>
          <h1 class="intro-title reveal" style="--d:.55s">${nd ? '欢度国庆' : '国庆快乐'}</h1>
          ${
            nd
              ? `<div class="intro-anniv reveal" style="--d:.85s">
                  <div class="years">${pixelDigitsSVG('1949', 3)}<span class="arrow">${pixelDigitsSVG('>', 3)}</span>${pixelDigitsSVG(String(year), 3)}</div>
                  <p>中华人民共和国成立 <b>${years}</b> 周年</p>
                </div>`
              : `<div class="intro-anniv reveal" style="--d:.85s"><p>国庆 · 天安门的一天</p></div>`
          }
          <div class="intro-en reveal" style="--d:1.05s">National Day · A Day at Tiananmen Square</div>
          <button id="enterBtn" class="enter-btn reveal" style="--d:1.35s">
            <span class="enter-main">进入</span>
            <span class="enter-sub">点击进入天安门广场</span>
          </button>
          <div class="intro-hint reveal" style="--d:1.7s">建议开启声音 · 全屏观看 · 页面将按北京时间自动运行</div>
        </div>
      </div>

      <div id="titleCard" class="title-card">
        <div class="tc-date">十月一日</div>
        <div class="tc-main">国庆节</div>
      </div>

      <div id="caption" class="caption"><span class="cap-line"></span><span id="capText" class="cap-text"></span><span class="cap-line"></span></div>

      <div id="info" class="info px-box">
        <div class="info-row">
          <span id="clockLabel" class="clock-label">北京时间</span>
          <span id="clock" class="clock"></span>
        </div>
        <div id="infoSub" class="info-sub"></div>
        <div id="fwTag" class="fw-tag">${icon('firework', 1)} 国庆庆典艺术场景</div>
        <button id="backNow" class="back-now">${icon('back', 1)}<span>回到现在</span></button>
      </div>

      <div id="toolbar" class="toolbar">
        <button class="tb-btn" id="btnTime" data-tip="时间">${icon('clock')}</button>
        <button class="tb-btn" id="btnWeather" data-tip="天气">${icon('cloudSun')}</button>
        <button class="tb-btn" id="btnFw" data-tip="释放一枚烟花">${icon('firework')}</button>
        <button class="tb-btn" id="btnShot" data-tip="保存此刻">${icon('camera')}</button>
        <button class="tb-btn" id="btnSound" data-tip="单击切换音量 · 长按打开混音">${icon('sound')}</button>
        <button class="tb-btn" id="btnFull" data-tip="全屏">${icon('full')}</button>
      </div>

      <div id="timePanel" class="panel px-box">
        <div class="panel-head">
          <div><div class="panel-title">时间</div><div class="panel-sub">选择时段，场景将在 2 秒内平滑过渡</div></div>
          <button class="panel-close" data-close>${icon('close', 1)}</button>
        </div>
        <div class="presets">
          ${PRESETS.map(
            (p) => `<button class="preset" data-preset="${p.id}">
              <span class="preset-ico">${icon(p.icon)}</span>
              <span class="preset-label">${p.label}</span>
              <span class="preset-time" data-ptime="${p.id}"></span>
              ${p.note ? `<span class="preset-note">${p.note}</span>` : ''}
            </button>`,
          ).join('')}
        </div>
        <div class="slider-wrap">
          <div class="slider-head"><span>时间滑杆</span><span id="sliderTime" class="slider-time"></span></div>
          <div class="slider">
            <div id="sliderTrack" class="slider-track"></div>
            <div id="sliderMarks" class="slider-marks"></div>
            <input id="slider" type="range" min="${SLIDER_MIN}" max="${SLIDER_MAX}" step="30" />
          </div>
          <div class="slider-scale"><span>04:00</span><span>10:00</span><span>16:00</span><span>22:00</span><span>04:00</span></div>
        </div>
      </div>

      <div id="weatherPanel" class="panel px-box">
        <div class="panel-head">
          <div><div class="panel-title">天气</div><div class="panel-sub">切换广场天气，云雨将平滑过渡</div></div>
          <button class="panel-close" data-close>${icon('close', 1)}</button>
        </div>
        <div class="presets weather-presets">
          ${WEATHERS.map(
            (w) => `<button class="preset" data-weather="${w.id}" data-wico="${w.id}">
              <span class="preset-ico">${icon(w.icon)}</span>
              <span class="preset-label">${w.label}</span>
              ${w.note ? `<span class="preset-note">${w.note}</span>` : ''}
            </button>`,
          ).join('')}
        </div>
      </div>

      <div id="audioPanel" class="panel px-box audio-panel">
        <div class="panel-head">
          <div><div class="panel-title">声音</div><div class="panel-sub">环境声实时合成，无背景音乐</div></div>
          <button class="panel-close" data-close>${icon('close', 1)}</button>
        </div>
        ${(
          [
            ['master', '总音量'],
            ['ambient', '环境音'],
            ['fireworks', '烟花'],
            ['ceremony', '仪式音频'],
          ] as [keyof Levels, string][]
        )
          .map(
            ([k, label]) => `<div class="meter-row"><span class="meter-label">${label}</span>
            <div class="meter" data-level="${k}">${'<i></i>'.repeat(10)}</div><span class="meter-val" data-val="${k}"></span></div>`,
          )
          .join('')}
        <div id="anthemNote" class="anthem-note">仪式音频加载中…</div>
      </div>

      <div id="shotModal" class="modal">
        <div class="modal-card px-box">
          <div class="panel-head"><div><div class="panel-title">保存此刻</div><div class="panel-sub">十月一日 · 北京 · 天安门</div></div>
          <button class="panel-close" data-close-modal>${icon('close', 1)}</button></div>
          <img id="shotImg" alt="此刻的天安门广场" />
          <div class="modal-actions">
            <a id="shotSave" class="btn primary" download="tiananmen.png">${icon('download', 1)}<span>保存图片</span></a>
            <button class="btn" data-close-modal>关闭</button>
          </div>
          <p class="modal-hint">手机端可长按图片保存到相册</p>
        </div>
      </div>

      <div id="toast" class="toast"></div>
      <div id="tooltip" class="tooltip"></div>
    `;

    this.startIntroFlag();
    const enter = this.$('enterBtn');
    enter.addEventListener('click', () => {
      this.$('intro').classList.add('leaving');
      setTimeout(() => {
        this.$('intro').remove();
        if (this.introFlag) cancelAnimationFrame(this.introFlag.raf);
      }, 1500);
      this.hooks.onEnter();
      document.body.classList.add('entered');
      setTimeout(() => this.showTitle(), 1400);
    });

    // 工具栏
    this.$('btnTime').addEventListener('click', () => this.toggle('time'));
    this.$('btnWeather').addEventListener('click', () => this.toggle('weather'));
    this.$('btnFw').addEventListener('click', () => this.hooks.onFirework());
    this.$('btnShot').addEventListener('click', () => this.hooks.onShot());
    this.$('btnFull').addEventListener('click', () => this.hooks.onFullscreen());
    this.$('backNow').addEventListener('click', () => this.hooks.onPreset('now'));

    // 声音按钮：单击循环 🔊🔉🔇，长按 / 右键打开混音面板
    const sb = this.$('btnSound');
    let pressT = 0;
    let longFired = false;
    sb.addEventListener('pointerdown', () => {
      longFired = false;
      pressT = window.setTimeout(() => {
        longFired = true;
        this.toggle('audio', true);
      }, 450);
    });
    const cancel = () => clearTimeout(pressT);
    sb.addEventListener('pointerleave', cancel);
    sb.addEventListener('pointerup', cancel);
    sb.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      cancel();
      longFired = true;
      this.toggle('audio', true);
    });
    sb.addEventListener('click', () => {
      if (longFired) return;
      this.setMute(this.hooks.onMuteCycle());
    });

    const tip = this.$('tooltip');
    this.root.querySelectorAll<HTMLElement>('.tb-btn').forEach((b) => {
      b.addEventListener('pointerenter', (e) => {
        if (e.pointerType !== 'mouse') return;
        const r = b.getBoundingClientRect();
        tip.textContent = b.dataset.tip ?? '';
        tip.style.left = `${Math.min(window.innerWidth - 90, r.left + r.width / 2)}px`;
        tip.style.top = `${r.top - 34}px`;
        tip.classList.add('show');
      });
      b.addEventListener('pointerleave', () => tip.classList.remove('show'));
      b.addEventListener('click', () => tip.classList.remove('show'));
    });

    this.root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => this.toggle(null)));
    this.root.querySelectorAll('[data-close-modal]').forEach((b) => b.addEventListener('click', () => this.closeShot()));
    this.$('shotModal').addEventListener('click', (e) => {
      if (e.target === this.$('shotModal')) this.closeShot();
    });

    this.root.querySelectorAll<HTMLElement>('[data-weather]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.weather as WeatherId;
        this.hooks.onWeather(id);
        this.syncWeather(id);
      }),
    );

    this.root.querySelectorAll<HTMLElement>('[data-preset]').forEach((b) =>
      b.addEventListener('click', () => {
        this.hooks.onPreset(b.dataset.preset as PresetId);
        this.root.querySelectorAll('.preset').forEach((x) => x.classList.toggle('active', x === b));
      }),
    );

    const slider = this.$('slider') as HTMLInputElement;
    slider.addEventListener('input', () => {
      this.scrubbing = true;
      this.hooks.onScrub(wrapDay(Number(slider.value)));
      this.root.querySelectorAll('.preset').forEach((x) => x.classList.remove('active'));
    });
    const end = () => (this.scrubbing = false);
    slider.addEventListener('change', end);
    slider.addEventListener('pointerup', end);

    // 分段音量条
    this.root.querySelectorAll<HTMLElement>('.meter').forEach((m) => {
      const key = m.dataset.level as keyof Levels;
      const set = (e: PointerEvent) => {
        const r = m.getBoundingClientRect();
        const v = clamp((e.clientX - r.left) / r.width);
        const q = Math.round(v * 10) / 10;
        this.info.levels[key] = q;
        this.hooks.onLevel(key, q);
        this.renderMeters();
      };
      m.addEventListener('pointerdown', (e) => {
        m.setPointerCapture(e.pointerId);
        set(e);
        const move = (ev: PointerEvent) => set(ev);
        const up = () => {
          m.removeEventListener('pointermove', move);
          m.removeEventListener('pointerup', up);
        };
        m.addEventListener('pointermove', move);
        m.addEventListener('pointerup', up);
      });
    });
    this.renderMeters();

    document.addEventListener('fullscreenchange', () => this.syncFullscreen());
    document.addEventListener('webkitfullscreenchange', () => this.syncFullscreen());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.toggle(null);
        this.closeShot();
      }
    });
  }

  private startIntroFlag() {
    const cv = this.$('introFlag') as HTMLCanvasElement;
    const ctx = cv.getContext('2d')!;
    const frames = buildFlagFrames()[1];
    let i = 0;
    let last = 0;
    const tick = (ts: number) => {
      if (ts - last > 110) {
        last = ts;
        i = (i + 1) % FLAG_FRAMES;
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.fillStyle = '#DADDE2';
        ctx.fillRect(0, 0, 2, cv.height);
        ctx.fillStyle = '#F2C14E';
        ctx.fillRect(0, 0, 2, 2);
        ctx.drawImage(frames[i], 3, 4 - FLAG_PAD + 2);
      }
      this.introFlag!.raf = requestAnimationFrame(tick);
    };
    this.introFlag = { frames, ctx, raf: requestAnimationFrame(tick) };
  }

  private renderMeters() {
    this.root.querySelectorAll<HTMLElement>('.meter').forEach((m) => {
      const key = m.dataset.level as keyof Levels;
      const v = Math.round(this.info.levels[key] * 10);
      m.querySelectorAll('i').forEach((seg, i) => seg.classList.toggle('on', i < v));
      const val = this.root.querySelector(`[data-val="${key}"]`);
      if (val) val.textContent = `${v * 10}%`;
    });
  }

  toggle(which: 'time' | 'audio' | 'weather' | null, force = false) {
    this.open = this.open === which && !force ? null : which;
    this.$('timePanel').classList.toggle('open', this.open === 'time');
    this.$('weatherPanel').classList.toggle('open', this.open === 'weather');
    this.$('audioPanel').classList.toggle('open', this.open === 'audio');
    this.$('btnTime').classList.toggle('active', this.open === 'time');
    this.$('btnWeather').classList.toggle('active', this.open === 'weather');
    this.$('btnSound').classList.toggle('active', this.open === 'audio');
    if (this.open === 'time') this.refreshPresetTimes();
  }

  /** 同步天气面板的选中态（点击与初始 URL 参数共用） */
  syncWeather(id: WeatherId) {
    this.root.querySelectorAll('[data-weather]').forEach((x) => x.classList.toggle('active', (x as HTMLElement).dataset.weather === id));
  }

  private refreshPresetTimes() {
    for (const p of PRESETS) {
      const el = this.root.querySelector(`[data-ptime="${p.id}"]`);
      if (el) el.textContent = fmtHM(this.hooks.presetTime(p.id));
    }
  }

  setMute(state: 0 | 1 | 2) {
    const name: IconName = state === 0 ? 'sound' : state === 1 ? 'soundLow' : 'mute';
    this.$('btnSound').innerHTML = icon(name);
    this.$('btnSound').classList.toggle('muted', state === 2);
    this.toast(state === 0 ? '声音：开' : state === 1 ? '声音：低' : '已静音');
  }

  setAnthem(available: boolean) {
    this.$('anthemNote').innerHTML = available
      ? '仪式音频已就绪：升旗仪式时播放国歌'
      : '提示：仪式音频需放置官方合法来源录音<br/><code>audio/ceremony/anthem.mp3</code>';
  }

  setTrackGradient(css: string, sunrise: number, sunset: number) {
    this.$('sliderTrack').style.background = css;
    const pos = (t: number) => {
      let v = t;
      if (v < SLIDER_MIN) v += DAY;
      return ((v - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100;
    };
    this.$('sliderMarks').innerHTML = [
      [sunrise, '升旗', 'up'],
      [sunset, '降旗', 'down'],
      [21 * HOUR, '烟花', 'fw'],
    ]
      .map(([t, l, k]) => `<span class="mark ${k}" style="left:${pos(t as number)}%"><em>${l}</em></span>`)
      .join('');
  }

  showTitle() {
    const tc = this.$('titleCard');
    tc.classList.add('show');
    setTimeout(() => tc.classList.remove('show'), 4200);
  }

  private toastT = 0;
  toast(msg: string) {
    const t = this.$('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = window.setTimeout(() => t.classList.remove('show'), 1800);
  }

  showShot(url: string) {
    if (this.shotUrl) URL.revokeObjectURL(this.shotUrl);
    this.shotUrl = url;
    (this.$('shotImg') as HTMLImageElement).src = url;
    const a = this.$('shotSave') as HTMLAnchorElement;
    a.href = url;
    a.download = `国庆-天安门-${Date.now()}.png`;
    this.$('shotModal').classList.add('open');
  }

  private closeShot() {
    this.$('shotModal').classList.remove('open');
  }

  private syncFullscreen() {
    const fs = !!(document.fullscreenElement || (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement);
    this.$('btnFull').innerHTML = icon(fs ? 'exitFull' : 'full');
    this.$('btnFull').dataset.tip = fs ? '退出全屏' : '全屏';
  }

  private bindIdle() {
    const wake = () => {
      document.body.classList.remove('idle');
      clearTimeout(this.idleTimer);
      this.idleTimer = window.setTimeout(() => {
        if (!this.open) document.body.classList.add('idle');
      }, 4500);
    };
    ['pointermove', 'pointerdown', 'keydown', 'touchstart'].forEach((e) => window.addEventListener(e, wake, { passive: true }));
    wake();
  }

  private set(key: string, val: string, fn: (v: string) => void) {
    if (this.cache[key] === val) return;
    this.cache[key] = val;
    fn(val);
  }

  update(s: UIState) {
    const hmStr = fmtHM(s.t);
    const blink = Math.floor(performance.now() / 1000) % 2 === 0 || s.simulated;
    this.set('clock', hmStr + (blink ? '1' : '0'), () => {
      this.$('clock').innerHTML = pixelDigitsSVG(blink ? hmStr : hmStr.replace(':', ' '), 3);
    });
    this.set('label', s.simulated ? '1' : '0', (v) => {
      this.$('clockLabel').textContent = v === '1' ? '模拟时间' : '北京时间';
      this.$('info').classList.toggle('sim', v === '1');
    });
    const sub = s.fireworks ? '国庆庆典' : s.nd ? `国庆节 · ${s.phaseLabel}` : s.phaseLabel;
    this.set('sub', sub, (v) => (this.$('infoSub').textContent = v));
    this.set('fw', s.fireworks ? '1' : '0', (v) => this.$('fwTag').classList.toggle('show', v === '1'));
    this.set('cap', s.caption ?? '', (v) => {
      this.$('caption').classList.toggle('show', !!v);
      if (v) this.$('capText').textContent = v;
    });
    this.set('cer', s.ceremony ? '1' : '0', (v) => document.body.classList.toggle('ceremony', v === '1'));
    if (!this.scrubbing) {
      const slider = this.$('slider') as HTMLInputElement;
      let v = s.t;
      if (v < SLIDER_MIN) v += DAY;
      slider.value = String(v);
    }
    this.set('stime', hmStr, (v) => (this.$('sliderTime').innerHTML = pixelDigitsSVG(v, 2)));
    if (this.open === 'time' && Math.floor(s.t) % 30 === 0) this.refreshPresetTimes();
  }
}
