// 截图巡检：跳到指定路段 / 时刻 / 镜头。用法: node tools/tour.mjs <name> key=village time=12 cam=chase off=150 wait=2500 [eval="js"]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const name = process.argv[2] || 'tour';
const o = Object.fromEntries(process.argv.slice(3).map(a => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const W = +(o.w || 1280), H = +(o.h || 720);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', `--window-size=${W},${H}`] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1, hasTouch: o.touch === '1', isMobile: o.touch === '1' });
const logs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => logs.push('[pageerror] ' + (e.stack || e.message)));
await page.goto(pathToFileURL(path.resolve('dist/index.html')).href + (o.lang ? '?lang=' + o.lang : ''), { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 1200));
const info = await page.evaluate((o) => {
  const G = window.__g, g = G.game;
  g.ui.fadeThen = (fn) => fn();
  if (o.mode !== 'title') { g.start(o.mode || 'adventure'); g.forceAuto = o.auto !== '0'; }
  if (o.key) {
    G.track._extend(9000);
    const z = G.track.zones.find(z => z.key === o.key && z.start > 0) || G.track.zones[0];
    g.p.dist = z.start + (+(o.off || 150)); g.p.zoneKey = o.key; g.needWarm = true; G.entities.clear(); G.entities.genS = g.p.dist + 12; g.p.nextKm = Math.ceil(g.p.dist / 1000) * 1000;
  }
  if (o.time) { G.sky.setTime(+o.time); G.sky.flow = 0; }
  if (o.cam) G.cam.set(o.cam);
  if (o.rain) g.weather.target = 1, g.weather.rain = 1;
  if (o.eval) { try { (0, eval)(o.eval); } catch (e) { return 'eval error: ' + e.message; } }
  return { zones: G.track.zones.slice(0, 8).map(z => z.key + '@' + Math.round(z.start)).join(' ') };
}, o);
await new Promise(r => setTimeout(r, +(o.wait || 2500)));
if (o.eval2) { const r = await page.evaluate((s) => { try { return (0, eval)(s); } catch (e) { return 'eval2 error: ' + e.message; } }, o.eval2); if (r !== undefined) console.log('eval2 =>', JSON.stringify(r)); await new Promise(r => setTimeout(r, +(o.wait2 || 400))); }
const stat = await page.evaluate(() => { const G = window.__g, i = G.gfx.renderer.info; return { fps: document.getElementById('fps').textContent, calls: i.render.calls, tris: i.render.triangles, dist: Math.round(G.game.p.dist), zone: G.game.p.zoneKey, state: G.game.state, geos: i.memory.geometries, tex: i.memory.textures }; });
await page.screenshot({ path: `shots/${name}.png` });
console.log(name, JSON.stringify(info), JSON.stringify(stat));
if (logs.length) console.log(logs.slice(0, 20).join('\n'));
await browser.close();
