// 氛围层：海上船只/浮标、远岛、热气球、海鸥群、鲸鱼与海豚、萤火虫/花瓣/烟花
import * as THREE from 'three';
import { Geo } from './geo.js';
import { EDGE } from './track.js';
import { clamp, lerp, smoothstep, TAU, makeRng } from './util.js';

const PI = Math.PI;
const _c = new THREE.Color(), _v = new THREE.Vector3();

function loftX(rings, seg = 10) { // 沿 X 的放样（头朝 +X）。rings: {x, w(半宽 z), t(上半高), b(下半高), y, c, cb}
  const pos = [], col = [], idx = [];
  for (const R of rings) for (let j = 0; j < seg; j++) {
    const a = j / seg * TAU, s = Math.sin(a);
    pos.push(R.x, (R.y || 0) + (s >= 0 ? s * R.t : s * R.b), Math.cos(a) * R.w);
    const c = s < -0.25 ? R.cb : R.c; col.push(c[0], c[1], c[2]);
  }
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < seg; j++) { const a = i * seg + j, b = i * seg + (j + 1) % seg, c = a + seg, d = b + seg; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export class Ambient {
  constructor(scene, world, sky, ocean, particles) {
    this.scene = scene; this.world = world; this.sky = sky; this.ocean = ocean; this.fx = particles;
    this.root = world.root; // 内容坐标
    const P = world.props;
    this.rng = makeRng(777);
    // ---- 海上物件 ----
    this.boatDefs = [
      { geo: P.sailboat.toGeometry(), w: 3, draft: 0.2, speed: [1.5, 4] },
      { geo: P.sailboat2.toGeometry(), w: 2, draft: 0.2, speed: [1.5, 4] },
      { geo: P.fishboat.solid.toGeometry(), glow: P.fishboat.glow.toGeometry(), w: 2, draft: 0.25, speed: [0.5, 2.5] },
      { geo: P.buoy.solid.toGeometry(), glow: P.buoy.glow.toGeometry(), w: 2.5, draft: 0.0, speed: [0, 0], near: true },
      { geo: P.rowboats[0].toGeometry(), w: 1.2, draft: 0.05, speed: [0, 0.6], near: true },
    ];
    this.boats = [];
    // ---- 远岛（不受场景雾影响，手动融入地平线）----
    this.islands = [];
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x556677, fog: false });
      const m = new THREE.Mesh(P.islands[i % P.islands.length].toGeometry(), mat);
      { const k = 1.3 + (i % 3) * 0.5; m.scale.set(k, k * 0.55, k); } m.rotation.y = i * 1.3;
      m.userData = { x: -(1050 + (i * 337) % 800), z0: i * 560, col: new THREE.Color(0x4f7a58).lerp(new THREE.Color(0x7a7468), (i % 3) / 3) };
      scene.add(m); this.islands.push(m);
    }
    // ---- 热气球 ----
    this.balloons = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(P.balloons[i].toGeometry(), world.matProps);
      m.userData = { s: 150 + i * 330, u: (i % 2 ? 1 : -1) * (60 + i * 35), h: 45 + i * 16, ph: i * 2 };
      m.scale.setScalar(1.6); this.root.add(m); this.balloons.push(m);
    }
    // ---- 海鸥群（实例化 + 顶点动画）----
    this._buildFlock(16);
    // ---- 鲸鱼 ----
    {
      const top = [0.16, 0.24, 0.36], bot = [0.82, 0.86, 0.9];
      const g = loftX([
        { x: 6.4, w: 0.3, t: 0.3, b: 0.35, y: -0.1, c: top, cb: bot }, { x: 5.4, w: 1.25, t: 1.1, b: 1.25, c: top, cb: bot }, { x: 3.2, w: 1.75, t: 1.6, b: 1.7, c: top, cb: bot },
        { x: 0.5, w: 1.7, t: 1.65, b: 1.55, c: top, cb: bot }, { x: -2.6, w: 1.2, t: 1.2, b: 1.0, c: top, cb: bot }, { x: -5.2, w: 0.55, t: 0.6, b: 0.45, y: 0.1, c: top, cb: top }, { x: -6.9, w: 0.22, t: 0.3, b: 0.22, y: 0.2, c: top, cb: top },
      ], 14);
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05 });
      const body = new THREE.Mesh(g, mat);
      const ex = new Geo(256, true);
      for (const z of [-1, 1]) { ex.sphere(1, 8, 6, { p: [2.4, -1.1, 1.9 * z], s: [1.3, 0.14, 0.55], r: [0.5 * z, 0.5 * z, 0], c: 0x2a3d5c }); ex.sphere(1, 8, 6, { p: [-7.5, 0.25, 1.1 * z], s: [0.9, 0.12, 1.2], r: [0, 0.5 * z, 0], c: 0x2a3d5c }); ex.sphere(0.12, 6, 5, { p: [4.6, 0.2, 1.42 * z], c: 0x0a0a10 }); }
      const fins = new THREE.Mesh(ex.toGeometry(), mat);
      this.whale = new THREE.Group(); this.whale.add(body, fins); this.whale.visible = false; this.whale.scale.setScalar(1.25);
      scene.add(this.whale);
      this.whaleT = -1; this.whaleCd = 40;
    }
    // ---- 海豚 ----
    {
      const top = [0.34, 0.44, 0.56], bot = [0.85, 0.88, 0.92];
      const g = loftX([{ x: 1.25, w: 0.05, t: 0.05, b: 0.05, y: -0.05, c: top, cb: bot }, { x: 0.9, w: 0.16, t: 0.17, b: 0.16, c: top, cb: bot }, { x: 0.3, w: 0.27, t: 0.29, b: 0.27, c: top, cb: bot },
        { x: -0.5, w: 0.2, t: 0.22, b: 0.18, c: top, cb: bot }, { x: -1.1, w: 0.07, t: 0.09, b: 0.07, c: top, cb: top }], 8);
      const ex = new Geo(128, true);
      ex.cone(0.14, 0.3, 4, { p: [0.05, 0.36, 0], r: [0, 0, 0.5], s: [1.4, 1, 0.25], c: 0x55708a });
      for (const z of [-1, 1]) ex.sphere(1, 6, 5, { p: [-1.25, 0.0, 0.2 * z], s: [0.2, 0.03, 0.22], r: [0, 0.6 * z, 0], c: 0x55708a });
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3 });
      this.dolphins = [];
      for (let i = 0; i < 3; i++) { const d = new THREE.Group(); d.add(new THREE.Mesh(g, mat), new THREE.Mesh(ex.toGeometry(), mat)); d.visible = false; d.scale.setScalar(1.5); scene.add(d); this.dolphins.push({ obj: d, ph: i * 0.37, off: i * 2.6, splashed: 0 }); }
      this.dolphinT = -1; this.dolphinCd = 14;
    }
    this.fireQ = []; this.emitAcc = 0;
    this.events = [];
  }

  _buildFlock(N) {
    const pos = [], aw = [], col = [];
    const tri = (a, b, c, wa, wb, wc, ca, cb, cc) => { pos.push(...a, ...b, ...c); aw.push(wa, wb, wc); col.push(...ca, ...cb, ...cc); };
    const W = [1, 1, 1], G = [0.62, 0.66, 0.72], D = [0.12, 0.13, 0.15], Y = [1, 0.7, 0.15];
    // 身体（菱形）+ 双翼
    tri([0, 0.05, -0.32], [0.07, 0, 0], [-0.07, 0, 0], 0, 0, 0, Y, W, W); tri([0, 0.0, 0.34], [-0.07, 0, 0], [0.07, 0, 0], 0, 0, 0, G, W, W);
    for (const s of [-1, 1]) {
      tri([0.05 * s, 0.02, -0.1], [0.05 * s, 0.02, 0.12], [0.5 * s, 0.02, 0.02], 0, 0, 0.55, W, W, G);
      tri([0.5 * s, 0.02, 0.02], [0.05 * s, 0.02, -0.1], [0.55 * s, 0.02, -0.12], 0.55, 0, 0.6, G, W, G);
      tri([0.5 * s, 0.02, 0.02], [0.55 * s, 0.02, -0.12], [1.0 * s, 0.02, 0.06], 0.55, 0.6, 1, G, G, D);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aW', new THREE.Float32BufferAttribute(aw, 1)); g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
    const ph = new Float32Array(N); for (let i = 0; i < N; i++) ph[i] = Math.random() * 10;
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
    this.flockU = { uTime: { value: 0 }, uLight: { value: new THREE.Color(1, 1, 1) }, uFog: { value: new THREE.Color() }, uFogD: { value: 0.003 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.flockU, side: THREE.DoubleSide,
      vertexShader: `attribute float aW; attribute vec3 aCol; attribute float aPhase; uniform float uTime; varying vec3 vC; varying float vF; uniform float uFogD;
        void main(){ vec3 p = position; float f = sin(uTime * 7.0 + aPhase); float glide = smoothstep(-0.2, 0.6, sin(uTime * 0.9 + aPhase * 1.7));
          p.y += aW * (f * 0.55 * (1.0 - glide * 0.85) + 0.12 * aW); p.x *= 1.0 - aW * 0.12 * abs(f) * (1.0 - glide);
          vC = aCol; vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0); float d = -mv.z; vF = 1.0 - exp(-uFogD * uFogD * d * d); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uLight, uFog; varying vec3 vC; varying float vF; void main(){ gl_FragColor = vec4(mix(vC * uLight, uFog, vF), 1.0); }`,
    });
    this.flock = new THREE.InstancedMesh(g, mat, N); this.flock.frustumCulled = false;
    this.flockData = []; for (let i = 0; i < N; i++) this.flockData.push({ r: 8 + Math.random() * 26, w: (0.12 + Math.random() * 0.2) * (Math.random() < 0.5 ? 1 : -1), ph: Math.random() * TAU, h: Math.random() * 12, sc: 1 + Math.random() * 0.8 });
    this.scene.add(this.flock);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3();
  }

  reset(track) {
    this.track = track;
    for (const b of this.boats) this.root.remove(b.obj);
    this.boats.length = 0;
    this.whaleT = -1; this.whaleCd = 35 + Math.random() * 30; this.whale.visible = false;
    this.dolphinT = -1; this.dolphinCd = 12 + Math.random() * 15; for (const d of this.dolphins) d.obj.visible = false;
    this.fireQ.length = 0;
  }

  _spawnBoat(s) {
    const r = this.rng, defs = this.boatDefs;
    const def = r.weighted(defs.map(d => [d.w, d]));
    const obj = new THREE.Group();
    const m = new THREE.Mesh(def.geo, this.world.matProps); m.castShadow = false; obj.add(m);
    if (def.glow) obj.add(new THREE.Mesh(def.glow, this.world.matGlow));
    this.root.add(obj);
    const side = this.track.params(s, {}).bridge > 0.5 && r.chance(0.45) ? 1 : -1;
    const b = { obj, def, s, off: def.near ? r.range(16, 60) : r.range(40, 380), side, vs: r.range(def.speed[0], def.speed[1]) * r.sign(), ph: r() * 10, yaw: r.sign() > 0 ? 0 : PI };
    if (!def.speed[1]) b.yaw = r() * TAU;
    this.boats.push(b);
  }

  // 触发事件
  triggerWhale() { if (this.whaleT < 0) { this.whaleT = 0; this.whaleSplash = 0; } }
  fireworks(n = 6) { for (let i = 0; i < n; i++) this.fireQ.push({ t: i * 0.28 + Math.random() * 0.2 }); }

  update(dt, time, dist, cam, zoneKey, speed, playerX, playerY) {
    const tr = this.track, sky = this.sky, P = this._P || (this._P = {});
    // ---- 船 ----
    while (this.boats.length < 10) this._spawnBoat(this.boats.length < 6 && !this._seeded ? dist + 60 + this.rng() * 600 : dist + 520 + this.rng() * 200);
    this._seeded = true;
    for (let i = this.boats.length - 1; i >= 0; i--) {
      const b = this.boats[i];
      b.s += b.vs * dt;
      if (b.s < dist - 120 || b.s > dist + 900) { this.root.remove(b.obj); this.boats.splice(i, 1); continue; }
      tr.params(b.s, P);
      const shoreU = b.side < 0 ? -(EDGE + P.seaW) : lerp(400, EDGE + 14, P.bridge);
      const x = tr.cx(b.s) + shoreU + b.side * b.off, z = dist - b.s;
      const y = this.ocean.heightAt(x, z, time, dist) - b.def.draft;
      b.obj.position.set(x, y, -b.s);
      b.obj.rotation.set(Math.sin(time * 0.9 + b.ph) * 0.06, b.yaw + (b.vs < 0 ? PI : 0) * 0, Math.sin(time * 0.7 + b.ph * 2) * 0.08);
      b.obj.visible = !(b.side > 0 && P.bridge < 0.9);
    }
    // ---- 远岛 ----
    const fog = sky.pal.fog, hor = sky.pal.hor, li = clamp(sky.pal.hemI * 0.55 + sky.sun.intensity * 0.22, 0.05, 1.3);
    for (const m of this.islands) {
      const ud = m.userData;
      let z = ((ud.z0 - dist * 0.06) % 2800 + 2800) % 2800; z = 300 - z; // 300 .. -2500
      m.position.set(cam.position.x * 0 + ud.x, -4, z);
      const d = Math.hypot(ud.x, z), f = smoothstep(900, 2400, d) * 0.3 + 0.7;
      _c.copy(ud.col).multiplyScalar(li * 0.5).lerp(hor, f).lerp(fog, 0.15);
      m.material.color.copy(_c);
    }
    // ---- 热气球 ----
    for (const m of this.balloons) {
      const ud = m.userData;
      if (ud.s < dist - 200) { ud.s += 1300 + Math.random() * 200; ud.u = (Math.random() < 0.5 ? 1 : -1) * (50 + Math.random() * 130); }
      if (ud.s > dist + 1500) ud.s = dist + 300;
      m.position.set(tr.cx(ud.s) + ud.u + Math.sin(time * 0.05 + ud.ph) * 20, ud.h + Math.sin(time * 0.3 + ud.ph) * 4, -ud.s);
      m.rotation.y = time * 0.05 + ud.ph;
    }
    // ---- 海鸥群 ----
    {
      const cs = dist + 70, cx = tr.cx(cs) - 26, cy = tr.cy(cs) + 14;
      const fd = this.flockData;
      for (let i = 0; i < fd.length; i++) {
        const f = fd[i], a = time * f.w + f.ph;
        const x = cx + Math.cos(a) * f.r * 1.5, z = -70 + Math.sin(a) * f.r * 2.2 + (i % 4) * 14, y = cy + f.h + Math.sin(time * 0.5 + f.ph) * 2.5;
        const hx = -Math.sin(a) * 1.5 * Math.sign(f.w), hz = Math.cos(a) * 2.2 * Math.sign(f.w);
        this._e.set(0, Math.atan2(-hx, -hz), Math.cos(a) * 0.35 * -Math.sign(f.w), 'YXZ'); this._q.setFromEuler(this._e);
        this._m.compose(_v.set(x, y, z), this._q, this._s.setScalar(f.sc));
        this.flock.setMatrixAt(i, this._m);
      }
      this.flock.instanceMatrix.needsUpdate = true;
      const U = this.flockU; U.uTime.value = time; U.uFog.value.copy(fog); U.uFogD.value = this.scene.fog.density;
      U.uLight.value.copy(sky.pal.hemS).multiplyScalar(sky.pal.hemI * 0.5).add(_c.copy(sky.sun.color).multiplyScalar(sky.sun.intensity * 0.22));
    }
    // ---- 鲸鱼 ----
    tr.params(dist + 80, P);
    const seaX = tr.cx(dist + 80) - (EDGE + P.seaW);
    if (this.whaleT >= 0) {
      this.whaleT += dt; const t = this.whaleT, D = 4.6;
      const wx = seaX - 46, wz = -78 + t * speed * 0.55; // 相对玩家缓慢后移
      const k = t / D;
      if (k >= 1) { this.whaleT = -1; this.whale.visible = false; this.whaleCd = 70 + Math.random() * 60; }
      else {
        this.whale.visible = true;
        const y = Math.sin(k * PI) * 9.5 - 5.5, pitch = lerp(1.15, -1.0, k);
        this.whale.position.set(wx, y, wz); this.whale.rotation.set(0, PI / 2 + 0.5, pitch, 'YXZ');
        const lz = -dist + wz; // 内容坐标
        if (this.whaleSplash === 0 && k > 0.06) { this.whaleSplash = 1; for (let i = 0; i < 5; i++) this.fx.splash(wx + (Math.random() - 0.5) * 5, 0.3, lz + (Math.random() - 0.5) * 5, 22); this.events.push({ type: 'whale', x: wx, z: wz }); }
        if (this.whaleSplash === 1 && k > 0.74) { this.whaleSplash = 2; for (let i = 0; i < 9; i++) this.fx.burst('soft', wx + (Math.random() - 0.5) * 9, 0.3, lz + (Math.random() - 0.5) * 9, 26, { color: 0xe8f6ff, speed: 11, up: 1.6, life: 1.5, size: 0.7, size1: 0.2, a: 0.9, grav: 13, drag: 0.3 }); this.events.push({ type: 'whaleSplash', x: wx, z: wz }); }
        if (k > 0.2 && k < 0.5 && Math.random() < 0.5) this.fx.burst('soft', wx + 3, y + 3, lz, 2, { color: 0xffffff, speed: 5, up: 2, life: 1.0, size: 0.5, a: 0.6, grav: 9, drag: 0.5 });
      }
    } else if ((this.whaleCd -= dt) < 0 && (zoneKey === 'bridge' || zoneKey === 'cliff' || Math.random() < 0.004)) this.triggerWhale();
    // ---- 海豚 ----
    if (this.dolphinT >= 0) {
      this.dolphinT += dt;
      const T = 9;
      for (const d of this.dolphins) {
        const lt = this.dolphinT - d.ph * 2.2, cyc = 1.5, n = Math.floor(lt / cyc), k = (lt - n * cyc) / cyc;
        const jumping = lt > 0 && n < 5 && k < 0.62;
        d.obj.visible = jumping;
        if (jumping) {
          const kk = k / 0.62, x = seaX - 12 - d.off * 1.4, z = -16 - d.off * 2.2 - kk * 4.5 + (this.dolphinT * 1.2);
          const y = Math.sin(kk * PI) * 2.3 - 0.35;
          d.obj.position.set(x, y, z); d.obj.rotation.set(0, PI / 2, lerp(0.95, -0.95, kk), 'YXZ');
          const key = n * 2 + (kk > 0.9 ? 1 : 0);
          if (d.splashed !== key && (kk < 0.08 || kk > 0.9)) { d.splashed = key; this.fx.splash(x, 0.15, -dist + z - (kk > 0.5 ? 2.2 : -2.2), 9); }
        }
      }
      if (this.dolphinT > T) { this.dolphinT = -1; this.dolphinCd = 22 + Math.random() * 30; for (const d of this.dolphins) d.obj.visible = false; }
    } else if ((this.dolphinCd -= dt) < 0 && P.bridge < 0.5 && speed > 4) { this.dolphinT = 0; this.events.push({ type: 'dolphin' }); }
    // ---- 环境粒子：萤火虫 / 花瓣 / 海雾飞沫 ----
    this.emitAcc += dt;
    if (this.emitAcc > 0.05) {
      this.emitAcc = 0;
      const night = sky.night, px = playerX, zc = -dist;
      if (night > 0.5 && zoneKey !== 'bridge') for (let i = 0; i < 2; i++) {
        const s = dist + 4 + Math.random() * 60, x = tr.cx(s) + 5 + Math.random() * 22;
        this.fx.glow.emit({ x, y: tr.cy(s) + 0.4 + Math.random() * 2.6, z: -s, vx: (Math.random() - 0.5) * 0.8, vy: (Math.random() - 0.5) * 0.5, vz: (Math.random() - 0.5) * 0.8, life: 2.2 + Math.random() * 2, size: 0.16, r: 0.75 * 2, g: 1.0 * 2, b: 0.3 * 2, a: night, grav: -0.05, drag: 0.4 });
      }
      if (zoneKey === 'blossom') for (let i = 0; i < 3; i++) {
        const s = dist - 4 + Math.random() * 70, x = tr.cx(s) + (Math.random() - 0.35) * 26;
        this.fx.soft.emit({ x, y: tr.cy(s) + 3 + Math.random() * 6, z: -s, vx: -1.2 + Math.random() * 0.8, vy: -0.9, vz: 0.5, life: 4 + Math.random() * 2, size: 0.17, r: 1.0, g: 0.72, b: 0.82, a: 0.95, grav: 0.25, drag: 0.5, shape: 1, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 6, floor: tr.cy(s) + 0.03 });
      }
      if (zoneKey === 'bridge' && Math.random() < 0.5) {
        const s = dist + Math.random() * 50;
        this.fx.soft.emit({ x: tr.cx(s) - 7 - Math.random() * 6, y: tr.cy(s) - 2 + Math.random() * 3, z: -s, vx: 2.5, vy: 1.5, vz: 0, life: 1.6, size: 0.4, size1: 1.4, r: 0.9, g: 0.95, b: 1, a: 0.22, grav: 0, drag: 0.6 });
      }
    }
    // ---- 烟花 ----
    for (let i = this.fireQ.length - 1; i >= 0; i--) {
      const f = this.fireQ[i]; f.t -= dt;
      if (f.t <= 0) {
        this.fireQ.splice(i, 1);
        const s = dist + 45 + Math.random() * 40;
        this.fx.firework(tr.cx(s) + (Math.random() - 0.5) * 34, tr.cy(s) + 14 + Math.random() * 10, -s, _c.setHSL(Math.random(), 0.9, 0.6).getHex());
        this.events.push({ type: 'firework' });
      }
    }
  }
}
