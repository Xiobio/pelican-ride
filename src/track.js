// 赛道：路线中心线、起伏、分区（纯函数，不依赖 three）
import { clamp, lerp, smooth, makeRng, fbm, vnoise } from './util.js';

export const SEA = -1;            // 海在 -X 一侧（左手边）
export const ROAD_HALF = 4.0;     // 路面半宽
export const EDGE = 5.3;          // 路 + 路肩半宽（地形从这里往外展开）
export const LANES = [-2.6, 0, 2.6];
export const CHUNK = 40;          // 区块长度 (m)

// 分区参数：roadY 路面高度；seaW 路肩到水线的水平距离；hillH/hillW 陆侧山体高度与爬升宽度；
// rock 岩石感；sand 沙地感；bridge 是否为跨海桥；trees 植被密度
export const ZONES = {
  coast:   { key: 'coast',   name: '海岸公路', en: 'Coast Road',      emoji: '🌊', roadY: 3.4, seaW: 15, hillH: 11, hillW: 46, rock: 0.55, sand: 0.25, bridge: 0, hills: 1.0,
             grass: [0.36, 0.52, 0.22], grass2: [0.50, 0.60, 0.26], sandC: [0.86, 0.76, 0.55], rockC: [0.42, 0.40, 0.40] },
  village: { key: 'village', name: '渔村小镇', en: 'Fishing Village', emoji: '🏘️', roadY: 2.8, seaW: 12, hillH: 6,  hillW: 60, rock: 0.25, sand: 0.35, bridge: 0, hills: 0.5,
             grass: [0.42, 0.55, 0.26], grass2: [0.58, 0.62, 0.32], sandC: [0.84, 0.74, 0.56], rockC: [0.46, 0.44, 0.42] },
  beach:   { key: 'beach',   name: '棕榈沙滩', en: 'Palm Beach',      emoji: '🏖️', roadY: 1.7, seaW: 30, hillH: 3.5, hillW: 50, rock: 0.1,  sand: 1.0,  bridge: 0, hills: 0.35,
             grass: [0.56, 0.62, 0.30], grass2: [0.80, 0.72, 0.50], sandC: [0.93, 0.83, 0.60], rockC: [0.55, 0.50, 0.44] },
  cliff:   { key: 'cliff',   name: '灯塔悬崖', en: 'Lighthouse Cliffs', emoji: '🗼', roadY: 15,  seaW: 9,  hillH: 24, hillW: 20, rock: 1.0,  sand: 0.0,  bridge: 0, hills: 1.3,
             grass: [0.30, 0.44, 0.22], grass2: [0.44, 0.48, 0.30], sandC: [0.62, 0.58, 0.50], rockC: [0.40, 0.37, 0.38] },
  bridge:  { key: 'bridge',  name: '跨海大桥', en: 'Sea Bridge',      emoji: '🌉', roadY: 10,  seaW: 12, hillH: 8,  hillW: 40, rock: 0.5,  sand: 0.2,  bridge: 1, hills: 0.25,
             grass: [0.36, 0.52, 0.22], grass2: [0.50, 0.60, 0.26], sandC: [0.86, 0.76, 0.55], rockC: [0.42, 0.40, 0.40] },
  blossom: { key: 'blossom', name: '樱花坡道', en: 'Blossom Hill',    emoji: '🌸', roadY: 7.5, seaW: 20, hillH: 15, hillW: 52, rock: 0.35, sand: 0.1,  bridge: 0, hills: 1.5,
             grass: [0.42, 0.58, 0.30], grass2: [0.62, 0.66, 0.40], sandC: [0.86, 0.78, 0.62], rockC: [0.48, 0.44, 0.46] },
};
const ORDER = ['village', 'beach', 'cliff', 'bridge', 'blossom', 'coast'];
const BLEND = 70; // 分区过渡长度

export class Track {
  constructor(seed = 1) { this.reset(seed); }

  reset(seed) {
    this.seed = seed >>> 0;
    const r = makeRng(this.seed ^ 0x9e3779b9);
    this.ph = [r() * 100, r() * 100, r() * 100, r() * 100, r() * 100, r() * 100];
    this.noiseOff = r() * 1000;
    // 分区序列：起点固定海岸公路，其后打乱循环
    this.zones = [{ key: 'coast', start: -200, end: 460 }];
    this._zr = makeRng(this.seed ^ 0x51ed270b);
    this._bag = [];
    this._extend(4000);
  }

  _extend(toS) {
    let last = this.zones[this.zones.length - 1];
    while (last.end < toS) {
      if (!this._bag.length) {
        this._bag = ORDER.slice();
        for (let i = this._bag.length - 1; i > 0; i--) { const j = Math.floor(this._zr() * (i + 1)); [this._bag[i], this._bag[j]] = [this._bag[j], this._bag[i]]; }
        if (this._bag[this._bag.length - 1] === last.key) this._bag.reverse();
      }
      const key = this._bag.pop();
      const len = key === 'bridge' ? this._zr.range(420, 520) : this._zr.range(460, 640);
      last = { key, start: last.end, end: last.end + len };
      this.zones.push(last);
    }
  }

