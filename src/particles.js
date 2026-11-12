// 粒子：CPU 模拟 + 单次 draw call 的点精灵（两套：普通混合 / 叠加发光），外加雨丝
import * as THREE from 'three';
import { TAU } from './util.js';

const VERT = /* glsl */`
attribute vec4 aColor; attribute vec3 aData; // size, shape, rot
varying vec4 vColor; varying float vShape; varying float vRot;
uniform float uScale;
void main(){
  vColor = aColor; vShape = aData.y; vRot = aData.z;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aData.x * uScale / max(-mv.z, 0.3), 0.0, 300.0);
}`;
const FRAG = /* glsl */`
varying vec4 vColor; varying float vShape; varying float vRot;
uniform float uLight;
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot); p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  float d = length(p) * 2.0, a;
  if (vShape < 0.5) a = smoothstep(1.0, 0.25, d);                                   // 0 柔和圆点
  else if (vShape < 1.5) a = smoothstep(1.0, 0.8, length(p * vec2(1.0, 2.3)) * 2.0); // 1 椭圆（花瓣 / 羽毛）
  else if (vShape < 2.5) { float st = max(0.0, 1.0 - abs(p.x) * abs(p.y) * 90.0) * smoothstep(1.0, 0.0, d); a = st * st + smoothstep(0.35, 0.0, d); } // 2 星芒
  else if (vShape < 3.5) a = smoothstep(0.16, 0.0, abs(d - 0.78)) + smoothstep(0.5, 0.0, length(p - vec2(-0.16, -0.16)) * 6.0) * 0.8; // 3 泡泡
  else a = step(d, 1.0);                                                             // 4 实心圆
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb * uLight, vColor.a * a);
}`;

class Pool {
  constructor(parent, max, additive) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.dat = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.ttl = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.size0 = new Float32Array(max); this.size1 = new Float32Array(max);
    this.alpha = new Float32Array(max); this.spin = new Float32Array(max); this.floorY = new Float32Array(max);
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aData', new THREE.BufferAttribute(this.dat, 3).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 600 }, uLight: { value: 1 } };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = additive ? 21 : 20;
    parent.add(this.points);
    g.setDrawRange(0, 0);
  }
  // o: {x,y,z, vx,vy,vz, life, size, size1, r,g,b, a, grav, drag, shape, rot, spin, floor}
  emit(o) {
    let i = this.n;
    if (i >= this.max) { i = (Math.random() * this.max) | 0; } else this.n++;
    const i3 = i * 3, i4 = i * 4;
    this.pos[i3] = o.x; this.pos[i3 + 1] = o.y; this.pos[i3 + 2] = o.z;
    this.vel[i3] = o.vx || 0; this.vel[i3 + 1] = o.vy || 0; this.vel[i3 + 2] = o.vz || 0;
    this.col[i4] = o.r; this.col[i4 + 1] = o.g; this.col[i4 + 2] = o.b; this.col[i4 + 3] = o.a === undefined ? 1 : o.a;
    this.alpha[i] = o.a === undefined ? 1 : o.a;
    this.life[i] = 0; this.ttl[i] = o.life || 1;
    this.grav[i] = o.grav || 0; this.drag[i] = o.drag || 0;
    this.size0[i] = o.size || 0.2; this.size1[i] = o.size1 === undefined ? this.size0[i] : o.size1;
    this.dat[i3] = this.size0[i]; this.dat[i3 + 1] = o.shape || 0; this.dat[i3 + 2] = o.rot || 0;
    this.spin[i] = o.spin || 0; this.floorY[i] = o.floor === undefined ? -1e9 : o.floor;
  }
  update(dt) {
    let n = this.n;
    const { pos, vel, col, dat, life, ttl, grav, drag, size0, size1, alpha, spin, floorY } = this;
    for (let i = 0; i < n; i++) {
      life[i] += dt;
      if (life[i] >= ttl[i]) {
        // 与最后一个交换
        n--;
        if (i !== n) {
          const a = i * 3, b = n * 3, a4 = i * 4, b4 = n * 4;
          pos[a] = pos[b]; pos[a + 1] = pos[b + 1]; pos[a + 2] = pos[b + 2];
          vel[a] = vel[b]; vel[a + 1] = vel[b + 1]; vel[a + 2] = vel[b + 2];
          dat[a] = dat[b]; dat[a + 1] = dat[b + 1]; dat[a + 2] = dat[b + 2];
          col[a4] = col[b4]; col[a4 + 1] = col[b4 + 1]; col[a4 + 2] = col[b4 + 2]; col[a4 + 3] = col[b4 + 3];
          life[i] = life[n]; ttl[i] = ttl[n]; grav[i] = grav[n]; drag[i] = drag[n]; size0[i] = size0[n]; size1[i] = size1[n]; alpha[i] = alpha[n]; spin[i] = spin[n]; floorY[i] = floorY[n];
        }
        i--; continue;
      }
      const i3 = i * 3, t = life[i] / ttl[i];
      const k = Math.max(0, 1 - drag[i] * dt);
      vel[i3] *= k; vel[i3 + 1] = vel[i3 + 1] * k - grav[i] * dt; vel[i3 + 2] *= k;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      if (pos[i3 + 1] < floorY[i]) { pos[i3 + 1] = floorY[i]; vel[i3 + 1] *= -0.35; vel[i3] *= 0.6; vel[i3 + 2] *= 0.6; }
      dat[i3] = size0[i] + (size1[i] - size0[i]) * t;
      dat[i3 + 2] += spin[i] * dt;
      col[i * 4 + 3] = alpha[i] * (t < 0.1 ? t * 10 : 1 - (t - 0.1) / 0.9) ;
    }
    this.n = n;
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aColor.needsUpdate = true; this.geo.attributes.aData.needsUpdate = true;
  }
  clear() { this.n = 0; this.geo.setDrawRange(0, 0); }
}

