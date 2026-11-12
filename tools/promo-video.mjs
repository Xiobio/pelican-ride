// 宣传视频：逐帧确定性录制（画面 + 离线渲染的游戏原声），再用 ffmpeg 合成
// 用法: node tools/promo-video.mjs [--dry] [--from=秒 --to=秒]      需要环境变量 FFMPEG 指向 ffmpeg（或 PATH 里有）
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const OUT = process.env.PROMO_OUT || 'promo';
const arg = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const FPS = 30, DUR = 32, N = FPS * DUR;
const dry = !!arg.dry;
fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,720', '--lang=zh-CN'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: dry ? 1 : 1.5 });
page.on('pageerror', e => console.log('[pageerror] ' + (e.stack || e.message)));
page.on('console', m => { if (m.type() === 'error') console.log('[console] ' + m.text()); });
await page.goto(pathToFileURL(path.resolve('dist/index.html')).href + '?lang=zh', { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 1500));

// ------------------------------------------------------------------ 页面内：导演脚本
await page.evaluate((FPS, DUR) => {
  const G = window.__g, g = G.game, E = G.entities, ui = g.ui;
  window.__noLoop = true;
  const cap = window.__cap = { log: [], t: 0 };
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };

  // ---- 虚拟时钟：setTimeout / requestAnimationFrame 跟着视频时间走 ----
  let vnow = 0, tid = 1e6; const timers = new Map(); let rafs = [];
  const realClear = window.clearTimeout.bind(window);
  window.setTimeout = (fn, ms = 0, ...a) => { const id = tid++; timers.set(id, { t: vnow + ms, fn, a }); return id; };
  window.clearTimeout = (id) => { if (!timers.delete(id)) realClear(id); };
  window.requestAnimationFrame = (fn) => { rafs.push(fn); return 0; };
  const advanceClock = (ms) => {
    vnow += ms;
    const r = rafs; rafs = []; for (const fn of r) { try { fn(vnow); } catch (e) { console.error(e); } }
    const due = [...timers.entries()].filter(([, v]) => v.t <= vnow).sort((a, b) => a[1].t - b[1].t);
    for (const [id, v] of due) { timers.delete(id); try { v.fn(...v.a); } catch (e) { console.error(e); } }
  };
  // CSS 动画 / 过渡也按视频时间推进
  const advanceAnims = (ms) => {
    for (const a of document.getAnimations()) {
      if (!a.__held) { a.__held = true; try { a.pause(); a.currentTime = 0; } catch (e) { continue; } }
      const end = a.effect ? a.effect.getComputedTiming().endTime : Infinity;
      const nt = (a.currentTime || 0) + ms;
      if (nt >= end) { try { a.finish(); } catch (e) { /* 无限循环动画不能 finish */ } } else a.currentTime = nt;
    }
  };

  // ---- 离线音频：游戏的 AudioContext 换成 OfflineAudioContext，逐帧暂停推进 ----
  const SR = 48000;
  const off = cap.off = new OfflineAudioContext(2, Math.ceil(SR * DUR), SR);
  window.AudioContext = function () { return off; };
  G.audio.init();

  // ---- 记录飘字和吐司（调试用）----
  const pop0 = ui.pop.bind(ui), toast0 = ui.toast.bind(ui);
  let quiet = false;
  ui.pop = (text, ...r) => { if (quiet) return; cap.log.push(cap.t.toFixed(2) + ' pop   ' + text); pop0(text, ...r); };
  ui.toast = (e, t, ...r) => { if (quiet || cap.noToast || (cap.toastOk && !cap.toastOk(t))) return; cap.log.push(cap.t.toFixed(2) + ' toast ' + t); toast0(e, t, ...r); };
  ui.fadeThen = (fn) => fn();
  G.save.d.settings.hints = false;
  // 不计入画面的预热帧（切镜头后让相机、围巾、粒子稳定下来）
  const warm = (n) => { quiet = true; const ar = G.audio.ready; G.audio.ready = false; for (let i = 0; i < n; i++) G.tick(1 / 60, false); G.audio.ready = ar; quiet = false; };

  // ---- 导演对自动驾驶的干预 ----
  const dir = cap.dir = { steerTo: null, noJump: true, jump: null }; // 自动驾驶偶尔会随机小跳，录制时只在需要的镜头里放开
  const ap0 = g._autopilot.bind(g);
  g._autopilot = (dt) => {
    const o = ap0(dt); o.trick = false; o.bell = false; o.honk = false;
    if (dir.noJump) { o.jump = false; o.glide = false; }
    if (dir.steerTo !== null) o.steer = clamp((dir.steerTo - g.p.lat) * 1.6, -1, 1);
    return o;
  };
  const camU = G.cam.update.bind(G.cam);
  G.cam.update = (dt, p) => {
    if (!cap.whaleCam) return camU(dt, p);
    const c = G.gfx.camera, w = G.ambient.whale.position, dx = w.x - p.x, dz = w.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
    c.position.set(p.x - ux * 8 - uz * 1.5, p.gy + 1.75, -uz * 8 + ux * 1.5);
    c.fov = 31; c.updateProjectionMatrix();
    c.lookAt(p.x + dx * 0.5, p.gy + 1.0 + Math.max(w.y, 0) * 0.15, dz * 0.5);
  };
  const TR = { backflip: { name: '后空翻', dur: 0.72, score: 150, key: 'backflips' }, superman: { name: '超人式', dur: 0.78, score: 180, key: 'supermans' } };
  const hud = (on) => document.body.classList.toggle('hide-ui', !on);
  const tp = (key, off, time, cam, w = 50) => {
    const p = g.p; G.track._extend(9000);
    const z = G.track.zones.find(z => z.key === key && z.start > 0);
    p.dist = z.start + off; p.zoneKey = key; p.lat = 0; p.latV = 0; p.y = 0; p.vy = 0; p.grounded = true; p.trick = null; p.feverT = 0; p.fever = 0; p.boosting = false; p.forceBoost = 0; p.invuln = 0; p.crashT = 0;
    g.needWarm = true; E.clear(); E.genS = p.dist + 14; p.nextKm = 1e9; p.thiefCd = 1e9;
    G.sky.setTime(time); G.sky.flow = 0; G.fx.clear(); G.pelican.scarfReset = true;
    G.cam.set('title'); G.cam.set(cam); warm(w);
  };

  // ---- 字幕 ----
  const st = document.createElement('style');
  st.textContent = `
    #pcap { position: fixed; left: 0; right: 0; bottom: 7.5%; z-index: 70; text-align: center; pointer-events: none; font-family: "PingFang SC","Microsoft YaHei","Segoe UI",sans-serif; }
    #pcap b { display: block; font-size: 52px; font-weight: 900; color: #fff; letter-spacing: 0.04em; -webkit-text-stroke: 9px rgba(10, 14, 30, 0.82); paint-order: stroke fill; text-shadow: 0 6px 24px rgba(0,0,0,0.55); }
    #pcap i { display: block; margin-top: 2px; font-style: normal; font-size: 25px; font-weight: 800; color: #ffd98a; letter-spacing: 0.02em; -webkit-text-stroke: 6px rgba(10, 14, 30, 0.82); paint-order: stroke fill; }
    #toasts { left: auto !important; right: 16px; top: 128px !important; transform: none !important; align-items: flex-end !important; }
    #pend { position: fixed; inset: 0; z-index: 69; pointer-events: none; opacity: 0; background: linear-gradient(270deg, rgba(8,11,24,0.86), rgba(8,11,24,0.55) 46%, rgba(8,11,24,0) 72%); font-family: "PingFang SC","Microsoft YaHei","Segoe UI",sans-serif; }
    #pend .box { position: absolute; right: 4.5%; top: 50%; transform: translateY(-50%); text-align: right; }
    #pend h1 { margin: 0; font-size: 78px; font-weight: 900; letter-spacing: 0.04em; line-height: 1.1; background: linear-gradient(92deg, #fff7e6, #ffc27a 45%, #ff8a5b); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 4px 18px rgba(0,0,0,0.4)); }
    #pend .en { font-size: 30px; font-weight: 800; letter-spacing: 0.42em; color: rgba(236,240,250,0.82); margin: 4px 0 26px; }
    #pend .url { display: inline-block; padding: 14px 30px; border-radius: 999px; font-size: 34px; font-weight: 900; color: #2a1400; background: linear-gradient(135deg, #ffd27a, #ff9a4d); box-shadow: 0 10px 34px rgba(255,140,60,0.5); }
    #pend .sub { margin-top: 20px; font-size: 22px; font-weight: 600; color: rgba(236,240,250,0.78); line-height: 1.6; }
  `;
  document.head.appendChild(st);
  const pc = document.createElement('div'); pc.id = 'pcap'; pc.innerHTML = '<b></b><i></i>'; document.body.appendChild(pc);
  const pe = document.createElement('div'); pe.id = 'pend';
  pe.innerHTML = '<div class="box"><h1>鹈鹕骑单车</h1><div class="en">PELICAN RIDE</div><div class="url">pelicanride.vercel.app</div><div class="sub">打开浏览器就能玩 · 免费 · 开源<br>Free in your browser · open source</div></div>';
  document.body.appendChild(pe);
  const CAPS = [
    [0.35, 3.05, '“画一只骑自行车的鹈鹕”', 'Every AI benchmark: “draw a pelican riding a bicycle”'],
    [3.3, 5.6, '画？直接让它上路。', 'Draw it? Nah. Let it ride.'],
    [6.1, 9.2, '沿着海岸线，一路干饭', 'Eat fish. Build combos.'],
    [10.0, 12.9, '后空翻？顺手的事', 'Backflips? Obviously.'],
    [13.5, 15.6, '按铃，海鸥让路', 'Ring the bell. Seagulls hate it.'],
    [15.9, 17.8, '嘎一嗓子，鱼自己蹦上岸', 'Squawk, and the fish come to you.'],
    [18.2, 21.0, '鱼群狂热 + 辣椒冲刺', 'FISH FRENZY. Also: hot sauce.'],
    [21.35, 24.5, '6 种路段 · 昼夜 · 天气', 'All procedural. Zero assets.'],
    [24.8, 26.4, '对了，海里还有鲸鱼', 'Oh, and there are whales.'],
    [26.75, 28.4, '偶尔也会翻车', 'It does not always go well.'],
  ];
  const drawCaps = (t) => {
    let shown = null;
    for (const c of CAPS) if (t >= c[0] && t <= c[1]) shown = c;
    if (!shown) { pc.style.opacity = 0; } else {
      const a = smooth((t - shown[0]) / 0.22) * smooth((shown[1] - t) / 0.18);
      pc.firstChild.textContent = shown[2]; pc.lastChild.textContent = shown[3];
      pc.className = shown[4] ? 'top' : '';
      pc.style.opacity = a; pc.style.transform = `translateY(${(1 - smooth((t - shown[0]) / 0.22)) * 14}px) scale(${0.94 + 0.06 * smooth((t - shown[0]) / 0.22)})`;
    }
    pe.style.opacity = smooth((t - 28.7) / 0.5);
    pe.firstChild.style.transform = `translateY(-50%) translateX(${(1 - smooth((t - 28.75) / 0.7)) * 40}px)`;
  };

  // ---- 时间线 ----
  let ramp = null, D = 0, hits0 = 0;
  const TL = [
    [0, () => {
      g.start('adventure'); g.forceAuto = true; hud(false); cap.noToast = true;
      const p = g.p; p.speed = 9.3; p.nextKm = 1e9; p.thiefCd = 1e9; E.clear(); E.genS = 1e9;
      G.sky.setTime(17.55); G.sky.flow = 0; g.weather.target = 0;
      G.cam.set('cine'); G.cam.cine.i = 3; G.cam.cine.t = 0; G.cam.cine.dur = 400; G.cam.cut = true; warm(90);
    }],
    [3.2, () => { G.cam.cine.i = 5; G.cam.cine.t = 0.6; G.cam.cine.dur = 6.5; G.cam.cut = true; warm(2); }],
    [4.05, () => { G.input.press('honk'); }],
    [5.8, () => {
      const p = g.p; hud(true); cap.noToast = false; G.cam.set('chase'); warm(2);
      D = p.dist;
      for (let i = 0; i < 9; i++) E.spawn(i === 8 ? 'gold' : 'fish', D + 9 + i * 2.3, -2.6 * smooth((i / 8 - 0.2) / 0.55) + (i < 2 ? p.lat * (1 - i / 2) : 0), 1.15);
      ramp = E.spawn('ramp', D + 40, -2.6);
      for (let i = 0; i < 4; i++) E.spawn('cone', D + 46.5 + i * 2.2, -2.6);
      for (let i = 0; i < 8; i++) { const t = i / 7; E.spawn(i === 4 ? 'gold' : 'fish', D + 42.5 + t * 14, -2.6, 1.5 + 4 * 2.7 * t * (1 - t)); }
      E.spawn('ring', D + 49.5, -2.6, 4.0);
      for (let i = 0; i < 4; i++) E.spawn('fish', D + 61 + i * 2.4, -2.6 + i * 0.6, 1.15);
      dir.jump = { stage: -1 };
    }],
    [13.25, () => { const p = g.p; for (let i = 0; i < 6; i++) E.spawn('gull', p.dist + 21 + (i % 2) * 1.6, -3.2 + i * 1.28, 0, { ry: (i - 2.5) * 0.3 }); for (let i = 0; i < 6; i++) E.spawn('fish', p.dist + 27 + i * 2.3, 0, 1.15); dir.steerTo = 0; }],
    [14.45, () => { G.input.press('bell'); }],
    [14.75, () => { G.input.press('bell'); dir.steerTo = null; }],
    [15.95, () => { G.input.press('honk'); }],
    [18.0, () => {
      const p = g.p; cap.toastOk = (t) => t.startsWith('鱼群'); p.fever = 100; g._startFever(); p.boost = 100; p.boosting = true; p.forceBoost = 2.9; G.audio.boost(); G.cam.shake(0.3); dir.noJump = true;
      for (const s of [22, 37]) for (const u of [-2.6, 0, 2.6]) E.spawn('barrier', p.dist + s, u);
      for (const u of [-2.6, -1.3, 0, 1.3, 2.6]) E.spawn('cone', p.dist + 30, u);
      for (let i = 0; i < 10; i++) E.spawn(i % 5 === 4 ? 'gold' : 'fish', p.dist + 8 + i * 4.5, 0, 1.15);
      dir.steerTo = 0;
    }],
    [21.2, () => { dir.noJump = false; dir.steerTo = null; cap.toastOk = null; hud(false); cap.noToast = true; tp('village', 150, 12.6, 'chase'); }],
    [22.1, () => { tp('blossom', 110, 21.1, 'chase'); }],
    [23.0, () => { g.weather.rain = 1; g.weather.target = 1; tp('beach', 170, 10.5, 'chase', 70); }],
    [23.85, () => { g.weather.rain = 0; g.weather.target = 0; G.sky.overcast = 0; tp('cliff', 135, 23.2, 'chase'); }],
    [24.65, () => {
      tp('coast', 180, 7.6, 'chase', 4); E.genS = 1e9; E.clear();
      dir.noJump = true; G.ambient.whaleT = -1; G.ambient.triggerWhale(); cap.whaleCam = true; warm(112);
    }],
    [26.5, () => {
      cap.whaleCam = false; tp('coast', 0, 17.5, 'chase', 4); const p = g.p; p.dist = 150; g.needWarm = true; p.zoneKey = 'coast'; E.clear(); E.genS = 1e9; hud(true); warm(40);
      hits0 = g.R.hits; p.hearts = p.maxHearts; dir.noJump = true; dir.steerTo = p.lat;
      E.spawn('cart', p.dist + 8.2, p.lat, 0, { vs: 3 });
      for (let i = 0; i < 3; i++) E.spawn('fish', p.dist + 2.5 + i * 1.8, p.lat, 1.15);
    }],
    [28.55, () => {
      hud(false); dir.noJump = true; dir.steerTo = 0; E.clear(); E.genS = 1e9; G.fx.clear();
      const p = g.p; p.invuln = 0; p.crashT = 0; p.y = 0; p.vy = 0; p.grounded = true; p.speed = 9; g.state = 'play'; g.timeScale = 1;
      G.pelican.applyCosmetics({ hat: 'wizard', glasses: 'heart', scarf: 'rainbow', paint: 'pink', trail: 'spark' });
      G.sky.setTime(17.7); G.cam.set('title'); G.cam.set('garage'); const o = G.cam.orbit; o.yaw = 2.2; o.auto = true; o.r = 4.6; warm(30);
    }],
  ];
  let ti = 0;
  // 每帧：跳台上的特技编排
  const perFrame = () => {
    const p = g.p, J = dir.jump;
    if (!J) return;
    if (J.stage === -1) {
      if (p.dist > D + 27) dir.steerTo = -2.6;
      if (ramp.s - p.dist < 4.2) { G.cam.set('side'); J.stage = 0; dir.noJump = true; }
    } else if (J.stage === 0) { if (!p.grounded && p.vy > 5) { J.stage = 1; } }
    else if (J.stage === 1) { if (p.airT >= 0.07) { p.trick = { type: 'backflip', t: 0, dir: 1, T: TR.backflip }; G.audio.flap(); J.stage = 2; } }
    else if (J.stage === 2) {
      if (!p.trick && p.airTricks >= 1) {
        p.flaps = 0; p.vy = Math.max(p.vy, 0) * 0.35 + 7.4; G.pelican.doFlap(); G.audio.flap(); G.fx.feathers(g.out.x, g.out.y + 1.2, -p.dist, 6);
        p.trick = { type: 'superman', t: 0, dir: 1, T: TR.superman }; J.stage = 3;
      }
    } else if (J.stage === 3) { if (p.grounded) { J.stage = 4; J.t = cap.t; dir.steerTo = null; } }
    else if (J.stage === 4) { if (cap.t - J.t > 0.55) { G.cam.set('chase'); dir.jump = null; } }
  };

  cap.step = async (i) => {
    const t = cap.t = i / FPS;
    if (i > 0) { const s = off.suspend(t); if (i === 1) cap.done = off.startRendering(); else off.resume(); await s; }
    while (ti < TL.length && TL[ti][0] <= t + 1e-6) { TL[ti][1](); ti++; }
    perFrame();
    G.tick(1 / 60, false); perFrame(); G.tick(1 / 60, true);
    if (g.R.hits > hits0 && dir.steerTo !== null && t > 26.6 && t < 28.5) { dir.steerTo = null; }
    drawCaps(t);
    advanceClock(1000 / FPS);
    advanceAnims(1000 / FPS);
    return { state: g.state, dist: Math.round(g.p.dist), y: +g.p.y.toFixed(2) };
  };
  cap.finish = async () => {
    off.resume(); const buf = await cap.done;
    const n = buf.length, L = buf.getChannelData(0), R = buf.getChannelData(1);
    let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const gain = peak > 0 ? Math.min(1.6, 0.92 / peak) : 1;
    const wav = new DataView(new ArrayBuffer(44 + n * 4));
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) wav.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); wav.setUint32(4, 36 + n * 4, true); ws(8, 'WAVEfmt '); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 2, true);
    wav.setUint32(24, SR, true); wav.setUint32(28, SR * 4, true); wav.setUint16(32, 4, true); wav.setUint16(34, 16, true); ws(36, 'data'); wav.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) { wav.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i] * gain)) * 32767, true); wav.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i] * gain)) * 32767, true); }
    const u8 = new Uint8Array(wav.buffer); let s = ''; const parts = [];
    for (let i = 0; i < u8.length; i += 0x8000) parts.push(String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)));
    return { b64: btoa(parts.join('')), peak, gain };
  };
}, FPS, DUR);

