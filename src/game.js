// 玩法核心：骑行物理、跳跃/滑翔/特技、连击与狂热、道具、碰撞、任务成就、天气事件、自动驾驶
import * as THREE from 'three';
import { clamp, lerp, damp, smooth, easeInOut, easeOutCubic, makeRng, hashStr, todayKey, TAU } from './util.js';
import { LANES, ROAD_HALF, DIFFICULTY, ZONES } from './track.js';
import { ACHIEVEMENTS, MISSIONS, UPGRADES } from './data.js';

const PI = Math.PI;
const G = 21, JUMP_V = 8.4, FLAP_V = 7.4, LAT_MAX = ROAD_HALF - 0.6;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const TRICKS = {
  backflip: { name: '后空翻', dur: 0.72, score: 150, key: 'backflips' },
  spin: { name: '360° 转体', dur: 0.6, score: 120, key: 'spins' },
  superman: { name: '超人式', dur: 0.78, score: 180, key: 'supermans' },
};
const POWER_NAME = { magnet: '磁铁', shield: '泡泡护盾', x2: '双倍得分', chili: '魔鬼辣椒', heart: '爱心' };

export class Game {
  constructor(c) {
    Object.assign(this, c); // track, world, entities, pelican, fx, audio, input, save, ui, sky, ambient, cam, gfx, ocean
    this.state = 'title'; this.mode = 'adventure';
    this.timeScale = 1; this.hitStop = 0; this.time = 0;
    this.auto = true;
    this.weather = { rain: 0, target: 0, t: 0, flashT: 8, rainbowT: 0, auroraT: 0 };
    this.p = this._newPlayer();
    this.R = this._newStats();
    this.out = { x: 0, y: 0, yaw: 0, lean: 0, pitch: 0, speed: 0, cadence: 0, steer: 0, wing: 0, stand: 0, wheelie: 0, flipX: 0, flipY: 0, roll: 0, superman: 0, brake: false, night: 0, fish: 0, lookAt: null, happy: 0 };
    this.look = new THREE.Vector3(); this.checkT = 0;
    this.entities.onSplash = (x, y, z) => { this.fx.splash(x, y, z, 10); };
  }

  _newPlayer() {
    const up = this.save.d.up;
    const maxHearts = 3 + up.helmet;
    return {
      dist: 0, lat: 0, latV: 0, y: 0, vy: 0, speed: 0, grounded: true, onRamp: false, rampY: 0,
      flaps: 1, glideT: 0, gliding: false, airT: 0, airTricks: 0, lastTrick: '', trick: null,
      wheelie: false, wheelieT: 0, wheelieA: 0,
      boost: 30, boosting: false, forceBoost: 0,
      hearts: maxHearts, maxHearts, invuln: 0, crashT: 0, slipT: 0,
      combo: 0, comboT: 0, comboMax: 3.0 + up.appetite * 0.6, mult: 1, fever: 0, feverT: 0, feverSpawn: 0,
      magnetT: 0, shield: false, x2T: 0,
      score: 0, fish: 0, landSquash: 0, bellCd: 0, honkCd: 0, summonCd: 0, gulpCd: 0,
      zoneKey: 'coast', nextKm: 1000, noHitFrom: 0, revived: false,
      thief: null, thiefCd: 30, banked: 0,
    };
  }
  _newStats() {
    return { fish: 0, gold: 0, dist: 0, tricks: 0, backflips: 0, spins: 0, supermans: 0, maxAirTricks: 0, wheelieMax: 0, near: 0, maxCombo: 0, fevers: 0, smash: 0, rings: 0, gulls: 0, crabs: 0, kicks: 0,
      maxSpeed: 0, noHit: 0, zones: 1, zoneSet: { coast: 1 }, night: false, rain: false, rainbow: false, whale: false, aurora: false, score: 0, perfect: 0, jumps: 0, hits: 0, powers: 0 };
  }

  // ---------- 流程 ----------
  // 标题画面的演示骑行
  attract() {
    this.state = 'title'; this.mode = 'zen';
    this._begin((Math.random() * 1e9) | 0, 'zen');
    this.auto = true; this.p.speed = 7;
    this.cam.set('title');
  }
  start(mode) {
    this.mode = mode; this.state = 'play';
    const seed = mode === 'daily' ? hashStr('pelican-daily-' + todayKey()) : (Math.random() * 1e9) | 0;
    // 上一局完成的任务在此换新
    const d = this.save.d; d.missions = d.missions.filter(m => !m.done); while (d.missions.length < 3) this.save.addMission();
    this._begin(seed, mode);
    this.auto = false;
    this.cam.set(mode === 'zen' ? 'chase' : 'chase');
    this.ui.onStart(mode);
    this.audio.zone();
    this.p.speed = 5;
  }
  _begin(seed, mode) {
    this.track.reset(seed);
    this.world.setTrack(this.track);
    this.entities.reset(this.track, seed, mode);
    this.ambient.reset(this.track);
    this.fx.clear();
    this.p = this._newPlayer();
    this.R = this._newStats();
    this.pelican.scarfReset = true; this.pelican.setVisible(true);
    this.timeScale = 1; this.hitStop = 0;
    this.missionBase = this.save.d.missions.map(m => m.prog);
    this.bank = { fish: 0, gold: 0, dist: 0, tricks: 0, runs: 0 };
    this.weather.target = 0; this.weather.t = 0;
    this.needWarm = true;
  }
  pause(on) {
    if (on && this.state === 'play') { this.state = 'pause'; this.ui.show('pause'); this.audio.suspend(false); }
    else if (!on && this.state === 'pause') { this.state = 'play'; this.ui.show(null); }
  }
  // 结束本局并结算。how: 'results' 显示结算 / 'title' 回主菜单 / 'silent' 仅存档
  finish(how = 'results') {
    const p = this.p, R = this.R, d = this.save.d, B = this.bank;
    if (this.state === 'title' || this.state === 'garage') return;
    R.score = Math.floor(p.score); R.dist = Math.floor(p.dist);
    this._checkProgress(true);
    d.fish += p.fish; p.banked += p.fish; p.fish = 0;
    d.total.fish += R.fish - B.fish; d.total.gold += R.gold - B.gold; d.total.dist += R.dist - B.dist; d.total.tricks += R.tricks - B.tricks;
    if (!B.runs) { d.total.runs++; B.runs = 1; }
    B.fish = R.fish; B.gold = R.gold; B.dist = R.dist; B.tricks = R.tricks;
    const key = this.mode === 'daily' ? 'daily' : 'adventure';
    let record = false;
    if (this.mode !== 'zen' && R.score > d.best[key]) { record = d.best[key] > 0 || R.score > 500; d.best[key] = R.score; }
    if (R.dist > d.best.dist) d.best.dist = R.dist;
    this.save.flush();
    this.lastResult = { score: R.score, dist: R.dist, fish: p.banked, R, record, best: d.best[key], mode: this.mode, doneM: d.missions.filter(m => m.done) };
    this.ui.warn(null);
    if (how === 'silent') return;
    if (how === 'title') { this.attract(); this.ui.show('title'); return; }
    this.state = 'over'; this.timeScale = 1;
    this.ui.showResults(this.lastResult);
    if (record) { this.audio.record(); this.ambient.fireworks(8); } else this.audio.over();
  }
  revive() {
    const p = this.p, cost = 80, d = this.save.d;
    if (p.revived || d.fish < cost || this.state !== 'over') return false;
    d.fish -= cost; this.save.flush();
    p.revived = true; p.hearts = Math.min(2, p.maxHearts); p.invuln = 3.2; p.crashT = 0; p.speed = 6; p.boost = Math.max(p.boost, 50);
    this.state = 'play'; this.timeScale = 1; this.ui.show(null); this.pelican.setVisible(true);
    this.fx.sparkle(this.out.x, this.out.y + 1.2, -p.dist, 0xff9ac0, 24);
    this.audio.power();
    return true;
  }

