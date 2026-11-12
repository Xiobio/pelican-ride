// 游戏数据：成就、任务模板、强化、提示文案
import { L } from './i18n.js';

export const ACHIEVEMENTS = [
  { id: 'fish1', e: '🐟', n: L('第一条鱼', 'First Fish'), d: L('张嘴就是干饭', 'Open wide — dinner time'), t: (R) => R.fish >= 1 },
  { id: 'fish50', e: '🧺', n: L('满载而归', 'Full Basket'), d: L('单局抓到 50 条鱼', 'Catch 50 fish in one run'), t: (R) => R.fish >= 50 },
  { id: 'fish150', e: '🎣', n: L('海岸渔王', 'Coast Fisher King'), d: L('单局抓到 150 条鱼', 'Catch 150 fish in one run'), t: (R) => R.fish >= 150 },
  { id: 'fish1000', e: '🏭', n: L('鱼类加工厂', 'Fish Factory'), d: L('累计抓到 1000 条鱼', 'Catch 1,000 fish in total'), t: (R, T) => T.fish + R.fish >= 1000 },
  { id: 'gold1', e: '✨', n: L('金色传说', 'Golden Legend'), d: L('吞下一条金鱼', 'Swallow a goldfish'), t: (R) => R.gold >= 1 },
  { id: 'gold10', e: '👑', n: L('点鱼成金', 'Midas Beak'), d: L('单局抓到 10 条金鱼', 'Catch 10 goldfish in one run'), t: (R) => R.gold >= 10 },
  { id: 'jump1', e: '🪽', n: L('起飞！', 'Liftoff!'), d: L('第一次跳跃', 'Your first jump'), t: (R) => R.jumps >= 1 },
  { id: 'trick1', e: '🤸', n: L('杂技入门', 'Acrobat 101'), d: L('完成第一个空中特技', 'Land your first air trick'), t: (R) => R.tricks >= 1 },
  { id: 'trick3', e: '🎪', n: L('空中芭蕾', 'Air Ballet'), d: L('一次腾空完成 3 个特技', 'Do 3 tricks in a single jump'), t: (R) => R.maxAirTricks >= 3 },
  { id: 'trickAll', e: '🎬', n: L('全能特技王', 'Stunt Master'), d: L('单局用过后空翻、转体和超人式', 'Use backflip, spin and superman in one run'), t: (R) => R.backflips > 0 && R.spins > 0 && R.supermans > 0 },
  { id: 'wheelie', e: '🛞', n: L('放手翘头', 'Look, No Wings'), d: L('保持翘头 5 秒', 'Hold a wheelie for 5 seconds'), t: (R) => R.wheelieMax >= 5 },
  { id: 'speed45', e: '💨', n: L('疾风鹈鹕', 'Gale Pelican'), d: L('时速突破 45 km/h', 'Break 45 km/h'), t: (R) => R.maxSpeed >= 45 },
  { id: 'speed70', e: '🚀', n: L('超速罚单', 'Speeding Ticket'), d: L('时速突破 70 km/h', 'Break 70 km/h'), t: (R) => R.maxSpeed >= 70 },
  { id: 'dist1', e: '🛣️', n: L('骑行 1 公里', '1 km Ridden'), d: L('海岸线才刚开始', 'The coastline has only just begun'), t: (R) => R.dist >= 1000 },
  { id: 'dist5', e: '🗺️', n: L('骑行 5 公里', '5 km Ridden'), d: L('真正的长途鹈鹕', 'A true long-haul pelican'), t: (R) => R.dist >= 5000 },
  { id: 'dist10', e: '🌍', n: L('环岛骑士', 'Island Rider'), d: L('单局骑行 10 公里', 'Ride 10 km in one run'), t: (R) => R.dist >= 10000 },
  { id: 'zones', e: '🧭', n: L('海岸全景', 'Coast Panorama'), d: L('单局骑过全部 6 种路段', 'Ride through all 6 zones in one run'), t: (R) => R.zones >= 6 },
  { id: 'night', e: '🌙', n: L('夜骑', 'Night Ride'), d: L('星光与路灯作伴', 'Starlight and street lamps for company'), t: (R) => R.night },
  { id: 'rain', e: '🌧️', n: L('风雨无阻', 'Rain or Shine'), d: L('在雨中骑行', 'Ride in the rain'), t: (R) => R.rain },
  { id: 'rainbow', e: '🌈', n: L('雨后彩虹', 'After the Rain'), d: L('见到彩虹', 'See a rainbow'), t: (R) => R.rainbow },
  { id: 'whale', e: '🐋', n: L('鲸喜', 'Whale Hello'), d: L('目睹鲸鱼跃出海面', 'Watch a whale breach'), t: (R) => R.whale },
  { id: 'aurora', e: '🌌', n: L('极光之夜', 'Aurora Night'), d: L('在夜空中看到极光', 'See the aurora in the night sky'), t: (R) => R.aurora },
  { id: 'bell', e: '🔔', n: L('铃铃铃', 'Ring Ring Ring'), d: L('单局赶走 10 只海鸥', 'Shoo 10 gulls in one run'), t: (R) => R.gulls >= 10 },
  { id: 'honk', e: '📣', n: L('嘎——！', 'SQUAWK!'), d: L('单局吓跑 8 只螃蟹', 'Scare off 8 crabs in one run'), t: (R) => R.crabs >= 8 },
  { id: 'near', e: '😎', n: L('擦肩而过', 'Close Shave'), d: L('单局 12 次极限闪避', '12 near misses in one run'), t: (R) => R.near >= 12 },
  { id: 'combo30', e: '🔥', n: L('停不下来', 'Can’t Stop'), d: L('达成 30 连击', 'Reach a 30 combo'), t: (R) => R.maxCombo >= 30 },
  { id: 'combo80', e: '☄️', n: L('连击大师', 'Combo Master'), d: L('达成 80 连击', 'Reach an 80 combo'), t: (R) => R.maxCombo >= 80 },
  { id: 'fever', e: '🎉', n: L('鱼群狂热', 'Fish Frenzy'), d: L('第一次进入狂热时间', 'Enter Frenzy for the first time'), t: (R) => R.fevers >= 1 },
  { id: 'fever3', e: '🪩', n: L('派对鹈鹕', 'Party Pelican'), d: L('单局 3 次狂热', '3 Frenzies in one run'), t: (R) => R.fevers >= 3 },
  { id: 'nohit', e: '🛡️', n: L('毫发无伤', 'Unscathed'), d: L('连续 2 公里不受伤', 'Ride 2 km without getting hurt'), t: (R) => R.noHit >= 2000 },
  { id: 'smash', e: '💥', n: L('横冲直撞', 'Wrecking Bird'), d: L('单局冲刺撞飞 12 个障碍', 'Smash 12 hazards while boosting in one run'), t: (R) => R.smash >= 12 },
  { id: 'ring', e: '⭕', n: L('穿环高手', 'Ring Master'), d: L('单局穿过 10 个金环', 'Fly through 10 gold rings in one run'), t: (R) => R.rings >= 10 },
  { id: 'score20k', e: '🥉', n: L('两万分', '20K Club'), d: L('单局得分 20,000', 'Score 20,000 in one run'), t: (R) => R.score >= 20000 },
  { id: 'score60k', e: '🥈', n: L('六万分', '60K Club'), d: L('单局得分 60,000', 'Score 60,000 in one run'), t: (R) => R.score >= 60000 },
  { id: 'score150k', e: '🥇', n: L('十五万分', '150K Club'), d: L('单局得分 150,000', 'Score 150,000 in one run'), t: (R) => R.score >= 150000 },
  { id: 'shop', e: '🛍️', n: L('第一次换装', 'First Makeover'), d: L('在车库购买一件物品', 'Buy something in the Garage'), t: (R, T) => T.bought >= 1 },
  { id: 'mission5', e: '📋', n: L('勤劳鹈鹕', 'Busy Pelican'), d: L('完成 5 个任务', 'Complete 5 missions'), t: (R, T) => T.missions >= 5 },
];