const _c = new THREE.Color();
export class Particles {
  // parent：世界根节点（内容坐标），粒子随世界滚动
  constructor(parent, scene) {
    this.soft = new Pool(parent, 2600, false);
    this.glow = new Pool(parent, 3200, true);
    // 雨丝：跟随相机的线段
    const N = this.rainN = 900;
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(N * 6), seed = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { const x = (Math.random() - 0.5) * 44, y = Math.random() * 26, z = (Math.random() - 0.5) * 44 - 8; p.set([x, y, z, x, y, z], i * 6); seed[i * 2] = 0; seed[i * 2 + 1] = 1; }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aEnd', new THREE.BufferAttribute(seed, 1));
    this.rainU = { uTime: { value: 0 }, uAmt: { value: 0 }, uSpeed: { value: 0 }, uLight: { value: 1 } };
    this.rain = new THREE.LineSegments(g, new THREE.ShaderMaterial({
      uniforms: this.rainU, transparent: true, depthWrite: false,
      vertexShader: `attribute float aEnd; uniform float uTime, uSpeed; varying float vA;
        void main(){ vec3 p = position; float fall = 24.0; p.y = mod(p.y - uTime * fall, 26.0) - 3.0; p.z = mod(p.z + uTime * uSpeed + 30.0, 44.0) - 30.0;
          p += vec3(0.18, 1.0, -uSpeed * 0.035) * aEnd * 0.75; vA = aEnd;
          gl_Position = projectionMatrix * viewMatrix * vec4(p + vec3(cameraPosition.x, cameraPosition.y - 6.0, cameraPosition.z), 1.0); }`,
      fragmentShader: `uniform float uAmt, uLight; varying float vA; void main(){ gl_FragColor = vec4(vec3(0.75, 0.82, 0.95) * uLight, uAmt * 0.32 * (0.35 + vA * 0.65)); }`,
    }));
    this.rain.frustumCulled = false; this.rain.visible = false; this.rain.renderOrder = 22;
    scene.add(this.rain);
  }
  update(dt, time, uScale, light, rainAmt, speed) {
    this.soft.uniforms.uScale.value = uScale; this.glow.uniforms.uScale.value = uScale;
    this.soft.uniforms.uLight.value = light; this.glow.uniforms.uLight.value = 1;
    this.soft.update(dt); this.glow.update(dt);
    this.rain.visible = rainAmt > 0.01;
    this.rainU.uTime.value = time; this.rainU.uAmt.value = rainAmt; this.rainU.uSpeed.value = speed; this.rainU.uLight.value = 0.35 + light * 0.65;
  }
  clear() { this.soft.clear(); this.glow.clear(); }

