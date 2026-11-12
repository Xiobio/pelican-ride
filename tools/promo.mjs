// 生成 README / 分享用截图：node tools/promo.mjs
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,720'] });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function shot(file, setup, wait = 2600, vp = [1280, 720]) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp[0], height: vp[1], deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.resolve('dist/index.html')).href, { waitUntil: 'load' });
  await sleep(1200);
  await page.evaluate((code) => {
    const G = window.__g, g = G.game; g.ui.fadeThen = (fn) => fn(); g.ui.toast = () => {}; g.ui.hint = () => {};
    const go = (key, off, time) => { g.start('adventure'); g.forceAuto = true; if (key) { G.track._extend(9000); const z = G.track.zones.find(z => z.key === key && z.start > 0); g.p.dist = z.start + off; g.p.zoneKey = key; g.needWarm = true; G.entities.clear(); G.entities.genS = g.p.dist + 12; g.p.nextKm = 1e9; } G.sky.setTime(time); G.sky.flow = 0; };
    (0, eval)('(' + code + ')')(G, g, go);
  }, setup.toString());
  await sleep(wait);
  await page.screenshot({ path: file, ...(file.endsWith('.jpg') ? { type: 'jpeg', quality: 88 } : {}) });
  console.log('saved', file);
  await page.close();
}
await shot('docs/title.png', (G) => { G.sky.setTime(17.7); G.sky.flow = 0; }, 3000);
await shot('docs/coast.png', (G, g, go) => { go(null, 0, 17.4); g.p.dist = 120; g.needWarm = true; G.entities.clear(); G.entities.genS = 132; }, 3200);
await shot('docs/village.png', (G, g, go) => go('village', 170, 13.5));
await shot('docs/blossom-night.png', (G, g, go) => go('blossom', 110, 21));
await shot('docs/bridge.png', (G, g, go) => go('bridge', 70, 5.7));
await shot('docs/garage.png', (G, g) => { G.sky.setTime(10); G.sky.flow = 0; g.ui.act('garage'); G.pelican.applyCosmetics({ hat: 'wizard', glasses: 'heart', scarf: 'rainbow', paint: 'pink' }); }, 1800);
await shot('public/og.jpg', (G, g, go) => { G.sky.setTime(17.7); G.sky.flow = 0; }, 3000, [1200, 630]);
await browser.close();
