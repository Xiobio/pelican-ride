// 赛道上的实体：鱼、道具、障碍、跳台等 —— 建模、对象池、关卡片段生成、运动与动画
import * as THREE from 'three';
import { Geo, selfLit } from './geo.js';
import { LANES, ROAD_HALF, DIFFICULTY } from './track.js';
import { makeRng, clamp, lerp, smooth, TAU } from './util.js';
import { L } from './i18n.js';

const PI = Math.PI;
const _v = new THREE.Vector3();

function emojiSprite(text, size = 128, font = 88, color = null) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `900 ${font}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji","PingFang SC","Microsoft YaHei",sans-serif`;
  if (color) { x.lineWidth = 10; x.strokeStyle = 'rgba(60,30,0,0.9)'; x.strokeText(text, size / 2, size / 2 + 4); x.fillStyle = color; }
  x.fillText(text, size / 2, size / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function chevronTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(10,30,40,0.55)'; x.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 4; i++) {
    const y = 250 - i * 64;
    x.fillStyle = i % 2 ? '#ffe36a' : '#3fe8d8';
    x.beginPath(); x.moveTo(10, y); x.lineTo(64, y - 44); x.lineTo(118, y); x.lineTo(118, y - 22); x.lineTo(64, y - 66); x.lineTo(10, y - 22); x.closePath(); x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapT = THREE.RepeatWrapping;
  return t;
}

// 各类型的碰撞尺寸：hw 半宽, hl 半长, hh 高度；kind: collect / hazard / soft / trigger
export const TYPES = {
  fish:    { kind: 'collect', r: 1.15 },
  gold:    { kind: 'collect', r: 1.25 },
  ring:    { kind: 'ring', r: 1.25 },
  magnet:  { kind: 'power', r: 1.3 }, shield: { kind: 'power', r: 1.3 }, x2: { kind: 'power', r: 1.3 }, chili: { kind: 'power', r: 1.3 }, heart: { kind: 'power', r: 1.3 },
  cone:    { kind: 'hazard', hw: 0.3, hl: 0.3, hh: 0.62, name: L('路锥', "cone") },
  barrier: { kind: 'hazard', hw: 1.15, hl: 0.3, hh: 0.98, name: L('路障', "barrier") },
  rock:    { kind: 'hazard', hw: 0.6, hl: 0.55, hh: 0.8, name: L('落石', "rock") },
  crab:    { kind: 'hazard', hw: 0.5, hl: 0.42, hh: 0.5, name: L('螃蟹', "crab") },
  barrel:  { kind: 'hazard', hw: 0.7, hl: 0.5, hh: 0.95, name: L('木桶', "barrel") },
  cart:    { kind: 'hazard', hw: 0.8, hl: 1.1, hh: 2.1, name: L('冰淇淋车', "ice cream cart") },
  puddle:  { kind: 'slip', hw: 1.0, hl: 1.0, hh: 0.3 },
  ball:    { kind: 'kick', hw: 0.5, hl: 0.5, hh: 0.9 },
  castle:  { kind: 'kick', hw: 0.6, hl: 0.6, hh: 1.0 },
  gull:    { kind: 'gull', hw: 0.4, hl: 0.4, hh: 0.7 },
  ramp:    { kind: 'ramp', hw: 1.2, hl: 1.6, hh: 0.2 },
  pad:     { kind: 'pad', hw: 1.15, hl: 1.6, hh: 0.2 },
};

