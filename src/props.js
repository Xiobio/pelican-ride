// 程序化道具原型库：所有模型都由基础体拼装，并烘焙顶点色
import * as THREE from 'three';
import { Geo } from './geo.js';
import { makeRng, TAU } from './util.js';
import { L } from './i18n.js';

const PI = Math.PI;
const WHITE = 0xf2efe6, WOOD = 0x8a5a36, WOOD_D = 0x5e3c24, METAL = 0x4a5058, METAL_L = 0x9aa3ad;

function frondGeometry(len, width, droop, segs = 5) {
  // 一片棕榈叶：沿 +Z 伸展并下垂的带状面（双层 V 形）
  const pos = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const z = len * t * (1 - 0.18 * t), y = -droop * t * t * len + 0.25 * len * t * (1 - t);
    const w = width * Math.sin(Math.PI * Math.min(1, t * 0.92 + 0.08)) * (1 - t * 0.35);
    pos.push(-w, y - w * 0.35, z, 0, y, z, w, y - w * 0.35, z);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 3, b = a + 3;
    idx.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function prismGeometry() { // 三棱柱（屋顶）：底宽 1、高 1、长 1（沿 Z）
  const g = new THREE.BufferGeometry();
  const p = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex([0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4, 0, 1, 4, 0, 4, 3]);
  return g;
}
const PRISM = prismGeometry();
const TRI = (() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, -1, 0, 0.5, 0, 0, -0.5, 0, 0, 0, -1, 0], 3)); return g; })();
const HULL = new THREE.SphereGeometry(1, 10, 5, 0, TAU, PI / 2, PI / 2);

