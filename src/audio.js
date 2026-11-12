// 声音：全部用 WebAudio 实时合成 —— 音效、环境声、以及跟随踏频/强度变化的生成式音乐
import { clamp, lerp } from './util.js';

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const PENTA = [0, 2, 4, 7, 9];

export class AudioSys {
  constructor() {
    this.ctx = null; this.ready = false;
    this.vol = { master: 0.8, music: 0.6, sfx: 0.9 };
    this.musicOn = true;
    this.intensity = 0; this.tempo = 100; this.night = 0; this.fever = 0; this.menu = true;
    this.speedN = 0; this.coast = 0; this.boostN = 0; this.rainN = 0; this.air = 0;
    this.step = 0; this.nextT = 0; this.bar = 0;
    this.motif = null; this.prog = null; this.key = 50; // D3
  }

  // 必须由用户手势触发
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.vol.master;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(c.destination);
    this.sfxBus = c.createGain(); this.sfxBus.gain.value = this.vol.sfx; this.sfxBus.connect(this.master);
    this.musicBus = c.createGain(); this.musicBus.gain.value = this.vol.music;
    this.musicLP = c.createBiquadFilter(); this.musicLP.type = 'lowpass'; this.musicLP.frequency.value = 18000;
    this.musicBus.connect(this.musicLP); this.musicLP.connect(this.master);
    // 混响
    const len = c.sampleRate * 2.4, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.reverb = c.createConvolver(); this.reverb.buffer = ir;
    const rv = c.createGain(); rv.gain.value = 0.32; this.reverb.connect(rv); rv.connect(this.master);
    // 延迟
    this.delay = c.createDelay(1.5); this.delay.delayTime.value = 0.3;
    const fb = c.createGain(); fb.gain.value = 0.3; const dl = c.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2600;
    this.delay.connect(dl); dl.connect(fb); fb.connect(this.delay);
    const dw = c.createGain(); dw.gain.value = 0.3; this.delay.connect(dw); dw.connect(this.musicBus);
    // 噪声
    const nl = c.sampleRate * 2; this.noise = c.createBuffer(1, nl, c.sampleRate);
    const nd = this.noise.getChannelData(0); for (let i = 0; i < nl; i++) nd[i] = Math.random() * 2 - 1;
    this._ambient();
    this.ready = true;
    this.nextT = c.currentTime + 0.1;
    this._newSong();
  }
  setVol(k, v) { this.vol[k] = v; if (!this.ready) return; if (k === 'master') this.master.gain.value = v; if (k === 'music') this.musicBus.gain.value = this.musicOn ? v : 0; if (k === 'sfx') this.sfxBus.gain.value = v; }
  setMusic(on) { this.musicOn = on; if (this.ready) this.musicBus.gain.setTargetAtTime(on ? this.vol.music : 0, this.ctx.currentTime, 0.1); }
  suspend(s) { if (!this.ctx) return; if (s) this.ctx.suspend(); else this.ctx.resume(); }

  // ---------- 基础发声 ----------
  _osc(type, freq, t, dur, vol, dest, opt = {}) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (opt.to) o.frequency.exponentialRampToValueAtTime(Math.max(1, opt.to), t + (opt.toT || dur));
    if (opt.detune) o.detune.value = opt.detune;
    const a = opt.a === undefined ? 0.005 : opt.a;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + a);
    if (opt.hold) { g.gain.setValueAtTime(vol, t + dur - (opt.rel || 0.08)); g.gain.linearRampToValueAtTime(0.0001, t + dur); }
    else g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (opt.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(opt.lp, t); if (opt.lpTo) f.frequency.exponentialRampToValueAtTime(opt.lpTo, t + dur); f.Q.value = opt.q || 0.7; node.connect(f); node = f; }
    node.connect(g); g.connect(dest || this.sfxBus);
    if (opt.rev) { const s = c.createGain(); s.gain.value = opt.rev; g.connect(s); s.connect(this.reverb); }
    if (opt.dly) { const s = c.createGain(); s.gain.value = opt.dly; g.connect(s); s.connect(this.delay); }
    if (opt.vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = opt.vib; lg.gain.value = opt.vibD || 6; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur + 0.05); }
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  _noise(t, dur, vol, type, freq, dest, opt = {}) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; s.loop = true; s.playbackRate.value = opt.rate || 1;
    f.type = type; f.frequency.setValueAtTime(freq, t); if (opt.to) f.frequency.exponentialRampToValueAtTime(opt.to, t + dur); f.Q.value = opt.q || 0.8;
    const a = opt.a === undefined ? 0.004 : opt.a;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || this.sfxBus);
    if (opt.rev) { const sg = c.createGain(); sg.gain.value = opt.rev; g.connect(sg); sg.connect(this.reverb); }
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  // ---------- 环境声（常驻，用增益调制）----------
  _ambient() {
    const c = this.ctx;
    const loop = (type, freq, q) => { const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = this.noise; s.loop = true; f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.sfxBus); s.start(); return { f, g, s }; };
    this.wind = loop('bandpass', 500, 0.6);
    this.waves = loop('lowpass', 420, 0.3);
    this.rain = loop('highpass', 3200, 0.3);
    this.tire = loop('bandpass', 180, 1.2);
    this.roar = loop('bandpass', 900, 0.8);
    // 海浪起伏 LFO
    const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 0.13; lg.gain.value = 0.035; l.connect(lg); lg.connect(this.waves.g.gain); l.start();
    this.ratchetT = 0;
  }

  // 每帧：环境声 + 音乐调度。s: {speed(0..1), coast, boost, rain, night, intensity, fever, menu, air, paused}
  update(dt, s) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    this.speedN = s.speed; this.night = s.night; this.menu = s.menu; this.fever = s.fever;
    this.intensity = lerp(this.intensity, s.intensity, 1 - Math.exp(-dt * 1.5));
    const sp = s.paused ? 0 : s.speed;
    this.wind.g.gain.setTargetAtTime(0.012 + sp * sp * 0.085 + s.air * 0.03, t, 0.12);
    this.wind.f.frequency.setTargetAtTime(380 + sp * 900, t, 0.15);
    this.waves.g.gain.setTargetAtTime(s.paused ? 0.02 : 0.06, t, 0.4);
    this.rain.g.gain.setTargetAtTime(s.rain * 0.075, t, 0.5);
    this.tire.g.gain.setTargetAtTime(s.air > 0.5 ? 0 : sp * 0.05, t, 0.08);
    this.tire.f.frequency.setTargetAtTime(120 + sp * 260, t, 0.1);
    this.roar.g.gain.setTargetAtTime(s.boost * 0.09, t, 0.08);
    this.roar.f.frequency.setTargetAtTime(700 + s.boost * 900, t, 0.2);
    // 滑行时的棘轮咔嗒声
    if (s.coast > 0.5 && sp > 0.12 && !s.paused && s.air < 0.5) { this.ratchetT -= dt; if (this.ratchetT <= 0) { this.ratchetT = 0.028 + 0.05 * (1 - sp); this._noise(t, 0.012, 0.035, 'bandpass', 5200, null, { q: 4 }); } }
    this.musicLP.frequency.setTargetAtTime(s.muffle ? 520 : 18000, t, 0.25);
    this._music(t);
  }

  // ---------- 生成式音乐 ----------
  _newSong() {
    const night = this.night > 0.5;
    const PROGS = night ? [[0, 9, 5, 7], [9, 5, 0, 7], [0, 4, 5, 7]] : [[0, 7, 9, 5], [0, 4, 5, 7], [9, 5, 0, 7], [0, 5, 9, 7]];
    this.prog = PROGS[(Math.random() * PROGS.length) | 0];
    this.key = [50, 48, 52, 45, 53][(Math.random() * 5) | 0];
    // 动机：16 个八分音符位置的五声音阶序号（-1 为休止）
    const m = []; let deg = (Math.random() * 5) | 0;
    for (let i = 0; i < 16; i++) { if (Math.random() < (i % 4 === 0 ? 0.1 : 0.4)) { m.push(-1); continue; } deg = clamp(deg + ((Math.random() * 5) | 0) - 2, -2, 8); m.push(deg); }
    this.motif = m;
  }
  _chord(root) { const minor = root === 9 || root === 4 || root === 2; return [0, minor ? 3 : 4, 7, minor ? 10 : 11]; }
  _music(now) {
    if (!this.musicOn) { this.nextT = now + 0.1; return; }
    const target = this.menu ? 84 : 96 + this.speedN * 40 + this.fever * 14;
    this.tempo = lerp(this.tempo, target, 0.02);
    const spb = 60 / this.tempo / 4; // 十六分音符
    while (this.nextT < now + 0.14) { this._tick(this.step, this.nextT, spb); this.nextT += spb; this.step++; }
  }
  _tick(step, t, spb) {
    const B = this.musicBus, s16 = step % 16, bar = Math.floor(step / 16), I = this.menu ? 0.25 : this.intensity, fever = this.fever > 0.5;
    if (s16 === 0 && bar % 16 === 0 && bar > 0) this._newSong();
    const root = this.prog[bar % 4], key = this.key + (fever ? 2 : 0), ch = this._chord(root);
    const swing = (s16 % 2) ? spb * 0.14 : 0; t += swing;
    // 垫音：每小节一次
    if (s16 === 0) {
      for (let i = 0; i < 3; i++) { const f = midi(key + 12 + root + ch[i]); this._osc('sawtooth', f, t, spb * 16.5, 0.028, B, { a: 0.5, hold: true, rel: 0.6, lp: 500 + I * 900, detune: (i - 1) * 7, rev: 0.5 }); this._osc('triangle', f * 2, t, spb * 16.5, 0.012, B, { a: 0.8, hold: true, rel: 0.6, rev: 0.6 }); }
    }
    // 贝斯
    const bassPat = I > 0.6 ? [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0] : [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0];
    if (bassPat[s16] && (!this.menu || s16 === 0)) { const oct = (s16 === 6 || s16 === 13) ? 12 : 0; this._osc('triangle', midi(key - 12 + root + oct), t, spb * 3.2, 0.2, B, { a: 0.008, lp: 700 }); this._osc('sine', midi(key - 12 + root + oct), t, spb * 3.2, 0.14, B, { a: 0.008 }); }
    // 拨弦琶音
    const arpOn = this.menu ? (s16 % 4 === 0) : (I > 0.7 ? true : s16 % 2 === 0);
    if (arpOn) { const idx = [0, 1, 2, 3, 2, 1, 2, 3][(step >> (I > 0.7 ? 0 : 1)) % 8]; const n = key + 24 + root + ch[idx] + (s16 % 8 === 6 ? 12 : 0); this._osc('triangle', midi(n), t, spb * 2.6, 0.075 * (0.6 + I * 0.5), B, { a: 0.003, lp: 3200, lpTo: 600, rev: 0.25, dly: 0.35 }); }
    // 旋律
    if ((I > 0.35 || this.menu) && s16 % 2 === 0 && (bar % 4 < 3 || fever)) {
      const d = this.motif[(s16 / 2 + (bar % 2) * 8) % 16];
      if (d >= 0) { const oct = Math.floor(d / 5), n = key + 36 + PENTA[((d % 5) + 5) % 5] + oct * 12; this._osc('square', midi(n), t, spb * (this.menu ? 5 : 2.8), 0.03, B, { a: 0.01, lp: 2400, vib: 5.5, vibD: 5, rev: 0.4, dly: 0.5 }); this._osc('sine', midi(n), t, spb * 3, 0.05, B, { a: 0.01, rev: 0.3 }); }
    }
    if (this.menu) return;
    // 鼓
    const kick = I > 0.75 ? s16 % 4 === 0 : (s16 === 0 || s16 === 8 || (I > 0.5 && s16 === 10));
    if (kick && I > 0.2) { this._osc('sine', 140, t, 0.22, 0.5, B, { to: 42, toT: 0.12, a: 0.002 }); this._noise(t, 0.02, 0.1, 'lowpass', 1800, B); }
    if ((s16 === 4 || s16 === 12) && I > 0.45) { this._noise(t, 0.16, 0.2, 'bandpass', 1900, B, { q: 0.9, rev: 0.25 }); this._osc('triangle', 210, t, 0.09, 0.1, B, { to: 150 }); }
    const hat = I > 0.6 ? true : s16 % 2 === 0;
    if (hat && I > 0.12) this._noise(t, s16 % 4 === 2 ? 0.07 : 0.03, 0.045 * (s16 % 4 === 2 ? 1.3 : 1) * (0.5 + I * 0.6), 'highpass', 7500, B);
    if (fever && s16 % 4 === 2) this._osc('sine', midi(key + 48 + ch[(step >> 2) % 3]), t, 0.25, 0.05, B, { rev: 0.5, dly: 0.5 });
  }

  // ---------- 音效 ----------
  get T() { return this.ctx.currentTime; }
  bell() { if (!this.ready) return; const t = this.T; for (const [f, v, d] of [[2093, 0.22, 1.3], [3140, 0.12, 0.9], [4186, 0.07, 0.6], [5274, 0.05, 0.4]]) this._osc('sine', f, t, d, v, null, { rev: 0.35 }); this._osc('sine', 2093, t + 0.16, 1.2, 0.16, null, { rev: 0.35 }); this._osc('sine', 3140, t + 0.16, 0.8, 0.08); this._noise(t, 0.012, 0.12, 'highpass', 6000); }
  honk() { if (!this.ready) return; const t = this.T;
    for (let i = 0; i < 2; i++) { const tt = t + i * 0.23; this._osc('sawtooth', 300, tt, 0.2, 0.2, null, { to: 190, a: 0.012, lp: 1700, q: 5, vib: 34, vibD: 26, rev: 0.2 }); this._osc('square', 610, tt, 0.18, 0.06, null, { to: 380, lp: 2400, q: 4 }); this._noise(tt, 0.18, 0.06, 'bandpass', 1500, null, { q: 2 }); } }
  fish(step = 0) { if (!this.ready) return; const t = this.T, n = 74 + PENTA[step % 5] + Math.min(2, Math.floor(step / 5)) * 12; this._osc('triangle', midi(n), t, 0.22, 0.2, null, { a: 0.002, rev: 0.25 }); this._osc('sine', midi(n + 12), t + 0.03, 0.2, 0.08, null, { rev: 0.3 }); this._noise(t, 0.04, 0.06, 'bandpass', 2600, null, { q: 2 }); }
  gold() { if (!this.ready) return; const t = this.T; [88, 93, 95, 100].forEach((n, i) => this._osc('triangle', midi(n), t + i * 0.055, 0.4, 0.15, null, { rev: 0.4, dly: 0.2 })); this._osc('sine', midi(100), t + 0.2, 0.6, 0.1, null, { rev: 0.5 }); }
  ring() { if (!this.ready) return; const t = this.T; [81, 86, 93].forEach((n, i) => this._osc('sine', midi(n), t + i * 0.04, 0.5, 0.14, null, { rev: 0.5 })); }
  jump() { if (!this.ready) return; const t = this.T; this._osc('sine', 260, t, 0.2, 0.2, null, { to: 620, a: 0.005 }); this._noise(t, 0.16, 0.08, 'bandpass', 900, null, { to: 2400, q: 1 }); }
  flap() { if (!this.ready) return; const t = this.T; this._noise(t, 0.2, 0.2, 'lowpass', 700, null, { to: 200, a: 0.02 }); this._noise(t + 0.02, 0.1, 0.08, 'bandpass', 1500, null, { q: 1 }); }
  land(hard = 0.5) { if (!this.ready) return; const t = this.T; this._osc('sine', 110, t, 0.16, 0.25 + hard * 0.2, null, { to: 50 }); this._noise(t, 0.08, 0.1 + hard * 0.1, 'lowpass', 900); }
  trick(n = 0) { if (!this.ready) return; const t = this.T; [79, 83, 86, 91].slice(0, 3 + Math.min(1, n)).forEach((m, i) => this._osc('square', midi(m + n * 2), t + i * 0.05, 0.16, 0.07, null, { lp: 3000, rev: 0.3 })); this._noise(t, 0.3, 0.07, 'bandpass', 600, null, { to: 3600, q: 1.5 }); }
  perfect() { if (!this.ready) return; const t = this.T; [84, 88, 91, 96].forEach((m, i) => this._osc('triangle', midi(m), t + i * 0.045, 0.35, 0.13, null, { rev: 0.45 })); }
  near() { if (!this.ready) return; const t = this.T; this._noise(t, 0.22, 0.16, 'bandpass', 2400, null, { to: 500, q: 1.2 }); this._osc('sine', 1200, t, 0.12, 0.05, null, { to: 700 }); }
  crash() { if (!this.ready) return; const t = this.T; this._noise(t, 0.4, 0.5, 'lowpass', 2200, null, { to: 180 }); this._osc('sawtooth', 190, t, 0.3, 0.25, null, { to: 55, lp: 900 }); for (let i = 0; i < 4; i++) this._osc('sine', 1700 + Math.random() * 1600, t + 0.05 + i * 0.07, 0.12, 0.07); this._noise(t + 0.12, 0.25, 0.2, 'bandpass', 3800, null, { q: 2 }); }
  smash() { if (!this.ready) return; const t = this.T; this._noise(t, 0.2, 0.36, 'bandpass', 1300, null, { to: 300, q: 0.8 }); this._osc('square', 170, t, 0.12, 0.14, null, { to: 70, lp: 1200 }); }
  splash() { if (!this.ready) return; const t = this.T; this._noise(t, 0.4, 0.2, 'bandpass', 1700, null, { to: 500, q: 0.7, a: 0.01 }); this._noise(t + 0.03, 0.25, 0.1, 'highpass', 4200); }
  bigSplash() { if (!this.ready) return; const t = this.T; this._noise(t, 1.6, 0.4, 'lowpass', 1300, null, { to: 240, a: 0.03, rev: 0.4 }); this._noise(t + 0.1, 1.0, 0.16, 'highpass', 3000, null, { a: 0.05 }); }
  whale() { if (!this.ready) return; const t = this.T; this._osc('sine', 150, t, 2.2, 0.2, null, { to: 300, toT: 1.2, a: 0.3, vib: 4, vibD: 9, rev: 0.8, hold: true, rel: 0.8 }); this._osc('sine', 300, t + 0.5, 1.8, 0.07, null, { to: 520, toT: 1.0, a: 0.3, rev: 0.8, hold: true, rel: 0.8 }); }
  power() { if (!this.ready) return; const t = this.T; [72, 76, 79, 84, 88].forEach((m, i) => this._osc('square', midi(m), t + i * 0.05, 0.2, 0.08, null, { lp: 3600, rev: 0.3 })); }
  boost() { if (!this.ready) return; const t = this.T; this._noise(t, 0.7, 0.25, 'bandpass', 400, null, { to: 3600, q: 1.5, a: 0.02 }); this._osc('sawtooth', 120, t, 0.6, 0.12, null, { to: 520, lp: 1800 }); }
  hurt() { if (!this.ready) return; const t = this.T; this._osc('square', 440, t, 0.14, 0.14, null, { to: 220, lp: 1800 }); this._osc('square', 330, t + 0.12, 0.2, 0.14, null, { to: 140, lp: 1500 }); }
  slip() { if (!this.ready) return; const t = this.T; this._osc('sine', 900, t, 0.3, 0.12, null, { to: 300, vib: 18, vibD: 60 }); this.splash(); }
  gull() { if (!this.ready) return; const t = this.T; for (let i = 0; i < 3; i++) this._osc('sawtooth', 1500, t + i * 0.16, 0.14, 0.07, null, { to: 950, lp: 3800, q: 6, a: 0.01, rev: 0.4 }); }
  crab() { if (!this.ready) return; const t = this.T; for (let i = 0; i < 5; i++) this._noise(t + i * 0.035, 0.02, 0.12, 'bandpass', 3400, null, { q: 5 }); }
  kick() { if (!this.ready) return; const t = this.T; this._osc('sine', 300, t, 0.2, 0.25, null, { to: 520, toT: 0.05 }); this._noise(t, 0.05, 0.12, 'lowpass', 1500); }
  feverSfx() { if (!this.ready) return; const t = this.T; [72, 76, 79, 84, 88, 91, 96].forEach((m, i) => this._osc('sawtooth', midi(m), t + i * 0.06, 0.4, 0.07, null, { lp: 3200, rev: 0.5, dly: 0.4 })); this._noise(t, 1.0, 0.1, 'bandpass', 500, null, { to: 6000, q: 1.5, a: 0.05 }); }
  zone() { if (!this.ready) return; const t = this.T; [76, 79, 83, 88].forEach((m, i) => this._osc('sine', midi(m), t + i * 0.09, 0.9, 0.09, null, { rev: 0.7 })); }
  ach() { if (!this.ready) return; const t = this.T; [79, 84, 88, 91].forEach((m, i) => this._osc('triangle', midi(m), t + i * 0.08, 0.5, 0.13, null, { rev: 0.5 })); }
  ui() { if (!this.ready) return; const t = this.T; this._osc('sine', 880, t, 0.07, 0.09); this._osc('sine', 1320, t + 0.03, 0.07, 0.06); }
  buy() { if (!this.ready) return; const t = this.T; [88, 91, 96].forEach((m, i) => this._osc('triangle', midi(m), t + i * 0.05, 0.3, 0.13, null, { rev: 0.4 })); this._noise(t, 0.05, 0.1, 'highpass', 6000); }
  deny() { if (!this.ready) return; const t = this.T; this._osc('square', 200, t, 0.12, 0.1, null, { lp: 900 }); this._osc('square', 160, t + 0.1, 0.16, 0.1, null, { lp: 900 }); }
  thunder() { if (!this.ready) return; const t = this.T; this._noise(t, 2.6, 0.6, 'lowpass', 500, null, { to: 70, a: 0.02, rev: 0.7 }); this._noise(t, 0.2, 0.3, 'bandpass', 2400, null, { q: 0.6 }); }
  firework() { if (!this.ready) return; const t = this.T; this._noise(t, 0.9, 0.3, 'lowpass', 2600, null, { to: 240, rev: 0.6 }); for (let i = 0; i < 6; i++) this._noise(t + 0.15 + Math.random() * 0.6, 0.03, 0.06, 'highpass', 5000); }
  over() { if (!this.ready) return; const t = this.T; [76, 72, 69, 64].forEach((m, i) => this._osc('triangle', midi(m), t + i * 0.2, 0.7, 0.16, null, { rev: 0.6 })); }
  record() { if (!this.ready) return; const t = this.T; [72, 76, 79, 84, 79, 84, 88, 96].forEach((m, i) => this._osc('square', midi(m), t + i * 0.09, 0.3, 0.08, null, { lp: 3600, rev: 0.5 })); }
}
