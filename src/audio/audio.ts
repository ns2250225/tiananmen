import { chance, clamp, rand, randInt } from '../core/math';

export interface Levels {
  master: number;
  ambient: number;
  fireworks: number;
  ceremony: number;
}

export interface AudioFrame {
  dt: number;
  wind: number;
  crowd: number;
  daylight: number;
  night: number;
  hold: number;
  marching: boolean;
  /** 降雨强度 0..1（雪天为 0） */
  rain: number;
}

/**
 * AudioManager —— 不使用持续背景音乐，声音来自风、鸟、人群、烟花与环境；
 * 仅在升旗仪式时播放仪式音频（需放置官方合法来源的 audio/ceremony/anthem.mp3）。
 * 所有环境音均由 Web Audio 实时合成，无需额外素材。
 */
export class AudioManager {
  ctx: AudioContext | null = null;
  levels: Levels = { master: 0.3, ambient: 0.75, fireworks: 0.8, ceremony: 1 };
  muteState: 0 | 1 | 2 = 0;
  anthemAvailable = false;
  onAnthemReady: (ok: boolean) => void = () => {};
  private master!: GainNode;
  private amb!: GainNode;
  private fw!: GainNode;
  private cer!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private crowdGain!: GainNode;
  private crowdFilter!: BiquadFilterNode;
  private nightGain!: GainNode;
  private rainGain!: GainNode;
  private anthemBuf: AudioBuffer | null = null;
  private anthemSrc: AudioBufferSourceNode | null = null;
  private anthemGain: GainNode | null = null;
  private birdT = 2;
  private cricketT = 1;
  private stepT = 0;
  private crowdMod = 1;
  private modT = 0;

  get ready() {
    return !!this.ctx;
  }

  /** 必须在用户手势中调用（浏览器自动播放策略） */
  init() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.amb = ctx.createGain();
    this.fw = ctx.createGain();
    this.cer = ctx.createGain();
    this.amb.connect(this.master);
    this.fw.connect(this.master);
    this.cer.connect(this.master);
    this.applyLevels();