  // ---------- 计分 ----------
  _mult() { const p = this.p; return p.mult * (p.x2T > 0 ? 2 : 1) * (p.feverT > 0 ? 2 : 1); }
  addScore(base, label, cls, at) {
    const p = this.p, g = Math.round(base * this._mult());
    p.score += g;
    if (label !== false) this.ui.pop((label ? label + ' ' : '') + '+' + g, at || this._headPos(), cls);
    return g;
  }
  _headPos() { return _w.set(this.out.x, this.out.y + 2.3, 0); }
  combo(n = 1, fever = 0) {
    const p = this.p;
    p.combo += n; p.comboT = p.comboMax; p.mult = 1 + Math.min(8, Math.floor(p.combo / 5)) * 0.25;
    if (p.combo > this.R.maxCombo) this.R.maxCombo = p.combo;
    if (p.feverT <= 0 && this.state === 'play' && this.mode !== 'zen') { p.fever = Math.min(100, p.fever + fever); if (p.fever >= 100) this._startFever(); }
  }
  _startFever() {
    const p = this.p; p.feverT = 8; p.fever = 100; p.feverSpawn = 0; this.R.fevers++;
    this.audio.feverSfx(); this.ui.toast('🎉', '鱼群狂热！', '下鱼雨啦 · 得分 ×2'); this.cam.shake(0.3);
    this.fx.sparkle(this.out.x, this.out.y + 1.5, -p.dist, 0xff8ad0, 30);
    this.entities.spawnFlying(p.dist + 18, 7, 0.3);
  }

