// 无渲染快进模拟：自动驾驶跑很久，捕捉运行时异常并打印统计
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const mode = process.argv[2] || 'adventure', steps = +(process.argv[3] || 20000), shot = process.argv[4];
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,720'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const logs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => logs.push('[pageerror] ' + (e.stack || e.message)));
await page.goto(pathToFileURL(path.resolve('dist/index.html')).href, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 1500));
const res = await page.evaluate((mode, steps) => {
  window.__noLoop = true;
  const G = window.__g, g = G.game;
  g.ui.fadeThen = (fn) => fn();
  G.audio.init(); const sfxErr = [];
  for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(G.audio))) { if (['constructor','init','update','setVol','setMusic','suspend','T'].includes(k) || k[0] === '_') continue; try { G.audio[k](2); } catch (e) { sfxErr.push(k + ': ' + e.message); } }
  g.start(mode); g.forceAuto = true;
  const t0 = performance.now(); let err = null, runs = 0; const hist = [];
  try {
    for (let i = 0; i < steps; i++) {
      G.tick(1 / 30, false);
      if (g.state === 'over') { hist.push({ score: g.lastResult.score, dist: g.lastResult.dist, fish: g.lastResult.fish, tricks: g.R.tricks, near: g.R.near, combo: g.R.maxCombo, fevers: g.R.fevers, t: Math.round(i / 30) }); runs++; g.start(mode); g.forceAuto = true; }
    }
  } catch (e) { err = e.stack || String(e); }
  const R = g.R;
  return { sfxErr, audio: G.audio.ready, err, ms: Math.round(performance.now() - t0), runs, hist: hist.slice(0, 12), cur: { dist: Math.round(g.p.dist), score: Math.round(g.p.score), hearts: g.p.hearts, fish: g.p.fish, zone: g.p.zoneKey }, R: { ...R, zoneSet: Object.keys(R.zoneSet).join(',') }, ents: G.entities.list.length, chunks: G.world.chunks.size, save: { fish: G.save.d.fish, ach: Object.keys(G.save.d.ach).length, missions: G.save.d.missions } };
}, mode, steps);
console.log(JSON.stringify(res, null, 1));
if (shot) { await page.evaluate(() => { window.__noLoop = false; }); await new Promise(r => setTimeout(r, 1200)); await page.screenshot({ path: shot }); console.log('saved', shot); }
if (logs.length) console.log(logs.slice(0, 30).join('\n'));
await browser.close();
