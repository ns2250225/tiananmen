import './style.css';
import { AudioManager, Levels } from './audio/audio';
import { css, mix } from './core/color';
import { computeEnv, Env } from './core/env';
import { EventManager, RandomEventManager } from './core/events';
import { DAY, HOUR, clamp, fmtHM, hm, lerp, rand, randInt, wrapDay } from './core/math';
import { BJDate, PHASE_LABEL, TimeManager } from './core/time';
import { WeatherManager } from './core/weather';
import { CN_FONT, drawPixelDigits, pixelDigitsWidth } from './render/canvas';
import { ceremonyState, CeremonyState, RAISE } from './scene/ceremony';
import { buildFlagFrames } from './scene/flag';
import { QUALITIES, SceneFrame, SceneManager } from './scene/scene';
import { PresetId, UIManager } from './ui/ui';

// ———————————————— URL 参数（便于调试 / 演示） ————————————————
const params = new URLSearchParams(location.search);
const dateParam = params.get('date');
let dateOverride: BJDate | null = null;
if (dateParam && /^\d{4}-\d{1,2}-\d{1,2}$/.test(dateParam)) {
  const [y, m, d] = dateParam.split('-').map(Number);
  dateOverride = { year: y, month: m, day: d };
}
const tParam = params.get('t');
const startAt = tParam && /^\d{1,2}:\d{2}(:\d{2})?$/.test(tParam) ? hm(tParam) + (Number(tParam.split(':')[2]) || 0) : null;
const isMobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
const qParam = (params.get('q') ?? '').toLowerCase();
let tier = Math.max(0, QUALITIES.findIndex((q) => q.name.toLowerCase() === qParam));
if (!qParam) tier = isMobile ? 1 : 0;

// ———————————————— 核心管理器 ————————————————
const time = new TimeManager(dateOverride, startAt);
const ndParam = params.get('nd');
const nd = ndParam === '1' ? true : ndParam === '0' ? false : time.isNationalDay;
const weather = new WeatherManager();
const events = new EventManager();
const randomEvents = new RandomEventManager();
const audio = new AudioManager();
const scene = new SceneManager();

const stage = document.getElementById('stage') as HTMLCanvasElement;
const sctx = stage.getContext('2d')!;
let entered = false;
let lastEnv: Env | null = null;
let lastCer: CeremonyState | null = null;
let focus = 0;
let viewport = { sx: 0, sy: 0, sw: 640, sh: 360 };

function computeView() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cw = window.innerWidth;
  const ch = window.innerHeight;
  const devW = Math.round(cw * dpr);
  const devH = Math.round(ch * dpr);
  const portrait = ch > cw * 1.05;
  const scale = portrait
    ? Math.max(1, Math.floor(devW / 360))
    : Math.max(1, Math.min(Math.round(devH / 360), Math.floor(devW / 420)));
  return { dpr, scale, W: Math.ceil(devW / scale), H: Math.ceil(devH / scale), cw, ch };
}

function resize() {
  const v = computeView();
  stage.width = v.W * v.scale;
  stage.height = v.H * v.scale;
  const cssW = stage.width / v.dpr;
  const cssH = stage.height / v.dpr;
  stage.style.width = `${cssW}px`;
  stage.style.height = `${cssH}px`;
  stage.style.left = `${Math.floor((v.cw - cssW) / 2)}px`;
  stage.style.top = `${Math.floor((v.ch - cssH) / 2)}px`;
  sctx.imageSmoothingEnabled = false;
  scene.resize(v.W, v.H, nd, QUALITIES[tier]);
  ui?.setTrackGradient(trackGradient(), time.sunrise, time.sunset);
}