  // ---------- 每帧 ----------
  update(rawDt) {
    this.time += rawDt;
    const st = this.state;
    if (st === 'pause') return 0;
    // 顿帧 / 慢动作
    if (this.hitStop > 0) { this.hitStop -= rawDt; return 0; }
    const dt = rawDt * this.timeScale;
    const p = this.p, inp = this.input, tr = this.track, R = this.R;
    const playing = st === 'play', demo = st === 'title' || st === 'garage';
    const zen = this.mode === 'zen';
    const autopilot = demo || this.forceAuto || (playing && zen && this.auto && inp.idle > 7);

    // --- 输入 ---
    let steer = 0, throttle = 0, jumpP = false, jumpH = false, trickP = false, trickH = false, boostH = false, bellP = false, honkP = false;
    if (playing && !autopilot) {
      steer = inp.steer; throttle = inp.throttle; jumpP = inp.take('jump'); jumpH = inp.held('jump'); trickP = inp.take('trick'); trickH = inp.held('trick'); boostH = inp.held('boost');
      bellP = inp.take('bell'); honkP = inp.take('honk');
    } else if (autopilot) {
      const a = this._autopilot(dt); steer = a.steer; jumpP = a.jump; jumpH = a.glide; trickP = a.trick; bellP = a.bell; honkP = a.honk; boostH = a.boost;
      if (playing) { bellP = bellP || inp.take('bell'); honkP = honkP || inp.take('honk'); }
    }
    if (st === 'dying' || st === 'over') { steer = 0; }
    const locked = p.crashT > 0.25 || st === 'dying' || st === 'over';

    // --- 速度 ---
    const d = DIFFICULTY(p.dist);
    const cruise = zen ? (demo ? 7.5 : 9) : lerp(9.2, 14.8, d);
    if (playing && boostH && !p.boosting && p.boost >= 12 && !locked) { p.boosting = true; this.audio.boost(); this.cam.shake(0.2); }
    if (p.boosting) {
      if (p.forceBoost > 0) p.forceBoost -= dt; else { p.boost -= 27 * (1 - this.save.d.up.chili * 0.15) * dt; if (!boostH || p.boost <= 0) p.boosting = false; }
      p.boost = Math.max(0, p.boost);
    }
    let target = cruise * (throttle > 0 ? 1.28 : throttle < 0 ? 0.48 : 1);
    if (p.boosting) target = cruise * 1.65 + 3;
    if (p.feverT > 0) target *= 1.08;
    target -= clamp(tr.dcy(p.dist), -0.25, 0.25) * 13;
    if (p.slipT > 0) target *= 0.8;
    if (p.crashT > 0) target = Math.min(target, 3.5);
    if (st === 'dying' || st === 'over') target = 0;
    p.speed = damp(p.speed, target, target < p.speed ? (throttle < 0 ? 2.6 : 1.4) : p.boosting ? 3.4 : 1.25, dt);
    p.dist += p.speed * dt;
    const kmh = p.speed * 3.6; if (kmh > R.maxSpeed) R.maxSpeed = kmh;

    // --- 转向 ---
    const ctrl = locked ? 0 : (p.grounded ? 1 : 0.72) * (p.wheelie ? 0.6 : 1);
    let tv = steer * (5.4 + p.speed * 0.17) * ctrl;
    if (p.slipT > 0) tv += Math.sin(this.time * 15) * 3.4 * Math.min(1, p.slipT * 2);
    p.latV = damp(p.latV, tv, p.grounded ? 11 : 5.5, dt);
    p.lat += p.latV * dt;
    if (Math.abs(p.lat) > LAT_MAX) { p.lat = clamp(p.lat, -LAT_MAX, LAT_MAX); p.latV *= 0.2; }

    // --- 跳跃 / 扑翅 / 滑翔 ---
    if (jumpP && !locked) {
      if (p.grounded) {
        p.vy = JUMP_V + (p.onRamp ? 2 : 0); p.grounded = false; p.flaps = 1; p.airT = 0; p.airTricks = 0; p.lastTrick = ''; p.glideT = 0;
        R.jumps++; this.audio.jump(); this.fx.dust(this.out.x, tr.cy(p.dist), -p.dist, 6);
      } else if (p.flaps > 0 && !p.trick) {
        p.flaps--; p.vy = Math.max(p.vy, 0) * 0.35 + FLAP_V; this.pelican.doFlap(); this.audio.flap();
        this.fx.feathers(this.out.x, this.out.y + 1.2, -p.dist, 5);
      }
    }
    p.onRamp = false;
    if (!p.grounded) {
      p.gliding = jumpH && p.vy < 0 && p.glideT < 1.6 && !p.trick && !locked;
      const g = p.gliding ? 4.2 : G;
      p.vy -= g * dt; if (p.gliding) { p.vy = Math.max(p.vy, -2.3); p.glideT += dt; }
      p.y += p.vy * dt; p.airT += dt;
      if (p.y <= 0 && p.vy < 0) this._land();
    } else p.gliding = false;

    // --- 特技 ---
    if (trickP && !locked && !p.grounded && !p.trick && p.airT > 0.06) {
      const type = inp.held('up') && !autopilot ? 'superman' : (Math.abs(steer) > 0.3 ? 'spin' : (autopilot ? ['backflip', 'spin', 'superman'][(Math.random() * 3) | 0] : 'backflip'));
      p.trick = { type, t: 0, dir: steer < 0 ? -1 : 1, T: TRICKS[type] };
      this.audio.flap();
    }
    if (p.trick) {
      const tk = p.trick; tk.t += dt / tk.T.dur;
      if (tk.t >= 1) this._trickDone(tk, 1);
    }
    const wantWheelie = trickH && p.grounded && !locked && !p.trick && p.speed > 4;
    if (wantWheelie) {
      if (!p.wheelie) { p.wheelie = true; p.wheelieT = 0; }
      p.wheelieT += dt; p.score += 16 * dt * this._mult(); p.boost = Math.min(100, p.boost + 7 * dt);
      if (p.wheelieT > R.wheelieMax) R.wheelieMax = p.wheelieT;
      if (Math.floor(p.wheelieT) > Math.floor(p.wheelieT - dt)) { this.combo(1, 3); this.ui.pop('翘头 ' + Math.floor(p.wheelieT) + 's', this._headPos(), 'trick'); }
    } else p.wheelie = false;
    p.wheelieA = damp(p.wheelieA, p.wheelie ? 0.62 : 0, p.wheelie ? 9 : 12, dt);

    // --- 计时器 ---
    p.invuln = Math.max(0, p.invuln - dt); p.crashT = Math.max(0, p.crashT - dt); p.slipT = Math.max(0, p.slipT - dt);
    p.magnetT = Math.max(0, p.magnetT - dt); p.x2T = Math.max(0, p.x2T - dt);
    p.bellCd -= dt; p.honkCd -= dt; p.summonCd -= dt; p.gulpCd -= dt; p.landSquash = Math.max(0, p.landSquash - dt * 4);
    if (p.comboT > 0) { p.comboT -= dt; if (p.comboT <= 0) { p.combo = 0; p.mult = 1; } }
    else if (p.feverT <= 0) p.fever = Math.max(0, p.fever - 3.5 * dt);
    if (p.feverT > 0) {
      p.feverT -= dt; p.fever = (p.feverT / 8) * 100;
      p.feverSpawn -= dt;
      if (p.feverSpawn <= 0) { p.feverSpawn = 0.6; if (Math.random() < 0.3) this.entities.spawnFlying(p.dist + 20 + p.speed, 4, 0.25); else this.entities.spawnRain(p.dist + 24 + p.speed * 1.2 + Math.random() * 8); }
      if (p.feverT <= 0) { p.fever = 0; this.ui.toast('😌', '狂热结束', '继续保持连击'); }
    }
    if (playing) p.score += p.speed * dt * (p.feverT > 0 ? 2 : 1) * (p.x2T > 0 ? 2 : 1);

    // --- 铃 / 大叫 ---
    if (bellP && p.bellCd <= 0) this._bell();
    if (honkP && p.honkCd <= 0) this._honk();

    // --- 关卡生成与实体交互 ---
    this.entities.ctx.hearts = p.hearts; this.entities.ctx.maxHearts = p.maxHearts; this.entities.ctx.shield = p.shield; this.entities.ctx.rain = this.weather.rain;
    this.entities.ctx.goldBoost = this.save.d.up.radar;
    this.entities.generate(p.dist + 300);
    if (st !== 'over') this._interact(dt, playing || demo);
    if (p.grounded && !p.onRamp && p.y > 0.001) { p.grounded = false; p.vy = Math.min(p.vy, 0); p.flaps = 1; p.airT = 0; p.airTricks = 0; p.glideT = 0; } // 从跳台侧面骑出去：自然落下
    if (playing && !zen) this._thief(dt, bellP);

    // --- 路段 / 里程碑 / 天气 ---
    const zk = tr.zoneAt(p.dist).key;
    if (zk !== p.zoneKey) {
      p.zoneKey = zk;
      if (playing) {
        if (!R.zoneSet[zk]) { R.zoneSet[zk] = 1; R.zones++; }
        const Z = ZONES[zk]; this.ui.zoneBanner(Z); this.audio.zone();
        if (!zen) this.addScore(200, '抵达' + Z.name, 'bonus');
        this._rollWeather();
      }
    }
    if (playing && p.dist >= p.nextKm) {
      const km = p.nextKm / 1000; p.nextKm += 1000;
      this.ui.toast('🚩', `${km} 公里！`, zen ? '海风正好' : `里程奖励 +${500 * km}`); if (!zen) p.score += 500 * km;
      this.ambient.fireworks(this.sky.night > 0.5 ? 7 : 3); this.audio.ach();
    }
    this._weather(dt, playing);
    R.dist = p.dist; R.score = p.score; R.noHit = Math.max(R.noHit, p.dist - p.noHitFrom);
    if (this.sky.night > 0.85 && playing) R.night = true;

    // --- 濒死 → 结算 ---
    if (st === 'dying') { this.dyingT += rawDt; this.timeScale = lerp(0.25, 0.6, clamp(this.dyingT / 1.4)); if (this.dyingT > 1.7) { this.timeScale = 1; this.finish(); } }

    // --- 任务 / 成就（低频）---
    if (playing) { this.checkT -= rawDt; if (this.checkT <= 0) { this.checkT = 0.5; this._checkProgress(false); } }

    this._pose(dt, steer, throttle, autopilot);
    this._trail(dt);
    return dt;
  }

