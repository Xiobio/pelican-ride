// 世界：按区块流式生成 地形 / 路面 / 护栏 / 分区景物；玩家固定在 z=0，世界向后滚动
import * as THREE from 'three';
import { Geo, rgb } from './geo.js';
import { Track, ZONES, CHUNK, EDGE, ROAD_HALF, SEA } from './track.js';
import { buildProps, buildSignAtlas, makeBannerTexture } from './props.js';
import { makeRng, hashInt, clamp, lerp, smoothstep, vnoise, TAU } from './util.js';

const ROWS = 16, DS = CHUNK / ROWS;
const U_COLS = [-64, -53, -44, -37, -31, -26, -21.5, -17.5, -14, -11, -8.5, -6.6, -EDGE, EDGE, 6.6, 8.2, 10.5, 13.5, 17, 21.5, 27, 34, 42, 52, 64, 80, 100, 125, 160];
const NC = U_COLS.length;
export const LAMP_GAP = 30, LAMP_OFF = 15, LAMP_U = 4.75;

const lin = (a) => a.map(v => Math.pow(v, 2.2));
const ZC = {};
for (const k in ZONES) { const z = ZONES[k]; ZC[k] = { grass: lin(z.grass), grass2: lin(z.grass2), sand: lin(z.sandC), rock: lin(z.rockC) }; }
const RAIL = { coast: rgb(0xf4f1ea), village: rgb(0xf4f1ea), beach: rgb(0xe4d2ae), cliff: rgb(0x9aa3ad), blossom: rgb(0xc8402f), bridge: rgb(0xd8dce0) };
const SIDEWALK = rgb(0xb9b2a6), CURB = rgb(0xd6d0c4), CURB2 = rgb(0x8f8a82);
const BANNER_COL = { coast: '#1d6f8a', village: '#a34a3a', beach: '#c98a1e', cliff: '#4a5568', bridge: '#b5432f', blossom: '#c24e86' };

const _M = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _v = new THREE.Vector3();
const mix3 = (a, b, t, o) => { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; };

const ROAD_GLSL = /* glsl */`
float rhash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float rnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(rhash(i), rhash(i+vec2(1,0)), u.x), mix(rhash(i+vec2(0,1)), rhash(i+vec2(1,1)), u.x), u.y); }
`;
const ROAD_COLOR = /* glsl */`
  float ru = vRUv.x, rs = vRUv.y, rau = abs(ru);
  float n1 = rnoise(vec2(ru * 11.0, rs * 11.0));
  float n2 = rnoise(vec2(ru * 0.7 + 3.0, rs * 0.33));
  float n3 = rnoise(vec2(ru * 2.6, rs * 0.9 + 7.0));
  vec3 rcol = mix(vec3(0.050, 0.052, 0.062), vec3(0.090, 0.088, 0.092), n2) * (0.82 + 0.36 * n1);
  rcol = mix(rcol, vec3(0.20, 0.20, 0.205) * (0.9 + 0.2 * n1), vMix.y * 0.6);
  float aa = fwidth(ru) * 1.3 + 0.004;
  float edgeL = smoothstep(0.075 + aa, 0.075, abs(rau - 3.72));
  float dash = smoothstep(0.0, 0.08, fract(rs / 7.5)) * smoothstep(0.44, 0.40, fract(rs / 7.5));
  float laneL = smoothstep(0.065 + aa, 0.065, abs(rau - 1.3)) * dash;
  float worn = 0.7 + 0.3 * smoothstep(0.25, 0.6, n3);
  rcol = mix(rcol, vec3(0.80, 0.78, 0.70), edgeL * worn);
  rcol = mix(rcol, vec3(0.85, 0.66, 0.22), laneL * worn);
  // 路中央的前进箭头
  float arS = mod(rs + 22.0, 60.0) - 30.0;
  if (abs(arS) < 2.0 && rau < 0.7) {
    float ay = arS + 0.2;
    float head = step(0.0, ay) * step(ay, 1.0) * step(rau, (1.0 - ay) * 0.6);
    float stem = step(-1.4, ay) * step(ay, 0.0) * step(rau, 0.14);
    rcol = mix(rcol, vec3(0.78, 0.77, 0.72), max(head, stem) * worn * 0.9);
  }
  // 沙滩路段：两侧积沙
  float sandF = vMix.x * smoothstep(2.4, 4.0, rau + (n2 - 0.5) * 2.4 + (n1 - 0.5) * 0.5);
  rcol = mix(rcol, vec3(0.60, 0.50, 0.31), clamp(sandF, 0.0, 1.0) * 0.9);
  // 樱花路段：零星花瓣
  vec2 pcell = vec2(ru * 9.0, rs * 9.0); vec2 pf = fract(pcell) - 0.5;
  float pet = step(0.972, rhash(floor(pcell))) * vMix.z * smoothstep(0.42, 0.25, length(pf * vec2(1.0, 1.6)));
  rcol = mix(rcol, vec3(0.95, 0.66, 0.76), pet * 0.85);
  // 雨天：变暗、变光滑
  float puddle = smoothstep(0.52, 0.7, n2 + (n3 - 0.5) * 0.3) * uWet;
  rcol *= mix(1.0, 0.55, uWet);
  float roadRough = mix(0.93, mix(0.38, 0.06, puddle), uWet);
  // 夜间路灯光斑
  float lds = mod(rs, ${LAMP_GAP.toFixed(1)}) - ${LAMP_OFF.toFixed(1)};
  vec2 dl = vec2(ru - 3.0, lds * 0.9);
  float pool = exp(-dot(dl, dl) / 10.0);
  vec2 dl2 = vec2(ru + 3.0, lds * 0.9);
  pool += exp(-dot(dl2, dl2) / 10.0) * vMix.y;
  vec3 roadGlow = uLampCol * pool * uNight * (rcol * 3.4 + 0.006);
  diffuseColor.rgb = rcol;
`;