// 任务模板。kind: 'run' 单局内达成 / 'sum' 跨局累计
export const MISSIONS = [
  { id: 'fish', kind: 'run', key: 'fish', goals: [30, 60, 100, 160], text: (n) => L(`单局抓到 ${n} 条鱼`, `Catch ${n} fish in one run`), e: '🐟' },
  { id: 'fishSum', kind: 'sum', key: 'fish', goals: [150, 300, 500], text: (n) => L(`累计抓到 ${n} 条鱼`, `Catch ${n} fish in total`), e: '🧺' },
  { id: 'dist', kind: 'run', key: 'dist', goals: [800, 1500, 2500, 4000], text: (n) => L(`单局骑行 ${n} 米`, `Ride ${n} m in one run`), e: '🛣️' },
  { id: 'distSum', kind: 'sum', key: 'dist', goals: [3000, 6000, 10000], text: (n) => L(`累计骑行 ${n / 1000} 公里`, `Ride ${n / 1000} km in total`), e: '🗺️' },
  { id: 'trick', kind: 'sum', key: 'tricks', goals: [5, 12, 25], text: (n) => L(`完成 ${n} 个空中特技`, `Land ${n} air tricks`), e: '🤸' },
  { id: 'backflip', kind: 'sum', key: 'backflips', goals: [3, 8], text: (n) => L(`完成 ${n} 次后空翻`, `Land ${n} backflips`), e: '🔄' },
  { id: 'superman', kind: 'sum', key: 'supermans', goals: [3, 6], text: (n) => L(`完成 ${n} 次超人式`, `Land ${n} supermans`), e: '🦸' },
  { id: 'near', kind: 'run', key: 'near', goals: [5, 10, 16], text: (n) => L(`单局 ${n} 次极限闪避`, `${n} near misses in one run`), e: '😎' },
  { id: 'combo', kind: 'run', key: 'maxCombo', goals: [15, 30, 50], text: (n) => L(`达成 ${n} 连击`, `Reach a ${n} combo`), e: '🔥' },
  { id: 'gull', kind: 'sum', key: 'gulls', goals: [6, 15], text: (n) => L(`按铃赶走 ${n} 只海鸥`, `Shoo ${n} gulls with the bell`), e: '🔔' },
  { id: 'crab', kind: 'sum', key: 'crabs', goals: [4, 10], text: (n) => L(`大叫吓跑 ${n} 只螃蟹`, `Scare off ${n} crabs`), e: '🦀' },
  { id: 'gold', kind: 'sum', key: 'gold', goals: [4, 10, 20], text: (n) => L(`抓到 ${n} 条金鱼`, `Catch ${n} goldfish`), e: '✨' },
  { id: 'ring', kind: 'sum', key: 'rings', goals: [5, 12], text: (n) => L(`穿过 ${n} 个金环`, `Fly through ${n} gold rings`), e: '⭕' },
  { id: 'fever', kind: 'sum', key: 'fevers', goals: [1, 3, 5], text: (n) => L(`进入 ${n} 次狂热时间`, `Enter Frenzy ${n}×`), e: '🎉' },
  { id: 'smash', kind: 'sum', key: 'smash', goals: [5, 12], text: (n) => L(`冲刺撞飞 ${n} 个障碍`, `Smash ${n} hazards while boosting`), e: '💥' },
  { id: 'nohit', kind: 'run', key: 'noHit', goals: [600, 1200, 2000], text: (n) => L(`连续 ${n} 米不受伤`, `Ride ${n} m without getting hurt`), e: '🛡️' },
  { id: 'score', kind: 'run', key: 'score', goals: [8000, 20000, 40000, 80000], text: (n) => L(`单局得分 ${n.toLocaleString('en-US')}`, `Score ${n.toLocaleString('en-US')} in one run`), e: '🏆' },
  { id: 'wheelie', kind: 'run', key: 'wheelieMax', goals: [3, 6], text: (n) => L(`保持翘头 ${n} 秒`, `Hold a wheelie for ${n}s`), e: '🛞' },
  { id: 'kick', kind: 'sum', key: 'kicks', goals: [5, 12], text: (n) => L(`踢飞 ${n} 个沙滩球或沙堡`, `Kick ${n} beach balls or sandcastles`), e: '🏐' },
  { id: 'perfect', kind: 'sum', key: 'perfect', goals: [4, 10], text: (n) => L(`${n} 次完美落地`, `${n} perfect landings`), e: '🎯' },
];