  // ---------- 落地 / 特技 ----------
  _land() {
    const p = this.p, R = this.R, impact = clamp(-p.vy / 14);
    p.y = 0; p.vy = 0; p.grounded = true; p.glideT = 0; p.gliding = false; p.landSquash = 1;
    const x = this.out.x, gy = this.track.cy(p.dist), z = -p.dist;
    this.fx.dust(x, gy, z, 6 + impact * 10); this.audio.land(impact); this.cam.shake(impact * 0.25);
    if (p.trick) {
      const tk = p.trick;
      if (tk.t < 0.55 && this.state === 'play') { p.trick = null; this._crash(null, '特技失败'); return; }
      this._trickDone(tk, 0.5); this.ui.pop('勉强落地', this._headPos(), 'warn');
    } else if (p.airTricks > 0 && this.state === 'play') {
      const n = p.airTricks;
      this.addScore(60 * n, n > 1 ? `完美落地 ×${n}` : '完美落地', 'perfect'); p.boost = Math.min(100, p.boost + 9 * n); this.combo(1, 6);
      R.perfect++; this.audio.perfect(); this.fx.sparkle(x, gy + 0.3, z, 0xfff2a8, 14); p.speed += 1.2;
    }
    if (p.airTricks > R.maxAirTricks) R.maxAirTricks = p.airTricks;
    p.airTricks = 0;
  }
  _trickDone(tk, k) {
    const p = this.p, R = this.R;
    p.trick = null;
    if (this.state !== 'play') return;
    const rep = tk.type === p.lastTrick ? 0.6 : 1;
    p.airTricks++; p.lastTrick = tk.type;
    R.tricks++; R[tk.T.key]++;
    this.addScore(tk.T.score * k * rep * (1 + (p.airTricks - 1) * 0.5), tk.T.name, 'trick');
    p.boost = Math.min(100, p.boost + 16); this.combo(2, 8);
    this.audio.trick(p.airTricks - 1);
    this.fx.sparkle(this.out.x, this.out.y + 1.2, -p.dist, 0x9fe8ff, 12);
  }

  // ---------- 铃 / 大叫 ----------
  _bell() {
    const p = this.p; p.bellCd = 0.3; this.audio.bell();
    let n = 0;
    for (const e of this.entities.list) if (e.type === 'gull' && !e.custom && e.state === 0 && e.s - p.dist > -4 && e.s - p.dist < 36) { this.entities.scareGull(e); n++; }
    if (n && this.state === 'play') { this.R.gulls += n; this.addScore(20 * n, `赶走海鸥 ×${n}`, 'bonus'); this.combo(n, 2 * n); this.audio.gull(); }
    this.fx.sparkle(this.out.x - 0.2, this.out.y + 1.15, -p.dist - 0.4, 0xfff6c8, 5);
  }
  _honk() {
    const p = this.p; p.honkCd = 0.7; this.audio.honk(); this.pelican.honk();
    let n = 0;
    for (const e of this.entities.list) if (e.type === 'crab' && e.state === 0 && e.s - p.dist > -3 && e.s - p.dist < 34) { this.entities.scareCrab(e); n++; }
    if (n && this.state === 'play') { this.R.crabs += n; this.addScore(15 * n, `吓跑螃蟹 ×${n}`, 'bonus'); this.combo(n, 2 * n); this.audio.crab(); }
    if (p.summonCd <= 0 && this.track.params(p.dist + 20, {}).bridge < 0.9) {
      p.summonCd = 7; this.entities.spawnFlying(p.dist + 15 + p.speed * 0.9, 5, 0.15 + this.save.d.up.radar * 0.05); this.audio.splash();
      if (this.state === 'play') this.ui.hintOnce('honkfish', '大叫把鱼吓出了海面，接住它们！');
    }
  }