/** 时间滑杆背景：一整天的天空颜色 */
function trackGradient() {
  const stops: string[] = [];
  for (let i = 0; i <= 48; i++) {
    const t = wrapDay(4 * HOUR + (i / 48) * DAY);
    const e = computeEnv(t, time.sunrise, time.sunset, time.moonPhase, scene.L, nd);
    stops.push(`${css(mix(e.skyTop, e.skyHor, 0.55))} ${((i / 48) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(',')})`;
}

// ———————————————— 时间预设 ————————————————
function presetTime(id: PresetId): number {
  switch (id) {
    case 'now':
      return time.getRealTime();
    case 'dawn':
      return time.sunrise - 25;
    case 'morning':
      return hm('09:30');
    case 'afternoon':
      return hm('15:20');
    case 'dusk':
      return time.sunset - 9 * 60;
    case 'night':
      return hm('19:50');
    case 'fireworks':
      return hm('21:00') + 5;
  }
}

const levels: Levels = audio.levels;
const ui: UIManager = new UIManager(
  document.getElementById('ui')!,
  {
    onEnter() {
      entered = true;
      audio.onAnthemReady = (ok) => ui.setAnthem(ok);
      audio.init();
    },
    onPreset(id) {
      if (id === 'now') time.resetToRealTime(2);
      else time.setSimulationTime(presetTime(id), 2);
      if (id === 'fireworks') setTimeout(() => scene.fireworks.burst(), 2200);
    },
    onScrub(sec) {
      time.setSimulationTime(sec);
    },
    onFirework() {
      const x = rand(scene.L.W * 0.2, scene.L.W * 0.8);
      scene.fireworks.launch(scene.fireworks.randomType(), x);
    },
    onShot: saveMoment,
    onFullscreen: toggleFullscreen,
    onMuteCycle() {
      return audio.cycleMute();
    },
    onLevel() {
      audio.applyLevels();
    },
    presetTime,
  },
  { nd, year: time.date.year, levels, mobile: isMobile },
);

// ———————————————— 事件 ————————————————
scene.fireworks.onLaunch = (x) => audio.launch((x / scene.L.W) * 2 - 1);
scene.fireworks.onExplode = (e) => {
  scene.addFlash(e.col, clamp(0.22 + e.size * 0.12, 0.2, 0.42), rand(0.2, 0.5));
  audio.explode((e.x / scene.L.W) * 2 - 1, e.size, e.type === 'glitter' || e.type === 'crossette' || e.type === 'willow');
};
events.on('FLAG_TOP', () => {
  // 国庆特别模式：国旗升至顶端后放飞鸽群
  if (nd) {
    scene.birds.spawn(8, scene.L.baseY - 90);
    setTimeout(() => scene.birds.spawn(7, scene.L.baseY - 70), 600);
    audio.flap();
  }
});
events.on('FIREWORK', () => ui.toast('国庆庆典艺术场景 · 烟花开始'));

const notCeremony = () => !lastCer || lastCer.hold < 0.2;
const env = () => lastEnv!;
randomEvents.add('pigeons', 30, 90, () => env().daylight > 0.4 && notCeremony(), () => {
  scene.birds.spawn();
  audio.flap();
});
randomEvents.add('gust', 40, 120, () => true, () => {
  weather.gustNow();
  scene.fx.leavesBurst(randInt(10, 24));
});
randomEvents.add('surge', 120, 240, () => env().daylight > 0.5 && notCeremony(), () => scene.crowd.surge());
randomEvents.add('photos', 45, 120, () => notCeremony(), () => scene.crowd.photoSpree());
randomEvents.add('cloudSun', 120, 300, () => env().daylight > 0.6 && env().sunVis > 0.5, () => scene.clouds.coverSun(env()));
randomEvents.add('kidRun', 60, 150, () => env().daylight > 0.3 && notCeremony(), () => scene.crowd.kidRun());
randomEvents.add('waveFlags', 60, 120, () => notCeremony(), () => scene.crowd.waveAll());
randomEvents.add('meteor', 40, 120, () => env().night > 0.85, () => scene.fx.meteor());
randomEvents.add('plane', 90, 240, () => true, () => scene.fx.plane());

// ———————————————— 交互 & 彩蛋 ————————————————
function toLogical(clientX: number, clientY: number) {
  const r = stage.getBoundingClientRect();
  const u = (clientX - r.left) / r.width;
  const v = (clientY - r.top) / r.height;
  return { x: viewport.sx + u * viewport.sw, y: viewport.sy + v * viewport.sh };
}

let skyClicks: number[] = [];
stage.addEventListener('click', (e) => {
  if (!entered || !lastEnv) return;
  const { x, y } = toLogical(e.clientX, e.clientY);
  const cam = scene.camX;
  // 点击月亮：出现流星
  if (scene.sky.hitMoon(lastEnv, x, y, cam)) {
    scene.fx.meteor(x - 30, Math.max(4, y - 40));
    return;
  }
  // 点击云：云轻轻抖动
  if (scene.clouds.hit(x, y, cam)) return;
  // 连续点击天空 5 次：鸽群
  if (scene.isSky(x, y)) {
    const now = performance.now();
    skyClicks = skyClicks.filter((t) => now - t < 4000);
    skyClicks.push(now);
    if (skyClicks.length >= 5) {
      skyClicks = [];
      scene.birds.spawn(randInt(6, 8), clamp(y, 20, scene.L.baseY - 60));
      audio.flap();
    }
  }
});
if (!isMobile)
  window.addEventListener('pointermove', (e) => {
    scene.pointerX = clamp((e.clientX / window.innerWidth - 0.5) * 2, -1, 1);
  });

function toggleFullscreen() {
  const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (document.fullscreenElement || d.webkitFullscreenElement) {
    if (document.exitFullscreen) void document.exitFullscreen();
    else d.webkitExitFullscreen?.();
  } else if (el.requestFullscreen) void el.requestFullscreen().catch(() => ui.toast('当前浏览器不支持全屏'));
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  else ui.toast('当前浏览器不支持全屏，可“添加到主屏幕”获得沉浸体验');
}

window.addEventListener('keydown', (e) => {
  if (!entered || (e.target as HTMLElement).tagName === 'INPUT') return;
  if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  else if (e.key === 'm' || e.key === 'M') ui.setMute(audio.cycleMute());
  else if (e.key === 't' || e.key === 'T') ui.toggle('time');
  else if (e.key === ' ') {
    e.preventDefault();
    scene.fireworks.launch();
  }
});

// ———————————————— 截图分享 ————————————————
const shotFlag = buildFlagFrames()[1][0];
function saveMoment() {
  const L = scene.L;
  const k = Math.max(2, Math.ceil(1600 / L.W));
  const W = L.W * k;
  const H = L.H * k;
  const fh = Math.round(Math.max(120, H * 0.15));
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H + fh;
  const c = out.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.drawImage(scene.canvas, 0, 0, W, H);
  const g = c.createLinearGradient(0, H, 0, H + fh);
  g.addColorStop(0, '#8E1A12');
  g.addColorStop(1, '#4A0B08');
  c.fillStyle = g;
  c.fillRect(0, H, W, fh);
  c.fillStyle = '#F2C14E';
  c.fillRect(0, H, W, Math.max(3, k));
  c.globalAlpha = 0.12;
  for (let x = 0; x < W; x += k * 4) c.fillRect(x, H + fh - k * 2, k * 2, k);
  c.globalAlpha = 1;
  const pad = Math.round(fh * 0.28);
  const fs = Math.round(fh / 34);
  c.drawImage(shotFlag, pad, H + Math.round(fh / 2 - (shotFlag.height * fs) / 2), shotFlag.width * fs, shotFlag.height * fs);
  const tx = pad + shotFlag.width * fs + pad * 0.7;
  c.textBaseline = 'alphabetic';
  c.fillStyle = '#FFD75A';
  c.font = `900 ${Math.round(fh * 0.27)}px ${CN_FONT}`;
  c.fillText('十月一日 · 国庆节', tx, H + fh * 0.48);
  c.fillStyle = '#F8E8D0';
  c.font = `500 ${Math.round(fh * 0.17)}px ${CN_FONT}`;
  c.fillText('北京 · 天安门', tx, H + fh * 0.78);
  const tstr = fmtHM(time.getCurrentTime());
  const px = Math.max(3, Math.round(fh * 0.07));
  const tw = pixelDigitsWidth(tstr, px);
  drawPixelDigits(c, tstr, W - pad - tw, H + fh * 0.2, px, '#FFD75A');
  c.fillStyle = 'rgba(248,232,208,0.85)';
  c.font = `500 ${Math.round(fh * 0.13)}px ${CN_FONT}`;
  const d = time.date;
  const label = `${time.simulated ? '模拟时间' : '北京时间'} ${d.year}.${String(d.month).padStart(2, '0')}.${String(d.day).padStart(2, '0')}`;
  const lw = c.measureText(label).width;
  c.fillText(label, W - pad - lw, H + fh * 0.84);
  out.toBlob((blob) => {
    if (!blob) return ui.toast('截图失败');
    ui.showShot(URL.createObjectURL(blob));
  }, 'image/png');
}

// ———————————————— 性能降级 ————————————————
let fpsFrames = 0;
let fpsTime = 0;
let badWindows = 0;
function monitorFps(dt: number) {
  fpsFrames++;
  fpsTime += dt;
  if (fpsTime < 2) return;
  const fps = fpsFrames / fpsTime;
  fpsFrames = 0;
  fpsTime = 0;
  if (document.hidden) return;
  if (fps < 40 && tier < QUALITIES.length - 1) {
    badWindows++;
    if (badWindows >= 2) {
      tier++;
      badWindows = 0;
    }
  } else badWindows = 0;
}

// ———————————————— 主循环 ————————————————
let last = performance.now();
let warmup = 0;
function frame(ts: number) {
  const dt = Math.min(0.05, Math.max(0.001, (ts - last) / 1000));
  last = ts;
  const now = ts / 1000;
  const t = time.update();
  const fast = time.fast;
  const L = scene.L;
  const e = computeEnv(t, time.sunrise, time.sunset, time.moonPhase, L, nd);
  const cer = ceremonyState(t, time.sunrise, time.sunset, L);
  lastEnv = e;
  lastCer = cer;
  weather.update(dt);
  events.update(t, fast, { sunrise: time.sunrise, sunset: time.sunset, raiseTop: RAISE.top, lightsOn: time.sunset + 15 * 60 });
  randomEvents.update(dt, fast);

  const q = QUALITIES[tier];
  const f: SceneFrame = { t, dt, now, fast, env: e, cer, wind: weather.wind, flagLevel: weather.flagLevel, quality: q, nd };
  scene.update(f, 0);
  scene.render(f);

  // 镜头：升旗时 Zoom 1.0 → 1.15 聚焦国旗、旗杆、天安门
  focus = lerp(focus, cer.focus, Math.min(1, dt * (fast ? 8 : 1.5)));
  const z = 1 + 0.15 * focus;
  const sw = L.W / z;
  const sh = L.H / z;
  const fx = L.cx + scene.camX;
  const fy = (L.poleTopY + L.poleBaseY) / 2;
  const sx = clamp(lerp(L.W / 2, fx, focus) - sw / 2, 0, L.W - sw);
  const sy = clamp(lerp(L.H / 2, fy, focus) - sh / 2, 0, L.H - sh);
  viewport = { sx, sy, sw, sh };
  sctx.imageSmoothingEnabled = false;
  if (focus < 0.002) sctx.drawImage(scene.canvas, 0, 0, stage.width, stage.height);
  else sctx.drawImage(scene.canvas, sx, sy, sw, sh, 0, 0, stage.width, stage.height);

  // 音频
  if (entered) {
    const marching = !fast && cer.guards.some((g) => g.moving);
    audio.update({ dt, wind: weather.wind, crowd: scene.crowd.npcs.length / 120, daylight: e.daylight, night: e.night, hold: cer.hold, marching });
    if (cer.anthem && !fast && !time.transitioning) audio.playAnthem(cer.anthemOffset);
    else if (audio.anthemPlaying) audio.stopAnthem();
  }

  let caption: string | null = null;
  if (cer.kind === 'raise' && cer.u > 1.5 && cer.u < 74) caption = cer.anthem && audio.anthemPlaying ? '升旗仪式 · 奏唱国歌' : '升旗仪式';
  else if (cer.kind === 'lower' && cer.u > 1.5 && cer.u < 70) caption = '降旗仪式';
  ui.update({
    t,
    simulated: time.simulated,
    phaseLabel: PHASE_LABEL[e.phase],
    nd,
    fireworks: e.fireworkLevel > 0.5 || (e.fireworkLevel > 0 && scene.fireworks.active),
    caption,
    ceremony: cer.hold > 0.4,
    sunrise: time.sunrise,
    sunset: time.sunset,
  });

  warmup += dt;
  if (warmup > 3) monitorFps(dt);
  requestAnimationFrame(frame);
}

let resizeT = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = window.setTimeout(resize, 120);
});
resize();
// 预热：让人群、云提前就位
{
  const t = time.update();
  const e = computeEnv(t, time.sunrise, time.sunset, time.moonPhase, scene.L, nd);
  const target = scene.crowdTarget(e, QUALITIES[tier]);
  for (let i = 0; scene.crowd.npcs.length < target && i < 200; i++) scene.crowd.spawnGroup('inside');
  scene.lightLevel = e.lightTarget;
}
requestAnimationFrame(frame);

if (params.has('autostart')) (document.getElementById('enterBtn') as HTMLButtonElement | null)?.click();
const panelParam = params.get('panel');
if (panelParam === 'time' || panelParam === 'audio') ui.toggle(panelParam);
if (params.has('burst')) {
  // 调试：立即燃放并预演若干秒
  scene.fireworks.burst();
  const steps = Number(params.get('burst')) || 120;
  for (let i = 0; i < steps; i++) scene.fireworks.update(1 / 60, 0, false);
}