// ------------------------------------------------------------------ 逐帧推进 + 截图
const from = arg.from ? +arg.from * FPS : 0, to = arg.to ? +arg.to * FPS : N;
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const st = await page.evaluate((i) => window.__cap.step(i), i);
  if (!dry && i >= from && i < to) await page.screenshot({ path: path.join(OUT, 'frames', `f_${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 95, optimizeForSpeed: true });
  if (dry && arg.shots && String(arg.shots).split(',').map(Number).some(s => Math.round(s * FPS) === i)) await page.screenshot({ path: path.join(OUT, `dry_${(i / FPS).toFixed(1)}.png`) });
  if (i % 150 === 0) console.log(`frame ${i}/${N}  t=${(i / FPS).toFixed(1)}s  ${JSON.stringify(st)}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
console.log((await page.evaluate(() => window.__cap.log)).join('\n'));
const audio = await page.evaluate(() => window.__cap.finish());
fs.writeFileSync(path.join(OUT, 'audio.wav'), Buffer.from(audio.b64, 'base64'));
console.log('audio peak', audio.peak.toFixed(3), 'gain', audio.gain.toFixed(2));
await browser.close();
if (dry || arg.from || arg.to) process.exit(0);

// ------------------------------------------------------------------ 合成
const ff = (args) => execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
const src = ['-framerate', String(FPS), '-i', path.join(OUT, 'frames', 'f_%05d.jpg'), '-i', path.join(OUT, 'audio.wav')];
const fadeA = ['-af', `afade=t=in:d=0.3,afade=t=out:st=${DUR - 1.2}:d=1.2`];
ff([...src, '-vf', `fade=t=in:d=0.35,fade=t=out:st=${DUR - 0.5}:d=0.5`, ...fadeA, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', '-preset', 'slow', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', path.join(OUT, 'pelican-ride-1080p.mp4')]);
ff([...src, '-vf', `scale=1280:720:flags=lanczos,fade=t=in:d=0.35,fade=t=out:st=${DUR - 0.5}:d=0.5`, ...fadeA, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-preset', 'slow', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', path.join(OUT, 'pelican-ride-720p.mp4')]);
console.log('done:', fs.readdirSync(OUT).filter(f => f.endsWith('.mp4')).map(f => `${f} ${(fs.statSync(path.join(OUT, f)).size / 1e6).toFixed(1)}MB`).join(', '));