  // ---------- 实体交互 ----------
  _interact(dt, active) {
    const p = this.p, R = this.R, tr = this.track, list = this.entities.list;
    const px = p.lat, py = p.y, ps = p.dist, play = this.state === 'play';
    let best = null, bestD = 1e9;
    const beak = this.pelican.beakWorld(_v);
    const reach = 1.12 + (p.magnetT > 0 ? 0 : 0);
    for (let i = 0; i < list.length; i++) {
      const e = list[i]; if (e.dead) continue;
      const ds = e.s - ps;
      if (ds > 60 || ds < -8) continue;
      const du = e.u - px, T = e.T;
      switch (e.kind) {
        case 'collect': case 'power': {
          if (e.pull) {
            // 吸入喙中
            e.pullT += dt * (e.kind === 'power' ? 9 : 7);
            const k = Math.min(1, e.pullT);
            const bu = beak.x - tr.cx(ps), by = beak.y - tr.cy(ps);
            e.s = lerp(e.s, ps + 0.6, k); e.u = lerp(e.u, bu, k); e.y = lerp(e.y, by, k);
            if (k >= 1) e.dead = true;
            break;
          }
          if (e.fly && e.fly.t < 0) break;
          const ey = e.obj.position.y - tr.cy(e.s);
          const dy = ey - (py + 1.25);
          const magnet = p.magnetT > 0 && e.kind === 'collect' && ds < 15 && ds > -3;
          if (magnet || (Math.abs(ds) < reach + p.speed * dt && Math.abs(du) < reach && Math.abs(dy) < 1.3)) {
            if (!active) break;
            e.pull = true; e.pullT = magnet ? -0.35 + Math.random() * 0.2 : 0; e.fly = null;
            if (e.kind === 'power') this._power(e); else this._collect(e);
          } else if (e.kind === 'collect' && ds > 0.5 && ds < 16 && Math.abs(du) < 2.2) { const dd = ds + Math.abs(du) * 2; if (dd < bestD) { bestD = dd; best = e; } }
          break;
        }
        case 'ring': {
          if (!e.passed && ds <= 0) {
            e.passed = true;
            if (active && Math.abs(du) < 1.2 && Math.abs(py + 1.15 - e.y) < 1.25) {
              e.dead = true; R.rings++; if (play) { this.addScore(100, '穿环', 'bonus'); p.boost = Math.min(100, p.boost + 14); this.combo(2, 6); }
              this.audio.ring(); this.fx.sparkle(e.obj.position.x, e.obj.position.y, e.obj.position.z, 0xffd45a, 22);
            }
          }
          break;
        }
        case 'hazard': {
          if (e.hit) break;
          const overlap = Math.abs(ds) < T.hl + 0.45 && Math.abs(du) < T.hw + 0.33;
          if (overlap && py < T.hh - 0.06 && active) {
            if (p.boosting) {
              this.entities.knock(e, p.speed * 1.3, Math.sign(du) || 1); R.smash++; this.audio.smash(); this.cam.shake(0.3);
              this.fx.smash(e.obj.position.x, e.obj.position.y + 0.5, e.obj.position.z);
              if (play) { this.addScore(30, '撞飞' + (T.name || ''), 'bonus'); this.combo(1, 3); }
            } else if (p.invuln > 0) { /* 无敌穿过 */ }
            else if (p.shield) {
              p.shield = false; p.invuln = 1.2; this.entities.knock(e, p.speed, Math.sign(du) || 1); this.audio.smash(); this.cam.shake(0.35);
              this.fx.burst('soft', this.out.x, this.out.y + 1.2, -ps, 16, { color: 0xbfefff, speed: 5, life: 0.6, size: 0.3, shape: 3, grav: 2 });
              this.ui.pop('护盾破碎', this._headPos(), 'warn');
            } else this._crash(e, '撞到' + (T.name || '障碍'));
          } else if (!e.passed && ds < -(T.hl + 0.5)) {
            e.passed = true;
            if (!play || p.crashT > 0 || p.invuln > 0.5) break;
            const gap = Math.abs(du) - (T.hw + 0.33);
            if (gap < 0 && py >= T.hh - 0.06) { this.addScore(20, '飞跃', 'bonus'); this.combo(1, 3); }
            else if (gap >= 0 && gap < 0.55 && py < T.hh + 0.3) { R.near++; this.addScore(35, '极限闪避', 'near'); p.boost = Math.min(100, p.boost + 10); this.combo(1, 5); this.audio.near(); }
          }
          break;
        }
        case 'slip': {
          if (!e.hit && Math.abs(ds) < 1.0 && Math.abs(du) < 1.05 && p.grounded && active) {
            e.hit = true; this.fx.splash(e.obj.position.x, e.obj.position.y + 0.05, e.obj.position.z, 18);
            if (!p.boosting) { p.slipT = 0.85; this.audio.slip(); if (play) this.ui.pop('打滑！', this._headPos(), 'warn'); } else this.audio.splash();
          }
          break;
        }
        case 'kick': {
          if (!e.hit && Math.abs(ds) < T.hl + 0.4 && Math.abs(du) < T.hw + 0.35 && py < T.hh && active) {
            this.entities.knock(e, p.speed * 1.5 + 4, Math.sign(du) || (Math.random() < 0.5 ? 1 : -1), 1.8); this.audio.kick(); R.kicks++;
            if (e.type === 'castle') this.fx.smash(e.obj.position.x, e.obj.position.y + 0.4, e.obj.position.z, 0xe6cf98); else this.fx.dust(e.obj.position.x, e.obj.position.y, e.obj.position.z, 6);
            if (play) { this.addScore(15, e.type === 'castle' ? '沙堡粉碎' : '砰！', 'bonus'); this.combo(1, 2); }
          }
          break;
        }
        case 'gull': {
          if (e.custom || e.state !== 0) break;
          if (Math.abs(ds) < 0.85 && Math.abs(du) < 0.75 && py < 0.7 && active) {
            this.entities.scareGull(e); this.audio.gull(); this.fx.feathers(e.obj.position.x, e.obj.position.y + 0.4, e.obj.position.z, 8);
            if (play && !p.boosting && p.invuln <= 0) { const n = Math.min(3, p.fish); if (n > 0) { p.fish -= n; this.ui.pop(`被海鸥抢走 ${n} 条鱼！`, this._headPos(), 'warn'); p.combo = 0; p.mult = 1; p.comboT = 0; } this.ui.hintOnce('gull', '按 B 响铃可以提前赶走海鸥'); }
          }
          break;
        }
        case 'ramp': {
          if (Math.abs(du) < T.hw + 0.1 && ds > -1.7 && ds < 1.7 && active) {
            const t = clamp((1.6 - ds) / 3.2), h = 0.95 * t * t;
            if (p.grounded || (p.y <= h + 0.25 && p.vy <= 0.5)) {
              p.onRamp = true; p.grounded = true; p.y = h; p.vy = 0;
              if (ds <= -1.45 && !e.hit) { // 飞出跳台
                e.hit = true; p.grounded = false; p.vy = 6.2 + p.speed * 0.42; p.flaps = 1; p.airT = 0; p.airTricks = 0; p.lastTrick = ''; p.glideT = 0;
                R.jumps++; this.audio.jump(); this.cam.shake(0.15);
                if (play) { this.ui.pop('起飞！', this._headPos(), 'trick'); this.ui.hintOnce('trick', '空中按 T 做特技（配合 ←→ / ↑ 换花样），落地前要转完！'); }
              }
            }
          } else if (e.hit && ds > 2) e.hit = false;
          break;
        }
        case 'pad': {
          if (!e.hit && Math.abs(ds) < T.hl && Math.abs(du) < T.hw && p.grounded && active) {
            e.hit = true; p.boost = Math.min(100, p.boost + 45); p.speed += 4.5; this.audio.boost(); this.cam.shake(0.15);
            if (play) { this.ui.pop('加速带！', this._headPos(), 'bonus'); this.ui.hintOnce('boost', '按住 Shift 冲刺：无敌并能撞飞障碍'); }
            this.fx.sparkle(this.out.x, this.out.y + 0.3, -ps, 0x7ff5e6, 14);
          }
          break;
        }
      }
      // 新手提示
      if (play && ds > 8 && ds < 30 && !this.save.d.seen[e.type]) {
        const tips = { gull: '前方有海鸥！按 B 响铃赶走它们', crab: '螃蟹过马路！按 H 大叫吓跑它们', ramp: '冲上跳台起飞！', barrier: '←→ 躲开路障，或者空格跳过去', cone: '←→ 转向躲避，空格跳跃', cart: '冰淇淋车太高跳不过去，绕开它', puddle: '水坑会打滑，尽量绕开', barrel: '木桶滚过来了！跳过去或躲开', ball: '沙滩球可以踢飞，有奖励', ring: '穿过金环有额外奖励：二段跳 + 按住空格滑翔' };
        if (tips[e.type]) { this.save.d.seen[e.type] = 1; this.ui.hint(tips[e.type]); }
      }
    }
    this.lookFish = best;
  }