export const UPGRADES = {
  magnet: { n: L('磁力喉囊', 'Magnetic Pouch'), e: '🧲', d: L('磁铁持续时间 +2 秒 / 级', 'Magnet lasts +2s per level'), max: 3, cost: [300, 800, 1800] },
  helmet: { n: L('加厚头盔', 'Thick Helmet'), e: '⛑️', d: L('生命上限 +1 / 级', '+1 max heart per level'), max: 2, cost: [800, 2400] },
  chili: { n: L('特辣辣椒酱', 'Extra Hot Sauce'), e: '🌶️', d: L('冲刺消耗 -15% / 级', 'Boost drains 15% slower per level'), max: 3, cost: [300, 800, 1800] },
  appetite: { n: L('好胃口', 'Big Appetite'), e: '😋', d: L('连击保持时间 +0.6 秒 / 级', 'Combo timer +0.6s per level'), max: 3, cost: [250, 700, 1600] },
  radar: { n: L('金鱼雷达', 'Goldfish Radar'), e: '📡', d: L('金鱼出现率 +30% / 级', 'Goldfish appear 30% more often per level'), max: 3, cost: [400, 1000, 2200] },
};

export const TIPS = [
  L('空中按 T（配合方向键）做特技，落地前要转完哦', 'Press T in the air (with arrow keys) for tricks — finish before you land'),
  L('跳起后再按一次空格可以扑翅二段跳，按住空格能滑翔', 'Press Space again in the air to flap; hold Space to glide'),
  L('按 B 响铃可以赶走路上的海鸥，按 H 大叫能吓跑螃蟹', 'B rings the bell to shoo gulls; H squawks to scare off crabs'),
  L('大叫还会把海里的鱼吓得跳出水面——接住它们！', 'Squawking also startles fish out of the sea — catch them!'),
  L('贴着障碍擦肩而过能获得「极限闪避」奖励', 'Skim past a hazard for a Near Miss bonus'),
  L('冲刺（Shift）时无敌，可以把障碍统统撞飞', 'You’re invincible while boosting (Shift) — smash right through'),
  L('连击越高倍率越高，别让连击条走完', 'Higher combo, higher multiplier — don’t let the combo bar run out'),
  L('攒满狂热槽会下起鱼雨，分数翻倍', 'Fill the Frenzy meter for a rain of fish and double score'),
  L('在地面按住 T 可以放手翘头，持续加分并积攒冲刺', 'Hold T on the ground for a wheelie: steady points and boost'),
  L('沙滩球和沙堡不会受伤——放心踢飞它们', 'Beach balls and sandcastles are harmless — kick away'),
];

export const CAM_NAMES = { chase: L('追随', 'Chase'), side: L('侧面跟拍', 'Side'), cine: L('电影运镜', 'Cinematic'), pov: L('鹈鹕视角', 'Pelican POV'), orbit: L('自由环绕', 'Orbit') };