export function buildProps() {
  const P = {};
  const rng = makeRng(20240611);

  // ---------- 路灯 ----------
  {
    const g = new Geo(), glow = new Geo();
    g.cyl(0.09, 0.13, 0.5, 8, { p: [0, 0.25, 0], c: 0x23262c });
    g.tube([0, 0.5, 0], [0, 5.0, 0], 0.06, 6, { c: 0x2b2f36 });
    // 朝 -X（路中央）弯出的灯臂
    let prev = [0, 5.0, 0];
    for (let i = 1; i <= 5; i++) { const a = (i / 5) * (PI / 2); const pt = [-Math.sin(a) * 1.25, 5.0 + (1 - Math.cos(a)) * -0.0 + Math.sin(a) * 0.55, 0]; g.tube(prev, pt, 0.045, 5, { c: 0x2b2f36 }); prev = pt; }
    g.box(0.62, 0.1, 0.26, { p: [-1.5, 5.52, 0], c: 0x23262c });
    glow.box(0.5, 0.05, 0.2, { p: [-1.5, 5.46, 0], c: 0xffe2a8 });
    P.lamp = { solid: g, glow, halo: [[-1.5, 5.38, 0, 3.6, 1.0, 0.82, 0.52]] };
  }
  // ---------- 桥灯（矮，双侧） ----------
  {
    const g = new Geo(), glow = new Geo();
    g.tube([0, 0, 0], [0, 3.2, 0], 0.05, 6, { c: METAL_L });
    glow.sphere(0.16, 8, 6, { p: [0, 3.3, 0], c: 0xdff3ff });
    P.bridgeLamp = { solid: g, glow, halo: [[0, 3.3, 0, 3.6, 0.75, 0.9, 1.0]] };
  }

  // ---------- 棕榈 ----------
  P.palms = [];
  for (let v = 0; v < 4; v++) {
    const g = new Geo();
    const h = 6.5 + rng() * 3.5, lean = (rng() - 0.5) * 2.6, leanZ = (rng() - 0.5) * 1.4;
    let prev = [0, -0.4, 0]; const N = 7;
    let top = prev;
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      const pt = [lean * t * t, h * t, leanZ * t * t];
      const r0 = 0.26 - 0.12 * ((i - 1) / N), r1 = 0.26 - 0.12 * t;
      g.tube(prev, pt, r0, 7, { r2: r1 * 1.12, c: 0x8d6a48, c2: 0x6a4a32, cj: 0.2 });
      prev = pt; top = pt;
    }
    const nf = 9 + (v % 2) * 2;
    const fl = 3.0 + rng() * 0.8;
    for (let i = 0; i < nf; i++) {
      const a = (i / nf) * TAU + rng() * 0.3;
      const tilt = -0.35 + rng() * 0.5;
      g.add(frondGeometry(fl * (0.85 + rng() * 0.3), 0.52, 0.2 + rng() * 0.14), { p: top, r: [tilt, a, 0], order: 'YXZ', c: i % 3 ? 0x2f7d3a : 0x3f9446, c2: 0x1f5a2c, cj: 0.25 });
    }
    for (let i = 0; i < 3; i++) g.sphere(0.2, 6, 5, { p: [top[0] + Math.cos(i * 2.1) * 0.25, top[1] - 0.22, top[2] + Math.sin(i * 2.1) * 0.25], c: 0x5a3d22 });
    P.palms.push(g);
  }

  // ---------- 阔叶树 ----------
  P.trees = [];
  for (let v = 0; v < 4; v++) {
    const g = new Geo();
    const h = 2.2 + rng() * 1.4;
    g.tube([0, -0.3, 0], [0.1, h, 0], 0.26, 6, { r2: 0.14, c: 0x6b4a34, c2: 0x4a3122 });
    const greens = [[0x4c8a34, 0x2c5a24], [0x5a9a3a, 0x356428], [0x3f7d38, 0x234e24], [0x6aa040, 0x3d6c2a]][v];
    const blobs = 3 + (v % 2);
    for (let i = 0; i < blobs; i++) {
      const a = (i / blobs) * TAU + rng(), rr = 1.25 + rng() * 0.75;
      g.ico(rr, 1, { p: [Math.cos(a) * 0.9 * (i ? 1 : 0), h + 0.6 + rng() * 1.3 + (i ? 0 : 1.0), Math.sin(a) * 0.9 * (i ? 1 : 0)], s: [1, 0.85, 1], c: greens[0], c2: greens[1], jit: 0.35, cj: 0.22 });
    }
    P.trees.push(g);
  }
  // ---------- 松树 ----------
  P.pines = [];
  for (let v = 0; v < 3; v++) {
    const g = new Geo();
    const h = 5 + rng() * 3;
    g.tube([0, -0.3, 0], [0, h * 0.5, 0], 0.2, 6, { r2: 0.1, c: 0x5c3f2c });
    for (let i = 0; i < 4; i++) {
      const t = i / 4;
      g.cone(1.9 * (1 - t * 0.62), h * 0.36, 7, { p: [0, h * (0.32 + t * 0.6), 0], c: 0x2c6a44, c2: 0x173d2c, jit: 0.16, cj: 0.2 });
    }
    P.pines.push(g);
  }
  // ---------- 樱花树 ----------
  P.sakura = [];
  for (let v = 0; v < 3; v++) {
    const g = new Geo();
    const h = 2.4 + rng() * 1.0;
    g.tube([0, -0.3, 0], [0.15, h, 0.05], 0.24, 6, { r2: 0.15, c: 0x4a3230, c2: 0x33221f });
    const cols = [[0xffc4dc, 0xf58ab4], [0xffd6e6, 0xf7a3c4], [0xffb3d2, 0xee7fae]][v];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + rng();
      const tip = [Math.cos(a) * 1.5, h + 1.0 + rng() * 0.9, Math.sin(a) * 1.5];
      g.tube([0.15, h, 0.05], tip, 0.11, 5, { r2: 0.05, c: 0x4a3230 });
      g.ico(1.2 + rng() * 0.6, 1, { p: [tip[0], tip[1] + 0.4, tip[2]], s: [1.15, 0.72, 1.15], c: cols[0], c2: cols[1], jit: 0.36, cj: 0.16 });
    }
    g.ico(1.5, 1, { p: [0.1, h + 2.2, 0], s: [1.2, 0.75, 1.2], c: cols[0], c2: cols[1], jit: 0.36, cj: 0.16 });
    P.sakura.push(g);
  }
  // ---------- 岩石 / 灌木 / 花草 ----------
  P.rocks = [];
  for (let v = 0; v < 4; v++) {
    const g = new Geo();
    g.ico(1, 1, { s: [1 + rng() * 0.5, 0.6 + rng() * 0.4, 0.9 + rng() * 0.4], r: [rng(), rng() * 3, rng()], c: 0xa29a92, c2: 0x5f5a5a, jit: 0.42, cj: 0.25 });
    P.rocks.push(g);
  }
  P.bushes = [];
  for (let v = 0; v < 3; v++) {
    const g = new Geo();
    for (let i = 0; i < 3; i++) g.ico(0.55 + rng() * 0.3, 1, { p: [(rng() - 0.5) * 1.0, 0.35, (rng() - 0.5) * 1.0], s: [1, 0.75, 1], c: [0x5c9a3c, 0x4b8a42, 0x79a84a][v], c2: 0x2f5c2a, jit: 0.25, cj: 0.2 });
    P.bushes.push(g);
  }
  P.flowers = [];
  for (const col of [0xff6b8a, 0xffd24a, 0xffffff, 0xb07bff, 0xff944d]) {
    const g = new Geo();
    for (let i = 0; i < 7; i++) {
      const x = (rng() - 0.5) * 1.6, z = (rng() - 0.5) * 1.6, h = 0.25 + rng() * 0.25;
      g.tube([x, 0, z], [x, h, z], 0.018, 3, { c: 0x4d8a3a });
      g.ico(0.085, 0, { p: [x, h + 0.04, z], c: col });
    }
    P.flowers.push(g);
  }
  {
    const g = new Geo();
    for (let i = 0; i < 6; i++) g.cone(0.07, 0.4 + rng() * 0.35, 3, { p: [(rng() - 0.5) * 0.7, 0.2, (rng() - 0.5) * 0.7], r: [(rng() - 0.5) * 0.5, rng() * 3, (rng() - 0.5) * 0.5], c: 0x8fb04a, c2: 0x55803a });
    P.grass = g;
  }

  // ---------- 沙滩物件 ----------
  P.umbrellas = [];
  for (const [c1, c2] of [[0xe8433f, 0xfff6e8], [0x2b8fd6, 0xfff6e8], [0xffb52e, 0xfff6e8], [0x33b79a, 0xffe36e], [0xf06aa6, 0xfff6e8]]) {
    const g = new Geo();
    g.tube([0, 0, 0], [0.25, 2.3, 0], 0.035, 5, { c: 0xe8e2d4 });
    const seg = 8;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU, R = 1.45, y = 2.0, ty = 2.45;
      const col = new THREE.Color(i % 2 ? c1 : c2); const cc = [col.r, col.g, col.b];
      g.quad([0.25, ty, 0], [0.25 + Math.cos(a0) * R, y, Math.sin(a0) * R], [0.25 + Math.cos(a1) * R, y, Math.sin(a1) * R], [0.25, ty, 0], cc);
      g.quad([0.25, ty - 0.02, 0], [0.25 + Math.cos(a1) * R, y - 0.02, Math.sin(a1) * R], [0.25 + Math.cos(a0) * R, y - 0.02, Math.sin(a0) * R], [0.25, ty - 0.02, 0], cc.map(x => x * 0.7));
    }
    P.umbrellas.push(g);
  }
  P.towels = [0xff7a7a, 0x6ac6ff, 0xffe27a, 0x9be28a].map(c => { const g = new Geo(); g.box(0.9, 0.03, 1.9, { p: [0, 0.03, 0], c }); g.box(0.9, 0.035, 0.25, { p: [0, 0.03, 0.5], c: 0xffffff }); g.box(0.9, 0.035, 0.25, { p: [0, 0.03, -0.5], c: 0xffffff }); return g; });
  {
    const g = new Geo(); // 躺椅
    g.box(0.7, 0.06, 1.3, { p: [0, 0.32, 0], c: 0xfaf3e0 });
    g.box(0.7, 0.06, 0.8, { p: [0, 0.58, -0.92], r: [-0.85, 0, 0], c: 0xfaf3e0 });
    for (const [x, z] of [[-0.3, 0.55], [0.3, 0.55], [-0.3, -0.55], [0.3, -0.55]]) g.box(0.05, 0.32, 0.05, { p: [x, 0.16, z], c: WOOD });
    P.chair = g;
  }
  P.surfboards = [0xff5f5f, 0x4ac0e8, 0xffd040, 0x7be07b].map(c => { const g = new Geo(); g.sphere(1, 8, 6, { p: [0, 1.0, 0], s: [0.28, 1.15, 0.045], r: [0.12, 0, 0.1], c, c2: 0xffffff }); return g; });
  {
    const g = new Geo(); // 沙堡（装饰）
    g.cyl(0.55, 0.7, 0.5, 8, { p: [0, 0.25, 0], c: 0xe6cf98, c2: 0xc9ad74 });
    for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) { g.cyl(0.16, 0.2, 0.75, 6, { p: [x, 0.37, z], c: 0xe6cf98, c2: 0xc9ad74 }); g.cone(0.2, 0.28, 6, { p: [x, 0.88, z], c: 0xd9bf85 }); }
    g.cyl(0.24, 0.28, 0.55, 6, { p: [0, 0.75, 0], c: 0xe6cf98 }); g.cone(0.3, 0.36, 6, { p: [0, 1.2, 0], c: 0xd9bf85 });
    g.tube([0, 1.3, 0], [0, 1.75, 0], 0.012, 3, { c: 0x555555 }); g.box(0.22, 0.13, 0.01, { p: [0.11, 1.68, 0], c: 0xff5a4e });
    P.castle = g;
  }
  {
    const g = new Geo(); // 沙滩小屋
    const mk = (body, roof) => { const h = new Geo(); h.box(2.6, 2.2, 2.6, { p: [0, 1.5, 0], c: body, cj: 0.06 }); h.add(PRISM, { p: [0, 2.6, 0], s: [3.1, 1.3, 3.0], c: roof });
      for (let i = 0; i < 4; i++) h.box(0.12, 0.5, 0.12, { p: [i < 2 ? -1.15 : 1.15, 0.22, i % 2 ? -1.15 : 1.15], c: WOOD_D });
      h.box(0.75, 1.45, 0.06, { p: [0, 1.15, 1.31], c: 0xffffff }); h.box(2.8, 0.1, 0.9, { p: [0, 0.42, 1.7], c: WOOD }); return h; };
    P.huts = [mk(0xff8f8f, 0xffffff), mk(0x7fd1e8, 0xffffff), mk(0xffe07a, 0xff7a5a), mk(0xa8e6a1, 0xffffff), mk(0xc8a2ff, 0xfff0c2)];
  }

  // ---------- 渔村房屋 ----------
  P.houses = [];
  const walls = [0xf4e9d8, 0xf6d7b0, 0xe8c9c0, 0xcfe3ea, 0xf3e2a9, 0xe6ede0, 0xf2c6a0];
  const roofs = [0xb5523a, 0x8a4a3a, 0x3e6b8a, 0x5a6470, 0xc46a3a, 0x7a8f5a];
  for (let v = 0; v < 7; v++) {
    const g = new Geo(), glow = new Geo();
    const w = 4.5 + rng() * 2.5, d = 4.2 + rng() * 1.6, h = 2.8 + (v % 3 === 0 ? 2.6 : 0) + rng() * 0.6;
    const wc = walls[v % walls.length], rc = roofs[(v * 5 + 2) % roofs.length];
    g.box(w, h + 0.6, d, { p: [0, h / 2 - 0.3, 0], c: wc, c2: new THREE.Color(wc).multiplyScalar(0.8).getHex(), cj: 0.05 });
    g.add(PRISM, { p: [0, h, 0], s: [w + 0.7, 1.7 + rng() * 0.6, d + 0.7], c: rc, cj: 0.1 });
    g.box(0.5, 1.1, 0.5, { p: [w * 0.28, h + 1.5, -d * 0.2], c: 0x8c6a5a });
    // 门（正面 +Z）
    g.box(0.95, 1.9, 0.08, { p: [-w * 0.22, 0.95, d / 2 + 0.03], c: [0x3d6b8a, 0x9a3f32, 0x2f7d5a, 0x5a4a8a][v % 4] });
    g.box(1.25, 0.1, 0.5, { p: [-w * 0.22, 0.05, d / 2 + 0.25], c: 0xbdb6a8 });
    // 窗
    const floors = h > 4.5 ? 2 : 1;
    for (let f = 0; f < floors; f++) for (const x of [w * 0.2, w * 0.2 - 1.3 * (floors > 1 || w > 6 ? 1 : 0)]) {
      const y = 1.55 + f * 2.5;
      g.box(1.0, 1.0, 0.07, { p: [x, y, d / 2 + 0.02], c: 0xffffff });
      glow.box(0.8, 0.8, 0.04, { p: [x, y, d / 2 + 0.06], c: 0xffd98a });
      g.box(0.06, 0.8, 0.05, { p: [x, y, d / 2 + 0.085], c: 0xffffff }); g.box(0.8, 0.06, 0.05, { p: [x, y, d / 2 + 0.085], c: 0xffffff });
      g.box(1.1, 0.18, 0.3, { p: [x, y - 0.62, d / 2 + 0.15], c: [0xd94f4f, 0x4f9ad9, 0xe6a93a][(v + f) % 3] }); // 花箱
    }
    if (floors > 1) { g.box(0.9, 0.9, 0.07, { p: [-w * 0.22, 4.05, d / 2 + 0.02], c: 0xffffff }); glow.box(0.7, 0.7, 0.04, { p: [-w * 0.22, 4.05, d / 2 + 0.06], c: 0xffc46a }); }
    // 侧窗（朝 ±X）
    glow.box(0.04, 0.8, 0.8, { p: [-w / 2 - 0.03, 1.6, 0], c: 0xffd98a }); g.box(0.05, 1.0, 1.0, { p: [-w / 2 - 0.0, 1.6, 0], c: 0xffffff });
    P.houses.push({ solid: g, glow, w, d });
  }
  // ---------- 集市摊位 ----------
  P.stalls = [];
  for (const [c1, c2] of [[0xe5484d, 0xffffff], [0x2f8fce, 0xffffff], [0xf2a735, 0xffffff], [0x3aa77d, 0xfff3c4]]) {
    const g = new Geo(), glow = new Geo();
    for (const [x, z] of [[-1.3, -0.8], [1.3, -0.8], [-1.3, 0.8], [1.3, 0.8]]) g.tube([x, 0, z], [x, 2.3, z], 0.045, 5, { c: WOOD });
    for (let i = 0; i < 8; i++) g.box(0.36, 0.06, 2.3, { p: [-1.26 + i * 0.36, 2.42 - Math.abs(0) , 0.1], r: [0.22, 0, 0], c: i % 2 ? c1 : c2 });
    for (let i = 0; i < 8; i++) g.add(TRI, { p: [-1.26 + i * 0.36, 2.18, 1.23], s: [0.36, 0.26, 1], c: i % 2 ? c1 : c2 });
    g.box(2.7, 0.1, 1.2, { p: [0, 0.95, 0.2], c: WOOD }); g.box(2.6, 0.8, 0.06, { p: [0, 0.5, 0.75], c: WOOD_D });
    for (let i = 0; i < 3; i++) { g.box(0.7, 0.28, 0.5, { p: [-0.85 + i * 0.85, 1.14, 0.25], r: [0.25, 0, 0], c: 0xb98a55 }); for (let k = 0; k < 4; k++) g.sphere(0.12, 6, 4, { p: [-1.05 + i * 0.85 + k * 0.13, 1.33, 0.3 + (k % 2) * 0.1], s: [1, 0.55, 2.0], c: [0x6fb7e8, 0xff9a5a, 0xcfd8e0][i] }); }
    glow.sphere(0.1, 6, 5, { p: [0, 2.05, 0.2], c: 0xffe2a0 });
    P.stalls.push({ solid: g, glow, halo: [[0, 2.05, 0.2, 2.4, 1.0, 0.8, 0.5]] });
  }
  // ---------- 小船（岸上 / 海上共用船壳） ----------
  const hull = (g, L, W, H, c, cIn, y = 0) => {
    g.add(HULL, { p: [0, y + H, 0], s: [W, H, L], c, c2: new THREE.Color(c).multiplyScalar(0.7).getHex() });
    g.add(HULL, { p: [0, y + H - 0.02, 0], s: [W * 0.9, H * 0.86, L * 0.94], c: cIn });
  };
  P.rowboats = [0x3f86c4, 0xd9534a, 0xf0c04a, 0x4aa58a, 0xffffff].map(c => {
    const g = new Geo(); hull(g, 2.1, 0.75, 0.55, c, 0xc8a070);
    g.box(1.3, 0.06, 0.3, { p: [0, 0.45, 0.3], c: WOOD }); g.box(1.2, 0.06, 0.3, { p: [0, 0.45, -0.7], c: WOOD });
    g.box(1.56, 0.07, 0.07, { p: [0, 0.57, 2.02], s: [0.0001, 1, 1], c });
    return g;
  });
  {
    const g = new Geo(); // 帆船
    hull(g, 4.2, 1.25, 0.9, 0xfdfbf5, 0xd9c7a2, -0.35);
    g.tube([0, 0.5, 0.4], [0, 8.2, 0.4], 0.07, 5, { c: 0xdedede });
    const sail = (a, b, c, col) => { const cc = new THREE.Color(col); g.quad(a, b, c, a, [cc.r, cc.g, cc.b]); g.quad(a, c, b, a, [cc.r * 0.82, cc.g * 0.82, cc.b * 0.82]); };
    P._sail = sail;
    sail([0, 8.0, 0.3], [0, 1.2, 0.3], [0.5, 1.3, -3.4], 0xffffff);
    sail([0, 7.4, 0.55], [0, 1.2, 0.55], [-0.35, 1.0, 3.7], 0xfff3e0);
    g.box(0.9, 0.5, 1.6, { p: [0, 0.75, -0.9], c: 0xf2efe6 });
    P.sailboat = g;
    const g2 = new Geo(); // 彩帆
    hull(g2, 3.6, 1.15, 0.85, 0x2f5f8a, 0xd9c7a2, -0.35);
    g2.tube([0, 0.5, 0.3], [0, 7.0, 0.3], 0.07, 5, { c: 0xdedede });
    const cc1 = new THREE.Color(0xff6a4a), cc2 = new THREE.Color(0xffd24a);
    g2.quad([0, 6.8, 0.2], [0, 1.2, 0.2], [0.5, 1.3, -3.0], [0, 6.8, 0.2], [cc1.r, cc1.g, cc1.b]); g2.quad([0, 6.8, 0.2], [0.5, 1.3, -3.0], [0, 1.2, 0.2], [0, 6.8, 0.2], [cc1.r * 0.8, cc1.g * 0.8, cc1.b * 0.8]);
    g2.quad([0, 6.2, 0.45], [0, 1.2, 0.45], [-0.3, 1.0, 3.2], [0, 6.2, 0.45], [cc2.r, cc2.g, cc2.b]); g2.quad([0, 6.2, 0.45], [-0.3, 1.0, 3.2], [0, 1.2, 0.45], [0, 6.2, 0.45], [cc2.r * 0.8, cc2.g * 0.8, cc2.b * 0.8]);
    P.sailboat2 = g2;
  }
  {
    const g = new Geo(), glow = new Geo(); // 渔船
    hull(g, 5.0, 1.7, 1.2, 0x2f6f9a, 0xcbb48a, -0.45);
    g.box(1.9, 1.5, 2.2, { p: [0, 1.55, -1.3], c: 0xf6f1e4 }); g.box(2.2, 0.14, 2.6, { p: [0, 2.36, -1.3], c: 0xc9453c });
    glow.box(1.4, 0.5, 0.05, { p: [0, 1.75, -0.19], c: 0xffe3a0 });
    g.tube([0, 1.0, 1.4], [0, 4.4, 1.4], 0.06, 5, { c: 0x6a4a30 }); g.tube([0, 3.8, 1.4], [0, 2.4, 3.6], 0.04, 4, { c: 0x6a4a30 });
    glow.sphere(0.13, 6, 5, { p: [0, 4.5, 1.4], c: 0xff5a4a }); glow.sphere(0.12, 6, 5, { p: [0, 2.6, -1.3], c: 0xbfffd0 });
    for (let i = 0; i < 3; i++) g.torus(0.3, 0.09, 5, 8, { p: [1.62, 0.75, -1.4 + i * 1.3], r: [0, PI / 2, 0], c: i % 2 ? 0xffffff : 0xe2553f });
    P.fishboat = { solid: g, glow, halo: [[0, 4.5, 1.4, 3.0, 1, 0.35, 0.3], [0, 2.6, -1.3, 2.2, 0.75, 1, 0.8]] };
  }
  {
    const g = new Geo(), glow = new Geo(); // 浮标
    g.cyl(0.5, 0.62, 0.5, 8, { p: [0, 0.1, 0], c: 0xd9453c }); g.cone(0.45, 1.3, 8, { p: [0, 1.0, 0], c: 0xe8e2d4, c2: 0xd9453c });
    glow.sphere(0.13, 6, 5, { p: [0, 1.75, 0], c: 0xff7a5a });
    P.buoy = { solid: g, glow, halo: [[0, 1.75, 0, 2.6, 1, 0.4, 0.3]] };
  }
  // ---------- 栈桥 ----------
  {
    const g = new Geo();
    const L = 22;
    for (let i = 0; i < 11; i++) g.box(2.2, 0.1, 1.85, { p: [0, 0, -1 - i * 2], c: i % 2 ? 0x9a7550 : 0x8a6644 });
    for (let i = 0; i <= 5; i++) for (const x of [-1.05, 1.05]) g.tube([x, -3.6, -i * 4.2 - 0.6], [x, 0.75, -i * 4.2 - 0.6], 0.11, 6, { c: 0x5c4030 });
    for (const x of [-1.05, 1.05]) g.tube([x, 0.7, -0.6], [x, 0.7, -L + 0.4], 0.04, 4, { c: 0xe8dcc0 });
    P.pier = { solid: g, len: L };
  }
  // ---------- 晾鱼架 ----------
  {
    const g = new Geo();
    for (const x of [-1.4, 1.4]) { g.tube([x - 0.3, 0, 0], [x, 2.0, 0], 0.04, 4, { c: WOOD }); g.tube([x + 0.3, 0, 0], [x, 2.0, 0], 0.04, 4, { c: WOOD }); }
    g.tube([-1.5, 1.95, 0], [1.5, 1.95, 0], 0.03, 4, { c: WOOD });
    for (let i = 0; i < 7; i++) g.sphere(0.12, 6, 4, { p: [-1.2 + i * 0.4, 1.65, 0], s: [0.5, 2.2, 1], c: i % 2 ? 0xc9d6de : 0xe8b98a });
    P.fishRack = g;
  }
  // ---------- 街道小物 ----------
  {
    const g = new Geo(); // 长椅
    g.box(1.7, 0.07, 0.5, { p: [0, 0.45, 0], c: 0x8f6a42 }); g.box(1.7, 0.4, 0.06, { p: [0, 0.78, -0.22], r: [-0.15, 0, 0], c: 0x8f6a42 });
    for (const x of [-0.7, 0.7]) g.box(0.08, 0.45, 0.45, { p: [x, 0.22, 0], c: 0x2e3238 });
    P.bench = g;
    const t = new Geo(); t.cyl(0.24, 0.2, 0.75, 8, { p: [0, 0.37, 0], c: 0x3a8f6a }); t.cyl(0.26, 0.26, 0.06, 8, { p: [0, 0.76, 0], c: 0x2a6a4e });
    P.trashcan = t;
    const m = new Geo(); m.tube([0, 0, 0], [0, 1.0, 0], 0.04, 5, { c: 0x555555 }); m.box(0.34, 0.26, 0.5, { p: [0, 1.1, 0], c: 0xd9453c }); m.cyl(0.17, 0.17, 0.5, 8, { p: [0, 1.23, 0], r: [PI / 2, 0, 0], c: 0xd9453c });
    P.mailbox = m;
    const b = new Geo(); // 木桶 + 鱼箱
    b.cyl(0.36, 0.3, 0.8, 8, { p: [0, 0.4, 0], c: 0x9a6c3a, c2: 0x7a5230 }); b.torus(0.36, 0.025, 4, 10, { p: [0, 0.62, 0], r: [PI / 2, 0, 0], c: 0x444444 }); b.torus(0.33, 0.025, 4, 10, { p: [0, 0.2, 0], r: [PI / 2, 0, 0], c: 0x444444 });
    b.box(0.7, 0.4, 0.5, { p: [0.75, 0.2, 0.1], r: [0, 0.3, 0], c: 0xb98a55 });
    P.barrelDecor = b;
  }
  // ---------- 鸟居 / 石灯笼 ----------
  {
    const g = new Geo();
    const RED = 0xd8402f;
    for (const x of [-5.9, 5.9]) { g.tube([x, -0.3, 0], [x * 0.97, 7.0, 0], 0.32, 8, { r2: 0.27, c: RED, c2: 0x9a2a20 }); g.cyl(0.42, 0.46, 0.5, 8, { p: [x, 0.2, 0], c: 0x2a2a2e }); }
    g.box(14.6, 0.42, 0.62, { p: [0, 7.25, 0], c: RED }); g.box(15.6, 0.3, 0.86, { p: [0, 7.62, 0], c: 0x23232a });
    g.box(12.4, 0.34, 0.4, { p: [0, 6.0, 0], c: RED }); g.box(0.9, 0.9, 0.2, { p: [0, 6.62, 0], c: 0x2a2a2e });
    P.torii = g;
    const s = new Geo(), sg = new Geo();
    s.cyl(0.28, 0.34, 0.2, 6, { p: [0, 0.1, 0], c: 0x8f8f8a }); s.cyl(0.11, 0.13, 0.75, 6, { p: [0, 0.55, 0], c: 0x9a9a94 });
    s.cyl(0.26, 0.2, 0.12, 6, { p: [0, 0.98, 0], c: 0x8f8f8a }); sg.box(0.3, 0.3, 0.3, { p: [0, 1.2, 0], c: 0xffc878 });
    for (const [x, z] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]]) s.box(0.05, 0.32, 0.05, { p: [x, 1.2, z], c: 0x77776f });
    s.cone(0.42, 0.3, 6, { p: [0, 1.5, 0], c: 0x7c7c76 }); s.sphere(0.07, 5, 4, { p: [0, 1.68, 0], c: 0x7c7c76 });
    P.stoneLantern = { solid: s, glow: sg, halo: [[0, 1.2, 0, 2.2, 1, 0.72, 0.4]] };
  }
  // ---------- 灯塔 ----------
  {
    const g = new Geo(), glow = new Geo();
    g.cyl(4.2, 5.0, 1.4, 12, { p: [0, 0.7, 0], c: 0x8d8780 });
    const H = 22, N = 5;
    for (let i = 0; i < N; i++) {
      const r0 = 2.6 - i * 0.28, r1 = 2.6 - (i + 1) * 0.28;
      g.cyl(r1, r0, H / N, 14, { p: [0, 1.4 + (i + 0.5) * H / N, 0], c: i % 2 ? 0xd8402f : 0xf6f2ea });
    }
    g.cyl(2.0, 1.7, 0.3, 14, { p: [0, 1.4 + H + 0.15, 0], c: 0x2c2f36 });
    for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; g.tube([Math.cos(a) * 1.9, 1.4 + H + 0.3, Math.sin(a) * 1.9], [Math.cos(a) * 1.9, 1.4 + H + 1.2, Math.sin(a) * 1.9], 0.03, 4, { c: 0x2c2f36 }); }
    g.torus(1.9, 0.035, 4, 16, { p: [0, 1.4 + H + 1.2, 0], r: [PI / 2, 0, 0], c: 0x2c2f36 });
    glow.cyl(1.05, 1.05, 1.7, 10, { p: [0, 1.4 + H + 1.15, 0], c: 0xfff0b8 });
    g.cone(1.5, 1.3, 10, { p: [0, 1.4 + H + 2.65, 0], c: 0xb8352a }); g.sphere(0.18, 6, 5, { p: [0, 1.4 + H + 3.4, 0], c: 0x2c2f36 });
    g.box(0.9, 1.8, 0.2, { p: [0, 2.2, 2.55], c: 0x3d5a78 });
    for (let i = 1; i < 4; i++) glow.box(0.4, 0.6, 0.1, { p: [0, 1.4 + i * 5.2, 2.55 - i * 0.3], c: 0xffd98a });
    // 守塔人小屋
    g.box(4.4, 2.6, 3.6, { p: [5.6, 1.3, 0.4], c: 0xf4eee0 }); g.add(PRISM, { p: [5.6, 2.6, 0.4], s: [5.0, 1.6, 4.2], c: 0xb5523a });
    glow.box(0.8, 0.8, 0.05, { p: [5.6, 1.5, 2.23], c: 0xffd98a });
    P.lighthouse = { solid: g, glow, beamY: 1.4 + H + 1.15, halo: [[0, 1.4 + H + 1.15, 0, 22, 1, 0.92, 0.65]] };
  }
  // ---------- 风车（塔 + 独立叶片） ----------
  {
    const g = new Geo();
    g.tube([0, 0, 0], [0, 16, 0], 0.5, 8, { r2: 0.3, c: 0xf2f2f2, c2: 0xd8dde2 });
    g.box(0.9, 0.8, 1.8, { p: [0, 16.2, 0.2], c: 0xf2f2f2 });
    P.turbine = g;
    const b = new Geo();
    b.sphere(0.45, 8, 6, { s: [1, 1, 1.3], c: 0xf2f2f2 });
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU; b.box(0.5, 7.5, 0.1, { p: [Math.sin(a) * 3.9, Math.cos(a) * 3.9, 0], r: [0, 0.12, -a], c: 0xfafafa }); }
    P.turbineBlades = b;
  }
  // ---------- 热气球 ----------
  P.balloons = [[0xff5a4e, 0xffd24a], [0x3fa9e0, 0xffffff], [0xff8ac0, 0xfff0a0], [0x7ad67a, 0xffffff], [0xb07bff, 0xffb347]].map(([c1, c2]) => {
    const g = new Geo();
    const seg = 12, rings = 8, R = 5;
    const C1 = new THREE.Color(c1), C2 = new THREE.Color(c2);
    const prof = (t) => { const a = t * PI * 0.92; return [Math.sin(a) * R * (0.25 + 0.75 * Math.sin(Math.min(a * 1.1, PI / 2))), -Math.cos(a) * R * 1.15 + R * 1.15]; };
    for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
      const [r0, y0] = prof(1 - j / rings), [r1, y1] = prof(1 - (j + 1) / rings);
      const a0 = i / seg * TAU, a1 = (i + 1) / seg * TAU;
      const cc = (i + (j > rings - 3 ? 1 : 0)) % 2 ? C1 : C2;
      g.quad([Math.cos(a0) * r0, y0, Math.sin(a0) * r0], [Math.cos(a0) * r1, y1, Math.sin(a0) * r1], [Math.cos(a1) * r1, y1, Math.sin(a1) * r1], [Math.cos(a1) * r0, y0, Math.sin(a1) * r0], [cc.r, cc.g, cc.b]);
    }
    g.box(1.3, 1.0, 1.3, { p: [0, -2.4, 0], c: 0x9a6c3a });
    for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) g.tube([x, -1.9, z], [x * 2.2, 0.6, z * 2.2], 0.03, 3, { c: 0x4a3a2a });
    return g;
  });
  // ---------- 桥塔 / 桥墩 ----------
  {
    const g = new Geo(), glow = new Geo();
    for (const x of [-6.6, 6.6]) {
      g.box(1.3, 60, 1.6, { p: [x, 6, 0], c: 0xd95a48, c2: 0xb04436 });
      glow.sphere(0.25, 6, 5, { p: [x, 36.4, 0], c: 0xff5a4a });
    }
    g.box(14.6, 1.4, 1.3, { p: [0, 33.5, 0], c: 0xd95a48 }); g.box(14.6, 1.2, 1.3, { p: [0, 20, 0], c: 0xd95a48 }); g.box(15.2, 2.0, 2.2, { p: [0, -2.6, 0], c: 0xbdb6aa });
    P.bridgeTower = { solid: g, glow, halo: [[-6.6, 36.4, 0, 5, 1, 0.3, 0.25], [6.6, 36.4, 0, 5, 1, 0.3, 0.25]], top: 34 };
    const p = new Geo();
    p.box(1.2, 30, 1.6, { p: [-3.4, -15.6, 0], c: 0xc9c3b8, c2: 0x8f8a82 }); p.box(1.2, 30, 1.6, { p: [3.4, -15.6, 0], c: 0xc9c3b8, c2: 0x8f8a82 });
    p.box(9.6, 1.1, 1.9, { p: [0, -1.2, 0], c: 0xc9c3b8 });
    P.bridgePier = p;
  }
  // ---------- 远景岛屿 ----------
  P.islands = [];
  for (let v = 0; v < 4; v++) {
    const g = new Geo();
    const n = 2 + (v % 3);
    for (let i = 0; i < n; i++) {
      const r = 26 + rng() * 34;
      g.ico(r, 1, { p: [(i - n / 2) * 34 + rng() * 14, -r * 0.12, rng() * 24], s: [1.25, 0.5 + rng() * 0.45, 1], c: 0x5d8a58, c2: 0x8c8474, jit: 0.32, cj: 0.2 });
    }
    P.islands.push(g);
  }
  // ---------- 彩旗 / 串灯（两点之间，由 world 调用时生成） ----------
  P.TRI = TRI; P.PRISM = PRISM;
  return P;
}