export class Entities {
  constructor(root, props, envMap) {
    this.root = root; this.props = props;
    this.list = []; this.pools = {};
    this.genS = 0; this.lastSection = '';
    this.M = {
      gloss: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.15, envMap, envMapIntensity: 0.7 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xffc23a, roughness: 0.22, metalness: 0.85, envMap, envMapIntensity: 1.2, emissive: 0x7a4a00, emissiveIntensity: 0.7 }),
      flat: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, side: THREE.DoubleSide }),
      smooth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
      bubble: new THREE.MeshStandardMaterial({ color: 0x9fe6ff, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.2, envMap, envMapIntensity: 0.5, depthWrite: false }),
      puddle: new THREE.MeshStandardMaterial({ color: 0x1c3248, roughness: 0.08, metalness: 0.5, transparent: true, opacity: 0.82, envMap, envMapIntensity: 1.4, depthWrite: false }),
      ring: new THREE.MeshStandardMaterial({ color: 0xffd45a, roughness: 0.25, metalness: 0.8, envMap, emissive: 0xffa020, emissiveIntensity: 0.5 }),
      pad: new THREE.MeshBasicMaterial({ map: chevronTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      halo: new THREE.SpriteMaterial({ map: this._haloTex(), color: 0xffd060, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.32 }),
    };
    this.icons = {
      magnet: new THREE.SpriteMaterial({ map: emojiSprite('🧲'), depthWrite: false }), shield: new THREE.SpriteMaterial({ map: emojiSprite('🛡️'), depthWrite: false }),
      x2: new THREE.SpriteMaterial({ map: emojiSprite('×2', 128, 84, '#ffd84a'), depthWrite: false }), chili: new THREE.SpriteMaterial({ map: emojiSprite('🌶️'), depthWrite: false }),
      heart: new THREE.SpriteMaterial({ map: emojiSprite('❤️'), depthWrite: false }),
    };
    this.uSelf = { value: 0 };
    for (const k of ['gloss', 'flat', 'smooth']) selfLit(this.M[k], this.uSelf);
    this._buildGeos();
    this.time = 0;
  }
  _haloTex() {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  }

  _buildGeos() {
    const G = this.G = {};
    // 鱼（头朝 +X）
    const fish = (top, bot, fin) => {
      const g = new Geo(512, true);
      g.sphere(1, 14, 10, { s: [0.36, 0.165, 0.1], c: top, c2: bot });
      g.cone(0.15, 0.22, 4, { p: [-0.42, 0, 0], r: [0, 0, -PI / 2], s: [1, 1, 0.22], c: fin });
      g.cone(0.07, 0.16, 4, { p: [0.02, 0.17, 0], r: [0, 0, 0.5], s: [1.6, 1, 0.2], c: fin });
      g.cone(0.045, 0.1, 4, { p: [0.08, -0.14, 0], r: [0, 0, PI - 0.5], s: [1.4, 1, 0.2], c: fin });
      for (const z of [-1, 1]) { g.sphere(0.036, 8, 6, { p: [0.22, 0.035, 0.075 * z], c: 0xffffff }); g.sphere(0.02, 6, 5, { p: [0.232, 0.035, 0.1 * z], c: 0x101018 }); }
      return g.toGeometry();
    };
    G.fish = fish(0x2b84e0, 0xc8f0ff, 0x1f5fb8);
    G.gold = fish(0xffffff, 0xffffff, 0xffffff);
    G.ring = new THREE.TorusGeometry(1.05, 0.085, 8, 28);
    G.bubble = new THREE.SphereGeometry(0.62, 20, 14);
    // 路锥
    { const g = new Geo(256); g.box(0.5, 0.05, 0.5, { p: [0, 0.025, 0], c: 0x26262a }); g.cone(0.2, 0.62, 10, { p: [0, 0.36, 0], c: 0xff6a1a }); g.cyl(0.115, 0.15, 0.13, 10, { p: [0, 0.3, 0], c: 0xffffff }); G.cone = g.toGeometry(); }
    // 路障
    { const g = new Geo(512), gl = new Geo(64);
      for (let i = 0; i < 6; i++) { g.box(0.37, 0.3, 0.06, { p: [-0.925 + i * 0.37, 0.8, 0], c: i % 2 ? 0xffffff : 0xe03a2e }); g.box(0.37, 0.16, 0.06, { p: [-0.925 + i * 0.37, 0.4, 0], c: i % 2 ? 0xe03a2e : 0xffffff }); }
      for (const x of [-0.95, 0.95]) { g.box(0.07, 1.0, 0.07, { p: [x, 0.5, 0], c: 0x3a3d44 }); g.box(0.09, 0.06, 0.7, { p: [x, 0.03, 0], c: 0x3a3d44 }); gl.sphere(0.075, 6, 5, { p: [x, 1.05, 0], c: 0xffb020 }); }
      G.barrier = g.toGeometry(); G.barrierGlow = gl.toGeometry(); }
    { const g = new Geo(128); g.ico(0.7, 1, { p: [0, 0.4, 0], s: [1, 0.75, 0.9], c: 0x9a9088, c2: 0x5a5452, jit: 0.3, cj: 0.25 }); G.rock = g.toGeometry(); }
    // 螃蟹（身体 + 可摆动的腿）
    { const g = new Geo(512, true);
      g.sphere(1, 12, 8, { p: [0, 0.3, 0], s: [0.36, 0.17, 0.27], c: 0xf0553a, c2: 0xc8321f });
      for (const x of [-0.12, 0.12]) { g.tube([x, 0.4, -0.16], [x * 1.2, 0.58, -0.2], 0.018, 5, { c: 0xe04a30 }); g.sphere(0.045, 8, 6, { p: [x * 1.2, 0.6, -0.2], c: 0xffffff }); g.sphere(0.024, 6, 5, { p: [x * 1.2, 0.605, -0.236], c: 0x111111 }); }
      for (const x of [-1, 1]) { g.tube([0.28 * x, 0.32, -0.12], [0.5 * x, 0.42, -0.3], 0.04, 6, { c: 0xe04a30 }); g.sphere(1, 8, 6, { p: [0.55 * x, 0.46, -0.36], s: [0.12, 0.09, 0.14], c: 0xff6a4a }); g.cone(0.05, 0.14, 5, { p: [0.55 * x, 0.5, -0.5], r: [-PI / 2, 0, 0], c: 0xff8a6a }); }
      G.crab = g.toGeometry();
      const l = new Geo(128, true);
      for (let i = 0; i < 3; i++) { const z = -0.1 + i * 0.13; l.tube([0.3, 0.28, z], [0.5, 0.3, z + 0.02], 0.025, 5, { c: 0xe04a30 }); l.tube([0.5, 0.3, z + 0.02], [0.62, 0.02, z + 0.04], 0.02, 5, { c: 0xc8321f }); }
      G.crabLegs = l.toGeometry(); }
    G.puddle = new THREE.CircleGeometry(1.12, 22).rotateX(-PI / 2);
    // 木桶（轴向沿 X，滚动）
    { const g = new Geo(256, true); g.cyl(0.42, 0.42, 1.3, 14, { r: [0, 0, PI / 2], c: 0x9a6a3a }); g.cyl(0.47, 0.47, 0.5, 14, { r: [0, 0, PI / 2], c: 0xa87644 });
      for (const x of [-0.5, -0.27, 0.27, 0.5]) g.torus(0.455 - Math.abs(x) * 0.05, 0.022, 4, 16, { p: [x, 0, 0], r: [0, PI / 2, 0], c: 0x33333a });
      for (let i = 0; i < 6; i++) g.box(1.28, 0.012, 0.02, { p: [0, Math.cos(i / 6 * TAU) * 0.44, Math.sin(i / 6 * TAU) * 0.44], r: [i / 6 * TAU, 0, 0], c: 0x6a4424 });
      G.barrel = g.toGeometry(); }
    // 冰淇淋三轮车
    { const g = new Geo(1024);
      g.box(1.4, 0.85, 1.7, { p: [0, 0.75, 0.1], c: 0xfff0d8 }); g.box(1.42, 0.2, 1.72, { p: [0, 0.5, 0.1], c: 0xff8fb0 }); g.box(1.5, 0.06, 1.8, { p: [0, 1.2, 0.1], c: 0xe8dcc4 });
      for (const [x, z] of [[-0.66, -0.7], [0.66, -0.7], [-0.66, 0.9], [0.66, 0.9]]) g.tube([x, 1.2, z], [x, 2.0, z], 0.03, 5, { c: 0xd8d8d8 });
      for (let i = 0; i < 8; i++) g.box(0.2, 0.06, 1.95, { p: [-0.7 + i * 0.2, 2.03, 0.1], c: i % 2 ? 0xff7fa6 : 0xffffff });
      for (let i = 0; i < 8; i++) g.add(this.props.TRI, { p: [-0.7 + i * 0.2, 2.0, -0.88], s: [0.2, 0.18, 1], c: i % 2 ? 0xff7fa6 : 0xffffff });
      for (const [x, z] of [[-0.75, 0.5], [0.75, 0.5]]) { g.torus(0.36, 0.05, 6, 16, { p: [x, 0.36, z], r: [0, PI / 2, 0], c: 0x222226 }); g.cyl(0.3, 0.3, 0.03, 10, { p: [x, 0.36, z], r: [0, 0, PI / 2], c: 0xc8c8cc }); }
      g.torus(0.3, 0.045, 6, 14, { p: [0, 0.3, -1.25], r: [0, PI / 2, 0], c: 0x222226 }); g.tube([0, 0.3, -1.25], [0, 0.95, -0.8], 0.03, 5, { c: 0x888888 }); g.tube([-0.35, 1.05, -0.85], [0.35, 1.05, -0.85], 0.025, 5, { c: 0x444444 });
      // 甜筒招牌
      g.cone(0.16, 0.45, 8, { p: [0, 2.3, 0.1], r: [PI, 0, 0], c: 0xe0a860 }); g.sphere(0.2, 10, 8, { p: [0, 2.62, 0.1], c: 0xffc0d6 }); g.sphere(0.15, 8, 6, { p: [0, 2.86, 0.1], c: 0xfff6e0 });
      G.cart = g.toGeometry(); }
    // 沙滩球
    { const g = new THREE.SphereGeometry(0.44, 18, 12), n = g.attributes.position.count, col = new Float32Array(n * 3), uv = g.attributes.uv;
      const cs = [0xff5a5a, 0xffffff, 0xffd24a, 0xffffff, 0x4ab4ff, 0xffffff].map(h => new THREE.Color(h));
      for (let i = 0; i < n; i++) { const c = cs[Math.max(0, Math.min(5, Math.floor(uv.getX(i) * 6))) || 0]; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); G.ball = g; }
    G.castle = this.props.castle.toGeometry();
    // 海鸥
    { const g = new Geo(512, true);
      g.sphere(1, 12, 8, { p: [0, 0.34, 0], s: [0.15, 0.15, 0.26], c: 0xffffff, c2: 0xe8e8ee });
      g.sphere(0.1, 10, 8, { p: [0, 0.54, -0.2], c: 0xffffff }); g.cone(0.035, 0.14, 6, { p: [0, 0.52, -0.33], r: [-PI / 2, 0, 0], c: 0xffb020 });
      for (const x of [-1, 1]) { g.sphere(0.018, 6, 5, { p: [0.07 * x, 0.57, -0.26], c: 0x111111 }); g.tube([0.05 * x, 0.2, 0.02], [0.05 * x, 0, 0.0], 0.012, 4, { c: 0xff9a2a }); }
      g.cone(0.09, 0.22, 4, { p: [0, 0.34, 0.33], r: [PI / 2 + 0.3, 0, 0], s: [1, 1, 0.3], c: 0x30343c });
      G.gull = g.toGeometry();
      const w = new Geo(64, true); w.sphere(1, 8, 6, { p: [0.3, 0, 0], s: [0.32, 0.025, 0.14], c: 0x8a93a2, c2: 0x8a93a2 }); w.sphere(1, 6, 5, { p: [0.62, 0, 0.02], s: [0.12, 0.02, 0.09], c: 0x23262c });
      G.gullWing = w.toGeometry(); }
    // 跳台（朝 -Z 前进方向升高）
    { const g = new Geo(256);
      const W = 1.2, L = 1.6, H = 0.95, wood = [0.55, 0.36, 0.2], dark = [0.36, 0.23, 0.13];
      const N = 6;
      for (let i = 0; i < N; i++) {
        const t0 = i / N, t1 = (i + 1) / N, z0 = L - t0 * 2 * L, z1 = L - t1 * 2 * L, y0 = H * t0 * t0, y1 = H * t1 * t1;
        const c = i % 2 ? [0.98, 0.78, 0.2] : wood;
        g.quad([-W, y0, z0], [W, y0, z0], [W, y1, z1], [-W, y1, z1], c);
        for (const sx of [-W, W]) g.quad([sx, 0, z0], [sx, y0, z0], [sx, y1, z1], [sx, 0, z1], dark);
      }
      g.quad([-W, 0, -L], [W, 0, -L], [W, H, -L], [-W, H, -L], dark);
      G.ramp = g.toGeometry(); }
    G.pad = new THREE.PlaneGeometry(2.3, 3.2).rotateX(-PI / 2);
  }

  // ---------- 对象池 ----------
  _make(type) {
    const M = this.M, G = this.G;
    const mesh = (g, m, shadow = true) => { const o = new THREE.Mesh(g, m); o.castShadow = shadow; return o; };
    let o;
    switch (type) {
      case 'fish': o = new THREE.Group(); o.add(mesh(G.fish, M.gloss)); break;
      case 'gold': { o = new THREE.Group(); const f = mesh(G.gold, M.gold); f.scale.setScalar(1.35); const h = new THREE.Sprite(M.halo); h.scale.setScalar(1.9); o.add(f, h); break; }
      case 'ring': { o = new THREE.Group(); o.add(mesh(G.ring, M.ring, false)); const h = new THREE.Sprite(M.halo); h.scale.setScalar(2.6); o.add(h); break; }
      case 'magnet': case 'shield': case 'x2': case 'chili': case 'heart': {
        o = new THREE.Group(); const b = mesh(G.bubble, M.bubble, false); b.renderOrder = 11; const s = new THREE.Sprite(this.icons[type]); s.scale.setScalar(0.8); s.renderOrder = 12; o.add(s, b); break; }
      case 'cone': o = mesh(G.cone, M.flat); break;
      case 'barrier': o = new THREE.Group(); o.add(mesh(G.barrier, M.flat), mesh(G.barrierGlow, M.glow, false)); break;
      case 'rock': o = mesh(G.rock, M.flat); break;
      case 'crab': { o = new THREE.Group(); const b = mesh(G.crab, M.gloss), l1 = mesh(G.crabLegs, M.gloss), l2 = mesh(G.crabLegs, M.gloss); l2.scale.x = -1; o.add(b, l1, l2); o.userData.legs = [l1, l2]; o.scale.setScalar(1.25); break; }
      case 'puddle': o = mesh(G.puddle, M.puddle, false); o.renderOrder = 3; break;
      case 'barrel': { o = new THREE.Group(); const b = mesh(G.barrel, M.smooth); b.position.y = 0.47; o.add(b); o.userData.roll = b; break; }
      case 'cart': o = mesh(G.cart, M.flat); break;
      case 'ball': { o = new THREE.Group(); const b = mesh(G.ball, M.gloss); b.position.y = 0.44; o.add(b); o.userData.ball = b; break; }
      case 'castle': o = mesh(G.castle, M.flat); break;
      case 'gull': { o = new THREE.Group(); const b = mesh(G.gull, M.smooth), w1 = mesh(G.gullWing, M.smooth), w2 = mesh(G.gullWing, M.smooth); w1.position.set(0.1, 0.4, 0.02); w2.position.set(-0.1, 0.4, 0.02); w2.scale.x = -1; o.add(b, w1, w2); o.userData.wings = [w1, w2]; o.scale.setScalar(1.3); break; }
      case 'ramp': o = mesh(G.ramp, M.flat); o.receiveShadow = true; break;
      case 'pad': o = mesh(G.pad, M.pad, false); o.renderOrder = 2; break;
    }
    return o;
  }
  spawn(type, s, u, y = 0, extra) {
    const pool = this.pools[type] || (this.pools[type] = []);
    const obj = pool.pop() || this._make(type);
    obj.visible = true; obj.rotation.set(0, 0, 0);
    const baseScale = type === 'crab' ? 1.25 : type === 'gull' ? 1.3 : 1;
    obj.scale.setScalar(baseScale);
    this.root.add(obj);
    const T = TYPES[type];
    const e = { type, kind: T.kind, T, s, u, y, obj, dead: false, t: Math.random() * 10, phase: Math.random() * TAU, state: 0, vx: 0, vy: 0, vs: 0, passed: false, hit: false };
    if (extra) Object.assign(e, extra);
    if (T.kind === 'hazard' || T.kind === 'ramp' || T.kind === 'pad') obj.rotation.y = -Math.atan(this.track.dcx(s));
    this.list.push(e);
    this._place(e);
    return e;
  }
  _place(e) {
    const tr = this.track;
    e.obj.position.set(tr.cx(e.s) + e.u, tr.cy(e.s) + e.y, -e.s);
  }
  _free(e) {
    e.obj.visible = false; this.root.remove(e.obj);
    (this.pools[e.type] || (this.pools[e.type] = [])).push(e.obj);
  }
  clear() { for (const e of this.list) this._free(e); this.list.length = 0; }

  reset(track, seed, mode = 'adventure') {
    this.clear();
    this.track = track; this.mode = mode;
    this.rng = makeRng((seed ^ 0x7f4a7c15) >>> 0);
    this.genS = 70; this.lastSection = '';
    this.ctx = { hearts: 3, maxHearts: 3, shield: false, rain: 0 };
  }

  // ---------- 关卡片段 ----------
  generate(toS) {
    let guard = 0;
    while (this.genS < toS && guard++ < 40) {
      const len = this._section(this.genS);
      const d = DIFFICULTY(this.genS);
      this.genS += len + lerp(15, 6, d) * (this.mode === 'zen' ? 1.6 : 1);
    }
  }
  _section(S) {
    const r = this.rng, tr = this.track, d = DIFFICULTY(S), zone = tr.zoneAt(S + 15).key, zen = this.mode === 'zen';
    const hz = zen ? 0.45 : 1; // 悠闲模式障碍更少
    const early = S < 380;
    const W = [
      [early ? 6 : 3.2, 'fishLine'], [2.2, 'fishArc'], [(early ? 1.2 : 2.4) * hz, 'slalom'], [(early ? 0.5 : 2.2 + d) * hz, 'barrierGap'],
      [early ? 1.4 : 2.4, 'rampJump'], [(early ? 0 : 1.6 + d) * hz * (zone === 'bridge' ? 0.3 : 1), 'crabCross'], [(early ? 0 : 1.0 + this.ctx.rain * 2.5) * hz, 'puddles'],
      [(early ? 0 : 0.9 + d * 1.6) * hz, 'barrels'], [(early ? 0 : 1.2 + d) * hz * (zone === 'village' || zone === 'beach' ? 1.8 : 0.6), 'cart'],
      [early ? 0.4 : 1.7, 'gulls'], [zone === 'beach' ? 3 : 0.35, 'balls'], [early ? 0.9 : 1.5, 'powerup'], [(early ? 0 : 1.2 + d) * hz, 'goldRisk'],
      [early ? 0.3 : 1.5, 'rings'], [early ? 0.6 : 1.3, 'pads'], [(zone === 'cliff' ? 3.2 : 0.3) * hz, 'rocks'], [1.0, 'rest'],
    ].filter(w => w[1] !== this.lastSection && w[0] > 0);
    const name = r.weighted(W);
    this.lastSection = name;
    return this['_s_' + name](S, r, d, zone);
  }
  _fish(s, u, y = 1.15, goldP = 0) { return this.spawn(this.rng.chance((goldP + 0.012) * (1 + (this.ctx.goldBoost || 0) * 0.3)) ? 'gold' : 'fish', s, u, y); }
  _lane(r) { return r.int(0, 2); }
  _other(r, a) { let b = r.int(0, 1); if (b >= a) b++; return b; }

  _s_rest() { return 12; }
  _s_fishLine(S, r, d) {
    const n = r.int(6, 10), a = this._lane(r), sw = r.chance(0.55), b = sw ? clamp(a + r.sign(), 0, 2) : a;
    for (let i = 0; i < n; i++) { const t = i / (n - 1); this._fish(S + 3 + i * 2.3, lerp(LANES[a], LANES[b], smooth((t - 0.25) / 0.5)), 1.15, i === n - 1 ? 0.3 : 0); }
    return n * 2.3 + 6;
  }
  _s_fishArc(S, r, d) {
    const a = this._lane(r), kind = r.weighted([[3, 'cone'], [2 + d * 2, 'barrier'], [1, 'rock']]);
    if (kind === 'cone') { for (const dz of [-1.2, 0, 1.2]) this.spawn('cone', S + 13 + dz, LANES[a]); } else this.spawn(kind, S + 13, LANES[a]);
    for (let i = 0; i < 7; i++) { const t = i / 6; this._fish(S + 6.5 + t * 13, LANES[a], 1.15 + 4 * 1.55 * t * (1 - t), i === 3 ? 0.4 : 0); }
    return 27;
  }
  _s_slalom(S, r, d) {
    const n = 4 + (d > 0.5 ? 1 : 0), a = this._lane(r), b = this._other(r, a), gap = lerp(9, 7, d);
    for (let i = 0; i < n; i++) {
      const ln = i % 2 ? b : a, s = S + 7 + i * gap;
      this.spawn('cone', s, LANES[ln]); if (d > 0.4 && r.chance(0.5)) this.spawn('cone', s + 0.9, LANES[ln] + 0.55 * r.sign());
      const free = i % 2 ? a : b;
      this._fish(s, LANES[free]); this._fish(s + gap * 0.5, lerp(LANES[free], LANES[ln], 0.5));
    }
    return n * gap + 9;
  }
  _s_barrierGap(S, r, d) {
    const open = this._lane(r);
    for (let l = 0; l < 3; l++) if (l !== open) this.spawn('barrier', S + 15, LANES[l]);
    for (let i = 0; i < 8; i++) this._fish(S + 4 + i * 2.6, LANES[open], 1.15, i === 7 ? 0.35 : 0);
    if (d > 0.45 && r.chance(0.6)) {
      const open2 = this._other(r, open);
      for (let l = 0; l < 3; l++) if (l !== open2) this.spawn('barrier', S + 35, LANES[l]);
      for (let i = 0; i < 5; i++) this._fish(S + 26 + i * 2.6, lerp(LANES[open], LANES[open2], smooth(i / 3)));
      return 50;
    }
    return 30;
  }
  _s_rampJump(S, r, d) {
    const a = this._lane(r);
    this.spawn('ramp', S + 6, LANES[a]);
    const under = r.weighted([[2, 'cone'], [1 + d, 'barrier'], [1, 'none']]);
    if (under === 'cone') for (let i = 0; i < 4; i++) this.spawn('cone', S + 12.5 + i * 2.2, LANES[a]);
    else if (under === 'barrier') { this.spawn('barrier', S + 13, LANES[a]); this.spawn('barrier', S + 18, LANES[a]); }
    for (let i = 0; i < 8; i++) { const t = i / 7; this._fish(S + 8.5 + t * 14, LANES[a], 1.5 + 4 * 2.6 * t * (1 - t), i === 4 ? 0.5 : 0); }
    if (r.chance(0.6)) this.spawn('ring', S + 15.5, LANES[a], 3.9);
    for (let i = 0; i < 3; i++) this._fish(S + 26 + i * 2.4, LANES[a]);
    return 36;
  }
  _s_crabCross(S, r, d) {
    const n = 2 + (d > 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) { const side = i % 2 ? 1 : -1; this.spawn('crab', S + 10 + i * 8, side * (ROAD_HALF - 0.7) * r.range(0.3, 1), 0, { vx: -side * r.range(1.1, 1.7 + d), dir: -side }); }
    for (let i = 0; i < 7; i++) this._fish(S + 5 + i * 3.6, LANES[(i + 1) % 3]);
    return 12 + n * 8 + 6;
  }
  _s_puddles(S, r) {
    for (let i = 0; i < 3; i++) { const l = this._lane(r); this.spawn('puddle', S + 6 + i * 8, LANES[l] + r.range(-0.4, 0.4), 0.02); this._fish(S + 6 + i * 8, LANES[(l + 1 + r.int(0, 1)) % 3]); this._fish(S + 10 + i * 8, LANES[(l + 1) % 3]); }
    return 30;
  }
  _s_barrels(S, r, d) {
    const n = 2 + (d > 0.55 ? 1 : 0), a = this._lane(r);
    const lanes = [a, this._other(r, a), a];
    for (let i = 0; i < n; i++) this.spawn('barrel', S + 26 + i * 9, LANES[lanes[i]], 0, { vs: -(4.5 + d * 3) });
    let free = 3 - a - lanes[1];
    for (let i = 0; i < 8; i++) this._fish(S + 5 + i * 3, LANES[free]);
    return 28 + n * 9;
  }
  _s_cart(S, r, d) {
    const a = this._lane(r);
    this.spawn('cart', S + 16, LANES[a], 0, { vs: 3.2 + r() * 1.5 });
    const b = this._other(r, a);
    for (let i = 0; i < 9; i++) this._fish(S + 5 + i * 3, LANES[b], 1.15, i === 8 ? 0.4 : 0);
    if (r.chance(0.5)) for (let i = 0; i < 3; i++) this._fish(S + 30 + i * 2.5, LANES[a]);
    return 40;
  }
  _s_gulls(S, r, d) {
    const n = r.int(3, 5);
    for (let i = 0; i < n; i++) this.spawn('gull', S + 16 + r.range(-1.5, 1.5), lerp(-3, 3, (i + 0.5) / n) + r.range(-0.3, 0.3), 0, { ry: r.range(-0.6, 0.6) });
    for (let i = 0; i < 9; i++) this._fish(S + 19 + (i % 3) * 2.4, LANES[Math.floor(i / 3)], 1.15, 0.12);
    return 32;
  }
  _s_balls(S, r) {
    for (let i = 0; i < 4; i++) { const l = this._lane(r); this.spawn(r.chance(0.65) ? 'ball' : 'castle', S + 5 + i * 6 + r.range(-1, 1), LANES[l] + r.range(-0.5, 0.5)); this._fish(S + 8 + i * 6, LANES[(l + 1) % 3]); }
    return 30;
  }
  _s_powerup(S, r) {
    const a = this._lane(r), c = this.ctx;
    const type = r.weighted([[3, 'magnet'], [c.shield ? 0.2 : 3, 'shield'], [3, 'x2'], [2.2, 'chili'], [c.hearts < c.maxHearts ? 3.5 : 0.01, 'heart']]);
    for (let i = 0; i < 4; i++) this._fish(S + 3 + i * 2.3, LANES[a]);
    this.spawn(type, S + 13.5, LANES[a], 1.25);
    return 22;
  }
  _s_goldRisk(S, r, d) {
    const b = this._lane(r);
    this.spawn('cone', S + 8, LANES[b]); this.spawn('cone', S + 21, LANES[b]);
    for (const l of [0, 1, 2]) if (l !== b) { this.spawn('cone', S + 14.5, LANES[l] + (LANES[b] - LANES[l]) * 0.42); }
    this.spawn('gold', S + 12.5, LANES[b], 1.15); this.spawn('gold', S + 16.5, LANES[b], 1.15);
    this._fish(S + 4, LANES[this._other(r, b)]); this._fish(S + 25, LANES[this._other(r, b)]);
    return 30;
  }
  _s_rings(S, r) {
    const a = this._lane(r);
    this.spawn('ramp', S + 5, LANES[a]);
    const ys = [3.4, 4.6, 4.2, 2.8];
    for (let i = 0; i < 4; i++) { this.spawn('ring', S + 12 + i * 6.5, LANES[a], ys[i]); this._fish(S + 15.2 + i * 6.5, LANES[a], ys[i] - 0.3 - (i === 3 ? 1 : 0), 0.2); }
    return 40;
  }
  _s_pads(S, r) {
    const a = this._lane(r);
    this.spawn('pad', S + 6, LANES[a], 0.03);
    for (let i = 0; i < 14; i++) this._fish(S + 11 + i * 2.6, LANES[a], 1.15, i % 7 === 6 ? 0.6 : 0);
    return 50;
  }
  _s_rocks(S, r, d) {
    const rows = 4;
    let prevOpen = this._lane(r);
    for (let i = 0; i < rows; i++) {
      const open = clamp(prevOpen + r.int(-1, 1), 0, 2);
      for (let l = 0; l < 3; l++) if (l !== open && (l !== prevOpen || i === 0) && r.chance(0.8)) this.spawn('rock', S + 8 + i * 8.5 + r.range(-0.8, 0.8), LANES[l] + r.range(-0.4, 0.4), 0, { ry: r() * 6 });
      this._fish(S + 8 + i * 8.5, LANES[open]); this._fish(S + 12 + i * 8.5, lerp(LANES[open], LANES[prevOpen], 0.3));
      prevOpen = open;
    }
    return rows * 8.5 + 8;
  }

  // 从海里跃出、横跨路面的飞鱼（大叫 / 狂热时出现）
  spawnFlying(s, n = 5, gold = 0.15) {
    for (let i = 0; i < n; i++) {
      const e = this.spawn(this.rng.chance(gold) ? 'gold' : 'fish', s + i * 2.6, -6, 0);
      e.fly = { t: -i * 0.12, dur: 2.3 + Math.random() * 0.5, h: 3.2 + Math.random() * 1.2, from: -7.5, to: 6.5 };
    }
  }
  // 狂热：从天而降悬停的鱼
  spawnRain(s, lanesOnly = true) {
    const l = this.rng.int(0, 2), n = this.rng.int(3, 5);
    for (let i = 0; i < n; i++) { const e = this._fish(s + i * 2.2, LANES[l], 1.15 + (this.rng.chance(0.3) ? 1.6 : 0), 0.14); e.drop = 1; }
  }

  // ---------- 每帧更新：运动 + 动画 + 回收 ----------
  update(dt, time, dist) {
    this.time = time;
    const tr = this.track;
    this.M.pad.map.offset.y = -time * 1.6;
    this.M.glow.color.setScalar(1.6);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i], o = e.obj;
      e.t += dt;
      if (e.dead || e.s < dist - 26 || e.s > dist + 520) { this._free(e); this.list.splice(i, 1); continue; }
      if (e.custom) continue;
      switch (e.type) {
        case 'fish': case 'gold': {
          if (e.fly) {
            const f = e.fly; f.t += dt;
            const t = f.t / f.dur;
            if (t > 1) { e.dead = true; break; }
            if (t < 0) { o.visible = false; break; } o.visible = true;
            if (!f.splashed && this.onSplash) { f.splashed = true; this.onSplash(tr.cx(e.s) + f.from, 0.2, -e.s); }
            e.u = lerp(f.from, f.to, t); e.y = Math.sin(t * PI) * f.h + 0.4 - tr.cy(e.s) * (1 - Math.sin(t * PI)) * (t < 0.5 ? 1 : 0.3);
            this._place(e);
            o.rotation.set(0, 0, (0.5 - t) * 2.2); o.rotation.y = 0;
          } else if (e.pull) {
            // 被磁铁/喉囊吸走：由 game 更新 s/u/y
            this._place(e); o.rotation.y += dt * 12; o.scale.setScalar(Math.max(0.2, o.scale.x - dt * 2.2));
          } else {
            if (e.drop) { e.drop = Math.max(0, e.drop - dt * 2.4); }
            const bob = Math.sin(e.t * 3 + e.phase) * 0.1 + (e.drop ? e.drop * e.drop * 7 : 0);
            o.position.y = tr.cy(e.s) + e.y + bob;
            o.rotation.y = Math.sin(e.t * 1.7 + e.phase) * 0.55 + (e.phase > PI ? PI : 0);
            o.rotation.z = Math.sin(e.t * 6 + e.phase) * 0.12;
          }
          break;
        }
        case 'ring': o.rotation.z = e.t * 0.8; o.scale.setScalar(1 + Math.sin(e.t * 4) * 0.04); break;
        case 'magnet': case 'shield': case 'x2': case 'chili': case 'heart': o.position.y = tr.cy(e.s) + e.y + Math.sin(e.t * 2.4) * 0.12; o.children[1].rotation.y = e.t; o.children[0].scale.setScalar(0.8 + Math.sin(e.t * 5) * 0.05); break;
        case 'crab': {
          if (e.state === 0) { e.u += e.vx * dt; if (Math.abs(e.u) > ROAD_HALF - 0.6) { e.vx = -e.vx; e.u = clamp(e.u, -ROAD_HALF + 0.6, ROAD_HALF - 0.6); } }
          else { e.u += e.vx * dt; if (Math.abs(e.u) > ROAD_HALF + 3) e.dead = true; }
          this._place(e);
          const w = e.t * (e.state ? 26 : 13);
          o.position.y += Math.abs(Math.sin(w)) * 0.03; o.rotation.z = Math.sin(w) * 0.07;
          o.userData.legs[0].rotation.z = Math.sin(w) * 0.25; o.userData.legs[1].rotation.z = Math.sin(w + 1.5) * 0.25;
          break;
        }
        case 'barrel': {
          if (!e.knock && e.s - dist < 58) { e.s += e.vs * dt; this._place(e); o.userData.roll.rotation.x += e.vs * dt / 0.45; }
          break;
        }
        case 'cart': if (!e.knock && e.s - dist < 46) { e.s += e.vs * dt; this._place(e); o.position.y += Math.abs(Math.sin(e.t * 9)) * 0.012; } break;
        case 'ball': if (!e.knock) { o.userData.ball.position.y = 0.44 + Math.abs(Math.sin(e.t * 2.2 + e.phase)) * 0.05; } break;
        case 'gull': {
          const wg = o.userData.wings;
          if (e.state === 0) { o.rotation.y = (e.ry || 0) + Math.sin(e.t * 0.9 + e.phase) * 0.3; wg[0].rotation.set(0, 0.25, -1.25); wg[1].rotation.set(0, -0.25, 1.25); o.position.y = tr.cy(e.s) + Math.max(0, Math.sin(e.t * 2.6 + e.phase) - 0.92) * 0.6; }
          else {
            // 受惊飞走
            e.fy = (e.fy || 0) + dt; const k = e.fy;
            e.u += e.vx * dt; e.s += (e.vs || 0) * dt; e.y = k * k * 3.2 + k * 2.4;
            this._place(e); o.rotation.y = e.vx > 0 ? -1.1 : 1.1;
            const f = Math.sin(e.t * 22) * 0.9; wg[0].rotation.set(0, 0, f); wg[1].rotation.set(0, 0, -f);
            if (k > 2.6) e.dead = true;
          }
          break;
        }
        case 'barrier': break;
      }
      if (e.ry !== undefined && e.type === 'rock') o.rotation.y = e.ry;
      // 被撞飞 / 踢飞
      if (e.knock) {
        const k = e.knock; k.t += dt;
        e.u += k.vx * dt; e.s += k.vs * dt; e.y += k.vy * dt; k.vy -= 20 * dt;
        if (e.y < 0 && k.vy < 0) { e.y = 0; k.vy *= -0.45; k.vx *= 0.7; k.vs *= 0.7; if (Math.abs(k.vy) < 1) k.vy = 0; }
        this._place(e);
        o.rotation.x += k.rx * dt; o.rotation.z += k.rz * dt;
        if (k.t > k.life) e.dead = true;
        if (k.t > k.life - 0.3) o.scale.multiplyScalar(Math.max(0.01, 1 - dt * 6));
      }
    }
  }

  knock(e, speed, dir = 0, life = 1.3) {
    e.knock = { t: 0, life, vx: (dir || (Math.random() - 0.5) * 2) * (3 + Math.random() * 3), vs: speed * (0.9 + Math.random() * 0.4), vy: 6 + Math.random() * 4, rx: (Math.random() - 0.5) * 18, rz: (Math.random() - 0.5) * 18 };
    e.hit = true;
  }
  scareGull(e, playerS) { if (e.state) return; e.state = 1; e.vx = (e.u >= 0 ? 1 : -1) * (3 + Math.random() * 3); e.vs = 6 + Math.random() * 5; e.hit = true; }
  scareCrab(e) { if (e.state) return; e.state = 1; e.vx = (e.u >= 0 ? 1 : -1) * 7.5; e.hit = true; }
}
