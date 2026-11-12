// 界面：标题 / HUD / 飘字 / 提示 / 暂停 / 结算 / 车库 / 任务成就 / 设置
import * as THREE from 'three';
import { COSMETICS } from './pelican.js';
import { ACHIEVEMENTS, MISSIONS, UPGRADES, TIPS, CAM_NAMES } from './data.js';
import { QUALITY } from './gfx.js';
import { CAM_ORDER } from './camera.js';
import { fmtInt, clamp } from './util.js';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();
const HAT_E = { helmet: '⛑️', straw: '👒', chef: '🧑‍🍳', pirate: '🏴‍☠️', propeller: '🚁', wizard: '🧙', crown: '👑' };
const GL_E = { none: '🚫', shades: '🕶️', heart: '💗', goggles: '🥽' };
const TR_E = { none: '🚫', bubble: '🫧', spark: '✨', petal: '🌸', rainbow: '🌈', flame: '🔥' };
const TABS = [['hat', '帽子'], ['glasses', '眼镜'], ['scarf', '围巾'], ['paint', '车漆'], ['trail', '尾迹'], ['up', '强化']];
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export class UI {
  constructor(c) {
    Object.assign(this, c); // save, audio, input, gfx, sky, pelican, cam
    this.screen = 'title'; this.prev = 'title'; this.tab = 'hat';
    this.toastQ = []; this.toastN = 0; this.hudT = 0; this.last = {}; this.popN = 0;
    this.el = {};
    for (const id of ['score', 'mult', 'comboFill', 'comboN', 'hearts', 'fishN', 'speedArc', 'speedVal', 'distVal', 'zoneVal', 'clockVal', 'boostFill', 'feverFill', 'feverTxt', 'powers', 'zone', 'zoneEmoji', 'zoneName', 'zoneEn', 'warn', 'hint', 'pops', 'toasts', 'timeSlider', 'sunIcon', 'fps', 'hurt', 'fade', 'tip']) this.el[id] = $(id);
    this.scoreShown = 0;
    this.tipI = (Math.random() * TIPS.length) | 0;
    this._rotateTip(); setInterval(() => this._rotateTip(), 6000);
  }

  bind(game) {
    this.game = game;
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      this.audio.init(); this.act(b.dataset.act, b);
    });
    document.querySelectorAll('[data-tap]').forEach((el) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.audio.init(); this.input.press(el.dataset.tap); }));
    this.input.bindTouch(document);
    window.addEventListener('pointerdown', () => this.audio.init(), { once: true });
    window.addEventListener('keydown', () => this.audio.init(), { once: true });
    // 设置面板
    const s = this.save.d.settings;
    const seg = $('qualitySeg');
    QUALITY.forEach((q, i) => { const b = document.createElement('button'); b.textContent = q.name; b.className = i === s.quality ? 'on' : ''; b.onclick = () => { s.quality = i; this.gfx.setQuality(i); this.sky.setQuality(i); [...seg.children].forEach((c, j) => c.classList.toggle('on', j === i)); this.save.flush(); this.audio.ui(); }; seg.appendChild(b); });
    const slider = (id, key) => { const el = $(id); el.value = s[key]; el.oninput = () => { s[key] = +el.value; this.audio.setVol(key, s[key]); }; el.onchange = () => { this.save.flush(); this.audio.fish(3); }; };
    slider('volMaster', 'master'); slider('volMusic', 'music'); slider('volSfx', 'sfx');
    const check = (id, key, fn) => { const el = $(id); el.checked = s[key]; el.onchange = () => { s[key] = el.checked; this.save.flush(); fn && fn(el.checked); }; fn && fn(s[key]); };
    check('optShake', 'shake', (v) => { this.cam.shakeOn = v; }); check('optHints', 'hints'); check('optFps', 'fps', (v) => { this.el.fps.hidden = !v; });
    for (const k of ['master', 'music', 'sfx']) this.audio.vol[k] = s[k];
    this.audio.musicOn = s.musicOn; this._musicBtn();
    // 悠闲模式的时间滑块
    const ts = this.el.timeSlider;
    ts.addEventListener('input', () => { this.sky.setTime(+ts.value); this.dragTime = true; });
    ts.addEventListener('change', () => { this.dragTime = false; });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.game.state === 'play') this.game.pause(true); });
    this.refreshTitle();
    requestAnimationFrame(() => this.el.fade.classList.add('clear'));
  }

  _rotateTip() { this.tipI = (this.tipI + 1) % TIPS.length; if (this.el.tip) this.el.tip.textContent = TIPS[this.tipI]; }
  _musicBtn() { document.querySelectorAll('[data-act=music]').forEach(b => b.classList.toggle('off', !this.audio.musicOn)); }
  fadeThen(fn) { const f = this.el.fade; f.classList.remove('clear'); setTimeout(() => { fn(); requestAnimationFrame(() => setTimeout(() => f.classList.add('clear'), 120)); }, 420); }

  // ---------- 屏幕切换 ----------
  show(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('show', s.id === name));
    this.screen = name;
    document.body.classList.toggle('modal', !!name && name !== 'title');
    document.body.classList.toggle('playing', !!this.inRun && name !== 'title' && name !== 'garage' && name !== 'over');
    if (name === 'title') { this.inRun = false; document.body.classList.remove('playing', 'zen'); this.refreshTitle(); }
    if (name === 'pause') this._renderMissions($('pauseMissions'), true);
  }
  onStart(mode) {
    this.inRun = true; this.show(null);
    document.body.classList.toggle('zen', mode === 'zen');
    this.last = {}; this.scoreShown = 0; this.el.powers.innerHTML = ''; this.warn(null);
    this.el.zone.classList.remove('show');
    if (this.save.d.settings.hints && !this.save.d.seen.intro) { this.save.d.seen.intro = 1; setTimeout(() => this.hint(matchMedia('(pointer: coarse)').matches ? '◀ ▶ 转向 · ⤒ 跳跃 · 抓鱼攒连击！' : 'A / D 转向 · 空格跳跃 · 抓鱼攒连击！', 5), 900); }
  }
  onDying() { this.warn(null); }

  act(a, btn) {
    const g = this.game, au = this.audio;
    switch (a) {
      case 'play': case 'daily': case 'zen': au.ui(); this.fadeThen(() => g.start(a === 'play' ? 'adventure' : a)); break;
      case 'again': au.ui(); this.fadeThen(() => g.start(g.mode)); break;
      case 'restart': au.ui(); g.finish('silent'); this.fadeThen(() => g.start(g.mode)); break;
      case 'resume': au.ui(); g.pause(false); break;
      case 'pause': au.ui(); g.pause(true); break;
      case 'quit': case 'finishZen': au.ui(); if (g.state === 'pause') g.state = 'play'; this.fadeThen(() => g.finish(a === 'finishZen' ? 'results' : 'title')); break;
      case 'home': au.ui(); this.fadeThen(() => { g.attract(); this.show('title'); }); break;
      case 'revive': if (g.revive()) { this.inRun = true; } else { au.deny(); btn.classList.add('deny'); setTimeout(() => btn.classList.remove('deny'), 300); } break;
      case 'garage':
        au.ui();
        if (g.state === 'over') this.fadeThen(() => { g.attract(); g.state = 'garage'; this.cam.set('garage'); this.prev = 'title'; this.show('garage'); this._renderGarage(); });
        else { g.state = 'garage'; this.cam.set('garage'); this.prev = 'title'; this.show('garage'); this._renderGarage(); }
        break;
      case 'missions': case 'settings': case 'help': au.ui(); this.prev = this.screen; this.show(a); if (a === 'missions') this._renderMissionPanel(); break;
      case 'back':
        au.ui();
        if (this.screen === 'garage') { this.pelican.applyCosmetics(this.save.d.equip); g.state = 'title'; this.cam.set('title'); }
        this.show(this.prev === 'garage' ? 'title' : this.prev); if (this.prev === null) g.pause(false);
        break;
      case 'cam': this.cycleCam(); break;
      case 'music': au.setMusic(!au.musicOn); this.save.d.settings.musicOn = au.musicOn; this.save.flush(); this._musicBtn(); break;
      case 'shot': this.shot(); break;
      case 'flow': this.sky.flow = this.sky.flow ? 0 : 1; btn.classList.toggle('on', !!this.sky.flow); break;
      case 'weather': g.weather.target = g.weather.target > 0.5 ? 0 : 1; if (g.weather.target) g.R.rain = true; btn.classList.toggle('on', g.weather.target > 0.5); break;
      case 'auto': g.auto = !g.auto; btn.classList.toggle('on', g.auto); break;
      case 'wipe': if (confirm('确定要清除全部存档吗？鱼干、装扮、成就都会消失。')) { this.save.reset(); this.pelican.applyCosmetics(this.save.d.equip); this.refreshTitle(); this.toast('🧹', '存档已清除', '一切从头开始'); } break;
    }
  }
  cycleCam() { const i = CAM_ORDER.indexOf(this.cam.mode); const m = CAM_ORDER[(i + 1) % CAM_ORDER.length]; this.cam.set(m); this.toast('🎥', '镜头：' + CAM_NAMES[m], '按 C 继续切换'); this.audio.ui(); }
  shot() {
    document.body.classList.add('hide-ui');
    requestAnimationFrame(() => this.gfx.screenshot((blob) => {
      document.body.classList.remove('hide-ui'); if (!blob) return;
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `pelican-ride-${Date.now()}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      this.toast('📸', '截图已保存', '分享你的鹈鹕骑行瞬间'); this.audio.ring();
    }));
  }

  // 全局快捷键（每帧调用）
  keys() {
    const i = this.input, g = this.game;
    if (i.take('pause')) { if (g.state === 'play') g.pause(true); else if (g.state === 'pause') { if (this.screen === 'pause') g.pause(false); else this.act('back'); } else if (['garage', 'missions', 'settings', 'help'].includes(this.screen)) this.act('back'); }
    if (i.take('cam') && (g.state === 'play')) this.cycleCam();
    if (i.take('music')) this.act('music');
    if (i.take('shot')) this.shot();
    if (i.take('full')) { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {}); }
    if (i.take('hideui')) document.body.classList.toggle('hide-ui');
    if (i.take('time')) { this.sky.setTime(this.sky.time + 3); this.toast('⏩', '时间快进 3 小时', '现在是 ' + this.sky.clock); }
    if (i.take('restart') && (g.state === 'over' || g.state === 'pause')) this.act(g.state === 'over' ? 'again' : 'restart');
    if (i.take('ok')) { if (this.screen === 'title') this.act('play'); else if (g.state === 'over' && this.screen === 'over') this.act('again'); }
  }

  // ---------- HUD ----------
  hud(dt) {
    const g = this.game, p = g.p, L = this.last, E = this.el;
    if (!this.inRun) return;
    // 分数平滑滚动
    this.scoreShown += (p.score - this.scoreShown) * Math.min(1, dt * 10);
    const sc = Math.round(this.scoreShown); if (sc !== L.sc) { L.sc = sc; E.score.textContent = fmtInt(sc); }
    const mult = g._mult();
    if (mult !== L.mult) { E.mult.textContent = '×' + (Number.isInteger(mult) ? mult : mult.toFixed(2).replace(/0$/, '')); E.mult.classList.toggle('hot', mult >= 3); if (mult > (L.mult || 1)) { E.mult.classList.remove('bump'); void E.mult.offsetWidth; E.mult.classList.add('bump'); } L.mult = mult; }
    E.comboFill.style.transform = `scaleX(${clamp(p.comboT / p.comboMax)})`;
    if (p.combo !== L.combo) { L.combo = p.combo; E.comboN.textContent = p.combo > 1 ? `连击 ${p.combo}` : ''; }
    E.boostFill.style.transform = `scaleX(${p.boost / 100})`;
    const ready = p.boost >= 12 || p.boosting; if (ready !== L.ready) { L.ready = ready; E.boostFill.parentElement.classList.toggle('ready', ready); }
    E.feverFill.style.transform = `scaleX(${p.fever / 100})`;
    const fev = p.feverT > 0; if (fev !== L.fev) { L.fev = fev; E.feverFill.parentElement.classList.toggle('on', fev); }
    const ft = fev ? Math.ceil(p.feverT) + 's' : '狂热'; if (ft !== L.ft) { L.ft = ft; E.feverTxt.textContent = ft; }
    const kmh = Math.round(p.speed * 3.6);
    if (kmh !== L.kmh) { L.kmh = kmh; E.speedVal.textContent = kmh; E.speedArc.style.strokeDashoffset = 245 * (1 - clamp(kmh / 80)); }
    if (p.fish !== L.fish) { const up = p.fish > (L.fish || 0); L.fish = p.fish; E.fishN.textContent = p.fish; if (up) { E.fishN.classList.remove('bump'); void E.fishN.offsetWidth; E.fishN.classList.add('bump'); } }
    const hk = p.hearts + '/' + p.maxHearts;
    if (hk !== L.hk) {
      const lost = L.hearts !== undefined && p.hearts < L.hearts; L.hk = hk; L.hearts = p.hearts;
      E.hearts.innerHTML = Array.from({ length: p.maxHearts }, (_, i) => `<span class="${i >= p.hearts ? 'lost' : ''}${lost && i === p.hearts ? ' pop' : ''}">❤️</span>`).join('');
    }
    // 道具计时
    const pk = (p.magnetT > 0 ? 'm' : '') + (p.x2T > 0 ? 'x' : '') + (p.shield ? 's' : '') + (p.boosting ? 'b' : '');
    if (pk !== L.pk) {
      L.pk = pk; let h = '';
      if (p.magnetT > 0) h += '<div class="pw" data-p="m"><i></i><span>🧲</span></div>';
      if (p.x2T > 0) h += '<div class="pw" data-p="x"><i></i><span>✖️2</span></div>';
      if (p.shield) h += '<div class="pw"><span>🛡️</span></div>';
      if (p.boosting) h += '<div class="pw"><span>🌶️</span></div>';
      E.powers.innerHTML = h;
    }
    for (const el of E.powers.children) { const k = el.dataset.p; if (k === 'm') el.firstChild.style.height = clamp(p.magnetT / 9) * 100 + '%'; else if (k === 'x') el.firstChild.style.height = clamp(p.x2T / 10) * 100 + '%'; }
    // 低频文本
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.2;
      E.distVal.textContent = fmtInt(p.dist);
      E.clockVal.textContent = this.sky.clock;
      const t = this.sky.time; E.sunIcon.textContent = t < 5 || t >= 20 ? '🌙' : t < 7 ? '🌅' : t < 17 ? '☀️' : '🌇';
      if (!this.dragTime) E.timeSlider.value = t;
    }
  }
  setZoneName(name) { if (this.last.zone !== name) { this.last.zone = name; this.el.zoneVal.textContent = name; } }
  setFps(f, extra) { if (!this.el.fps.hidden) this.el.fps.textContent = f + ' fps' + (extra ? ' · ' + extra : ''); }

  // ---------- 飘字 / 吐司 / 提示 ----------
  pop(text, worldPos, cls) {
    if (this.popN > 16 || document.body.classList.contains('hide-ui')) return;
    const cam = this.gfx.camera; _v.copy(worldPos).project(cam);
    if (_v.z > 1) return;
    const el = document.createElement('div'); el.className = 'pop' + (cls ? ' ' + cls : ''); el.textContent = text;
    el.style.left = clamp((_v.x * 0.5 + 0.5) * innerWidth + (Math.random() - 0.5) * 50, 60, innerWidth - 60) + 'px';
    el.style.top = clamp((-_v.y * 0.5 + 0.5) * innerHeight + (Math.random() - 0.5) * 24, 70, innerHeight - 120) + 'px';
    this.el.pops.appendChild(el); this.popN++;
    el.addEventListener('animationend', () => { el.remove(); this.popN--; });
  }
  toast(emoji, title, sub, cls) {
    this.toastQ.push({ emoji, title, sub, cls }); this._pumpToast();
  }
  _pumpToast() {
    if (this.toastN >= 3 || !this.toastQ.length) return;
    const t = this.toastQ.shift(); this.toastN++;
    const el = document.createElement('div'); el.className = 'toast' + (t.cls ? ' ' + t.cls : '');
    el.innerHTML = `<span class="emo">${t.emoji}</span><div><b></b><small></small></div>`;
    el.querySelector('b').textContent = t.title; el.querySelector('small').textContent = t.sub || '';
    this.el.toasts.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { el.classList.remove('in'); setTimeout(() => { el.remove(); this.toastN--; this._pumpToast(); }, 450); }, t.cls === 'ach' ? 3600 : 2600);
  }
  hint(text, sec = 4.5) {
    if (!this.save.d.settings.hints) return;
    const h = this.el.hint; h.textContent = text; h.classList.add('show');
    clearTimeout(this._hintT); this._hintT = setTimeout(() => h.classList.remove('show'), sec * 1000);
  }
  hintOnce(key, text) { const s = this.save.d.seen; if (s['h_' + key]) return; s['h_' + key] = 1; this.hint(text); }
  zoneBanner(Z) {
    const E = this.el; E.zoneEmoji.textContent = Z.emoji; E.zoneName.textContent = Z.name; E.zoneEn.textContent = Z.en.toUpperCase();
    E.zone.classList.add('show'); clearTimeout(this._zoneT); this._zoneT = setTimeout(() => E.zone.classList.remove('show'), 3200);
  }
  warn(text) { const w = this.el.warn; if (text) { w.textContent = text; w.hidden = false; } else w.hidden = true; }
  hurt() { const h = this.el.hurt; h.classList.remove('go'); void h.offsetWidth; h.classList.add('go'); }

  // ---------- 标题 ----------
  refreshTitle() {
    const d = this.save.d;
    $('walletT').textContent = fmtInt(d.fish); $('bestT').textContent = fmtInt(d.best.adventure); $('bestDistT').textContent = fmtInt(d.best.dist);
    $('achT').textContent = Object.keys(d.ach).length + '/' + ACHIEVEMENTS.length;
    $('dailyBest').textContent = d.best.daily ? '最高 ' + fmtInt(d.best.daily) : '';
  }

  // ---------- 结算 ----------
  showResults(r) {
    const d = this.save.d, R = r.R, zen = r.mode === 'zen';
    $('overTitle').textContent = zen ? '收工啦，今天也骑得很开心' : r.mode === 'daily' ? '每日挑战结束' : '骑行结束';
    $('overBadge').hidden = !r.record;
    $('overScore').textContent = fmtInt(r.score); $('overBest').textContent = fmtInt(r.best);
    const cells = [['里程', fmtInt(r.dist) + ' m'], ['抓到的鱼', R.fish + (R.gold ? `（金 ${R.gold}）` : '')], ['最高连击', R.maxCombo], ['空中特技', R.tricks], ['极限闪避', R.near], ['最高时速', Math.round(R.maxSpeed) + ' km/h'], ['完美落地', R.perfect], ['狂热次数', R.fevers], ['经过路段', R.zones + ' / 6']];
    $('overGrid').innerHTML = cells.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    $('overFish').textContent = fmtInt(r.fish); $('overWallet').textContent = fmtInt(d.fish);
    const om = $('overMissions'); om.innerHTML = '';
    for (const m of r.doneM) { const tpl = MISSIONS.find(t => t.id === m.id); if (!tpl) continue; const el = document.createElement('div'); el.className = 'mission done'; el.innerHTML = `<span class="emo">✅</span><b></b><span class="rw">+${m.reward} 🐟</span>`; el.querySelector('b').textContent = tpl.text(m.goal); om.appendChild(el); }
    const rv = $('reviveBtn'); rv.hidden = zen || this.game.p.revived || this.game.p.hearts > 0; rv.disabled = d.fish < 80;
    this.show('over');
  }

  // ---------- 任务 / 成就 ----------
  _renderMissions(host, mini) {
    host.innerHTML = '';
    for (const m of this.save.d.missions) {
      const tpl = MISSIONS.find(t => t.id === m.id); if (!tpl) continue;
      const el = document.createElement('div'); el.className = 'mission' + (m.done ? ' done' : '');
      el.innerHTML = `<span class="emo">${m.done ? '✅' : tpl.e}</span><b></b><span class="rw">+${m.reward} 🐟</span><div class="bar"><i style="transform:scaleX(${clamp(m.prog / m.goal)})"></i></div><span class="pg">${fmtInt(Math.min(m.prog, m.goal))} / ${fmtInt(m.goal)}</span>`;
      el.querySelector('b').textContent = tpl.text(m.goal);
      host.appendChild(el);
    }
  }
  _renderMissionPanel() {
    const d = this.save.d;
    $('walletM').textContent = fmtInt(d.fish);
    this._renderMissions($('missionList'));
    $('achCount').textContent = Object.keys(d.ach).length + ' / ' + ACHIEVEMENTS.length;
    $('achGrid').innerHTML = ACHIEVEMENTS.map(a => `<div class="ach${d.ach[a.id] ? ' got' : ''}"><div class="emo">${a.e}</div><b>${a.n}</b><small>${a.d}</small></div>`).join('');
  }

  // ---------- 车库 ----------
  _renderGarage() {
    const d = this.save.d;
    $('walletG').textContent = fmtInt(d.fish);
    const tabs = $('garageTabs'); tabs.innerHTML = '';
    for (const [k, n] of TABS) { const b = document.createElement('button'); b.textContent = n; b.className = k === this.tab ? 'on' : ''; b.onclick = () => { this.tab = k; this.audio.ui(); this.pelican.applyCosmetics(d.equip); this._renderGarage(); }; tabs.appendChild(b); }
    const grid = $('garageGrid'); grid.innerHTML = '';
    if (this.tab === 'up') {
      for (const k in UPGRADES) {
        const U = UPGRADES[k], lv = d.up[k], max = lv >= U.max;
        const el = document.createElement('div'); el.className = 'item up' + (max ? ' equipped' : '');
        el.innerHTML = `<span class="emo">${U.e}</span><b>${U.n} <span class="pips">${'●'.repeat(lv)}${'○'.repeat(U.max - lv)}</span></b><span class="cost">${max ? '已满级' : '🐟 ' + U.cost[lv]}</span><small>${U.d}</small>`;
        el.onclick = () => {
          if (max) return;
          if (d.fish >= U.cost[lv]) { d.fish -= U.cost[lv]; d.up[k]++; d.total.bought++; this.save.flush(); this.audio.buy(); this._renderGarage(); this.game._checkProgress(false); }
          else { this.audio.deny(); el.classList.add('deny'); setTimeout(() => el.classList.remove('deny'), 300); }
        };
        grid.appendChild(el);
      }
      return;
    }
    const cat = this.tab, items = COSMETICS[cat];
    for (const id in items) {
      const it = items[id], owned = d.owned[cat].includes(id), eq = d.equip[cat] === id;
      const el = document.createElement('div'); el.className = 'item' + (owned ? ' owned' : '') + (eq ? ' equipped' : '');
      let sw = '';
      if (cat === 'paint') sw = `<div class="sw" style="background:${hex(it.col)}"></div>`;
      else if (cat === 'scarf') sw = `<div class="sw" style="background:${it.cols === 'rainbow' ? 'conic-gradient(red,orange,yellow,lime,cyan,blue,magenta,red)' : `linear-gradient(135deg, ${hex(it.cols[0])} 50%, ${hex(it.cols[1])} 50%)`}"></div>`;
      else sw = `<div class="sw">${(cat === 'hat' ? HAT_E : cat === 'glasses' ? GL_E : TR_E)[id]}</div>`;
      el.innerHTML = `${sw}<b>${it.name}</b><small>${eq ? '使用中' : owned ? '已拥有 · 点击装备' : '🐟 ' + it.price}</small>`;
      el.onclick = () => {
        if (owned) { d.equip[cat] = id; this.save.flush(); this.pelican.applyCosmetics(d.equip); this.audio.ui(); this._renderGarage(); }
        else if (d.fish >= it.price) { d.fish -= it.price; d.owned[cat].push(id); d.equip[cat] = id; d.total.bought++; this.save.flush(); this.pelican.applyCosmetics(d.equip); this.audio.buy(); this._renderGarage(); this.game._checkProgress(false); }
        else { this.pelican.applyCosmetics({ ...d.equip, [cat]: id }); this.audio.deny(); grid.querySelectorAll('.preview').forEach(x => x.classList.remove('preview')); el.classList.add('deny', 'preview'); el.querySelector('small').textContent = `🐟 ${it.price} · 试穿中`; setTimeout(() => el.classList.remove('deny'), 300); }
      };
      grid.appendChild(el);
    }
  }
}