    // 粉红噪声缓冲
    const len = ctx.sampleRate * 4;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }

    // 风
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 500;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.loopNoise(0).connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.amb);

    // 远处人群
    this.crowdFilter = ctx.createBiquadFilter();
    this.crowdFilter.type = 'bandpass';
    this.crowdFilter.frequency.value = 650;
    this.crowdFilter.Q.value = 0.7;
    const crowdLp = ctx.createBiquadFilter();
    crowdLp.type = 'lowpass';
    crowdLp.frequency.value = 1400;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0;
    this.loopNoise(1.3).connect(this.crowdFilter);
    this.crowdFilter.connect(crowdLp);
    crowdLp.connect(this.crowdGain);
    this.crowdGain.connect(this.amb);

    // 夜间环境底噪
    const nightLp = ctx.createBiquadFilter();
    nightLp.type = 'lowpass';
    nightLp.frequency.value = 180;
    this.nightGain = ctx.createGain();
    this.nightGain.gain.value = 0;
    this.loopNoise(2.6).connect(nightLp);
    nightLp.connect(this.nightGain);
    this.nightGain.connect(this.amb);

    // 雨声：宽带噪声经带通得到沙沙雨幕
    const rainBp = ctx.createBiquadFilter();
    rainBp.type = 'bandpass';
    rainBp.frequency.value = 2800;
    rainBp.Q.value = 0.35;
    const rainLp = ctx.createBiquadFilter();
    rainLp.type = 'lowpass';
    rainLp.frequency.value = 5200;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    this.loopNoise(3.9).connect(rainBp);
    rainBp.connect(rainLp);
    rainLp.connect(this.rainGain);
    this.rainGain.connect(this.amb);

    void this.loadAnthem();
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  private async loadAnthem() {
    try {
      const res = await fetch('./audio/ceremony/anthem.mp3');
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || type.includes('text/html')) throw new Error('anthem not found');
      const buf = await res.arrayBuffer();
      this.anthemBuf = await new Promise<AudioBuffer>((ok, fail) => this.ctx!.decodeAudioData(buf, ok, fail));
      this.anthemAvailable = true;
    } catch (e) {
      console.warn('[audio] 国歌音频加载失败', e);
      this.anthemBuf = null;
    }
    this.onAnthemReady(this.anthemAvailable);
  }

  private loopNoise(offset: number) {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, offset);
    return src;
  }

  applyLevels() {
    if (!this.ctx) return;
    const m = this.muteState === 2 ? 0 : this.muteState === 1 ? 0.4 : 1;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.levels.master * m * 1.6, t, 0.05);
    this.amb.gain.setTargetAtTime(this.levels.ambient, t, 0.05);
    this.fw.gain.setTargetAtTime(this.levels.fireworks, t, 0.05);
    this.cer.gain.setTargetAtTime(this.levels.ceremony, t, 0.05);
  }

  cycleMute() {
    this.muteState = ((this.muteState + 1) % 3) as 0 | 1 | 2;
    this.applyLevels();
    return this.muteState;
  }

  private panner(pan: number): AudioNode {
    const ctx = this.ctx!;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      return p;
    }
    return ctx.createGain();
  }

  update(f: AudioFrame) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.04 + f.wind * f.wind * 0.42, t, 0.6);
    this.windFilter.frequency.setTargetAtTime(280 + f.wind * 1100, t, 0.6);
    this.modT -= f.dt;
    if (this.modT <= 0) {
      this.crowdMod = rand(0.7, 1.25);
      this.modT = rand(0.4, 1.4);
      this.crowdFilter.frequency.setTargetAtTime(rand(520, 820), t, 0.4);
    }
    const crowd = clamp(f.crowd) * (1 - f.hold * 0.85);
    this.crowdGain.gain.setTargetAtTime(crowd * 0.55 * this.crowdMod, t, 0.5);
    this.nightGain.gain.setTargetAtTime(f.night * 0.18, t, 1);
    this.rainGain.gain.setTargetAtTime(f.rain * 0.42, t, 0.8);

    // 鸟叫（白天，清晨更多；雨天躲雨不叫）
    this.birdT -= f.dt;
    if (this.birdT <= 0) {
      if (f.daylight > 0.3 && f.hold < 0.5 && f.rain < 0.2) this.chirp();
      this.birdT = rand(2, 7) / Math.max(0.3, f.daylight);
    }
    // 秋虫（夜晚）
    this.cricketT -= f.dt;
    if (this.cricketT <= 0) {
      if (f.night > 0.7) this.cricket();
      this.cricketT = rand(0.8, 3.2);
    }
    // 护卫队正步
    if (f.marching) {
      this.stepT -= f.dt;
      if (this.stepT <= 0) {
        this.step();
        this.stepT = 1 / 1.6;
      }
    } else this.stepT = 0;
  }

  private env(g: GainNode, t0: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  chirp() {
    const ctx = this.ctx!;
    const p = this.panner(rand(-0.8, 0.8));
    p.connect(this.amb);
    const notes = randInt(2, 5);
    const base = rand(2600, 3800);
    let t = ctx.currentTime + 0.02;
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(base * rand(0.9, 1.1), t);
      o.frequency.exponentialRampToValueAtTime(base * rand(1.2, 1.5), t + 0.07);
      this.env(g, t, 0.01, 0.05, 0.09);
      o.connect(g);
      g.connect(p);
      o.start(t);
      o.stop(t + 0.15);
      t += rand(0.09, 0.18);
    }
  }

  cricket() {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    o.frequency.value = rand(4300, 4800);
    const am = ctx.createOscillator();
    am.type = 'square';
    am.frequency.value = rand(28, 40);
    const amg = ctx.createGain();
    amg.gain.value = 0.5;
    const g = ctx.createGain();
    const out = ctx.createGain();
    out.gain.value = 0;
    this.env(out, t, 0.02, 0.018, 0.28);
    am.connect(amg);
    amg.connect(g.gain);
    o.connect(g);
    g.connect(out);
    const p = this.panner(rand(-1, 1));
    out.connect(p);
    p.connect(this.amb);
    o.start(t);
    am.start(t);
    o.stop(t + 0.35);
    am.stop(t + 0.35);
  }

  private step() {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.08);
    const g = ctx.createGain();
    this.env(g, t, 0.003, 0.22, 0.1);
    o.connect(g);
    g.connect(this.cer);
    o.start(t);
    o.stop(t + 0.15);
  }

  /** 鸽群扑翅 */
  flap() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (let i = 0; i < 6; i++) {
      const t = ctx.currentTime + i * rand(0.07, 0.12);
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = rand(900, 1600);
      const g = ctx.createGain();
      this.env(g, t, 0.01, 0.08, 0.07);
      src.connect(bp);
      bp.connect(g);
      g.connect(this.amb);
      src.start(t, rand(0, 3));
      src.stop(t + 0.1);
    }
  }

  // —————— 烟花 ——————
  launch(pan: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const p = this.panner(pan);
    p.connect(this.fw);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 1.1);
    const g = ctx.createGain();
    this.env(g, t, 0.05, 0.12, 1.1);
    src.connect(bp);
    bp.connect(g);
    g.connect(p);
    src.start(t, rand(0, 3));
    src.stop(t + 1.3);
    if (chance(0.35)) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(900, t);
      o.frequency.exponentialRampToValueAtTime(2400, t + 1);
      const og = ctx.createGain();
      this.env(og, t, 0.1, 0.025, 0.9);
      o.connect(og);
      og.connect(p);
      o.start(t);
      o.stop(t + 1.1);
    }
  }

  explode(pan: number, size: number, crackle: boolean) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + rand(0.25, 0.45);
    const p = this.panner(pan);
    p.connect(this.fw);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + 1.2);
    const g = ctx.createGain();
    this.env(g, t, 0.005, 0.9 * clamp(size, 0.6, 1.4), 1.6);
    src.connect(lp);
    lp.connect(g);
    g.connect(p);
    src.start(t, rand(0, 2));
    src.stop(t + 1.8);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(rand(70, 95), t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.5);
    const og = ctx.createGain();
    this.env(og, t, 0.005, 0.5, 0.55);
    o.connect(og);
    og.connect(p);
    o.start(t);
    o.stop(t + 0.6);
    if (crackle) {
      const n = randInt(18, 34);
      for (let i = 0; i < n; i++) {
        const ct = t + 0.35 + Math.random() * 1.1;
        const s = ctx.createBufferSource();
        s.buffer = this.noise;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 2500;
        const cg = ctx.createGain();
        this.env(cg, ct, 0.001, rand(0.08, 0.2), 0.03);
        s.connect(hp);
        hp.connect(cg);
        cg.connect(p);
        s.start(ct, rand(0, 3));
        s.stop(ct + 0.05);
      }
    }
  }

  // —————— 仪式音频 ——————
  get anthemPlaying() {
    return !!this.anthemSrc;
  }

  playAnthem(offset: number) {
    if (!this.ctx || !this.anthemBuf || this.anthemSrc) return;
    if (offset > this.anthemBuf.duration - 0.5) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.anthemBuf;
    const g = this.ctx.createGain();
    g.gain.value = 0.9;
    src.connect(g);
    g.connect(this.cer);
    src.start(0, Math.max(0, offset));
    src.onended = () => {
      if (this.anthemSrc === src) {
        this.anthemSrc = null;
        this.anthemGain = null;
      }
    };
    this.anthemSrc = src;
    this.anthemGain = g;
  }

  stopAnthem() {
    if (!this.anthemSrc || !this.ctx) return;
    const g = this.anthemGain!;
    g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    const src = this.anthemSrc;
    src.stop(this.ctx.currentTime + 1.2);
    this.anthemSrc = null;
    this.anthemGain = null;
  }
}