  _collect(e) {
    const p = this.p, R = this.R, gold = e.type === 'gold';
    const play = this.state === 'play';
    if (play) {
      p.fish += gold ? 3 : 1; R.fish++; if (gold) R.gold++;
      this.addScore(gold ? 60 : 10, gold ? '金鱼' : '', gold ? 'gold' : 'fish', e.obj.position.clone().applyMatrix4(this.world.root.matrixWorld));
      this.combo(1, gold ? 5 : 1.5); p.boost = Math.min(100, p.boost + (gold ? 6 : 1.6));
    }
    if (gold) this.audio.gold(); else this.audio.fish(p.combo);
    this.fx.fishPop(e.obj.position.x, e.obj.position.y, e.obj.position.z, gold);
    if (p.gulpCd <= 0) { this.pelican.gulp(); p.gulpCd = 0.22; }
  }
  _power(e) {
    const p = this.p, up = this.save.d.up, play = this.state === 'play';
    this.audio.power(); this.R.powers++;
    this.fx.burst('soft', e.obj.position.x, e.obj.position.y, e.obj.position.z, 14, { color: 0xbfefff, speed: 4, life: 0.6, size: 0.28, shape: 3, grav: 1 });
    switch (e.type) {
      case 'magnet': p.magnetT = 9 + up.magnet * 2; break;
      case 'shield': p.shield = true; break;
      case 'x2': p.x2T = 10; break;
      case 'chili': p.boost = 100; p.boosting = true; p.forceBoost = 3.6; this.audio.boost(); this.cam.shake(0.3); break;
      case 'heart': if (p.hearts < p.maxHearts) p.hearts++; else if (play) this.addScore(200, '满血奖励', 'bonus'); break;
    }
    if (play) { this.ui.toast({ magnet: '🧲', shield: '🛡️', x2: '✖️', chili: '🌶️', heart: '❤️' }[e.type], POWER_NAME[e.type], { magnet: '鱼会自己飞过来', shield: '抵挡一次碰撞', x2: '10 秒内得分翻倍', chili: '喷火冲刺！', heart: '恢复一点生命' }[e.type]); this.combo(1, 4); }
  }

  _crash(e, why) {
    const p = this.p, R = this.R;
    if (e) { this.entities.knock(e, p.speed * 0.8, Math.sign(e.u - p.lat) || 1); }
    const x = this.out.x, y = this.out.y + 1.1, z = -p.dist;
    this.fx.feathers(x, y, z, 18); this.fx.dust(x, this.track.cy(p.dist), z, 8);
    this.audio.crash(); this.cam.shake(0.75);
    p.combo = 0; p.mult = 1; p.comboT = 0; p.boosting = false; p.trick = null; p.wheelie = false;
    if (this.mode === 'zen' || this.state !== 'play') { p.invuln = 1.2; p.speed *= 0.6; p.crashT = 0.5; this.ui.pop('哎哟！', this._headPos(), 'warn'); return; }
    p.hearts--; R.hits++; p.noHitFrom = p.dist; p.fever = Math.max(0, p.fever - 30);
    p.crashT = 0.95; p.invuln = 2.6; p.speed *= 0.3; p.vy = 5.5; p.grounded = false; p.y = Math.max(p.y, 0.05); p.flaps = 0;
    this.hitStop = 0.07; this.ui.hurt(); this.audio.hurt();
    this.ui.pop(why || '摔车！', this._headPos(), 'warn');
    if (p.hearts <= 0) { this.state = 'dying'; this.dyingT = 0; p.invuln = 99; this.ui.onDying(); }
  }

  // ---------- 抢鱼的海鸥 ----------
  _thief(dt, bellP) {
    const p = this.p;
    if (!p.thief) {
      p.thiefCd -= dt;
      if (p.thiefCd <= 0 && p.dist > 350 && p.fish >= 6 && p.grounded && p.feverT <= 0) {
        const e = this.entities.spawn('gull', p.dist - 8, p.lat + 3, 6); e.custom = true; e.state = 2;
        p.thief = { e, t: 0, phase: 0 };
        this.audio.gull(); this.ui.warn('🔔 海鸥来抢鱼了！快按 B 响铃');
      }
      return;
    }
    const th = p.thief, e = th.e; th.t += dt;
    const wg = e.obj.userData.wings, f = Math.sin(this.time * 20) * 0.8; wg[0].rotation.set(0, 0, f); wg[1].rotation.set(0, 0, -f);
    if (th.phase === 0) {
      const k = smooth(th.t / 1.0);
      e.s = p.dist + lerp(-8, 1.2, k); e.u = p.lat + lerp(3.2, 1.5, k) + Math.sin(this.time * 3) * 0.25; e.y = lerp(6, 3.0, k) + Math.sin(this.time * 5) * 0.15 + p.y;
      e.obj.rotation.y = 0.5;
      if (bellP) { th.phase = 2; th.t = 0; this.R.gulls++; this.addScore(60, '赶走小偷', 'bonus'); this.combo(2, 6); this.ui.warn(null); this.audio.gull(); }
      else if (th.t > 2.6) { th.phase = 1; th.t = 0; }
    } else if (th.phase === 1) {
      const k = clamp(th.t / 0.35);
      e.s = p.dist + lerp(1.2, 0.7, k); e.u = p.lat + lerp(1.5, 0, k); e.y = lerp(3.0, 1.15, k) + p.y;
      if (k >= 1) {
        const n = Math.min(5, p.fish); p.fish -= n; th.phase = 2; th.t = 0; this.ui.warn(null);
        if (n) { this.ui.pop(`被抢走 ${n} 条鱼！`, this._headPos(), 'warn'); this.fx.fishPop(this.out.x, this.out.y + 1.1, -p.dist - 0.6, false); }
        this.audio.gull(); p.combo = 0; p.mult = 1; p.comboT = 0;
      }
    } else {
      e.s += (p.speed + 5) * dt; e.u += 5 * dt; e.y += 6 * dt; e.obj.rotation.y = -0.9;
      if (th.t > 1.6) { e.dead = true; p.thief = null; p.thiefCd = 26 + Math.random() * 24; }
    }
    this.entities._place(e);
  }

  // ---------- 天气 ----------
  _rollWeather() {
    const w = this.weather, r = Math.random();
    const wasRain = w.target > 0.5;
    if (wasRain) { w.target = 0; if (this.sky.sunVis > 0.5) { w.rainbowT = 45; this.R.rainbow = true; this.ui.toast('🌈', '雨过天晴', '看，彩虹！'); } }
    else if (r < 0.24 && this.p.dist > 400) { w.target = 1; this.R.rain = true; this.ui.toast('🌧️', '下雨了', '路面湿滑，小心水坑'); }
    if (this.sky.night > 0.8 && Math.random() < 0.4 && w.target < 0.5) { w.auroraT = 60; this.R.aurora = true; this.ui.toast('🌌', '极光出现了', '抬头看看夜空'); }
  }
  _weather(dt, playing) {
    const w = this.weather, sky = this.sky;
    w.rain = damp(w.rain, w.target, 0.35, dt);
    sky.overcast = w.rain;
    w.rainbowT = Math.max(0, w.rainbowT - dt); sky.rainbow = damp(sky.rainbow, w.rainbowT > 0 ? 1 : 0, 0.5, dt);
    w.auroraT = Math.max(0, w.auroraT - dt); sky.aurora = damp(sky.aurora, w.auroraT > 0 ? 1 : 0, 0.4, dt);
    sky.flash = Math.max(0, sky.flash - dt * 4);
    if (w.rain > 0.7) { w.flashT -= dt; if (w.flashT <= 0) { w.flashT = 7 + Math.random() * 14; sky.flash = 1.2; this.audio.thunder(); } }
    this.world.uniforms.uWet.value = w.rain;
  }

