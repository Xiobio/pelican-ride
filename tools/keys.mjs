// 键盘操作冒烟测试：真实按键 -> 检查状态变化
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,720'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const logs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => logs.push('[pageerror] ' + (e.stack || e.message)));
await page.goto(pathToFileURL(path.resolve('dist/index.html')).href, { waitUntil: 'load' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const st = (expr) => page.evaluate(expr);
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
await sleep(1500);
await page.keyboard.press('Enter');                       // 开始冒险
await sleep(1800);
ok('start via Enter', await st(`__g.game.state === 'play' && __g.game.mode === 'adventure'`));
await st(`__g.entities.clear(); __g.entities.genS = 1e9; 0`);  // 清空障碍，专心测操作
await page.keyboard.down('KeyD'); await sleep(700); await page.keyboard.up('KeyD');
ok('steer right', await st(`__g.game.p.lat > 1`), 'lat=' + (await st(`__g.game.p.lat.toFixed(2)`)));
await page.keyboard.down('KeyA'); await sleep(1100); await page.keyboard.up('KeyA');
ok('steer left', await st(`__g.game.p.lat < -0.5`), 'lat=' + (await st(`__g.game.p.lat.toFixed(2)`)));
await page.keyboard.press('Space'); await sleep(150);
ok('jump', await st(`!__g.game.p.grounded && __g.game.R.jumps === 1`));
await page.keyboard.press('KeyT'); await sleep(120);
ok('trick starts', await st(`!!__g.game.p.trick`), await st(`__g.game.p.trick && __g.game.p.trick.type`));
await page.keyboard.press('Space'); await sleep(200);       // 特技中不能扑翅
await sleep(900);
ok('landed', await st(`__g.game.p.grounded`), 'tricks=' + (await st(`__g.game.R.tricks`)) + ' hearts=' + (await st(`__g.game.p.hearts`)));
await sleep(2700);                                         // 等无敌结束
// 二段跳 + 滑翔
await page.keyboard.press('Space'); await sleep(280); await page.keyboard.press('Space'); await sleep(60);
ok('flap used', await st(`__g.game.p.flaps === 0`));
await page.keyboard.down('Space'); await sleep(650);
ok('gliding', await st(`__g.game.p.gliding`), 'y=' + (await st(`__g.game.p.y.toFixed(2)`)));
await page.keyboard.up('Space'); await sleep(1500);
// 空中两连特技：转体 + 超人
await page.keyboard.press('Space'); await sleep(100); await page.keyboard.press('Space'); await sleep(60);
await page.keyboard.down('KeyD'); await page.keyboard.press('KeyT'); await sleep(80); await page.keyboard.up('KeyD');
const t1 = await st(`__g.game.p.trick && __g.game.p.trick.type`);
ok('spin trick', t1 === 'spin', String(t1));
await sleep(1500);
// 翘头
await page.keyboard.down('KeyT'); await sleep(1300);
ok('wheelie', await st(`__g.game.p.wheelie && __g.game.p.wheelieT > 1`));
await page.keyboard.up('KeyT');
// 冲刺
await st(`__g.game.p.boost = 100; 0`);
await page.keyboard.down('ShiftLeft'); await sleep(900);
ok('boost', await st(`__g.game.p.boosting`), 'kmh=' + (await st(`Math.round(__g.game.p.speed * 3.6)`)));
await page.keyboard.up('ShiftLeft'); await sleep(200);
ok('boost stops', await st(`!__g.game.p.boosting`));
// 铃 + 大叫（生成海鸥与螃蟹）
await st(`{ const g = __g.game, E = __g.entities; for (let i = 0; i < 3; i++) E.spawn('gull', g.p.dist + 14 + i, -2 + i * 2, 0); E.spawn('crab', g.p.dist + 16, 2, 0, { vx: -1 }); 0 }`);
await page.keyboard.press('KeyB'); await sleep(150);
ok('bell scares gulls', await st(`__g.game.R.gulls === 3`));
await page.keyboard.press('KeyH'); await sleep(150);
ok('honk scares crab + summons fish', await st(`__g.game.R.crabs === 1 && __g.entities.list.some(e => e.fly)`));
// 暂停 / 继续
await page.keyboard.press('KeyP'); await sleep(250);
ok('pause', await st(`__g.game.state === 'pause' && document.getElementById('pause').classList.contains('show')`));
await page.screenshot({ path: 'shots/k_pause.png' });
await page.keyboard.press('KeyP'); await sleep(250);
ok('resume', await st(`__g.game.state === 'play'`));
await page.keyboard.press('KeyC'); await sleep(200);
ok('camera cycle', await st(`__g.cam.mode === 'side'`));
// 撞障碍掉血直到结算
await st(`__g.game.p.invuln = 0; __g.cam.set('chase'); 0`);
for (let i = 0; i < 3; i++) { await st(`{ const g = __g.game; g.p.invuln = 0; g.p.crashT = 0; g.p.y = 0; g.p.grounded = true; __g.entities.spawn('barrier', g.p.dist + 2.5, g.p.lat, 0); 0 }`); await sleep(900); }
ok('hearts lost', await st(`__g.game.p.hearts === 0`), 'state=' + (await st(`__g.game.state`)));
await sleep(2600);
ok('game over screen', await st(`__g.game.state === 'over' && document.getElementById('over').classList.contains('show')`));
await page.screenshot({ path: 'shots/k_over.png' });
const wallet = await st(`__g.save.d.fish`);
await st(`__g.save.d.fish = 500; 0`);
await st(`document.getElementById('reviveBtn').disabled = false; 0`);
await page.click('#reviveBtn'); await sleep(400);
ok('revive', await st(`__g.game.state === 'play' && __g.game.p.hearts === 2 && __g.save.d.fish === 420`), 'wallet before=' + wallet);
await page.keyboard.press('KeyP'); await sleep(200);
await page.click('[data-act=quit]'); await sleep(1500);
ok('quit to title', await st(`__g.game.state === 'title' && document.getElementById('title').classList.contains('show')`));
await page.click('[data-act=missions]'); await sleep(400); await page.screenshot({ path: 'shots/k_missions.png' });
await page.keyboard.press('Escape'); await sleep(300);
ok('esc closes panel', await st(`__g.ui.screen === 'title'`));
await page.click('[data-act=settings]'); await sleep(400); await page.screenshot({ path: 'shots/k_settings.png' });
await page.click('#settings [data-act=back]'); await sleep(300);
await page.click('[data-act=help]'); await sleep(400); await page.screenshot({ path: 'shots/k_help.png' });
await page.click('#help .btn.primary'); await sleep(300);
await page.click('[data-act=zen]'); await sleep(2500);
ok('zen mode', await st(`__g.game.mode === 'zen' && document.body.classList.contains('zen')`));
await page.screenshot({ path: 'shots/k_zen.png' });
console.log('achievements:', await st(`Object.keys(__g.save.d.ach).join(',')`));
if (logs.length) console.log(logs.slice(0, 30).join('\n'));
await browser.close();