  zoneIndexAt(s) {
    if (s > this.zones[this.zones.length - 1].end - 800) this._extend(s + 4000);
    const z = this.zones;
    // 区间不多，线性 + 缓存
    let i = this._zi || 0;
    if (i >= z.length) i = 0;
    while (i > 0 && s < z[i].start) i--;
    while (i < z.length - 1 && s >= z[i].end) i++;
    this._zi = i;
    return i;
  }
  zoneAt(s) { return ZONES[this.zones[this.zoneIndexAt(s)].key]; }

  // 混合后的分区数值参数。out: {roadY, seaW, hillH, hillW, rock, sand, bridge, hills, w(主区权重), a, b}
  params(s, out = {}) {
    const i = this.zoneIndexAt(s);
    const z = this.zones[i];
    const A = ZONES[z.key];
    let B = A, t = 0;
    const half = BLEND * 0.5;
    if (s > z.end - half && i < this.zones.length - 1) { B = ZONES[this.zones[i + 1].key]; t = smooth((s - (z.end - half)) / BLEND); }
    else if (s < z.start + half && i > 0) { B = ZONES[this.zones[i - 1].key]; t = smooth(((z.start + half) - s) / BLEND); }
    out.a = A; out.b = B; out.t = t;
    out.roadY = lerp(A.roadY, B.roadY, t);
    out.seaW = lerp(A.seaW, B.seaW, t);
    if (A.key === 'cliff') { const mid = (z.start + z.end) * 0.5, q = (s - mid) / 38; out.seaW += 34 * Math.exp(-q * q) * (1 - t); } // 灯塔岬角
    out.hillH = lerp(A.hillH, B.hillH, t);
    out.hillW = lerp(A.hillW, B.hillW, t);
    out.rock = lerp(A.rock, B.rock, t);
    out.sand = lerp(A.sand, B.sand, t);
    out.hills = lerp(A.hills, B.hills, t);
    // 桥的过渡更陡一些，让桥头显得干脆
    const br = lerp(A.bridge, B.bridge, t);
    out.bridge = smooth(clamp((br - 0.25) / 0.5));
    return out;
  }

  // 路中心线的横向偏移
  cx(s) {
    const k = smooth(clamp((s - 40) / 220));
    const p = this.ph;
    return k * (17 * Math.sin(s * 0.0088 + p[0]) + 8 * Math.sin(s * 0.0205 + p[1]) + 3 * Math.sin(s * 0.041 + p[2]));
  }
  dcx(s) { return (this.cx(s + 0.5) - this.cx(s - 0.5)); }

  // 路面高度
  cy(s) {
    const P = this.params(s, this._tp || (this._tp = {}));
    const p = this.ph;
    const k = smooth(clamp((s - 20) / 160));
    const roll = (1.5 * Math.sin(s * 0.0147 + p[3]) + 0.8 * Math.sin(s * 0.0331 + p[4]) + 0.35 * Math.sin(s * 0.071 + p[5])) * P.hills * k;
    return P.roadY + roll;
  }
  dcy(s) { return (this.cy(s + 0.5) - this.cy(s - 0.5)); }

  // 地形高度：u 为相对路中心的横向偏移（海侧为负）
  // P 需要是 params(s) 的结果，roadY 传入 cy(s)
  terrainH(u, s, P, roadY) {
    const au = Math.abs(u);
    if (au <= EDGE) return roadY - 0.1;
    const d = au - EDGE;
    const no = this.noiseOff;
    let h;
    if (u * SEA > 0) {
      // 海侧：护坡 -> 沙滩 -> 入水
      const t = d / P.seaW;
      const n = fbm(u * 0.11 + no, s * 0.11, 3) - 0.5;
      if (t < 1) {
        const k = 1 - t;
        // 崖区（rock 高）更陡直，沙滩区更平缓
        const shape = lerp(k * k * (3 - 2 * k), Math.pow(k, 0.55), P.rock * 0.8);
        h = roadY * shape + 0.25 * t;
        h += n * (0.6 + P.rock * 3.2) * Math.sin(Math.PI * clamp(t)) ;
        h = Math.max(h, 0.22 * (1 - t) + 0.02);
      } else {
        h = 0.25 - (d - P.seaW) * 0.16 + n * 0.5;
        h = Math.max(h, -6);
      }
    } else {
      // 陆侧：缓坡 -> 山丘
      const t = clamp(d / P.hillW);
      const st = t * t * (3 - 2 * t);
      const n1 = fbm(u * 0.028 + no, s * 0.028 + 31.7, 4);
      const n2 = fbm(u * 0.09 + no + 50, s * 0.09, 2) - 0.5;
      h = roadY + P.hillH * st * (0.55 + 0.9 * n1) + n2 * (0.5 + P.rock * 2.5) * Math.min(1, d / 6);
      // 远处继续抬升成山
      if (d > P.hillW) h += (d - P.hillW) * 0.12 * (0.4 + n1);
      // 贴近路边留一条平整的人行带
      const flat = clamp((d - 2.2) / 3.5);
      h = lerp(roadY - 0.02, h, flat * flat);
    }
    if (P.bridge > 0.001) h = lerp(h, -7, P.bridge);
    return h;
  }

  // 水线相对路中心的横向位置（海侧，负值）。桥区视为无穷近（两侧皆海）
  shoreU(s, P) { return SEA * (EDGE + P.seaW); }
}

export const DIFFICULTY = (dist) => clamp(dist / 4200);