  // ---------- 任务 / 成就 ----------
  _checkProgress(final) {
    const R = this.R, d = this.save.d, T = d.total;
    for (const a of ACHIEVEMENTS) {
      if (d.ach[a.id]) continue;
      let ok = false; try { ok = a.t(R, T); } catch (e) { ok = false; }
      if (ok) { d.ach[a.id] = Date.now(); d.fish += 40; this.ui.toast(a.e, '成就 · ' + a.n, a.d + '（+40 🐟）', 'ach'); this.audio.ach(); }
    }
    if (this.state !== 'play' && this.state !== 'dying') return;
    d.missions.forEach((m, i) => {
      if (m.done) return;
      const tpl = MISSIONS.find(t => t.id === m.id); if (!tpl) return;
      const v = R[tpl.key] || 0;
      const base = this.missionBase[i] || 0;
      m.prog = tpl.kind === 'run' ? Math.max(m.prog, Math.floor(v)) : base + Math.floor(v);
      if (tpl.kind === 'run' && final && m.prog < m.goal) m.prog = 0;
      if (m.prog >= m.goal) { m.done = true; m.prog = m.goal; d.fish += m.reward; T.missions++; this.ui.toast('📋', '任务完成', `${tpl.text(m.goal)}（+${m.reward} 🐟）`, 'ach'); this.audio.ach(); }
    });
  }

  // ---------- 自动驾驶（演示 / 悠闲模式挂机）----------
  _autopilot(dt) {
    const p = this.p, list = this.entities.list, a = this._ap || (this._ap = { lane: 1, t: 0, jumpCd: 0 });
    const out = { steer: 0, jump: false, glide: false, trick: false, bell: false, honk: false, boost: false };
    a.t -= dt; a.jumpCd -= dt;
    const score = [0, 0, 0]; let needJump = false, gull = false, crab = false, rampAhead = false;
    for (const e of list) {
      if (e.dead || e.hit) continue;
      const ds = e.s - p.dist; if (ds < -1 || ds > 30) continue;
      for (let l = 0; l < 3; l++) {
        const du = Math.abs(e.u + (e.vx || 0) * (ds / Math.max(4, p.speed)) * (e.type === 'crab' ? 1 : 0) - LANES[l]);
        if (e.kind === 'collect' && du < 1.1 && e.y < 2.2) score[l] += (e.type === 'gold' ? 4 : 1) * (1 - ds / 36);
        else if (e.kind === 'power' && du < 1.1) score[l] += 5;
        else if (e.kind === 'hazard' && du < e.T.hw + 0.95 && ds < 9 + p.speed * 0.9) score[l] -= 12 * (1 - ds / 40);
        else if (e.kind === 'slip' && du < 1.6 && ds < 14) score[l] -= 4;
        else if (e.kind === 'ramp' && du < 1 && ds < 18) { score[l] += 6; }
        else if (e.kind === 'pad' && du < 1) score[l] += 3;
      }
      const duP = Math.abs(e.u - p.lat);
      if (e.kind === 'hazard' && duP < e.T.hw + 0.55 && ds > 0.6 && ds < 1.3 + p.speed * 0.36 && e.T.hh <= 1.05) needJump = true;
      if (e.type === 'gull' && e.state === 0 && ds < 26 && ds > 4) gull = true;
      if (e.type === 'crab' && e.state === 0 && ds < 24 && ds > 4) crab = true;
      if (e.kind === 'ramp' && duP < 1 && ds < 3) rampAhead = true;
    }
    if (a.t <= 0) { a.t = 0.25; let b = a.lane; score[a.lane] += 0.6; for (let l = 0; l < 3; l++) if (score[l] > score[b] + 0.01) b = l; if (Math.abs(b - a.lane) > 1) b = 1; a.lane = b; }
    out.steer = clamp((LANES[a.lane] - p.lat) * 1.5, -1, 1);
    if (needJump && p.grounded && a.jumpCd <= 0 && !rampAhead) { out.jump = true; a.jumpCd = 0.6; }
    else if (p.grounded && a.jumpCd <= 0 && !rampAhead && Math.random() < 0.004) { out.jump = true; a.jumpCd = 2.5; }
    if (!p.grounded) { out.glide = p.vy < 0 && p.y > 1.2; if (p.y > 1.7 && p.vy > 1 && !p.trick && p.airTricks < 1 && Math.random() < 0.25) out.trick = true; }
    if (gull && p.bellCd <= 0 && Math.random() < 0.08) out.bell = true;
    if (crab && p.honkCd <= 0 && Math.random() < 0.06) out.honk = true;
    return out;
  }

  // ---------- 输出给模型的姿态 ----------
  _pose(dt, steer, throttle, autopilot) {
    const p = this.p, tr = this.track, o = this.out, st = this.state;
    const cx = tr.cx(p.dist), cy = tr.cy(p.dist);
    o.x = cx + p.lat; o.y = cy + p.y;
    const roadYaw = -Math.atan(tr.dcx(p.dist));
    let flipX = 0, flipY = 0, roll = 0, superman = 0, wing = 0;
    if (p.trick) {
      const k = easeInOut(clamp(p.trick.t));
      if (p.trick.type === 'backflip') flipX = k * TAU;
      else if (p.trick.type === 'spin') flipY = k * TAU * -p.trick.dir;
      else { superman = Math.sin(clamp(p.trick.t) * PI) > 0.2 ? 1 : 0; wing = superman; }
    }
    if (p.crashT > 0) { const k = 1 - p.crashT / 0.95; flipX = -easeOutCubic(k) * TAU; roll = Math.sin(k * PI) * 0.5; }
    if (st === 'dying' || st === 'over') { roll = damp(o.roll, 1.35, 4, dt); flipX = 0; }
    if (p.gliding) wing = 1; else if (!p.grounded && !p.trick) wing = Math.max(wing, 0.28);
    if (p.wheelie) wing = 1;
    o.yaw = roadYaw - Math.atan2(p.latV, Math.max(4, p.speed)) * 0.75;
    o.lean = damp(o.lean, -p.latV * 0.055 + (p.slipT > 0 ? Math.sin(this.time * 15) * 0.2 : 0), 10, dt);
    const slope = Math.atan(tr.dcy(p.dist));
    o.pitch = damp(o.pitch, p.grounded ? slope + (p.onRamp ? 0.45 * Math.sqrt(p.y / 0.95 + 0.01) : 0) - p.landSquash * 0.06 : slope + clamp(p.vy * 0.035, -0.4, 0.45), 12, dt);
    o.speed = p.speed;
    const coasting = !p.grounded || throttle < 0 || p.speed < 0.4 || st === 'dying' || st === 'over' || tr.dcy(p.dist) < -0.09;
    const gear = clamp(p.speed / (2.136 * 1.35), 1.5, 3.8);
    o.cadence = coasting ? 0 : p.speed / (2.136 * gear) * (p.boosting ? 1.5 : 1);
    this.coasting = coasting && p.grounded;
    o.steer = clamp(p.latV / 6, -1, 1);
    o.wing = wing; o.stand = p.boosting || (throttle > 0 && p.grounded) ? 1 : 0;
    o.wheelie = p.wheelieA; o.flipX = flipX; o.flipY = flipY; o.roll = roll; o.superman = superman;
    o.brake = throttle < 0; o.night = this.sky.night; o.fish = p.fish + p.banked; o.happy = p.feverT > 0 ? 1 : 0;
    o.y -= p.landSquash * 0.02;
    if (this.lookFish && !this.lookFish.dead) { const e = this.lookFish; o.lookAt = this.look.set(e.obj.position.x, e.obj.position.y, e.obj.position.z + p.dist); } else o.lookAt = null;
    // 无敌闪烁
    const blink = p.invuln > 0 && p.invuln < 90 && p.crashT <= 0 && Math.floor(this.time * 14) % 2 === 0;
    this.pelican.setVisible(!blink);
  }

