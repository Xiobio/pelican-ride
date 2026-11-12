import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1920,1080', '--disable-frame-rate-limit', '--disable-gpu-vsync'] });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
page.on('pageerror', e => console.log('[pageerror] ' + e.message));
await page.goto(pathToFileURL(path.resolve('dist/index.html')).href, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 1500));
for (const q of [3, 2, 1, 0]) {
  const r = await page.evaluate(async (q) => {
    const G = window.__g, g = G.game; g.ui.fadeThen = (fn) => fn();
    G.gfx.setQuality(q); G.sky.setQuality(q);
    g.start('adventure'); g.forceAuto = true; g.p.dist = 700; g.needWarm = true;
    await new Promise(r => setTimeout(r, 1500));
    // 逐段计时：模拟 vs 渲染
    let n = 0, sim = 0, ren = 0; const t0 = performance.now();
    window.__noLoop = true;
    const gl = G.gfx.renderer.getContext();
    while (performance.now() - t0 < 3000) { const a = performance.now(); G.tick(1 / 60, false); const b = performance.now(); G.gfx.render(); gl.finish(); const c = performance.now(); sim += b - a; ren += c - b; n++; await new Promise(r => setTimeout(r, 0)); }
    window.__noLoop = false;
    const i = G.gfx.renderer.info;
    return { q, frames: n, simMs: +(sim / n).toFixed(2), renderMs: +(ren / n).toFixed(2), calls: i.render.calls, tris: i.render.triangles, geos: i.memory.geometries, programs: i.programs.length, gpu: gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info') ? gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL : gl.RENDERER) };
  }, q);
  console.log(JSON.stringify(r));
}
await browser.close();