  // ---------- 预设 ----------
  burst(pool, x, y, z, n, o) {
    const P = pool === 'glow' ? this.glow : this.soft;
    _c.set(o.color === undefined ? 0xffffff : o.color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, b = Math.acos(2 * Math.random() - 1), sp = (o.speed || 2) * (0.35 + Math.random() * 0.65);
      const j = o.cj ? 1 + (Math.random() - 0.5) * o.cj : 1;
      P.emit({
        x: x + (Math.random() - 0.5) * (o.spread || 0), y: y + (Math.random() - 0.5) * (o.spread || 0), z: z + (Math.random() - 0.5) * (o.spread || 0),
        vx: Math.sin(b) * Math.cos(a) * sp + (o.vx || 0), vy: Math.abs(Math.cos(b)) * sp * (o.up === undefined ? 1 : o.up) + (o.vy || 0), vz: Math.sin(b) * Math.sin(a) * sp + (o.vz || 0),
        life: (o.life || 0.8) * (0.6 + Math.random() * 0.6), size: (o.size || 0.2) * (0.6 + Math.random() * 0.8), size1: o.size1 === undefined ? undefined : o.size1,
        r: _c.r * j, g: _c.g * j, b: _c.b * j, a: o.a === undefined ? 1 : o.a, grav: o.grav === undefined ? 6 : o.grav, drag: o.drag || 0.5,
        shape: o.shape || 0, rot: Math.random() * 6, spin: o.spin ? (Math.random() - 0.5) * o.spin : 0, floor: o.floor,
      });
    }
  }
  sparkle(x, y, z, color = 0xfff2a8, n = 10) { this.burst('glow', x, y, z, n, { color, speed: 3.2, life: 0.55, size: 0.34, size1: 0, grav: 2, drag: 2.5, shape: 2, spin: 6 }); }
  fishPop(x, y, z, gold) {
    this.burst('glow', x, y, z, gold ? 18 : 8, { color: gold ? 0xffd45a : 0x8fe4ff, speed: gold ? 4.5 : 3, life: 0.5, size: gold ? 0.42 : 0.3, size1: 0, grav: 3, drag: 2.5, shape: 2, spin: 8 });
    this.burst('soft', x, y, z, 5, { color: 0xcfefff, speed: 2, life: 0.7, size: 0.16, grav: 7, drag: 1, shape: 3 });
  }
  dust(x, y, z, n = 8, color = 0xbfb39a) { this.burst('soft', x, y + 0.05, z, n, { color, speed: 1.6, up: 0.5, life: 0.7, size: 0.35, size1: 0.9, a: 0.5, grav: -0.3, drag: 2.2 }); }
  splash(x, y, z, n = 16) {
    this.burst('soft', x, y, z, n, { color: 0xd8f1ff, speed: 4.2, up: 1.4, life: 0.75, size: 0.2, size1: 0.08, a: 0.85, grav: 12, drag: 0.6, floor: y - 0.02 });
    this.burst('soft', x, y, z, 5, { color: 0xffffff, speed: 1, up: 0.3, life: 0.5, size: 0.5, size1: 1.3, a: 0.35, grav: 0, drag: 2 });
  }
  feathers(x, y, z, n = 14) { this.burst('soft', x, y, z, n, { color: 0xffffff, speed: 4, up: 1.1, life: 1.6, size: 0.3, a: 0.95, grav: 2.2, drag: 2.2, shape: 1, spin: 9, floor: y - 1.0 }); }
  smash(x, y, z, color = 0xff8a3a) {
    this.burst('soft', x, y, z, 14, { color, speed: 6, up: 1.2, life: 0.9, size: 0.26, a: 1, grav: 14, drag: 0.4, shape: 4, cj: 0.5, floor: y - 0.5 });
    this.burst('glow', x, y, z, 10, { color: 0xffe2a0, speed: 5, life: 0.35, size: 0.5, size1: 0, grav: 0, drag: 3, shape: 2 });
  }
  firework(x, y, z, color) {
    _c.set(color);
    const n = 70;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, b = Math.acos(2 * Math.random() - 1), sp = 9 + Math.random() * 2.5;
      this.glow.emit({ x, y, z, vx: Math.sin(b) * Math.cos(a) * sp, vy: Math.cos(b) * sp, vz: Math.sin(b) * Math.sin(a) * sp, life: 1.5 + Math.random() * 0.5, size: 0.9, size1: 0.1, r: _c.r * 2, g: _c.g * 2, b: _c.b * 2, a: 1, grav: 2.4, drag: 1.5, shape: 2, rot: Math.random() * 6, spin: 4 });
    }
    this.glow.emit({ x, y, z, life: 0.3, size: 14, size1: 2, r: _c.r, g: _c.g, b: _c.b, a: 0.8, shape: 0 });
  }
}
