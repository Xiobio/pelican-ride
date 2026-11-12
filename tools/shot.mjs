// 用法: node tools/shot.mjs <url|file> <out.png> [--w=1280 --h=720 --wait=3000 --eval="js" --click="selector" --keys="KeyW,Space"]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return [a.slice(2, i < 0 ? undefined : i), i < 0 ? true : a.slice(i + 1)]; }));
const pos = args.filter(a => !a.startsWith('--'));
let url = pos[0]; const out = pos[1] || 'shots/out.png';
if (!/^https?:/.test(url)) url = pathToFileURL(path.resolve(url)).href;
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio', `--window-size=${opt.w || 1280},${opt.h || 720}`],
});
const page = await browser.newPage();
await page.setViewport({ width: +(opt.w || 1280), height: +(opt.h || 720), deviceScaleFactor: 1 });
const logs = [];
page.on('console', m => { const t = m.type(); if (t === 'error' || t === 'warning' || opt.verbose) logs.push(`[${t}] ${m.text()}`); });
page.on('pageerror', e => logs.push('[pageerror] ' + (e.stack || e.message)));
await page.goto(url, { waitUntil: 'load', timeout: 60000 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(+(opt.pre || 1500));
if (opt.click) for (const sel of String(opt.click).split('|')) { try { await page.click(sel); } catch (e) { logs.push('[click-fail] ' + sel + ' ' + e.message); } await sleep(400); }
if (opt.eval) { try { const r = await page.evaluate(opt.eval); if (r !== undefined) console.log('eval =>', typeof r === 'string' ? r : JSON.stringify(r)); } catch (e) { logs.push('[eval-fail] ' + e.message); } }
if (opt.hold) for (const k of String(opt.hold).split(',')) await page.keyboard.down(k);
await sleep(+(opt.wait || 3000));
if (opt.eval2) { try { const r = await page.evaluate(opt.eval2); if (r !== undefined) console.log('eval2 =>', typeof r === 'string' ? r : JSON.stringify(r)); } catch (e) { logs.push('[eval2-fail] ' + e.message); } await sleep(+(opt.wait2 || 300)); }
await page.screenshot({ path: out });
if (logs.length) console.log(logs.slice(0, 40).join('\n'));
console.log('saved', out);
await browser.close();
