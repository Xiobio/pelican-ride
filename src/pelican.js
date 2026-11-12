// 主角：鹈鹕 + 复古单车。程序化建模、双骨骼 IK（腿/翅膀）、弹簧脖子、Verlet 围巾、换装
import * as THREE from 'three';
import { Geo, selfLit } from './geo.js';
import { clamp, lerp, damp, smooth, easeInOut, TAU } from './util.js';

const PI = Math.PI;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const _a = V(), _b = V(), _c = V(), _d = V(), _e = V(), _f = V();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _ref = V();

// 车架关键点（车体坐标：前进方向 -Z，原点在两轮中点的地面）
const WR = 0.34;
const RA = [0, WR, 0.52], FA = [0, WR, -0.56], BB = [0, 0.30, 0.06], ST = [0, 0.83, 0.27], SAD = [0, 0.94, 0.30];
const HTt = [0, 0.93, -0.34], HTb = [0, 0.70, -0.40];
const CRANK = 0.17, PEDAL_X = 0.135;
const GRIP = [0.27, 1.075, -0.10];
const BASKET = [0, 1.0, -0.68];

export const COSMETICS = {
  hat: {
    helmet: { name: '经典头盔', price: 0 }, straw: { name: '海边草帽', price: 250 }, chef: { name: '厨师高帽', price: 450 },
    pirate: { name: '海盗船长', price: 700 }, propeller: { name: '竹蜻蜓帽', price: 1000 }, wizard: { name: '星星巫师帽', price: 1500 }, crown: { name: '鹈鹕王冠', price: 3000 },
  },
  glasses: { none: { name: '不戴', price: 0 }, shades: { name: '酷黑墨镜', price: 200 }, heart: { name: '爱心眼镜', price: 500 }, goggles: { name: '飞行风镜', price: 800 } },
  scarf: {
    red: { name: '经典红', price: 0, cols: [0xd7263d, 0xd7263d] }, stripe: { name: '海军条纹', price: 220, cols: [0x1f4e8c, 0xf4f1ea] }, mint: { name: '薄荷绿', price: 350, cols: [0x3fd0a0, 0x2a9a7a] },
    sunset: { name: '晚霞渐变', price: 600, cols: [0xff7a3d, 0xffd24a] }, rainbow: { name: '彩虹', price: 1200, cols: 'rainbow' }, gold: { name: '黄金锦缎', price: 2200, cols: [0xffd24a, 0xfff2a8] },
  },
  paint: {
    teal: { name: '湖水青', price: 0, col: 0x138a8a }, cherry: { name: '樱桃红', price: 250, col: 0xc0283a }, mint: { name: '奶油薄荷', price: 400, col: 0x8fdcc0 },
    sun: { name: '向日葵黄', price: 550, col: 0xf2b92e }, pink: { name: '泡泡糖粉', price: 750, col: 0xf07aa8 }, night: { name: '午夜黑金', price: 1800, col: 0x15161c },
  },
  trail: { none: { name: '无', price: 0 }, bubble: { name: '泡泡', price: 400 }, spark: { name: '星屑', price: 750 }, petal: { name: '花瓣', price: 900 }, rainbow: { name: '彩虹尾迹', price: 2000 }, flame: { name: '烈焰', price: 2600 } },
};

