// 中英双语。语言在页面加载时确定（切换语言会重新加载页面），所以所有文案都可以直接用 L(中文, English) 就地书写
const SAVE_KEY = 'pelicanRide.save.v1';
function detect() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q) return q;
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    if (s.settings && s.settings.lang) return s.settings.lang;
  } catch (e) { /* 读不到存档就看浏览器语言 */ }
  const nav = (typeof navigator !== 'undefined' && (navigator.language || '')) || 'zh';
  return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
export const LANG = detect() === 'en' ? 'en' : 'zh';
export const EN = LANG === 'en';
export const L = (zh, en) => (EN ? en : zh);

// ---- 静态 HTML 的英文文案：选择器 -> 文本（替换元素的第一个文本节点，保留子元素） ----
const TEXT = {
  '#fallback': 'Your browser does not support WebGL2, so the 3D scene cannot be shown. Please use a recent Chrome / Edge / Safari / Firefox.',
  '#title h1': 'Pelican Ride',
  '#title .tagline': 'A COASTAL BIKE ADVENTURE',
  '#title [data-act=play]': '▶ Start Adventure',
  '#title [data-act=daily]': '📅 Daily Run',
  '#title [data-act=zen]': '🌅 Zen Ride',
  '#title [data-act=garage]': '🧢 Garage',
  '#title [data-act=missions]': '📋 Missions',
  '#title [data-act=settings]': '⚙️ Settings',
  '#title [data-act=help]': '❓ Help',
  '#title .title-links a:first-child': 'Source code',
  '#feverTxt': 'Frenzy',
  '[data-act=weather]': '🌧️ Weather',
  '[data-act=auto]': '🤖 Autopilot',
  '[data-act=finishZen]': '🏁 Finish',
  '#pause h2': '⏸ Paused',
  '#pause [data-act=resume]': 'Resume',
  '#pause [data-act=restart]': 'Restart',
  '#pause [data-act=settings]': 'Settings',
  '#pause [data-act=quit]': 'End Run',
  '#overBadge': '🎉 New Record',
  '#over .over-score small': 'Best ',
  '#earnL': 'This run',
  '#walletL': 'Wallet',
  '#over [data-act=again]': '🔁 Play Again',
  '#reviveBtn': '❤️ Continue ',
  '#over [data-act=garage]': '🧢 Garage',
  '#over [data-act=missions]': '📋 Missions',
  '#over [data-act=home]': '🏠 Menu',
  '#garage h2': '🧢 Garage',
  '#garage .note': 'Drag to look around · Tap an item you can’t afford yet to try it on',
  '#missions h2': '📋 Missions & Achievements',
  '#settings h2': '⚙️ Settings',
  '#settings [data-act=wipe]': 'Erase save data',
  '#help h2': '❓ How to Play',
  '#help .btn.primary': 'Got it',
};
const LISTS = {
  '#missions h3': ['Active missions', 'Achievements '],
  '#settings .set > span': ['Language', 'Quality', 'Master volume', 'Music', 'Sound effects', 'Camera shake', 'Tutorial hints', 'Show FPS'],
};
const TITLES = {
  '.title-stats span:nth-child(1)': 'Fish (currency)', '.title-stats span:nth-child(2)': 'Adventure high score', '.title-stats span:nth-child(3)': 'Longest ride', '.title-stats span:nth-child(4)': 'Achievements',
  '.tools [data-act=cam]': 'Camera (C)', '.tools [data-act=music]': 'Music (M)', '.tools [data-act=shot]': 'Screenshot (K)', '.tools [data-act=pause]': 'Pause (P)', '[data-act=flow]': 'Time flow',
};
const HTML = {
  '#help .keys': `
      <li><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd> Steer</li><li><kbd>W</kbd> Pedal hard　<kbd>S</kbd> Brake</li>
      <li><kbd>Space</kbd> Jump · press again in the air to flap (double jump)</li><li><b>Hold</b> <kbd>Space</kbd> in the air to glide</li>
      <li><kbd>T</kbd> Air tricks: backflip · with <kbd>←</kbd><kbd>→</kbd> spin · with <kbd>↑</kbd> superman</li><li>Hold <kbd>T</kbd> on the ground for a wheelie</li>
      <li><kbd>Shift</kbd> Chili boost: invincible + smash hazards</li><li><kbd>B</kbd> Bell: shoo the gulls</li>
      <li><kbd>H</kbd> Squawk: scare crabs, startle fish out of the sea</li><li><kbd>C</kbd> Camera　<kbd>P</kbd> Pause　<kbd>M</kbd> Music</li>
      <li><kbd>K</kbd> Screenshot　<kbd>F</kbd> Fullscreen　<kbd>U</kbd> Hide UI</li><li><kbd>N</kbd> Skip ahead 3 hours</li>`,
  '#help .note': 'Catch fish to build a combo → the multiplier climbs → fill the Frenzy meter for a rain of fish. Tricks, near misses and rings all charge your boost. Hitting a hazard costs a heart; lose all three and the run ends. Fish you catch go into your wallet — spend them in the Garage on hats, scarves, paint and upgrades. Touch and gamepad are supported.',
};

function setText(el, text) {
  for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) { n.nodeValue = text; return; }
  el.insertBefore(document.createTextNode(text), el.firstChild);
}
// 在页面启动时调用一次
export function applyDom() {
  document.documentElement.lang = EN ? 'en' : 'zh-CN';
  if (!EN) return;
  document.title = 'Pelican Ride · A Coastal Bike Adventure';
  for (const sel in TEXT) document.querySelectorAll(sel).forEach((el) => setText(el, TEXT[sel]));
  for (const sel in LISTS) document.querySelectorAll(sel).forEach((el, i) => { if (LISTS[sel][i] !== undefined) setText(el, LISTS[sel][i]); });
  for (const sel in TITLES) document.querySelectorAll(sel).forEach((el) => { el.title = TITLES[sel]; });
  for (const sel in HTML) document.querySelectorAll(sel).forEach((el) => { el.innerHTML = HTML[sel]; });
  const ts = document.getElementById('timeSlider'); if (ts) ts.setAttribute('aria-label', 'Time of day');
}

// 保存选择并重新加载
export function switchLang(lang, save) {
  save.d.settings.lang = lang; save.flush();
  const u = new URL(location.href);
  if (u.searchParams.has('lang')) { u.searchParams.delete('lang'); location.replace(u.toString()); } else location.reload();
}
