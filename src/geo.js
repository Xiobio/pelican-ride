// 轻量几何合并器：把许多带颜色的基础体合并为一个 BufferGeometry（省 draw call）
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _n = new THREE.Matrix3();

const primCache = new Map();
function prim(key, make) {
  let g = primCache.get(key);
  if (!g) { g = make(); primCache.set(key, g); }
  return g;
}

const hash3 = (x, y, z) => {
  let h = (Math.imul(Math.round(x * 97) | 0, 374761393) + Math.imul(Math.round(y * 97) | 0, 668265263) + Math.imul(Math.round(z * 97) | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export function mat(opts = {}, out = new THREE.Matrix4()) {
  const p = opts.p || [0, 0, 0];
  const r = opts.r || [0, 0, 0];
  const s = opts.s === undefined ? 1 : opts.s;
  _p.set(p[0], p[1], p[2]);
  _e.set(r[0], r[1], r[2], opts.order || 'XYZ');
  _q.setFromEuler(_e);
  if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
  return out.compose(_p, _q, _s);
}

export class Geo {
  constructor(cap = 1024, withNormals = false) {
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.nor = withNormals ? new Float32Array(cap * 3) : null;
    this.idx = new Uint32Array(cap * 3);
    this.nv = 0; this.ni = 0;
    this.base = null; // 父变换（用于 group 嵌套）
  }
  _growV(n) {
    const need = (this.nv + n) * 3;
    if (need <= this.pos.length) return;
    let cap = this.pos.length; while (cap < need) cap *= 2;
    const np = new Float32Array(cap); np.set(this.pos.subarray(0, this.nv * 3)); this.pos = np;
    const nc = new Float32Array(cap); nc.set(this.col.subarray(0, this.nv * 3)); this.col = nc;
    if (this.nor) { const nn = new Float32Array(cap); nn.set(this.nor.subarray(0, this.nv * 3)); this.nor = nn; }
  }
  _growI(n) {
    const need = this.ni + n;
    if (need <= this.idx.length) return;
    let cap = this.idx.length; while (cap < need) cap *= 2;
    const ni = new Uint32Array(cap); ni.set(this.idx.subarray(0, this.ni)); this.idx = ni;
  }
  clear() { this.nv = 0; this.ni = 0; return this; }

  // 添加 three 几何体。opts: {p, r, s, m(Matrix4), c(顶部色), c2(底部色), jit(顶点扰动), cj(颜色抖动)}
  add(geom, opts = {}) {
    const m = opts.m ? _m.copy(opts.m) : mat(opts, _m);
    if (this.base) m.premultiply(this.base);
    const pa = geom.attributes.position, na = geom.attributes.normal, ca = geom.attributes.color;
    const n = pa.count;
    this._growV(n);
    const hasC = opts.c !== undefined;
    if (hasC) setC(_c, opts.c);
    const grad = opts.c2 !== undefined;
    if (grad) setC(_c2, opts.c2);
    let y0 = 0, y1 = 1;
    if (grad) { if (!geom.boundingBox) geom.computeBoundingBox(); y0 = geom.boundingBox.min.y; y1 = geom.boundingBox.max.y; if (y1 - y0 < 1e-6) y1 = y0 + 1; }
    const jit = opts.jit || 0, cj = opts.cj || 0;
    if (this.nor) _n.getNormalMatrix(m);
    const e = m.elements;
    let o = this.nv * 3;
    for (let i = 0; i < n; i++, o += 3) {
      let x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      const ly = y;
      if (jit) { const h = hash3(x, y, z), h2 = hash3(z, x, y), h3 = hash3(y, z, x); x += (h - 0.5) * jit; y += (h2 - 0.5) * jit; z += (h3 - 0.5) * jit; }
      this.pos[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
      this.pos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      this.pos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      let r = 1, g = 1, b = 1;
      if (hasC) {
        if (grad) { const t = (ly - y0) / (y1 - y0); r = _c2.r + (_c.r - _c2.r) * t; g = _c2.g + (_c.g - _c2.g) * t; b = _c2.b + (_c.b - _c2.b) * t; }
        else { r = _c.r; g = _c.g; b = _c.b; }
      } else if (ca) { r = ca.getX(i); g = ca.getY(i); b = ca.getZ(i); }
      if (cj) { const k = 1 + (hash3(x * 3.1, y * 1.7, z * 2.3) - 0.5) * cj; r *= k; g *= k; b *= k; }
      this.col[o] = r; this.col[o + 1] = g; this.col[o + 2] = b;
      if (this.nor) {
        if (na) {
          const nx = na.getX(i), ny = na.getY(i), nz = na.getZ(i), ne = _n.elements;
          let tx = ne[0] * nx + ne[3] * ny + ne[6] * nz, ty = ne[1] * nx + ne[4] * ny + ne[7] * nz, tz = ne[2] * nx + ne[5] * ny + ne[8] * nz;
          const l = Math.hypot(tx, ty, tz) || 1;
          this.nor[o] = tx / l; this.nor[o + 1] = ty / l; this.nor[o + 2] = tz / l;
        } else { this.nor[o] = 0; this.nor[o + 1] = 1; this.nor[o + 2] = 0; }
      }
    }
    const ia = geom.index;
    const flip = m.determinant() < 0;
    if (ia) {
      const k = ia.count; this._growI(k);
      const arr = ia.array;
      if (flip) for (let i = 0; i < k; i += 3) { this.idx[this.ni + i] = arr[i] + this.nv; this.idx[this.ni + i + 1] = arr[i + 2] + this.nv; this.idx[this.ni + i + 2] = arr[i + 1] + this.nv; }
      else for (let i = 0; i < k; i++) this.idx[this.ni + i] = arr[i] + this.nv;
      this.ni += k;
    } else {
      this._growI(n);
      if (flip) for (let i = 0; i < n; i += 3) { this.idx[this.ni + i] = this.nv + i; this.idx[this.ni + i + 1] = this.nv + i + 2; this.idx[this.ni + i + 2] = this.nv + i + 1; }
      else for (let i = 0; i < n; i++) this.idx[this.ni + i] = this.nv + i;
      this.ni += n;
    }
    this.nv += n;
    return this;
  }

  // 把另一个 Geo（原型）整体加入：m 为 Matrix4，tint 为颜色乘子 [r,g,b] 或 null
  addGeo(src, m, tint) {
    const n = src.nv; if (!n) return this;
    this._growV(n); this._growI(src.ni);
    const e = m.elements, sp = src.pos, sc = src.col;
    let o = this.nv * 3;
    const tr = tint ? tint[0] : 1, tg = tint ? tint[1] : 1, tb = tint ? tint[2] : 1;
    for (let i = 0, k = 0; i < n; i++, k += 3, o += 3) {
      const x = sp[k], y = sp[k + 1], z = sp[k + 2];
      this.pos[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
      this.pos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      this.pos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      this.col[o] = sc[k] * tr; this.col[o + 1] = sc[k + 1] * tg; this.col[o + 2] = sc[k + 2] * tb;
    }
    if (this.nor && src.nor) {
      _n.getNormalMatrix(m); const ne = _n.elements, sn = src.nor; o = this.nv * 3;
      for (let i = 0, k = 0; i < n; i++, k += 3, o += 3) {
        const nx = sn[k], ny = sn[k + 1], nz = sn[k + 2];
        const tx = ne[0] * nx + ne[3] * ny + ne[6] * nz, ty = ne[1] * nx + ne[4] * ny + ne[7] * nz, tz = ne[2] * nx + ne[5] * ny + ne[8] * nz;
        const l = Math.hypot(tx, ty, tz) || 1;
        this.nor[o] = tx / l; this.nor[o + 1] = ty / l; this.nor[o + 2] = tz / l;
      }
    }
    const si = src.idx, b = this.nv;
    for (let i = 0; i < src.ni; i++) this.idx[this.ni + i] = si[i] + b;
    this.ni += src.ni; this.nv += n;
    return this;
  }

  // 直接写入一个四边形（a,b,c,d 逆时针），颜色 [r,g,b]
  quad(a, b, c, d, col) {
    this._growV(4); this._growI(6);
    let o = this.nv * 3;
    for (const v of [a, b, c, d]) { this.pos[o] = v[0]; this.pos[o + 1] = v[1]; this.pos[o + 2] = v[2]; this.col[o] = col[0]; this.col[o + 1] = col[1]; this.col[o + 2] = col[2]; o += 3; }
    const n = this.nv;
    this.idx[this.ni++] = n; this.idx[this.ni++] = n + 1; this.idx[this.ni++] = n + 2;
    this.idx[this.ni++] = n; this.idx[this.ni++] = n + 2; this.idx[this.ni++] = n + 3;
    this.nv += 4;
    return this;
  }

  // ---- 基础体快捷方法 ----
  box(w, h, d, o) { return this.add(prim(`b`, () => new THREE.BoxGeometry(1, 1, 1)), { ...o, s: scl(o, w, h, d) }); }
  cyl(rt, rb, h, seg = 8, o = {}) { return this.add(prim(`c${rt / (rb || 1e-6)}_${seg}_${o.open ? 1 : 0}`, () => new THREE.CylinderGeometry(rt / (rb || 1e-6) || 0, rb ? 1 : 0, 1, seg, 1, !!o.open)), { ...o, s: scl(o, rb || rt, h, rb || rt) }); }
  cone(r, h, seg = 8, o = {}) { return this.add(prim(`k${seg}`, () => new THREE.ConeGeometry(1, 1, seg)), { ...o, s: scl(o, r, h, r) }); }
  sphere(r, ws = 10, hs = 8, o = {}) { return this.add(prim(`s${ws}_${hs}`, () => new THREE.SphereGeometry(1, ws, hs)), { ...o, s: scl(o, r, r, r) }); }
  ico(r, det = 0, o = {}) { return this.add(prim(`i${det}`, () => new THREE.IcosahedronGeometry(1, det)), { ...o, s: scl(o, r, r, r) }); }
  torus(R, r, rs = 8, ts = 16, o = {}) { return this.add(prim(`t${(r / R).toFixed(4)}_${rs}_${ts}_${o.arc || 0}`, () => new THREE.TorusGeometry(1, r / R, rs, ts, o.arc || Math.PI * 2)), { ...o, s: scl(o, R, R, R) }); }
  // 两点之间的圆管
  tube(a, b, r, seg = 6, o = {}) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 1e-6;
    _p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    _q.setFromUnitVectors(UP, _s.set(dx / len, dy / len, dz / len));
    const r2 = o.r2 === undefined ? r : o.r2;
    const m = new THREE.Matrix4().compose(_p, _q, _s.set(r, len, r));
    return this.add(prim(`c${(r2 / r).toFixed(4)}_${seg}_0`, () => new THREE.CylinderGeometry(r2 / r, 1, 1, seg, 1, false)), { ...o, m });
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.nv * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, this.nv * 3), 3));
    if (this.nor) g.setAttribute('normal', new THREE.BufferAttribute(this.nor.slice(0, this.nv * 3), 3));
    const I = this.nv > 65535 ? this.idx.slice(0, this.ni) : new Uint16Array(this.idx.subarray(0, this.ni));
    g.setIndex(new THREE.BufferAttribute(I, 1));
    g.computeBoundingSphere();
    return g;
  }
}
const UP = new THREE.Vector3(0, 1, 0);
function setC(c, v) { if (Array.isArray(v)) c.setRGB(v[0], v[1], v[2]); else c.set(v); }
function scl(o, x, y, z) {
  const s = o && o.s;
  if (s === undefined) return [x, y, z];
  if (typeof s === 'number') return [x * s, y * s, z * s];
  return [x * s[0], y * s[1], z * s[2]];
}

// 让标准材质按自身漫反射色微微自发光（夜间可读性）。uniform: { value: 0..1 }
export function selfLit(mat, uniform) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uSelfLit = uniform;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSelfLit;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uSelfLit;');
  };
  mat.customProgramCacheKey = () => 'selfLit' + (prev ? '1' : '0');
  return mat;
}

// sRGB 十六进制 -> 线性 [r,g,b]
export function rgb(hex) { _c.set(hex); return [_c.r, _c.g, _c.b]; }