// 路牌图集（Canvas 绘制）：返回 { texture, cells: {name: [u0,v0,u1,v1]} }
export function buildSignAtlas() {
  const W = 1024, H = 512, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const cells = {};
  const font = '"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif';
  const fit = (text, px, maxW) => { x.font = `900 ${px}px ${font}`; const w = x.measureText(text).width; if (w > maxW) x.font = `900 ${Math.floor(px * maxW / w)}px ${font}`; };
  const diamond = (i, j, emoji, text, bg = '#ffcc33') => {
    const cx = i * 256 + 128, cy = j * 256 + 128;
    x.save(); x.translate(cx, cy); x.rotate(Math.PI / 4);
    x.fillStyle = '#1a1a1a'; rr(x, -84, -84, 168, 168, 18); x.fill();
    x.fillStyle = bg; rr(x, -76, -76, 152, 152, 13); x.fill(); x.restore();
    x.fillStyle = '#1a1a1a'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `64px ${font}`; x.fillText(emoji, cx, cy - 22);
    fit(text, 30, 122); x.fillText(text, cx, cy + 40);
  };
  const names = [];
  const put = (name, i, j, w = 1) => { cells[name] = [i * 256 / W, 1 - (j + 1) * 256 / H, (i + w) * 256 / W, 1 - j * 256 / H]; names.push(name); };
  diamond(0, 0, '🐟', L('前方有鱼', "FISH AHEAD")); put('fish', 0, 0);
  diamond(1, 0, '🦀', L('小心螃蟹', "CRAB XING")); put('crab', 1, 0);
  diamond(2, 0, '🚲', L('鹈鹕专用道', "BIRD LANE"), '#7ad0ff'); put('lane', 2, 0);
  // 限速牌
  { const cx = 3 * 256 + 128, cy = 128; x.fillStyle = '#fff'; x.beginPath(); x.arc(cx, cy, 104, 0, 7); x.fill(); x.strokeStyle = '#e02e2e'; x.lineWidth = 22; x.beginPath(); x.arc(cx, cy, 90, 0, 7); x.stroke();
    x.fillStyle = '#1a1a1a'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = `900 84px ${font}`; x.fillText('45', cx, cy - 8); fit(L('鹈鹕限速', "PELICANS"), 24, 104); x.fillText(L('鹈鹕限速', "PELICANS"), cx, cy + 50); put('limit', 3, 0); }
  diamond(0, 1, '🐦', L('禁止抢鱼', "NO STEALING"), '#ff9a6a'); put('gull', 0, 1);
  diamond(1, 1, '🛹', L('前有跳台', "RAMP AHEAD")); put('ramp', 1, 1);
  diamond(2, 1, '🐋', L('鲸鱼出没', "WHALES"), '#8fe3c8'); put('whale', 2, 1);
  diamond(3, 1, '🔔', L('请勤按铃', "RING BELL"), '#ffe680'); put('bell', 3, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return { texture: tex, cells, names };
}
function rr(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }

// 分区牌坊文字贴图
export function makeBannerTexture(text, sub, color = '#1d6f8a') {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, color); g.addColorStop(1, '#0d2c3a');
  x.fillStyle = g; rr(x, 0, 0, 1024, 256, 36); x.fill();
  x.strokeStyle = 'rgba(255,255,255,0.85)'; x.lineWidth = 10; rr(x, 14, 14, 996, 228, 26); x.stroke();
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  { const f = '"PingFang SC","Microsoft YaHei","Noto Sans SC","Segoe UI",sans-serif'; x.font = `900 118px ${f}`; const w = x.measureText(text).width; if (w > 900) x.font = `900 ${Math.floor(118 * 900 / w)}px ${f}`; } x.fillText(text, 512, 108);
  x.font = '600 40px "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif'; x.fillStyle = 'rgba(255,255,255,0.85)'; x.fillText(sub, 512, 204);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}