export class World {
  constructor(scene, sky, quality = 2) {
    this.scene = scene; this.sky = sky; this.quality = quality;
    this.root = new THREE.Group(); this.root.name = 'world';
    scene.add(this.root);
    this.props = buildProps();
    this.atlas = buildSignAtlas();
    this.chunks = new Map();
    this.ahead = 13; this.behind = 2;
    this.uniforms = { uNight: { value: 0 }, uWet: { value: 0 }, uLampCol: { value: new THREE.Color(1.0, 0.72, 0.38) }, uScale: { value: 600 }, uFogD: { value: 0.003 } };
    this.dynamic = [];
    this.banners = {};
    this._makeMaterials();
    this.lampLight = new THREE.PointLight(0xffc27a, 0, 22, 1.6);
    scene.add(this.lampLight);
  }

  _makeMaterials() {
    const U = this.uniforms;
    this.matTerrain = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.96, metalness: 0, side: THREE.DoubleSide });
    this.matProps = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
    this.matGlow = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.matRoad = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
    this.matRoad.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = U.uNight; sh.uniforms.uWet = U.uWet; sh.uniforms.uLampCol = U.uLampCol;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aMix; varying vec2 vRUv; varying vec3 vMix;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRUv = uv; vMix = aMix;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight; uniform float uWet; uniform vec3 uLampCol; varying vec2 vRUv; varying vec3 vMix;\n' + ROAD_GLSL)
        .replace('#include <color_fragment>', ROAD_COLOR)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roadRough;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += roadGlow;');
    };
    this.matSign = new THREE.MeshStandardMaterial({ map: this.atlas.texture, roughness: 0.6, side: THREE.DoubleSide, alphaTest: 0.5, emissive: 0xffffff, emissiveMap: this.atlas.texture, emissiveIntensity: 0.12 });
    this.matHalo = new THREE.ShaderMaterial({
      uniforms: { uNight: U.uNight, uScale: U.uScale, uFogD: U.uFogD },
      vertexShader: `attribute float aSize; attribute vec3 aColor; varying vec3 vC; varying float vF; uniform float uScale; uniform float uFogD;
        void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float d = -mv.z; vF = exp(-uFogD*uFogD*d*d*0.45) * smoothstep(3.0, 14.0, d); gl_PointSize = min(aSize * uScale / max(d, 0.5), 260.0); }`,
      fragmentShader: `uniform float uNight; varying vec3 vC; varying float vF;
        void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(1.0 - d, 0.0), 2.6); gl_FragColor = vec4(vC * a * uNight * vF * 0.85, 1.0); }`,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    });
    this.matBeam = new THREE.ShaderMaterial({
      uniforms: { uNight: U.uNight },
      vertexShader: `varying float vT; void main(){ vT = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uNight; varying float vT; void main(){ float a = pow(max(vT, 0.0), 2.2) * 0.13 * uNight; gl_FragColor = vec4(vec3(1.0, 0.92, 0.7) * a, 1.0); }`,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide,
    });
    this.geoBlades = this.props.turbineBlades.toGeometry();
    const beam = new THREE.CylinderGeometry(0.6, 9, 160, 14, 1, true); beam.translate(0, -80, 0); beam.rotateX(-Math.PI / 2); // 沿 +Z 展开，uv.y: 1 在塔端
    this.geoBeam = beam;
  }

  setTrack(track) { this.track = track; this.clear(); }

  clear() {
    for (const c of this.chunks.values()) this._dispose(c);
    this.chunks.clear(); this.dynamic.length = 0;
  }
  _dispose(c) {
    this.root.remove(c.group);
    c.group.traverse(o => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); });
    for (const d of c.dyn) { const i = this.dynamic.indexOf(d); if (i >= 0) this.dynamic.splice(i, 1); }
  }

  // 保证 dist 附近的区块存在。budget: 本帧最多新建几个
  update(dist, dt, time, budget = 1) {
    const i0 = Math.floor((dist - CHUNK * this.behind) / CHUNK), i1 = i0 + this.behind + this.ahead;
    for (let i = i0; i <= i1 && budget > 0; i++) if (!this.chunks.has(i)) { this.chunks.set(i, this._build(i)); budget--; }
    for (const [i, c] of this.chunks) if (i < i0 - 1 || i > i1 + 1) { this._dispose(c); this.chunks.delete(i); }
    this.root.position.z = dist;
    const U = this.uniforms;
    const night = this.sky.night;
    U.uNight.value = night; U.uFogD.value = this.scene.fog.density;
    this.matGlow.color.setScalar(0.22 + night * 2.6);
    // 动态物件
    for (const d of this.dynamic) {
      if (d.type === 'blades') d.mesh.rotation.z = time * d.speed + d.phase;
      else if (d.type === 'beam') { d.mesh.rotation.y = time * 0.55; d.mesh.visible = night > 0.05; }
    }
    // 离玩家最近的一盏路灯给主角打一点暖光
    const k = Math.round((dist + 3 - LAMP_OFF) / LAMP_GAP), ls = k * LAMP_GAP + LAMP_OFF;
    const tr = this.track, P = tr.params(ls, this._lp || (this._lp = {}));
    this.lampLight.position.set(tr.cx(ls) + (P.bridge > 0.5 ? 0 : LAMP_U - 1.5), tr.cy(ls) + 5.2, dist - ls);
    this.lampLight.intensity = night * 16 * (P.bridge > 0.5 ? 0.6 : 1);
  }
  ready(dist) { const i0 = Math.floor((dist - CHUNK * this.behind) / CHUNK); for (let i = i0; i <= i0 + this.behind + this.ahead; i++) if (!this.chunks.has(i)) return false; return true; }

  _build(ci) {
    const tr = this.track, s0 = ci * CHUNK;
    const rng = makeRng(hashInt(ci, tr.seed) || 1);
    const group = new THREE.Group(); group.position.z = -s0;
    const chunk = { group, dyn: [], index: ci };
    // ---- 每行预计算 ----
    const rows = [];
    for (let r = 0; r <= ROWS; r++) {
      const s = s0 + r * DS, P = tr.params(s, {});
      rows.push({ s, z: -(r * DS), cx: tr.cx(s), cy: tr.cy(s), P, key: P.t < 0.5 ? P.a.key : P.b.key });
    }
    // ---- 地形 ----
    {
      const nv = (ROWS + 1) * NC, pos = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
      const H = new Float32Array(nv);
      for (let r = 0; r <= ROWS; r++) { const R = rows[r]; for (let c = 0; c < NC; c++) H[r * NC + c] = tr.terrainH(U_COLS[c], R.s, R.P, R.cy); }
      const g = [0, 0, 0], g2 = [0, 0, 0], sd = [0, 0, 0], rk = [0, 0, 0], out = [0, 0, 0];
      for (let r = 0; r <= ROWS; r++) {
        const R = rows[r], P = R.P, A = ZC[P.a.key], B = ZC[P.b.key], t = P.t;
        mix3(A.grass, B.grass, t, g); mix3(A.grass2, B.grass2, t, g2); mix3(A.sand, B.sand, t, sd); mix3(A.rock, B.rock, t, rk);
        for (let c = 0; c < NC; c++) {
          const u = U_COLS[c], i = r * NC + c, h = H[i], o = i * 3;
          pos[o] = R.cx + u; pos[o + 1] = h; pos[o + 2] = R.z;
          const cl = Math.max(c - 1, 0), cr = Math.min(c + 1, NC - 1);
          const slope = Math.abs(H[r * NC + cr] - H[r * NC + cl]) / (U_COLS[cr] - U_COLS[cl]);
          const d = Math.abs(u) - EDGE;
          const n = vnoise(u * 0.13 + 7, R.s * 0.13), n2 = vnoise(u * 0.031 + 3, R.s * 0.031);
          mix3(g, g2, clamp(n2 * 0.85 + n * 0.25), out);
          let sandF;
          if (u * SEA > 0) { const lvl = 1.5 + n * 1.3 + P.sand * 7; sandF = 1 - smoothstep(lvl - 0.5, lvl + 0.8, h); }
          else sandF = P.sand * (1 - smoothstep(10, 44, d)) * (0.65 + 0.35 * n);
          mix3(out, sd, clamp(sandF), out);
          const rockF = clamp(smoothstep(0.7, 1.25, slope) * (0.45 + P.rock) + P.rock * smoothstep(0.58, 0.8, n) * 0.55);
          mix3(out, rk, rockF * (1 - sandF * 0.6), out);
          let k = 0.9 + 0.2 * vnoise(u * 0.9 + 1.3, R.s * 0.9);
          if (h < 0.35) k *= lerp(0.62, 1, clamp(h / 0.35)); // 湿沙
          if (h < 0) { k *= 0.8; out[2] *= 1.15; }
          col[o] = out[0] * k; col[o + 1] = out[1] * k; col[o + 2] = out[2] * k;
        }
      }
      const idx = new Uint16Array(ROWS * (NC - 1) * 6); let o = 0;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < NC - 1; c++) {
        const a = r * NC + c, b = a + 1, cc = a + NC, dd = cc + 1;
        idx[o++] = a; idx[o++] = b; idx[o++] = cc; idx[o++] = b; idx[o++] = dd; idx[o++] = cc;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, this.matTerrain); m.receiveShadow = true; group.add(m);
    }
    // ---- 路面 ----
    {
      const nv = (ROWS + 1) * 2, pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), mx = new Float32Array(nv * 3);
      for (let r = 0; r <= ROWS; r++) {
        const R = rows[r], dcy = tr.dcy(R.s), nl = Math.hypot(1, dcy);
        const bl = (R.P.a.key === 'blossom' ? 1 - R.P.t : 0) + (R.P.b.key === 'blossom' ? R.P.t : 0);
        for (let k = 0; k < 2; k++) {
          const i = r * 2 + k, u = k ? ROAD_HALF : -ROAD_HALF;
          pos[i * 3] = R.cx + u; pos[i * 3 + 1] = R.cy; pos[i * 3 + 2] = R.z;
          nor[i * 3] = 0; nor[i * 3 + 1] = 1 / nl; nor[i * 3 + 2] = dcy / nl;
          uv[i * 2] = u; uv[i * 2 + 1] = R.s;
          mx[i * 3] = R.P.sand; mx[i * 3 + 1] = R.P.bridge; mx[i * 3 + 2] = bl;
        }
      }
      const idx = new Uint16Array(ROWS * 6); let o = 0;
      for (let r = 0; r < ROWS; r++) { const a = r * 2, b = a + 1, c = a + 2, d = a + 3; idx[o++] = a; idx[o++] = b; idx[o++] = c; idx[o++] = b; idx[o++] = d; idx[o++] = c; }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setAttribute('aMix', new THREE.BufferAttribute(mx, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, this.matRoad); m.receiveShadow = true; group.add(m);
    }
    // ---- 景物 ----
    const solid = this._solid || (this._solid = new Geo(16384)), glow = this._glow || (this._glow = new Geo(2048));
    solid.clear(); glow.clear();
    const halo = [], signPos = [], signUv = [];
    const Pt = {};
    const yaw = (s) => -Math.atan(tr.dcx(s));
    // 放置一个原型。o: {ry, rx, rz, sc, dy, y, tint, onRoad}
    const put = (proto, u, s, o = {}) => {
      const cx = tr.cx(s), cy = tr.cy(s);
      let y = o.y;
      if (y === undefined) { tr.params(s, Pt); y = (o.onRoad ? cy : tr.terrainH(u, s, Pt, cy)) + (o.dy || 0); }
      _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ'); _q.setFromEuler(_e);
      const sc = o.sc === undefined ? 1 : o.sc;
      if (typeof sc === 'number') _s.set(sc, sc, sc); else _s.set(sc[0], sc[1], sc[2]);
      _M.compose(_p.set(cx + u, y, -(s - s0)), _q, _s);
      solid.addGeo(proto.solid || proto, _M, o.tint);
      if (proto.glow) glow.addGeo(proto.glow, _M, null);
      if (proto.halo) for (const h of proto.halo) { _v.set(h[0], h[1], h[2]).applyMatrix4(_M); halo.push(_v.x, _v.y, _v.z, h[3] * (typeof sc === 'number' ? sc : 1), h[4], h[5], h[6]); }
      return y;
    };
    const quadS = (a, b, c, d, col) => solid.quad(a, b, c, d, col);
    const tint = () => { const k = 0.85 + rng() * 0.3; return [k * (0.95 + rng() * 0.1), k, k * (0.95 + rng() * 0.1)]; };
    const P = this.props;

    // 人行道、路缘、护栏、桥体（逐行段）
    for (let r = 0; r < ROWS; r++) {
      const A = rows[r], B = rows[r + 1];
      const br = (A.P.bridge + B.P.bridge) * 0.5;
      const ya = A.cy, yb = B.cy, za = A.z, zb = B.z;
      const X = (R, u) => R.cx + u;
      const sw = 0.14;
      // 陆侧人行道（顶面 + 路缘立面）
      quadS([X(A, ROAD_HALF), ya + sw, za], [X(A, EDGE + 0.1), ya + sw, za], [X(B, EDGE + 0.1), yb + sw, zb], [X(B, ROAD_HALF), yb + sw, zb], r % 2 ? SIDEWALK : SIDEWALK.map(v => v * 0.93));
      quadS([X(A, ROAD_HALF), ya, za], [X(A, ROAD_HALF), ya + sw, za], [X(B, ROAD_HALF), yb + sw, zb], [X(B, ROAD_HALF), yb, zb], CURB);
      // 海侧路缘
      quadS([X(A, -ROAD_HALF - 0.85), ya + sw, za], [X(A, -ROAD_HALF), ya + sw, za], [X(B, -ROAD_HALF), yb + sw, zb], [X(B, -ROAD_HALF - 0.85), yb + sw, zb], CURB);
      quadS([X(A, -ROAD_HALF), ya + sw, za], [X(A, -ROAD_HALF), ya, za], [X(B, -ROAD_HALF), yb, zb], [X(B, -ROAD_HALF), yb + sw, zb], CURB2);
      if (br < 0.5) {
        // 护栏：立柱 + 两道横杆
        const rc = RAIL[A.key] || RAIL.coast, ur = -4.62;
        solid.box(0.11, 1.05, 0.11, { p: [X(A, ur), ya + sw + 0.52, za], c: rc });
        solid.tube([X(A, ur), ya + sw + 1.02, za], [X(B, ur), yb + sw + 1.02, zb], 0.05, 5, { c: rc });
        solid.tube([X(A, ur), ya + sw + 0.56, za], [X(B, ur), yb + sw + 0.56, zb], 0.035, 4, { c: rc });
      }
      if (br > 0.04) {
        // 桥面箱梁 + 两侧防撞墙
        const cc = rgb(0xc9c3b8), cd = rgb(0x9a958c), th = 1.5 * br + 0.1, e = EDGE + 0.25;
        for (const sgn of [-1, 1]) {
          quadS([X(A, sgn * e), ya + sw, za], [X(A, sgn * e), ya - th, za], [X(B, sgn * e), yb - th, zb], [X(B, sgn * e), yb + sw, zb], cc);
          if (br > 0.5) {
            const w0 = sgn * (EDGE - 0.35), w1 = sgn * (EDGE + 0.1), hh = 0.95;
            quadS([X(A, w0), ya + sw, za], [X(A, w0), ya + sw + hh, za], [X(B, w0), yb + sw + hh, zb], [X(B, w0), yb + sw, zb], cc);
            quadS([X(A, w0), ya + sw + hh, za], [X(A, w1), ya + sw + hh, za], [X(B, w1), yb + sw + hh, zb], [X(B, w0), yb + sw + hh, zb], CURB);
            quadS([X(A, w1), ya + sw + hh, za], [X(A, w1), ya + sw, za], [X(B, w1), yb + sw, zb], [X(B, w1), yb + sw + hh, zb], cd);
            solid.tube([X(A, w0 + sgn * 0.2), ya + sw + hh + 0.28, za], [X(B, w0 + sgn * 0.2), yb + sw + hh + 0.28, zb], 0.05, 5, { c: RAIL.bridge });
            if (r % 2 === 0) solid.box(0.09, 0.3, 0.09, { p: [X(A, w0 + sgn * 0.2), ya + sw + hh + 0.14, za], c: RAIL.bridge });
          }
        }
        quadS([X(A, -e), ya - th, za], [X(A, e), ya - th, za], [X(B, e), yb - th, zb], [X(B, -e), yb - th, zb], cd);
      }
    }
    // 悬索（桥区）
    {
      const zi = tr.zoneIndexAt(s0 + CHUNK * 0.5);
      for (const z of [tr.zones[zi - 1], tr.zones[zi], tr.zones[zi + 1]]) {
        if (!z || z.key !== 'bridge') continue;
        const L = z.end - z.start, span = L * 0.23, top = P.bridgeTower.top;
        for (const ts of [z.start + L * 0.27, z.start + L * 0.73]) {
          if (ts >= s0 && ts < s0 + CHUNK) put(P.bridgeTower, 0, ts, { onRoad: true, ry: yaw(ts) });
          for (let r = 0; r < ROWS; r++) {
            const A = rows[r], B = rows[r + 1];
            const xa = Math.abs(A.s - ts), xb = Math.abs(B.s - ts);
            if (Math.min(xa, xb) > span) continue;
            const hc = (x) => 1.3 + (top - 1.3) * Math.pow(clamp(1 - x / span), 2);
            for (const sgn of [-1, 1]) {
              solid.tube([A.cx + sgn * 6.6, A.cy + hc(xa), A.z], [B.cx + sgn * 6.6, B.cy + hc(xb), B.z], 0.14, 5, { c: 0xd95a48 });
              if (r % 3 === 0 && xa < span && hc(xa) > 2) solid.tube([A.cx + sgn * 6.6, A.cy + hc(xa), A.z], [A.cx + sgn * 5.6, A.cy + 0.3, A.z], 0.035, 3, { c: 0xe8e2d8 });
            }
          }
        }
      }
    }

    // 路灯 / 桥灯 / 桥墩（全局对齐，与路面光斑一致）
    for (let k = Math.ceil((s0 - LAMP_OFF) / LAMP_GAP); k * LAMP_GAP + LAMP_OFF < s0 + CHUNK; k++) {
      const s = k * LAMP_GAP + LAMP_OFF; if (s < s0) continue;
      tr.params(s, Pt);
      if (Pt.bridge > 0.5) { put(P.bridgeLamp, EDGE - 0.15, s, { onRoad: true, dy: 1.1 }); put(P.bridgeLamp, -EDGE + 0.15, s, { onRoad: true, dy: 1.1 }); }
      else put(P.lamp, LAMP_U, s, { onRoad: true, dy: 0.14, ry: yaw(s) });
    }
    for (let k = Math.ceil(s0 / 40); k * 40 < s0 + CHUNK; k++) { const s = k * 40; tr.params(s, Pt); if (Pt.bridge > 0.6) put(P.bridgePier, 0, s, { onRoad: true, ry: yaw(s) }); }

    // 分区景物
    const SLOT = 8;
    for (let k = 0; k < CHUNK / SLOT; k++) {
      const sa = s0 + k * SLOT;
      const zi = tr.zoneIndexAt(sa + SLOT / 2), zone = tr.zones[zi], key = zone.key;
      tr.params(sa + SLOT / 2, Pt);
      if (Pt.bridge > 0.3) continue;
      const seaW = Pt.seaW;
      const S = () => sa + rng() * SLOT;
      const land = (a, b) => EDGE + a + rng() * (b - a);
      const sea = (a, b) => -(EDGE + a + rng() * (b - a));
      const ry = () => rng() * TAU;
      const face = (s) => -Math.PI / 2 + yaw(s); // 正面朝向路
      const common = () => {
        if (rng.chance(0.5)) put(P.grass, land(1.2, 14), S(), { ry: ry(), sc: 0.8 + rng() * 0.8 });
        if (rng.chance(0.07) && sa > 120) this._sign(signPos, signUv, solid, rng.pick(this.atlas.names), EDGE - 0.1, S(), s0);
      };
      if (key === 'coast') {
        if (rng.chance(0.5)) put(rng.pick(P.palms), sea(1.0, 3.2), S(), { ry: ry(), sc: 0.85 + rng() * 0.35, dy: -0.2 });
        for (let i = 0, n = 1 + rng.int(0, 1); i < n; i++) put(rng.chance(0.8) ? rng.pick(P.trees) : rng.pick(P.pines), land(4, 46), S(), { ry: ry(), sc: 0.9 + rng() * 0.9, tint: tint() });
        for (let i = 0; i < 2; i++) if (rng.chance(0.6)) put(rng.pick(P.bushes), land(1.6, 30), S(), { ry: ry(), sc: 0.7 + rng() * 0.8, tint: tint() });
        if (rng.chance(0.4)) put(rng.pick(P.rocks), rng.chance(0.6) ? sea(1.5, seaW + 3) : land(3, 40), S(), { ry: ry(), sc: 0.5 + rng() * 1.5, dy: -0.25, tint: tint() });
        if (rng.chance(0.55)) put(rng.pick(P.flowers), land(1.2, 10), S(), { ry: ry(), sc: 1 + rng() * 0.6 });
        if (rng.chance(0.14)) { const s = S(), u = sea(seaW * 0.55, seaW * 0.85); put(rng.pick(P.umbrellas), u, s, { ry: ry() }); put(rng.pick(P.towels), u - 0.9, s + 0.6, { ry: ry(), dy: 0.02 }); }
        if (rng.chance(0.035)) this._turbine(chunk, land(60, 110), S(), s0, rng);
        if (rng.chance(0.07)) { const s = S(); put(P.bench, EDGE - 0.35, s, { onRoad: true, dy: 0.14, ry: face(s) }); }
        common();
      } else if (key === 'village') {
        if (k % 2 === 0) { const h = rng.pick(P.houses), s = sa + 4 + rng() * 3; put(h, EDGE + 5.5 + h.d / 2 + rng() * 2.5, s, { ry: face(s), dy: -0.15, tint: tint() }); }
        if (rng.chance(0.55)) { const h = rng.pick(P.houses), s = S(); put(h, land(26, 44), s, { ry: face(s) + (rng() - 0.5) * 0.8, dy: -0.4, sc: 1.05 + rng() * 0.2, tint: tint() }); }
        if (rng.chance(0.22)) { const s = S(); put(rng.pick(P.stalls), EDGE + 2.0, s, { ry: face(s), dy: -0.02 }); }
        if (rng.chance(0.25)) { const s = S(); put(rng.pick([P.barrelDecor, P.trashcan, P.mailbox, P.bench]), EDGE - 0.4, s, { onRoad: true, dy: 0.14, ry: face(s) }); }
        if (rng.chance(0.32)) put(rng.pick(P.rowboats), sea(seaW * 0.55, seaW * 0.9), S(), { ry: ry(), rz: (rng() - 0.5) * 0.35, dy: -0.12 });
        if (rng.chance(0.16)) { const s = S(); put(P.fishRack, sea(seaW * 0.25, seaW * 0.5), s, { ry: yaw(s) + Math.PI / 2 * rng.sign() * rng() }); }
        if (rng.chance(0.3)) put(rng.pick(P.trees), land(14, 50), S(), { ry: ry(), sc: 0.9 + rng() * 0.6, tint: tint() });
        if (rng.chance(0.4)) put(rng.pick(P.flowers), land(1.0, 5), S(), { ry: ry() });
        if (Math.floor(sa / 120) !== Math.floor((sa + SLOT) / 120)) { const s = sa + 4; put(P.pier, -(EDGE + seaW - 5), s, { y: 0.95, ry: Math.PI / 2 + yaw(s) }); }
        if (Math.floor(sa / 40) !== Math.floor((sa + SLOT) / 40) && sa > zone.start + 20 && sa < zone.end - 20) this._garland(solid, glow, halo, Math.ceil(sa / 40) * 40, s0, rng);
        common();
      } else if (key === 'beach') {
        for (let i = 0, n = 1 + rng.int(0, 1); i < n; i++) put(rng.pick(P.palms), sea(1.0, seaW * 0.5), S(), { ry: ry(), sc: 0.85 + rng() * 0.4, dy: -0.2 });
        if (rng.chance(0.75)) put(rng.pick(P.palms), land(1.6, 24), S(), { ry: ry(), sc: 0.85 + rng() * 0.45, dy: -0.2 });
        if (rng.chance(0.65)) { const s = S(), u = sea(seaW * 0.45, seaW * 0.82); put(rng.pick(P.umbrellas), u, s, { ry: ry() }); if (rng.chance(0.7)) put(P.chair, u - 1.1, s + 0.3, { ry: Math.PI / 2 + (rng() - 0.5), dy: 0.02 }); if (rng.chance(0.6)) put(rng.pick(P.towels), u + 1.2, s - 0.5, { ry: ry(), dy: 0.02 }); }
        if (rng.chance(0.18)) put(rng.pick(P.surfboards), sea(seaW * 0.3, seaW * 0.8), S(), { ry: ry(), dy: -0.1 });
        if (rng.chance(0.14)) put(P.castle, sea(seaW * 0.6, seaW * 0.88), S(), { ry: ry(), sc: 0.8 + rng() * 0.5 });
        if (rng.chance(0.2)) { const s = S(); put(rng.pick(P.huts), land(5, 11), s, { ry: face(s) }); }
        if (rng.chance(0.4)) put(rng.pick(P.bushes), land(2, 30), S(), { ry: ry(), sc: 0.7 + rng() * 0.6, tint: tint() });
        if (rng.chance(0.14)) put(rng.pick(P.rowboats), sea(seaW * 0.7, seaW * 0.95), S(), { ry: ry(), rz: (rng() - 0.5) * 0.3, dy: -0.12 });
        common();
      } else if (key === 'cliff') {
        for (let i = 0; i < 2; i++) put(rng.pick(P.pines), land(3, 46), S(), { ry: ry(), sc: 0.8 + rng() * 0.8, tint: tint(), dy: -0.3 });
        for (let i = 0; i < 2; i++) if (rng.chance(0.75)) put(rng.pick(P.rocks), rng.chance(0.5) ? sea(0.8, seaW + 6) : land(2, 30), S(), { ry: ry(), sc: 0.8 + rng() * 2.4, dy: -0.4, tint: tint() });
        if (rng.chance(0.35)) put(rng.pick(P.bushes), land(1.5, 20), S(), { ry: ry(), sc: 0.6 + rng() * 0.6, tint: tint() });
        const mid = (zone.start + zone.end) / 2;
        if (mid >= sa && mid < sa + SLOT) this._lighthouse(chunk, put, mid, s0, Pt, halo);
        common();
      } else if (key === 'blossom') {
        for (let i = 0, n = 1 + rng.int(0, 1); i < n; i++) put(rng.pick(P.sakura), land(1.6, 40), S(), { ry: ry(), sc: 0.9 + rng() * 0.7, tint: tint() });
        if (rng.chance(0.55)) put(rng.pick(P.sakura), sea(1.2, seaW * 0.55), S(), { ry: ry(), sc: 0.8 + rng() * 0.4, dy: -0.2 });
        if (rng.chance(0.7)) put(P.flowers[rng.pick([0, 2, 3])], land(1.0, 12), S(), { ry: ry(), sc: 1 + rng() * 0.6 });
        if (rng.chance(0.35)) put(rng.pick(P.bushes), land(2, 30), S(), { ry: ry(), tint: tint() });
        if (rng.chance(0.2)) put(rng.pick(P.rocks), land(3, 30), S(), { ry: ry(), sc: 0.5 + rng(), dy: -0.2 });
        { const s = sa + 4; if (Math.abs((s % LAMP_GAP) - LAMP_OFF) > 5) put(P.stoneLantern, EDGE - 0.3, s, { onRoad: true, dy: 0.14, sc: 1.1 }); }
        if (Math.floor(sa / 160) !== Math.floor((sa + SLOT) / 160) && sa > zone.start + 30 && sa < zone.end - 30) { const s = sa + 4; put(P.torii, 0, s, { onRoad: true, ry: yaw(s) }); }
        common();
      }
    }
    // 分区入口牌坊
    {
      const zi = tr.zoneIndexAt(s0 + 1);
      for (const z of [tr.zones[zi], tr.zones[zi + 1]]) if (z && z.start >= s0 && z.start < s0 + CHUNK && z.start > 0) this._banner(group, solid, z, s0);
    }

    const addMesh = (geoB, mat, cast, recv) => { if (!geoB.nv) return; const m = new THREE.Mesh(geoB.toGeometry(), mat); m.castShadow = cast; m.receiveShadow = recv; group.add(m); return m; };
    addMesh(solid, this.matProps, true, true);
    addMesh(glow, this.matGlow, false, false);
    if (halo.length) {
      const n = halo.length / 7, hp = new Float32Array(n * 3), hs = new Float32Array(n), hc = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { hp.set(halo.slice(i * 7, i * 7 + 3), i * 3); hs[i] = halo[i * 7 + 3]; hc.set(halo.slice(i * 7 + 4, i * 7 + 7), i * 3); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(hp, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(hs, 1)); g.setAttribute('aColor', new THREE.BufferAttribute(hc, 3));
      g.computeBoundingSphere();
      const pts = new THREE.Points(g, this.matHalo); pts.renderOrder = 5; group.add(pts);
    }
    if (signPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(signPos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(signUv, 2));
      const idx = []; for (let i = 0; i < signPos.length / 12; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
      g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, this.matSign); m.castShadow = true; group.add(m);
    }
    this.root.add(group);
    return chunk;
  }

  _sign(pos, uv, solid, name, u, s, s0) {
    const tr = this.track, x = tr.cx(s) + u, y = tr.cy(s) + 0.14, z = -(s - s0);
    solid.tube([x, y, z], [x, y + 2.3, z], 0.04, 5, { c: 0x6a7078 });
    const h = 0.62, cy = y + 2.75, c = this.atlas.cells[name];
    pos.push(x - h, cy - h, z + 0.05, x + h, cy - h, z + 0.05, x + h, cy + h, z + 0.05, x - h, cy + h, z + 0.05);
    uv.push(c[0], c[1], c[2], c[1], c[2], c[3], c[0], c[3]);
  }

  _banner(group, solid, zone, s0) {
    const tr = this.track, s = zone.start + 2, cx = tr.cx(s), cy = tr.cy(s), z = -(s - s0);
    const Z = ZONES[zone.key];
    let bm = this.banners[zone.key];
    if (!bm) { const tex = makeBannerTexture(Z.name, Z.en.toUpperCase(), BANNER_COL[zone.key]); bm = this.banners[zone.key] = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.3, side: THREE.DoubleSide }); }
    for (const sgn of [-1, 1]) solid.tube([cx + sgn * 5.6, cy - 0.5, z], [cx + sgn * 5.6, cy + 7.6, z], 0.16, 7, { c: 0x4a5058 });
    solid.box(11.6, 0.18, 0.18, { p: [cx, cy + 7.55, z], c: 0x4a5058 });
    solid.box(11.6, 0.14, 0.14, { p: [cx, cy + 4.95, z], c: 0x4a5058 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(9.6, 2.4), bm);
    m.position.set(cx, cy + 6.25, z + 0.12); m.userData.banner = true;
    group.add(m);
  }

  _garland(solid, glow, halo, s, s0, rng) {
    // 横跨街道的串灯 + 彩旗
    const tr = this.track, cx = tr.cx(s), cy = tr.cy(s), z = -(s - s0);
    const cols = [0xff5a5a, 0xffd24a, 0x5ad1ff, 0x7be07b, 0xff8ad0, 0xffffff];
    for (const sgn of [-1, 1]) solid.tube([cx + sgn * 5.5, cy, z], [cx + sgn * 5.5, cy + 5.6, z], 0.07, 6, { c: 0x4d4034 });
    const N = 13; let prev = null;
    for (let i = 0; i <= N; i++) {
      const t = i / N, x = cx - 5.5 + 11 * t, y = cy + 5.5 - Math.sin(t * Math.PI) * 1.2;
      const pt = [x, y, z];
      if (prev) solid.tube(prev, pt, 0.015, 3, { c: 0x2a2a2a });
      prev = pt;
      if (i > 0 && i < N) {
        const c = cols[i % cols.length];
        if (i % 2) { glow.sphere(0.09, 5, 4, { p: [x, y - 0.12, z], c }); const cc = new THREE.Color(c); halo.push(x, y - 0.12, z, 1.3, cc.r, cc.g, cc.b); }
        else solid.add(this.props.TRI, { p: [x, y - 0.02, z], s: [0.42, 0.55, 1], r: [0, 0, (rng() - 0.5) * 0.3], c });
      }
    }
  }

  _turbine(chunk, u, s, s0, rng) {
    const tr = this.track, P = tr.params(s, {}), cx = tr.cx(s), cy = tr.cy(s);
    const y = tr.terrainH(u, s, P, cy) - 0.5, z = -(s - s0);
    if (!this.geoTurbine) this.geoTurbine = this.props.turbine.toGeometry();
    const tower = new THREE.Mesh(this.geoTurbine, this.matProps); tower.userData.shared = true;
    tower.position.set(cx + u, y, z); tower.rotation.y = Math.PI * 0.15; tower.scale.setScalar(1.5); tower.castShadow = true;
    const blades = new THREE.Mesh(this.geoBlades, this.matProps); blades.userData.shared = true;
    blades.position.set(0, 16.2, 1.25); tower.add(blades);
    chunk.group.add(tower);
    const d = { type: 'blades', mesh: blades, speed: 0.7 + rng() * 0.5, phase: rng() * 6 };
    chunk.dyn.push(d); this.dynamic.push(d);
  }

  _lighthouse(chunk, put, s, s0, Pt, halo) {
    const tr = this.track, P = this.props.lighthouse;
    tr.params(s, Pt);
    const u = -(EDGE + Pt.seaW * 0.62), cx = tr.cx(s), cy = tr.cy(s);
    const y = Math.max(tr.terrainH(u, s, Pt, cy), 1.5) - 0.6;
    put(this.props.rocks[0], u, s, { y: y - 4.5, sc: [9, 7, 9] });
    put(P, u, s, { y, ry: Math.PI / 2 });
    const beam = new THREE.Mesh(this.geoBeam, this.matBeam); beam.userData.shared = true;
    const pivot = new THREE.Group(); pivot.position.set(cx + u, y + P.beamY, -(s - s0));
    const b2 = beam.clone(); b2.rotation.y = Math.PI; b2.userData.shared = true;
    pivot.add(beam, b2); chunk.group.add(pivot);
    const d = { type: 'beam', mesh: pivot };
    chunk.dyn.push(d); this.dynamic.push(d);
  }
}