function leafGeometry(len, w, tipDark = 0, bend = 0.15) {
  // 一片羽毛：沿 +Z 伸展的菱形叶片，带一点弧度；顶点色 白 -> 尖端深色
  const seg = 4, pos = [], col = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, z = len * t, ww = w * Math.sin(PI * (0.12 + 0.88 * t) * 0.92) * (1 - t * 0.25), y = -bend * len * t * t;
    const k = 1 - tipDark * smooth((t - 0.45) / 0.4);
    pos.push(-ww, y - ww * 0.15, z, 0, y + 0.012, z, ww, y - ww * 0.15, z);
    for (let j = 0; j < 3; j++) col.push(k, k, k * (1 + 0.02 * tipDark));
  }
  for (let i = 0; i < seg; i++) { const a = i * 3, b = a + 3; idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// 放样：一串沿 Z 的椭圆截面（上/下半高可不同）连成光滑实体。rings: [{z, w, t, b, y, c:[r,g,b]}]
function loft(rings, seg = 10) {
  const pos = [], col = [], idx = [];
  for (const R of rings) for (let j = 0; j < seg; j++) {
    const a = j / seg * TAU, s = Math.sin(a);
    pos.push(Math.cos(a) * R.w, R.y + (s >= 0 ? s * R.t : s * R.b), R.z); col.push(R.c[0], R.c[1], R.c[2]);
  }
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < seg; j++) { const a = i * seg + j, b = i * seg + (j + 1) % seg, c = a + seg, d = b + seg; idx.push(a, c, b, b, c, d); }
  for (const [k, R] of [[0, rings[0]], [rings.length - 1, rings[rings.length - 1]]]) {
    const ci = pos.length / 3; pos.push(0, R.y, R.z); col.push(R.c[0], R.c[1], R.c[2]);
    for (let j = 0; j < seg; j++) { const a = k * seg + j, b = k * seg + (j + 1) % seg; if (k === 0) idx.push(ci, a, b); else idx.push(ci, b, a); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// 两骨骼 IK：返回关节位置（写入 out）
function ik2(root, target, l1, l2, hint, out) {
  _a.subVectors(target, root);
  let d = _a.length();
  const maxD = (l1 + l2) * 0.999;
  if (d > maxD) { d = maxD; }
  if (d < 1e-4) d = 1e-4;
  _a.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _b.copy(hint).addScaledVector(_a, -hint.dot(_a));
  if (_b.lengthSq() < 1e-8) _b.set(0, 0, 1); _b.normalize();
  out.copy(root).addScaledVector(_a, a).addScaledVector(_b, h);
  // 实际末端（目标过远时被截断）
  return d;
}
// 把一个沿 +Y 的单位长度 mesh 摆到 a→b
function setBone(mesh, a, b, r = 1) {
  _c.subVectors(b, a); const len = _c.length() || 1e-4;
  mesh.position.copy(a).addScaledVector(_c, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, _c.multiplyScalar(1 / len));
  mesh.scale.set(r, len, r);
}
// 骨骼坐标系：Y 沿骨骼，Z 尽量贴近 ref
function setFrame(group, a, b, ref) {
  _c.subVectors(b, a).normalize();
  _d.copy(ref).addScaledVector(_c, -ref.dot(_c)); if (_d.lengthSq() < 1e-8) _d.set(1, 0, 0); _d.normalize();
  _e.crossVectors(_c, _d);
  _m.makeBasis(_e, _c, _d);
  group.quaternion.setFromRotationMatrix(_m);
  group.position.copy(a);
}

export class Pelican {
  constructor(scene, envMap) {
    this.scene = scene;
    this.root = new THREE.Group(); this.root.name = 'pelican';
    this.tilt = new THREE.Group(); this.root.add(this.tilt);
    this.flipPivot = new THREE.Group(); this.flipPivot.position.y = 0.95; this.tilt.add(this.flipPivot);
    this.flip = new THREE.Group(); this.flip.position.y = -0.95; this.flipPivot.add(this.flip);
    this.wheeliePivot = new THREE.Group(); this.wheeliePivot.position.set(0, 0, RA[2]); this.flip.add(this.wheeliePivot);
    this.bike = new THREE.Group(); this.bike.position.set(0, 0, -RA[2]); this.wheeliePivot.add(this.bike);
    scene.add(this.root);

    const env = { envMap, envMapIntensity: 0.9 };
    this.mat = {
      paint: new THREE.MeshStandardMaterial({ color: 0x138a8a, roughness: 0.32, metalness: 0.35, vertexColors: true, ...env }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xc4cbd2, roughness: 0.28, metalness: 1.0, vertexColors: true, ...env }),
      matte: new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, vertexColors: true, ...env, envMapIntensity: 0.25 }),
      feather: new THREE.MeshStandardMaterial({ color: 0xf1eee8, roughness: 0.8, metalness: 0, vertexColors: true, ...env, envMapIntensity: 0.3 }),
      featherFlat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, vertexColors: true, side: THREE.DoubleSide, ...env, envMapIntensity: 0.25 }),
      skin: new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0, vertexColors: true, ...env, envMapIntensity: 0.35 }),
      gloss: new THREE.MeshStandardMaterial({ roughness: 0.18, metalness: 0.1, vertexColors: true, ...env }),
      glow: new THREE.MeshBasicMaterial({ color: 0xfff1c0 }),
      tail: new THREE.MeshBasicMaterial({ color: 0xff3020 }),
      scarf: new THREE.MeshStandardMaterial({ roughness: 0.9, vertexColors: true, side: THREE.DoubleSide }),
    };
    this.allMats = Object.values(this.mat);
    this.uSelf = { value: 0 };
    for (const k of ['paint', 'chrome', 'matte', 'feather', 'featherFlat', 'skin', 'gloss', 'scarf']) selfLit(this.mat[k], this.uSelf);
    this.cos = { hat: 'helmet', glasses: 'none', scarf: 'red', paint: 'teal', trail: 'none' };
    this._buildBike();
    this._buildBird();
    this._buildScarf();
    this.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });

    // 动画状态
    this.crank = 0; this.wheelRot = 0; this.steer = 0;
    this.headPos = V(0, 1.88, -0.12); this.headVel = V();
    this.headYaw = 0; this.headPitch = 0; this.jaw = 0; this.pouch = 1; this.blink = 0; this.blinkT = 2;
    this.wing = 0; this.flap = 0; this.flapT = 1; this.bob = 0; this.stand = 0; this.superman = 0;
    this.gulpT = 1; this.honkT = 1; this.happy = 0; this.time = 0;
    this.fishShown = 0;
    this.lookTarget = null; // 世界坐标（鱼）
    this.headlight = new THREE.SpotLight(0xfff0c8, 0, 34, 0.52, 0.6, 1.2);
    this.headlight.position.copy(V(0, 0.8, -0.62).applyMatrix4(this.steerInv)); this.steerG.add(this.headlight);
    this.headlight.target.position.copy(V(0, -0.6, -9).applyMatrix4(this.steerInv)); this.steerG.add(this.headlight.target);
    this.applyCosmetics(this.cos);
  }

  // ---------------- 单车 ----------------
  _buildBike() {
    const M = this.mat, bike = this.bike;
    const paint = new Geo(2048, true), chrome = new Geo(2048, true), matte = new Geo(2048, true);
    const W = 0xffffff;
    // 车架
    paint.tube(BB, [ST[0], ST[1] + 0.04, ST[2] + 0.015], 0.021, 10, { c: W });
    paint.tube([0, ST[1] - 0.03, ST[2] - 0.01], [0, HTt[1] - 0.05, HTt[2] - 0.012], 0.019, 10, { c: W });
    paint.tube([0, ST[1] - 0.16, ST[2] - 0.065], [0, HTb[1] + 0.04, HTb[2] + 0.01], 0.015, 8, { c: W }); // 复古双上管
    paint.tube([0, HTb[1] + 0.01, HTb[2]], BB, 0.022, 10, { c: W });
    paint.tube([0, HTb[1] - 0.03, HTb[2] - 0.008], [0, HTt[1] + 0.02, HTt[2] + 0.005], 0.026, 10, { c: W });
    for (const x of [-0.055, 0.055]) {
      paint.tube([x * 0.5, BB[1], BB[2]], [x, RA[1], RA[2]], 0.012, 6, { c: W });
      paint.tube([x * 0.4, ST[1] - 0.02, ST[2]], [x, RA[1], RA[2]], 0.010, 6, { c: W });
    }
    paint.sphere(0.036, 10, 8, { p: BB, s: [1.6, 1, 1], c: W });
    // 后挡泥板 + 链罩
    paint.torus(0.375, 0.02, 5, 16, { p: RA, r: [0, PI / 2, 0.75], s: [1, 1, 2.6], arc: 2.75, c: W });
    paint.box(0.012, 0.07, 0.36, { p: [0.066, BB[1] + 0.085, (BB[2] + RA[2]) / 2], r: [0.09, 0, 0], c: W });
    // 座管、鞍座
    chrome.tube([0, ST[1], ST[2]], [SAD[0], SAD[1] - 0.05, SAD[2]], 0.013, 8, { c: W });
    matte.sphere(1, 12, 8, { p: [0, SAD[1], SAD[2] + 0.02], s: [0.115, 0.035, 0.15], c: 0x6b3f22 });
    matte.sphere(1, 10, 6, { p: [0, SAD[1] - 0.005, SAD[2] - 0.12], s: [0.05, 0.03, 0.1], c: 0x6b3f22 });
    for (const x of [-0.05, 0.05]) for (let i = 0; i < 4; i++) chrome.torus(0.022, 0.005, 4, 8, { p: [x, SAD[1] - 0.035 - i * 0.012, SAD[2] + 0.1], r: [PI / 2, 0, 0], c: W });
    // 后货架 + 尾灯
    for (const x of [-0.07, 0.07]) { chrome.tube([x, 0.76, 0.36], [x, 0.76, 0.92], 0.007, 5, { c: W }); chrome.tube([x, 0.76, 0.84], [x * 0.8, RA[1], RA[2]], 0.006, 5, { c: W }); }
    for (let i = 0; i < 4; i++) chrome.tube([-0.07, 0.76, 0.42 + i * 0.16], [0.07, 0.76, 0.42 + i * 0.16], 0.006, 5, { c: W });
    chrome.tube([0, 0.76, 0.36], [0, ST[1] - 0.06, ST[2]], 0.007, 5, { c: W });
    matte.box(0.07, 0.045, 0.02, { p: [0, 0.73, 0.925], c: 0x2a2a2e });
    // 链条
    matte.tube([0.058, BB[1] + 0.095, BB[2]], [0.058, RA[1] + 0.038, RA[2]], 0.006, 4, { c: 0x2a2a2e });
    matte.tube([0.058, BB[1] - 0.095, BB[2]], [0.058, RA[1] - 0.038, RA[2]], 0.006, 4, { c: 0x2a2a2e });
    chrome.cyl(0.04, 0.04, 0.012, 12, { p: [0.058, RA[1], RA[2]], r: [0, 0, PI / 2], c: 0xbfc5ca });
    bike.add(new THREE.Mesh(paint.toGeometry(), M.paint), new THREE.Mesh(chrome.toGeometry(), M.chrome), new THREE.Mesh(matte.toGeometry(), M.matte));
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.012), M.tail); tl.position.set(0, 0.73, 0.938); bike.add(tl);

    // 车轮（前后共用几何）
    const wm = new Geo(1024, true), wc = new Geo(2048, true);
    wm.torus(WR - 0.024, 0.024, 8, 28, { r: [0, PI / 2, 0], c: 0x1b1b1e });
    wm.torus(WR - 0.052, 0.011, 5, 28, { r: [0, PI / 2, 0], s: [1, 1, 1.9], c: 0xe9dfc8 });
    wc.torus(WR - 0.066, 0.011, 5, 28, { r: [0, PI / 2, 0], s: [1, 1, 1.6], c: W });
    wc.cyl(0.02, 0.02, 0.1, 8, { r: [0, 0, PI / 2], c: W });
    const NS = 20;
    for (let i = 0; i < NS; i++) {
      const a = (i / NS) * TAU, x = i % 2 ? 0.035 : -0.035, R = WR - 0.07, off = (i % 2 ? 0.25 : -0.25);
      wc.tube([x, Math.cos(a + off) * 0.022, Math.sin(a + off) * 0.022], [0, Math.cos(a) * R, Math.sin(a) * R], 0.0028, 3, { c: W });
    }
    for (const a of [0.4, 0.4 + PI]) wm.box(0.012, 0.022, 0.055, { p: [0, Math.cos(a) * 0.2, Math.sin(a) * 0.2], r: [-a, 0, 0], c: 0xff8a2a });
    const gWm = wm.toGeometry(), gWc = wc.toGeometry();
    const mkWheel = () => { const g = new THREE.Group(); g.add(new THREE.Mesh(gWm, M.matte), new THREE.Mesh(gWc, M.chrome)); return g; };
    this.rearWheel = mkWheel(); this.rearWheel.position.set(...RA); bike.add(this.rearWheel);

    // 曲柄 + 踏板
    this.crankG = new THREE.Group(); this.crankG.position.set(...BB); bike.add(this.crankG);
    const cg = new Geo(512, true);
    cg.tube([0.085, 0, 0], [0.085, -CRANK, 0], 0.011, 6, { c: W }); cg.tube([-0.085, 0, 0], [-0.085, CRANK, 0], 0.011, 6, { c: W });
    cg.tube([-0.09, 0, 0], [0.09, 0, 0], 0.012, 6, { c: W });
    cg.cyl(0.098, 0.098, 0.006, 20, { p: [0.058, 0, 0], r: [0, 0, PI / 2], c: 0xc9ced2 });
    for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; cg.tube([0.062, 0, 0], [0.062, Math.cos(a) * 0.09, Math.sin(a) * 0.09], 0.007, 4, { c: W }); }
    this.crankG.add(new THREE.Mesh(cg.toGeometry(), M.chrome));
    const pg = new Geo(64, true); pg.box(0.1, 0.022, 0.075, { c: 0x2a2a2e }); pg.box(0.012, 0.03, 0.08, { p: [0.045, 0, 0], c: 0xff8a2a }); pg.box(0.012, 0.03, 0.08, { p: [-0.045, 0, 0], c: 0xff8a2a });
    const gP = pg.toGeometry();
    this.pedals = [new THREE.Mesh(gP, M.matte), new THREE.Mesh(gP, M.matte)];
    this.pedals[0].position.set(PEDAL_X, -CRANK, 0); this.pedals[1].position.set(-PEDAL_X, CRANK, 0);
    this.crankG.add(...this.pedals);

    // 转向组件（绕头管轴转动）
    const sg = this.steerG = new THREE.Group();
    const axis = V(HTt[0] - HTb[0], HTt[1] - HTb[1], HTt[2] - HTb[2]).normalize();
    this.steerBase = new THREE.Quaternion().setFromUnitVectors(UP, axis);
    sg.position.set(...HTt); sg.quaternion.copy(this.steerBase);
    bike.add(sg); sg.updateMatrix();
    const inv = this.steerInv = sg.matrix.clone().invert();
    const sp = new Geo(1024, true), sc = new Geo(1024, true), sm = new Geo(2048, true);
    sp.base = inv; sc.base = inv; sm.base = inv;
    // 前叉 + 前挡泥板
    sp.tube([0, HTb[1], HTb[2]], [0, 0.655, -0.412], 0.02, 8, { c: W });
    sp.tube([-0.06, 0.655, -0.412], [0.06, 0.655, -0.412], 0.018, 6, { c: W });
    for (const x of [-0.058, 0.058]) { sp.tube([x, 0.655, -0.412], [x, 0.47, -0.475], 0.013, 6, { c: W }); sp.tube([x, 0.47, -0.475], [x, FA[1], FA[2]], 0.011, 6, { c: W }); }
    sp.torus(0.375, 0.02, 5, 14, { p: FA, r: [0, PI / 2, 0.55], s: [1, 1, 2.6], arc: 2.0, c: W });
    // 把立、车把、把套、车铃
    sc.tube(HTt, [0, 1.04, -0.365], 0.014, 8, { c: W });
    const barPts = [[0, 1.045, -0.385], [0.09, 1.05, -0.4], [0.2, 1.065, -0.35], [0.262, 1.075, -0.24], [0.27, 1.075, -0.15]];
    for (const sgn of [-1, 1]) {
      for (let i = 0; i < barPts.length - 1; i++) { const a = barPts[i], b = barPts[i + 1]; sc.tube([a[0] * sgn, a[1], a[2]], [b[0] * sgn, b[1], b[2]], 0.011, 7, { c: W }); sc.sphere(0.011, 6, 5, { p: [b[0] * sgn, b[1], b[2]], c: W }); }
      sm.tube([0.27 * sgn, 1.075, -0.16], [0.27 * sgn, 1.075, -0.03], 0.016, 8, { c: 0x6b3f22 });
    }
    sc.sphere(0.03, 10, 6, { p: [-0.16, 1.095, -0.375], s: [1, 0.75, 1], c: W });
    // 车篮（藤编）
    const bx = BASKET[0], by = BASKET[1], bz = BASKET[2];
    for (let i = 0; i < 6; i++) { const t = i / 5, rr = 0.15 + 0.045 * t; sm.torus(rr, 0.011, 5, 16, { p: [bx, by - 0.11 + 0.22 * t, bz], r: [PI / 2, 0, 0], s: [1.25, 0.9, 1], c: i % 2 ? 0xb07a45 : 0xc8925a }); }
    for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; sm.tube([bx + Math.cos(a) * 0.15 * 1.25, by - 0.11, bz + Math.sin(a) * 0.15 * 0.9], [bx + Math.cos(a) * 0.195 * 1.25, by + 0.11, bz + Math.sin(a) * 0.195 * 0.9], 0.006, 3, { c: 0x9a6a3a }); }
    sm.cyl(0.15, 0.15, 0.012, 14, { p: [bx, by - 0.115, bz], s: [1.25, 1, 0.9], c: 0x8a5c30 });
    sm.torus(0.2, 0.014, 5, 16, { p: [bx, by + 0.115, bz], r: [PI / 2, 0, 0], s: [1.25, 0.9, 1], c: 0x7a4f2a });
    for (const x of [-0.07, 0.07]) sc.tube([x, by - 0.11, bz + 0.05], [x * 0.8, FA[1], FA[2]], 0.006, 4, { c: W });
    sc.tube([0, by - 0.02, bz + 0.17], [0, 1.045, -0.385], 0.007, 4, { c: W });
    // 车灯
    sc.cyl(0.04, 0.03, 0.07, 10, { p: [0, 0.79, -0.5], r: [PI / 2, 0, 0], c: W });
    sc.tube([0, 0.79, -0.47], [0, 0.72, -0.41], 0.007, 4, { c: W });
    sg.add(new THREE.Mesh(sp.toGeometry(), M.paint), new THREE.Mesh(sc.toGeometry(), M.chrome), new THREE.Mesh(sm.toGeometry(), M.matte));
    this.frontWheel = mkWheel(); this.frontWheel.position.copy(V(...FA).applyMatrix4(inv)); sg.add(this.frontWheel);
    this.lens = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.008, 12), M.glow);
    this.lens.position.copy(V(0, 0.79, -0.538).applyMatrix4(inv)); this.lens.quaternion.setFromUnitVectors(UP, V(0, 0, -1).applyMatrix4(new THREE.Matrix4().extractRotation(inv))); sg.add(this.lens);
    this.gripLocal = [V(GRIP[0], GRIP[1], GRIP[2]).applyMatrix4(inv), V(-GRIP[0], GRIP[1], GRIP[2]).applyMatrix4(inv)];
    this.basketLocal = V(...BASKET).applyMatrix4(inv);

    // 车篮里的鱼
    const fishG = new Geo(256, true);
    fishG.sphere(1, 8, 6, { s: [0.035, 0.06, 0.13], c: 0x9fd0ea, c2: 0x3a78b0 });
    fishG.cone(0.055, 0.09, 4, { p: [0, 0, 0.16], r: [-PI / 2, 0, 0], s: [0.3, 1, 1], c: 0x3a78b0 });
    const gF = fishG.toGeometry();
    this.basketFish = [];
    for (let i = 0; i < 9; i++) {
      const f = new THREE.Mesh(gF, M.gloss);
      const a = i * 2.4, r = 0.03 + (i % 3) * 0.035;
      f.position.copy(this.basketLocal).add(V(Math.cos(a) * r * 1.3, 0.0 + (i > 4 ? 0.05 : 0), Math.sin(a) * r));
      f.rotation.set(PI / 2 - 0.3 + (i % 2) * 0.5, a, (i % 3 - 1) * 0.5);
      f.visible = false; sg.add(f); this.basketFish.push(f);
    }
  }

  // ---------------- 鹈鹕 ----------------
  _buildBird() {
    const M = this.mat, bike = this.bike;
    const W = 0xfaf7f0, W2 = 0xe9e3d6;
    // 躯干
    const body = this.bodyG = new THREE.Group(); bike.add(body);
    const bg = new Geo(2048, true);
    bg.sphere(1, 20, 14, { s: [0.235, 0.25, 0.37], c: W, c2: W2 });
    bg.sphere(1, 16, 12, { p: [0, 0.035, -0.2], s: [0.2, 0.215, 0.2], c: W });
    bg.sphere(1, 14, 10, { p: [0, -0.02, 0.26], s: [0.175, 0.17, 0.2], c: W, c2: W2 });
    body.add(new THREE.Mesh(bg.toGeometry(), M.feather));
    const tail = new Geo(256, true);
    const tf = leafGeometry(0.3, 0.07, 0.75, 0.1);
    for (let i = -2; i <= 2; i++) tail.add(tf, { p: [i * 0.035, 0.0, 0.37], r: [-0.25 - Math.abs(i) * 0.04, i * 0.2, i * 0.12], order: 'YXZ' });
    this.tailM = new THREE.Mesh(tail.toGeometry(), M.featherFlat); body.add(this.tailM);
    this.hipL = [V(0.125, -0.17, 0.09), V(-0.125, -0.17, 0.09)];
    this.shoulderL = [V(0.205, 0.07, -0.13), V(-0.205, 0.07, -0.13)];
    this.neckL = V(0, 0.13, -0.3);

    // 腿
    const thighG = new THREE.CylinderGeometry(0.052, 0.088, 1, 12); // -Y 端（髋）粗，+Y 端（膝）细
    const shankG = new THREE.CylinderGeometry(0.02, 0.027, 1, 8);
    const ballG = new THREE.SphereGeometry(1, 12, 10);
    const footG = (() => { const g = new Geo(128, true); g.sphere(1, 8, 6, { p: [0, 0, -0.035], s: [0.062, 0.016, 0.095], c: 0xf38a2a }); for (const a of [-0.45, 0, 0.45]) g.tube([0, 0.004, 0], [Math.sin(a) * 0.11, 0, -Math.cos(a) * 0.13 - 0.02], 0.012, 5, { c: 0xe9741a }); return g.toGeometry(); })();
    const mk = (geo, mat, col) => { const m = new THREE.Mesh(geo, mat); if (col !== undefined) { const c = new THREE.Color(col); const n = geo.attributes.position.count; if (!geo.attributes.color) { const arr = new Float32Array(n * 3); for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; } geo.setAttribute('color', new THREE.BufferAttribute(arr, 3)); } } bike.add(m); return m; };
    this._col = (geo, col) => { const c = new THREE.Color(col), n = geo.attributes.position.count, arr = new Float32Array(n * 3); for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; } geo.setAttribute('color', new THREE.BufferAttribute(arr, 3)); return geo; };
    this._col(thighG, W); this._col(shankG, 0xf38a2a);
    const ballW = this._col(ballG.clone(), W), ballO = this._col(ballG.clone(), 0xf38a2a);
    this.legs = [0, 1].map(() => ({
      thigh: mk(thighG, M.feather), shank: mk(shankG, M.skin), knee: mk(ballO, M.skin), hipBall: mk(ballW, M.feather), foot: mk(footG, M.skin), kneePos: V(),
    }));
    for (const l of this.legs) { l.knee.scale.setScalar(0.03); l.hipBall.scale.setScalar(0.09); }

    // 翅膀（当手臂用）
    const upG = this._col(new THREE.CylinderGeometry(0.05, 0.075, 1, 10), W);
    const foreG = this._col(new THREE.CylinderGeometry(0.04, 0.055, 1, 10), W);
    const fanFore = new Geo(512, true), fanUp = new Geo(256, true), fanHand = new Geo(256, true);
    const f1 = leafGeometry(1, 0.2, 0.9, 0.08), f0 = leafGeometry(1, 0.22, 0.0, 0.08);
    for (let i = 0; i < 6; i++) { const t = i / 5; fanFore.add(f1, { p: [0, 0.04 + t * 0.26, 0.02], s: [0.36, 1, 0.22 + t * 0.2], r: [0.1 - t * 0.55, 0, 0] }); }
    for (let i = 0; i < 4; i++) { const t = i / 3; fanUp.add(f0, { p: [0, 0.05 + t * 0.22, 0.03], s: [0.4, 1, 0.24], r: [0.25 - t * 0.2, 0, 0] }); }
    for (let i = 0; i < 4; i++) { const t = i / 3; fanHand.add(f1, { p: [0, 0.01, 0], s: [0.34, 1, 0.3 + t * 0.12], r: [-0.75 - t * 0.5, 0, 0] }); }
    const gFF = fanFore.toGeometry(), gFU = fanUp.toGeometry(), gFH = fanHand.toGeometry();
    this.wings = [0, 1].map(() => {
      const up = new THREE.Group(), fore = new THREE.Group(), hand = new THREE.Group();
      const upB = new THREE.Mesh(upG, M.feather), foreB = new THREE.Mesh(foreG, M.feather);
      const fu = new THREE.Mesh(gFU, M.featherFlat), ff = new THREE.Mesh(gFF, M.featherFlat), fh = new THREE.Mesh(gFH, M.featherFlat);
      const mit = new THREE.Mesh(ballW, M.feather); mit.scale.set(0.05, 0.06, 0.05);
      const sh = new THREE.Mesh(ballW, M.feather); sh.scale.setScalar(0.085);
      const el = new THREE.Mesh(ballW, M.feather); el.scale.setScalar(0.056);
      up.add(upB, fu); fore.add(foreB, ff); hand.add(mit, fh);
      bike.add(up, fore, hand, sh, el);
      return { up, fore, hand, upB, foreB, fu, ff, fh, sh, el, elbow: V(), wrist: V() };
    });

    // 脖子（动态圆管）
    {
      const NR = this.NR = 14, NSD = this.NSD = 12;
      const g = this.neckGeo = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NR * NSD * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(NR * NSD * 3), 3));
      const col = new Float32Array(NR * NSD * 3); const cw = new THREE.Color(W); for (let i = 0; i < NR * NSD; i++) { col[i * 3] = cw.r; col[i * 3 + 1] = cw.g; col[i * 3 + 2] = cw.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const idx = [];
      for (let i = 0; i < NR - 1; i++) for (let j = 0; j < NSD; j++) { const a = i * NSD + j, b = i * NSD + (j + 1) % NSD, c = a + NSD, d = b + NSD; idx.push(a, b, c, b, d, c); }
      g.setIndex(idx);
      const m = new THREE.Mesh(g, M.feather); m.frustumCulled = false; bike.add(m);
      this.neckC = []; for (let i = 0; i < NR; i++) this.neckC.push(V());
      this.pouchBulge = 0;
    }

    // 头
    const head = this.head = new THREE.Group(); bike.add(head);
    const hg = new Geo(1024, true);
    hg.sphere(1, 18, 14, { s: [0.112, 0.11, 0.128], c: W });
    hg.sphere(1, 10, 8, { p: [0, -0.012, -0.075], s: [0.082, 0.07, 0.07], c: 0xffe7ae });
    for (const [x, k] of [[0, 1.0], [-0.035, 0.8], [0.035, 0.8]]) hg.cone(0.024, 0.13 * k, 5, { p: [x, 0.09, 0.075], r: [-2.0 + Math.abs(x) * 5, 0, x * 7], c: W });
    head.add(new THREE.Mesh(hg.toGeometry(), M.feather));
    // 上喙（放样成形：基部厚、末端带钩）
    const cU1 = [1.0, 0.80, 0.42], cU2 = [0.96, 0.52, 0.16], cU3 = [0.86, 0.22, 0.08];
    const upper = loft([
      { z: -0.07, w: 0.066, t: 0.054, b: 0.02, y: -0.004, c: cU1 }, { z: -0.2, w: 0.064, t: 0.04, b: 0.018, y: -0.01, c: cU1 },
      { z: -0.38, w: 0.057, t: 0.03, b: 0.016, y: -0.018, c: cU2 }, { z: -0.54, w: 0.046, t: 0.023, b: 0.014, y: -0.026, c: cU2 },
      { z: -0.63, w: 0.03, t: 0.02, b: 0.02, y: -0.034, c: cU3 }, { z: -0.665, w: 0.013, t: 0.01, b: 0.016, y: -0.052, c: cU3 },
    ], 12);
    head.add(new THREE.Mesh(upper, M.skin));
    // 下喙 + 喉囊（一个可鼓起的袋子）
    this.jawG = new THREE.Group(); this.jawG.position.set(0, -0.03, -0.075); head.add(this.jawG);
    const cP1 = [0.98, 0.62, 0.30], cP2 = [0.96, 0.50, 0.24];
    const pouch = loft([
      { z: 0.0, w: 0.05, t: 0.008, b: 0.03, y: 0, c: cP1 }, { z: -0.12, w: 0.058, t: 0.008, b: 0.6, y: 0, c: cP1 },
      { z: -0.27, w: 0.055, t: 0.008, b: 0.78, y: 0, c: cP2 }, { z: -0.43, w: 0.043, t: 0.008, b: 0.5, y: 0, c: cP2 },
      { z: -0.55, w: 0.026, t: 0.006, b: 0.16, y: 0, c: cU2 }, { z: -0.585, w: 0.012, t: 0.004, b: 0.06, y: 0, c: cU2 },
    ], 12);
    this.pouchM = new THREE.Mesh(pouch, M.skin); this.pouchM.scale.y = 0.14; this.jawG.add(this.pouchM);
    // 眼睛
    this.eyes = [];
    for (const sgn of [1, -1]) {
      const eg = new THREE.Group(); eg.position.set(0.092 * sgn, 0.038, -0.052);
      const e = new Geo(128, true);
      e.sphere(0.038, 12, 10, { c: 0xffe38a }); e.sphere(0.025, 10, 8, { p: [0.02 * sgn, 0.002, -0.008], c: 0x130a06 }); e.sphere(0.009, 6, 4, { p: [0.038 * sgn, 0.014, -0.018], c: 0xffffff });
      eg.add(new THREE.Mesh(e.toGeometry(), M.gloss)); head.add(eg); this.eyes.push(eg);
    }
    this.hatAnchor = new THREE.Group(); this.hatAnchor.position.set(0, 0.04, 0.005); head.add(this.hatAnchor);
    this.glassAnchor = new THREE.Group(); this.glassAnchor.position.set(0, 0.032, -0.07); head.add(this.glassAnchor);
    this.hats = {}; this.glassesM = {};
  }

  _hat(name) {
    if (this.hats[name]) return this.hats[name];
    const M = this.mat, g = new THREE.Group(), a = new Geo(512, true);
    let spin = null;
    if (name === 'helmet') {
      const hs = new THREE.SphereGeometry(1, 16, 8, 0, TAU, 0, PI / 2);
      a.add(hs, { s: [0.118, 0.105, 0.135], p: [0, 0.01, 0.005], c: 0xd8322f });
      for (const x of [-0.045, 0, 0.045]) a.add(hs, { s: [0.022, 0.108, 0.137], p: [x, 0.012, 0.005], c: 0xfff3dc });
      a.box(0.17, 0.012, 0.06, { p: [0, 0.018, -0.13], r: [0.2, 0, 0], c: 0x2a2a2e });
      a.torus(0.117, 0.008, 4, 16, { p: [0, 0.012, 0.005], r: [PI / 2, 0, 0], s: [1, 1.14, 1], c: 0x2a2a2e });
    } else if (name === 'straw') {
      a.cyl(0.2, 0.22, 0.012, 18, { p: [0, 0.045, 0], c: 0xe8cf8a }); a.cyl(0.095, 0.105, 0.085, 14, { p: [0, 0.09, 0], c: 0xe8cf8a, c2: 0xd8b96a });
      a.cyl(0.107, 0.107, 0.028, 14, { p: [0, 0.066, 0], c: 0xd7263d });
    } else if (name === 'chef') {
      a.cyl(0.095, 0.092, 0.11, 14, { p: [0, 0.095, 0], c: 0xffffff });
      for (let i = 0; i < 6; i++) { const t = i / 6 * TAU; a.sphere(0.07, 8, 6, { p: [Math.cos(t) * 0.062, 0.19, Math.sin(t) * 0.062], c: 0xffffff }); }
      a.sphere(0.08, 8, 6, { p: [0, 0.215, 0], c: 0xffffff });
    } else if (name === 'pirate') {
      a.cyl(0.1, 0.11, 0.07, 12, { p: [0, 0.075, 0], c: 0x1c1c22 });
      a.add(new THREE.CylinderGeometry(1, 1, 1, 3), { p: [0, 0.05, 0.01], s: [0.2, 0.018, 0.2], r: [0, PI, 0], c: 0x1c1c22 });
      for (let i = 0; i < 3; i++) { const t = i / 3 * TAU + PI / 3; a.box(0.19, 0.075, 0.012, { p: [Math.sin(t) * 0.1, 0.085, Math.cos(t) * 0.1 + 0.01], r: [0, t, 0], c: 0x23232b }); a.box(0.19, 0.012, 0.014, { p: [Math.sin(t) * 0.1, 0.123, Math.cos(t) * 0.1 + 0.01], r: [0, t, 0], c: 0xf2c94a }); }
      a.sphere(0.022, 6, 5, { p: [0, 0.09, -0.1], c: 0xffffff });
      a.add(leafGeometry(0.2, 0.035, 0, 0.5), { p: [0.07, 0.11, 0.04], r: [-1.1, 0.3, 0], c: 0xe8433f });
    } else if (name === 'propeller') {
      const hs = new THREE.SphereGeometry(1, 12, 6, 0, TAU, 0, PI / 2);
      const cols = [0xff5a5a, 0xffd24a, 0x5ad1ff, 0x7be07b];
      for (let i = 0; i < 4; i++) a.add(new THREE.SphereGeometry(1, 4, 6, i * PI / 2, PI / 2, 0, PI / 2), { s: [0.112, 0.1, 0.12], p: [0, 0.02, 0], c: cols[i] });
      a.tube([0, 0.11, 0], [0, 0.17, 0], 0.006, 4, { c: 0x444444 });
      const p = new Geo(64, true); p.box(0.3, 0.006, 0.035, { c: 0xff5a5a }); p.box(0.035, 0.006, 0.3, { c: 0x5ad1ff }); p.sphere(0.016, 6, 5, { c: 0xffd24a });
      spin = new THREE.Mesh(p.toGeometry(), M.gloss); spin.position.y = 0.172; g.add(spin);
    } else if (name === 'wizard') {
      a.cone(0.115, 0.3, 14, { p: [0, 0.2, 0.01], r: [0.12, 0, 0], c: 0x5b3fb8, c2: 0x3a2a8a });
      a.cyl(0.19, 0.2, 0.012, 16, { p: [0, 0.048, 0], c: 0x4a32a0 });
      for (let i = 0; i < 7; i++) { const t = i * 2.4, h = 0.08 + (i % 4) * 0.055; a.ico(0.014, 0, { p: [Math.cos(t) * (0.11 - h * 0.3), h + 0.02, Math.sin(t) * (0.11 - h * 0.3) + 0.01], c: 0xffe36a }); }
      a.torus(0.105, 0.012, 4, 14, { p: [0, 0.06, 0], r: [PI / 2, 0, 0], c: 0xffd24a });
    } else if (name === 'crown') {
      a.cyl(0.092, 0.092, 0.05, 14, { p: [0, 0.075, 0], open: true, c: 0xffcf3a });
      for (let i = 0; i < 7; i++) { const t = i / 7 * TAU; a.cone(0.024, 0.07, 4, { p: [Math.cos(t) * 0.09, 0.132, Math.sin(t) * 0.09], c: 0xffd84a }); a.ico(0.014, 0, { p: [Math.cos(t) * 0.094, 0.078, Math.sin(t) * 0.094], c: [0xff4a6a, 0x4ad0ff, 0x7be07b][i % 3] }); }
      a.sphere(0.08, 10, 6, { p: [0, 0.07, 0], s: [1, 0.6, 1], c: 0xa0283a });
    }
    g.add(new THREE.Mesh(a.toGeometry(), name === 'crown' || name === 'helmet' ? M.gloss : M.matte));
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.userData.spin = spin;
    this.hatAnchor.add(g); this.hats[name] = g;
    return g;
  }
  _glasses(name) {
    if (name === 'none') return null;
    if (this.glassesM[name]) return this.glassesM[name];
    const a = new Geo(256, true);
    if (name === 'shades') {
      for (const x of [-0.06, 0.06]) a.box(0.085, 0.05, 0.012, { p: [x, 0, -0.045], r: [0, -x * 5, 0], c: 0x101014 });
      a.box(0.05, 0.012, 0.012, { p: [0, 0.012, -0.05], c: 0x101014 });
      for (const x of [-0.1, 0.1]) a.box(0.008, 0.012, 0.12, { p: [x, 0.012, 0.01], c: 0x101014 });
    } else if (name === 'heart') {
      for (const x of [-0.06, 0.06]) { for (const dx of [-0.018, 0.018]) a.sphere(0.024, 8, 6, { p: [x + dx, 0.012, -0.048], s: [1, 1, 0.3], c: 0xff4a8a }); a.cone(0.036, 0.05, 4, { p: [x, -0.02, -0.048], r: [PI, PI / 4, 0], s: [1, 1, 0.3], c: 0xff4a8a }); }
      a.box(0.05, 0.01, 0.01, { p: [0, 0.012, -0.05], c: 0xffffff });
      for (const x of [-0.1, 0.1]) a.box(0.008, 0.01, 0.12, { p: [x, 0.012, 0.01], c: 0xffffff });
    } else if (name === 'goggles') {
      for (const x of [-0.058, 0.058]) { a.cyl(0.04, 0.04, 0.03, 12, { p: [x, 0.005, -0.045], r: [PI / 2, 0, 0], c: 0x8a5a2a }); a.cyl(0.031, 0.031, 0.034, 12, { p: [x, 0.005, -0.047], r: [PI / 2, 0, 0], c: 0x9fe0ff }); }
      a.torus(0.108, 0.01, 4, 16, { p: [0, 0.01, 0.03], r: [PI / 2, 0, 0], s: [1, 1.15, 1], c: 0x5a3a1a });
    }
    const m = new THREE.Mesh(a.toGeometry(), this.mat.gloss); m.castShadow = true;
    this.glassAnchor.add(m); this.glassesM[name] = m;
    return m;
  }

  // ---------------- 围巾 ----------------
  _buildScarf() {
    const M = this.mat;
    this.scarfRing = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.03, 8, 18), M.scarf);
    this._col(this.scarfRing.geometry, 0xffffff);
    this.bike.add(this.scarfRing);
    const N = this.SN = 11;
    this.tails = [0, 1].map((k) => {
      const pts = [], prev = [];
      for (let i = 0; i < N; i++) { pts.push(V(0, 1.6, i * 0.07)); prev.push(V(0, 1.6, i * 0.07)); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
      const idx = []; for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, M.scarf); mesh.frustumCulled = false; mesh.castShadow = true;
      this.scene.add(mesh);
      return { pts, prev, mesh, seg: 0.064 - k * 0.008, w: 0.058 - k * 0.01, k };
    });
    this.scarfReset = true;
  }
  _scarfColors(cols) {
    const c1 = new THREE.Color(), N = this.SN;
    const at = (t, i) => { if (cols === 'rainbow') c1.setHSL((t * 0.9 + 0.0) % 1, 0.85, 0.55); else c1.set(cols[Math.floor(i / 2) % 2]); return c1; };
    for (const tl of this.tails) {
      const a = tl.mesh.geometry.attributes.color;
      for (let i = 0; i < N; i++) { const c = at(i / (N - 1), i); a.setXYZ(i * 2, c.r, c.g, c.b); a.setXYZ(i * 2 + 1, c.r, c.g, c.b); }
      a.needsUpdate = true;
    }
    const ra = this.scarfRing.geometry.attributes.color, n = ra.count;
    for (let i = 0; i < n; i++) { const c = cols === 'rainbow' ? c1.setHSL((i / n * 3) % 1, 0.85, 0.55) : c1.set(cols[0]); ra.setXYZ(i, c.r, c.g, c.b); }
    ra.needsUpdate = true;
  }

  applyCosmetics(cos) {
    Object.assign(this.cos, cos);
    const c = this.cos;
    for (const k in this.hats) this.hats[k].visible = false;
    this._hat(c.hat).visible = true;
    for (const k in this.glassesM) this.glassesM[k].visible = false;
    const g = this._glasses(c.glasses); if (g) g.visible = true;
    this._scarfColors(COSMETICS.scarf[c.scarf].cols);
    this.mat.paint.color.set(COSMETICS.paint[c.paint].col);
    this.mat.paint.metalness = c.paint === 'night' ? 0.7 : 0.35;
  }

  setVisible(v) { this.root.visible = v; for (const t of this.tails) t.mesh.visible = v; }
  setEnvIntensity(k) { for (const m of this.allMats) if (m.envMap) m.envMapIntensity = (m === this.mat.chrome ? 0.55 : m === this.mat.paint || m === this.mat.gloss ? 0.8 : 0.25) * k; }

  // 事件
  gulp() { this.gulpT = 0; }
  honk() { this.honkT = 0; }
  doFlap() { this.flapT = 0; }

  // s: { x, y, yaw, lean, pitch, speed, cadence(转/秒), steer, wing(0..1), stand, wheelie(弧度), flipX, flipY, roll, superman, air, brake, night, fish, lookAt(Vector3|null), dtScale }
  update(dt, s) {
    this.time += dt;
    const t = this.time;
    this.root.position.set(s.x, s.y, 0);
    this.root.rotation.y = s.yaw;
    this.tilt.rotation.set(s.pitch || 0, 0, s.lean || 0);
    this.flipPivot.rotation.set(s.flipX || 0, s.flipY || 0, s.roll || 0, 'YXZ');
    this.wheeliePivot.rotation.x = s.wheelie || 0;
    this.stand = damp(this.stand, s.stand || 0, 8, dt);
    this.superman = damp(this.superman, s.superman || 0, 10, dt);
    this.wing = damp(this.wing, s.wing || 0, 12, dt);
    this.happy = damp(this.happy, s.happy || 0, 6, dt);
    const sp = this.superman, st = this.stand;

    // 车轮 / 曲柄 / 转向
    this.wheelRot += (s.speed * dt) / WR;
    this.rearWheel.rotation.x = -this.wheelRot;
    this.frontWheel.rotation.x = -this.wheelRot;
    this.crank += (s.cadence || 0) * TAU * dt;
    const ca = this.crank;
    this.crankG.rotation.x = -ca;
    this.pedals[0].rotation.x = ca; this.pedals[1].rotation.x = ca;
    this.steer = damp(this.steer, s.steer || 0, 14, dt);
    _q.setFromAxisAngle(UP, -this.steer * 0.5);
    this.steerG.quaternion.copy(this.steerBase).multiply(_q);
    this.steerG.updateMatrix();
    // 站起来摇车时车身左右晃
    const rock = Math.sin(ca) * 0.11 * st;
    this.bike.rotation.z = rock;

    // 躯干
    const pedalPulse = Math.sin(ca * 2) * 0.008 * clamp(s.cadence || 0);
    const body = this.bodyG;
    body.position.set(-rock * 0.5, 1.2 + pedalPulse + st * 0.13 + sp * 0.36, 0.17 - st * 0.12 + sp * 0.34);
    body.rotation.set(lerp(0.55 - st * 0.2 - (s.brake ? 0.08 : 0), -0.12, sp), 0, Math.sin(ca) * 0.035 * clamp(s.cadence || 0) - rock * 0.6);
    body.updateMatrix();

    // 腿
    for (let i = 0; i < 2; i++) {
      const L = this.legs[i], sgn = i ? -1 : 1;
      const hip = _f.copy(this.hipL[i]).applyMatrix4(body.matrix);
      const ang = ca + (i ? PI : 0);
      const foot = V(PEDAL_X * sgn, BB[1] - CRANK * Math.cos(ang) + 0.028, BB[2] + CRANK * Math.sin(ang));
      if (sp > 0.01) foot.lerp(_a.set(0.1 * sgn, hip.y + 0.06, hip.z + 0.86), sp); // 超人式：双腿后伸
      const hint = _b.set(0.35 * sgn, 0.25 - sp * 1.2, -1);
      const hipC = hip.clone();
      ik2(hipC, foot, 0.47, 0.47, hint, L.kneePos);
      // 目标过远时把脚收回到可达处
      _c.subVectors(foot, L.kneePos); if (_c.length() > 0.47) foot.copy(L.kneePos).addScaledVector(_c.normalize(), 0.47);
      setBone(L.thigh, hipC, L.kneePos); setBone(L.shank, L.kneePos, foot);
      L.knee.position.copy(L.kneePos); L.hipBall.position.copy(hipC);
      L.foot.position.copy(foot);
      L.foot.rotation.set(sp * 1.3 + Math.sin(ang) * 0.12, 0, 0);
    }

    // 翅膀
    this.flapT = Math.min(1, this.flapT + dt * 2.6);
    const flapPulse = Math.sin(this.flapT * PI) * (1 - this.flapT);
    const w = this.wing;
    const glideFlap = Math.sin(t * 7) * 0.07 * w;
    for (let i = 0; i < 2; i++) {
      const Wg = this.wings[i], sgn = i ? -1 : 1;
      const sh = _f.copy(this.shoulderL[i]).applyMatrix4(body.matrix).clone();
      const grip = this.gripLocal[i].clone().applyMatrix4(this.steerG.matrix);
      const out = V(sh.x + sgn * 0.6, sh.y + 0.16 + glideFlap - flapPulse * 0.75 + this.happy * 0.1 * Math.sin(t * 9 + i), sh.z + 0.02 + flapPulse * 0.1);
      const target = grip.lerp(out, smooth(w));
      const hint = _b.set(sgn * lerp(0.5, 0.2, w), lerp(-0.6, 1.0, w), lerp(0.9, 0.5, w));
      ik2(sh, target, 0.3, 0.32, hint, Wg.elbow);
      _c.subVectors(target, Wg.elbow); if (_c.length() > 0.32) target.copy(Wg.elbow).addScaledVector(_c.normalize(), 0.32);
      Wg.wrist.copy(target);
      const ref = _ref.set(0, lerp(-1, -0.15, w), lerp(0.35, 1, w));
      setFrame(Wg.up, sh, Wg.elbow, ref); setFrame(Wg.fore, Wg.elbow, Wg.wrist, ref);
      Wg.upB.scale.set(1, 0.3, 1); Wg.upB.position.set(0, 0.15, 0);
      Wg.foreB.scale.set(1, 0.32, 1); Wg.foreB.position.set(0, 0.16, 0);
      const fs = 0.5 + 0.85 * w;
      Wg.ff.scale.set(1, 1, fs); Wg.fu.scale.set(1, 1, 0.6 + 0.7 * w);
      // 手（初级飞羽）：展开时沿前臂方向向外伸展
      _c.subVectors(Wg.wrist, Wg.elbow).normalize();
      setFrame(Wg.hand, Wg.wrist, _e.copy(Wg.wrist).add(_c), ref);
      Wg.fh.scale.set(1, 1, 0.25 + 1.0 * w); Wg.fh.rotation.x = lerp(0.9, 0.0, w);
      Wg.sh.position.copy(sh); Wg.el.position.copy(Wg.elbow);
    }

    // 头：弹簧跟随 + 注视
    const nb = this.neckL.clone().applyMatrix4(body.matrix);
    this.gulpT = Math.min(1, this.gulpT + dt * 3.2);
    this.honkT = Math.min(1, this.honkT + dt * 1.6);
    const gulp = Math.sin(this.gulpT * PI) * (1 - this.gulpT * 0.3);
    const honk = Math.sin(Math.min(1, this.honkT * 1.3) * PI);
    let yawT = -this.steer * 0.35 + Math.sin(t * 0.45) * 0.1, pitchT = Math.sin(t * 0.7) * 0.04 - honk * 0.75 + sp * 0.2 - (s.wheelie || 0) * 0.5;
    const rest = _a.set(-(s.lean || 0) * 0.25 + rock * -0.3, body.position.y + 0.66 - honk * -0.05, body.position.z - 0.31 - st * 0.05 - sp * 0.25);
    if (s.lookAt) {
      // 把世界坐标的目标变到车体坐标（忽略翻转，仅用于朝向）
      _b.copy(s.lookAt).sub(this.root.position); _b.applyAxisAngle(UP, -s.yaw);
      const dx = _b.x - rest.x, dy = _b.y - rest.y, dz = _b.z - rest.z;
      const dd = Math.hypot(dx, dz);
      if (dz < 1 && dd < 14) {
        yawT = clamp(Math.atan2(-dx, -dz), -1.2, 1.2); pitchT += clamp(Math.atan2(dy, dd), -0.6, 0.7);
        const reach = clamp(1 - dd / 3.0) * 0.16;
        rest.x += clamp(dx, -1, 1) * reach; rest.y += clamp(dy, -1, 1) * reach; rest.z += clamp(dz, -1, 1) * reach * 0.5;
      }
    }
    rest.y += gulp * 0.03; rest.z -= gulp * 0.06;
    // 弹簧
    const k = 190, c = 17;
    _c.subVectors(rest, this.headPos).multiplyScalar(k).addScaledVector(this.headVel, -c);
    this.headVel.addScaledVector(_c, dt); this.headPos.addScaledVector(this.headVel, dt);
    _c.subVectors(this.headPos, rest); if (_c.length() > 0.22) this.headPos.copy(rest).addScaledVector(_c.normalize(), 0.22);
    this.headYaw = damp(this.headYaw, yawT, 9, dt); this.headPitch = damp(this.headPitch, pitchT, 9, dt);
    const head = this.head;
    head.position.copy(this.headPos);
    head.rotation.set(this.headPitch - 0.1, this.headYaw, -(s.lean || 0) * 0.4, 'YXZ');
    head.updateMatrix();
    this.jaw = damp(this.jaw, Math.max(gulp * 0.75, honk * 0.9, this.happy * 0.25, (s.wheelie || 0) * 0.5), 22, dt);
    this.jawG.rotation.x = this.jaw;
    this.pouch = damp(this.pouch, 0.15 + gulp * 0.16 + honk * 0.08 + this.jaw * 0.05, 16, dt);
    this.pouchBulge = damp(this.pouchBulge, gulp, 10, dt);
    this.pouchM.scale.y = this.pouch;
    // 眨眼
    this.blinkT -= dt; if (this.blinkT < 0) this.blinkT = 1.5 + Math.random() * 3.5;
    const bl = this.blinkT < 0.12 ? 0.12 : 1;
    const squint = lerp(1, 0.45, this.happy);
    for (const e of this.eyes) e.scale.y = Math.min(bl, squint);
    const hat = this.hats[this.cos.hat]; if (hat && hat.userData.spin) hat.userData.spin.rotation.y += dt * (6 + s.speed * 2.2);

    // 脖子：沿三次贝塞尔挤出的圆管
    const p0 = nb, p3 = _f.set(0, -0.05, 0.04).applyMatrix4(head.matrix).clone();
    const p1 = V(nb.x, nb.y + 0.25, nb.z + 0.06 + sp * 0.1), p2 = _e.set(0, -0.27, 0.15).applyMatrix4(head.matrix).clone();
    {
      const NR = this.NR, NSD = this.NSD, pa = this.neckGeo.attributes.position, na = this.neckGeo.attributes.normal;
      const C = this.neckC;
      for (let i = 0; i < NR; i++) {
        const u = i / (NR - 1), v = 1 - u;
        const cx = v * v * v * p0.x + 3 * v * v * u * p1.x + 3 * v * u * u * p2.x + u * u * u * p3.x;
        const cy = v * v * v * p0.y + 3 * v * v * u * p1.y + 3 * v * u * u * p2.y + u * u * u * p3.y;
        const cz = v * v * v * p0.z + 3 * v * v * u * p1.z + 3 * v * u * u * p2.z + u * u * u * p3.z;
        C[i].set(cx, cy, cz);
        // 切线
        _a.set(
          3 * v * v * (p1.x - p0.x) + 6 * v * u * (p2.x - p1.x) + 3 * u * u * (p3.x - p2.x),
          3 * v * v * (p1.y - p0.y) + 6 * v * u * (p2.y - p1.y) + 3 * u * u * (p3.y - p2.y),
          3 * v * v * (p1.z - p0.z) + 6 * v * u * (p2.z - p1.z) + 3 * u * u * (p3.z - p2.z)).normalize();
        const yw = this.headYaw * u;
        _b.set(Math.cos(yw), 0, -Math.sin(yw));         // 横向参考
        _c.crossVectors(_a, _b).normalize();            // 副法线
        _d.crossVectors(_c, _a);                         // 修正后的横向
        const r = lerp(0.128, 0.074, Math.pow(u, 0.62)) * (1 + 0.18 * Math.sin(u * PI) * this.pouchBulge);
        for (let j = 0; j < NSD; j++) {
          const a = j / NSD * TAU, ca2 = Math.cos(a), sa2 = Math.sin(a);
          const nx = _d.x * ca2 + _c.x * sa2, ny = _d.y * ca2 + _c.y * sa2, nz = _d.z * ca2 + _c.z * sa2;
          const k = i * NSD + j;
          pa.setXYZ(k, cx + nx * r, cy + ny * r, cz + nz * r); na.setXYZ(k, nx, ny, nz);
        }
      }
      pa.needsUpdate = true; na.needsUpdate = true;
    }
    // 围巾环
    const n3 = this.neckC[4], n4 = this.neckC[5];
    this.scarfRing.position.copy(n3);
    this.scarfRing.quaternion.setFromUnitVectors(_a.set(0, 0, 1), _b.subVectors(n4, n3).normalize());

    // 车篮里的鱼
    const show = Math.min(this.basketFish.length, Math.ceil((s.fish || 0) / 3));
    if (show !== this.fishShown) { this.fishShown = show; this.basketFish.forEach((f, i) => f.visible = i < show); }
    // 车灯
    const night = s.night || 0;
    this.headlight.intensity = night * 26;
    this.uSelf.value = night * 0.2;
    this.mat.glow.color.setScalar(0.4 + night * 3.2).multiply(_colWarm);
    this.mat.tail.color.setRGB(0.6 + night * 3.0 + (s.brake ? 2.5 : 0), 0.05, 0.03);

    this._updateScarf(dt, s);
  }

  _updateScarf(dt, s) {
    this.root.updateMatrixWorld(true);
    const anchor = _a.copy(this.scarfRing.position).add(_b.set(0, -0.01, 0.1)).applyMatrix4(this.bike.matrixWorld);
    const N = this.SN;
    const h = Math.min(dt, 1 / 30);
    const windZ = 2.2 + s.speed * 1.5, t = this.time;
    const bodyC = _f.copy(this.bodyG.position).applyMatrix4(this.bike.matrixWorld);
    for (const tl of this.tails) {
      const P = tl.pts, Q = tl.prev;
      if (this.scarfReset) for (let i = 0; i < N; i++) { P[i].set(anchor.x + (tl.k ? 0.03 : -0.03), anchor.y - i * 0.01, anchor.z + i * tl.seg); Q[i].copy(P[i]); }
      P[0].copy(anchor); P[0].x += tl.k ? 0.025 : -0.025;
      for (let i = 1; i < N; i++) {
        const p = P[i], q = Q[i];
        const vx = (p.x - q.x) * 0.965, vy = (p.y - q.y) * 0.965, vz = (p.z - q.z) * 0.965;
        q.copy(p);
        const ph = t * (5.5 + tl.k) - i * 0.8;
        const turb = 0.5 + s.speed * 0.09;
        p.x += vx + (Math.sin(ph) * turb + (s.steer || 0) * -1.5) * h * h * 14;
        p.y += vy + (-6.5 + Math.cos(ph * 1.3) * turb * 1.6 + windZ * 0.32) * h * h;
        p.z += vz + windZ * h * h * 6.5;
      }
      for (let it = 0; it < 4; it++) {
        for (let i = 1; i < N; i++) {
          const a = P[i - 1], b = P[i];
          _c.subVectors(b, a); const d = _c.length() || 1e-5; const diff = (d - tl.seg) / d;
          if (i === 1) b.addScaledVector(_c, -diff); else { a.addScaledVector(_c, diff * 0.5); b.addScaledVector(_c, -diff * 0.5); }
          // 不穿过身体
          _d.subVectors(b, bodyC); const bd = _d.length(); if (bd < 0.33) b.addScaledVector(_d, (0.33 - bd) / (bd || 1));
        }
      }
      // 写入带状网格
      const pa = tl.mesh.geometry.attributes.position, na = tl.mesh.geometry.attributes.normal;
      for (let i = 0; i < N; i++) {
        const a = P[Math.max(0, i - 1)], b = P[Math.min(N - 1, i + 1)];
        _c.subVectors(b, a).normalize();
        { const tw = i * 0.22 + Math.sin(t * 3.1 + i * 0.6 + tl.k * 2) * 0.55; _d.set(Math.sin(tw) * 0.9, Math.cos(tw), 0.0).cross(_c).normalize(); } // 宽度方向（带扭转）
        _e.crossVectors(_c, _d);
        const wdt = tl.w * (i === N - 1 ? 0.6 : 1);
        pa.setXYZ(i * 2, P[i].x + _d.x * wdt, P[i].y + _d.y * wdt + _e.y * 0, P[i].z + _d.z * wdt);
        pa.setXYZ(i * 2 + 1, P[i].x - _d.x * wdt, P[i].y - _d.y * wdt, P[i].z - _d.z * wdt);
        na.setXYZ(i * 2, _e.x, Math.abs(_e.y) + 0.3, _e.z); na.setXYZ(i * 2 + 1, _e.x, Math.abs(_e.y) + 0.3, _e.z);
      }
      pa.needsUpdate = true; na.needsUpdate = true;
    }
    this.scarfReset = false;
  }

  // 世界坐标：喙尖 / 车篮 / 后轮触地点（给粒子、吸鱼动画用）
  beakWorld(out) { return out.set(0, -0.03, -0.42).applyMatrix4(this.head.matrix).applyMatrix4(this.bike.matrixWorld); }
  basketWorld(out) { return out.copy(this.basketLocal).applyMatrix4(this.steerG.matrix).applyMatrix4(this.bike.matrixWorld); }
  rearWorld(out) { return out.set(0, 0.05, RA[2]).applyMatrix4(this.bike.matrixWorld); }
  headWorld(out) { return out.set(0, 0.2, -0.02).applyMatrix4(this.head.matrix).applyMatrix4(this.bike.matrixWorld); }
  bodyWorld(out) { return out.copy(this.bodyG.position).applyMatrix4(this.bike.matrixWorld); }
}
const _colWarm = new THREE.Color(1.0, 0.92, 0.72);