  // 尾迹 / 冲刺火焰 / 磁铁光环等持续特效
  _trail(dt) {
    const p = this.p, o = this.out, fx = this.fx, z = -p.dist;
    this.trailAcc = (this.trailAcc || 0) + dt;
    if (this.trailAcc < 0.03) return; this.trailAcc = 0;
    const rear = this.pelican.rearWorld(_v); const rx = rear.x, ry = rear.y, rz = z + rear.z;
    if (p.boosting) {
      for (let i = 0; i < 3; i++) fx.glow.emit({ x: rx + (Math.random() - 0.5) * 0.2, y: ry + 0.25 + Math.random() * 0.3, z: rz + 0.2, vx: (Math.random() - 0.5) * 1.5, vy: 0.8 + Math.random() * 1.2, vz: p.speed * 0.7, life: 0.32, size: 0.42, size1: 0.06, r: 1.7, g: 0.5 + Math.random() * 0.6, b: 0.1, a: 0.8, drag: 1.5 });
      fx.soft.emit({ x: rx, y: ry + 0.4, z: rz + 0.3, vx: (Math.random() - 0.5), vy: 1, vz: p.speed * 0.5, life: 0.7, size: 0.4, size1: 1.3, r: 0.25, g: 0.22, b: 0.22, a: 0.3, drag: 1.2 });
      // 速度线
      fx.glow.emit({ x: o.x + (Math.random() - 0.5) * 9, y: o.y + 0.3 + Math.random() * 4, z: z - 14 - Math.random() * 10, vz: p.speed * 2.2, life: 0.35, size: 0.14, r: 1.6, g: 1.6, b: 1.8, a: 0.7 });
    }
    const trail = this.pelican.cos.trail;
    if (trail !== 'none' && p.speed > 3 && this.state !== 'over') {
      const c = { x: rx + (Math.random() - 0.5) * 0.25, y: ry + 0.15 + Math.random() * 0.35, z: rz + 0.1 };
      if (trail === 'bubble') fx.soft.emit({ ...c, vy: 0.9 + Math.random(), vx: (Math.random() - 0.5), vz: p.speed * 0.25, life: 1.3, size: 0.2 + Math.random() * 0.2, r: 0.8, g: 0.95, b: 1, a: 0.85, shape: 3, grav: -0.6, drag: 0.8 });
      else if (trail === 'spark') fx.glow.emit({ ...c, vy: 0.5 + Math.random(), vx: (Math.random() - 0.5) * 1.5, vz: p.speed * 0.3, life: 0.8, size: 0.3, size1: 0, r: 2, g: 1.7, b: 0.7, a: 1, shape: 2, rot: Math.random() * 6, spin: 6, grav: 1.5, drag: 1 });
      else if (trail === 'petal') fx.soft.emit({ ...c, vy: 1 + Math.random(), vx: (Math.random() - 0.5) * 2, vz: p.speed * 0.3, life: 1.6, size: 0.19, r: 1, g: 0.7, b: 0.82, a: 0.95, shape: 1, rot: Math.random() * 6, spin: 8, grav: 1.6, drag: 1.2, floor: this.track.cy(p.dist) + 0.03 });
      else if (trail === 'rainbow') { _c.setHSL((this.time * 0.6) % 1, 0.9, 0.6); fx.glow.emit({ ...c, y: ry + 0.3, vz: p.speed * 0.15, life: 0.9, size: 0.55, size1: 0.1, r: _c.r * 1.8, g: _c.g * 1.8, b: _c.b * 1.8, a: 0.9 }); }
      else if (trail === 'flame') fx.glow.emit({ ...c, vy: 1.2, vz: p.speed * 0.4, life: 0.5, size: 0.5, size1: 0.05, r: 2.2, g: 0.7 + Math.random() * 0.7, b: 0.1, a: 0.9, drag: 1 });
    }
    if (p.feverT > 0) { _c.setHSL(Math.random(), 0.9, 0.62); fx.glow.emit({ x: o.x + (Math.random() - 0.5) * 1.6, y: o.y + Math.random() * 2.2, z: z + (Math.random() - 0.5), vy: 1.5, vz: p.speed * 0.4, life: 0.7, size: 0.3, size1: 0, r: _c.r * 2, g: _c.g * 2, b: _c.b * 2, a: 1, shape: 2, spin: 5 }); }
    if (p.magnetT > 0 && Math.random() < 0.5) { const a = Math.random() * TAU; fx.glow.emit({ x: o.x + Math.cos(a) * 1.5, y: o.y + 1.2 + Math.sin(a) * 1.5, z, vx: -Math.cos(a) * 3, vy: -Math.sin(a) * 3, vz: 0, life: 0.45, size: 0.2, r: 2, g: 0.5, b: 0.5, a: 0.9 }); }
    if (p.slipT > 0) fx.splash(rx, ry, rz, 2);
    if (this.weather.rain > 0.4 && p.grounded && p.speed > 5 && Math.random() < 0.6) fx.soft.emit({ x: rx, y: ry + 0.1, z: rz + 0.2, vx: (Math.random() - 0.5) * 1.5, vy: 1.5 + Math.random() * 1.5, vz: p.speed * 0.5, life: 0.5, size: 0.14, r: 0.85, g: 0.92, b: 1, a: 0.6, grav: 9 });
  }
}
const _c = new THREE.Color();
