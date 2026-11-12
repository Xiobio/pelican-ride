// 海面：Gerstner 波 + 细节法线 + 菲涅尔天空反射 + 浪尖/岸边白沫
import * as THREE from 'three';
import { TAU } from './util.js';
import { GLSL_NOISE, GLSL_SKY_BASE } from './sky.js';

const NW = 6;
// 波长, 方向角(度, 0 = 朝 +X 即拍向岸边), 振幅比例
const WAVES = [
  [41, 12, 1.0], [26, -24, 0.95], [15.5, 38, 0.9], [9.2, -8, 0.85], [5.6, 52, 0.8], [3.3, -40, 0.7],
];
export const SHORE_RANGE = 640, SHORE_BACK = 80, SHORE_N = 256;

const VERT = /* glsl */`
uniform vec4 uWave[${NW}];      // dir.x, dir.z, k, amp
uniform float uPhase[${NW}];
uniform float uWaveScale;
uniform sampler2D uShore;
varying vec3 vWorld; varying vec3 vN; varying float vCrest; varying float vShore; varying float vLand;
void main(){
  vec3 p = position;
  float su = clamp((${SHORE_BACK.toFixed(1)} - p.z) / ${SHORE_RANGE.toFixed(1)}, 0.0, 1.0);
  vec4 sh = texture2D(uShore, vec2(su, 0.5));
  float sd = max(sh.r - p.x, 0.0);            // 到岸线的距离（海在 -X）
  sd = mix(sd, 60.0, sh.g);                    // 桥区：到处都是开阔海面
  float att = smoothstep(-1.0, 16.0, sd) * 0.88 + 0.12;
  float far = 1.0 - smoothstep(350.0, 1300.0, length(p.xz));
  float sc = uWaveScale * att;
  vec3 d = vec3(0.0); vec3 n = vec3(0.0, 1.0, 0.0);
  for (int i = 0; i < ${NW}; i++) {
    vec4 w = uWave[i];
    float a = w.w * sc * (i < 2 ? 1.0 : far);
    float f = w.z * (w.x * p.x + w.y * p.z) + uPhase[i];
    float s = sin(f), c = cos(f);
    d.x += w.x * a * c * 1.15; d.z += w.y * a * c * 1.15; d.y += a * s;
    n.x -= w.x * w.z * a * c; n.z -= w.y * w.z * a * c; n.y -= 1.15 * w.z * a * s;
  }
  p += d;
  vCrest = d.y / (1.1 * uWaveScale + 1e-3);
  vShore = sd; vLand = sh.g;
  vN = normalize(n);
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */`
precision highp float;
uniform float uTime; uniform float uDist;
uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uFoam;
uniform vec3 uFogColor; uniform float uFogDensity;
uniform float uRain;
varying vec3 vWorld; varying vec3 vN; varying float vCrest; varying float vShore; varying float vLand;
${GLSL_NOISE}
${GLSL_SKY_BASE}
void main(){
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  // 内容坐标（不随“跑步机”滑动）
  vec2 cp = vec2(vWorld.x, vWorld.z - uDist);
  // 细节法线：两层滚动噪声的有限差分
  float lod = 1.0 - smoothstep(60.0, 420.0, dist);
  vec2 p1 = cp * 0.55 + vec2(uTime * 0.22, uTime * 0.11);
  vec2 p2 = cp * 1.7 + vec2(-uTime * 0.31, uTime * 0.27);
  float e = 0.12;
  float h0 = vnoise(p1) + 0.5 * vnoise(p2);
  float hx = vnoise(p1 + vec2(e, 0.0)) + 0.5 * vnoise(p2 + vec2(e, 0.0));
  float hz = vnoise(p1 + vec2(0.0, e)) + 0.5 * vnoise(p2 + vec2(0.0, e));
  vec3 N = normalize(vN + vec3(h0 - hx, 0.0, h0 - hz) * (1.1 + uRain * 1.4) * (0.25 + 0.75 * lod));
  // 远处把法线压平一些，避免闪烁
  N = normalize(mix(vec3(0.0, 1.0, 0.0), N, 0.45 + 0.55 * lod));

  float ndv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N); R.y = abs(R.y) + 0.02; R = normalize(R);
  vec3 refl = skyBase(R);
  // 太阳 / 月亮高光
  float sdot = max(dot(R, uSunDir), 0.0);
  vec3 spec = uSunColor * (pow(sdot, 520.0) * 26.0 + pow(sdot, 60.0) * 0.6) * uSunGlow;
  float mdot = max(dot(R, uMoonDir), 0.0);
  spec += vec3(0.6, 0.72, 1.0) * (pow(mdot, 420.0) * 7.0 + pow(mdot, 40.0) * 0.2) * uNight;

  // 水体颜色：近岸偏青绿，远海深蓝
  float shallow = exp(-vShore * 0.11) * (1.0 - vLand);
  vec3 body = mix(uDeep, uShallow, clamp(shallow * 1.1 + max(vCrest, 0.0) * 0.28, 0.0, 1.0));
  // 浪尖透光
  vec3 Lh = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-4);
  float sss = pow(max(dot(V, -Lh), 0.0), 3.0) * max(vCrest, 0.0);
  body += uShallow * uSunColor * sss * 0.9 * uSunGlow;

  vec3 col = mix(body, refl, fres) + spec;

  // 白沫：浪尖 + 岸边碎浪
  float fn = vnoise(cp * 0.9 + vec2(uTime * 0.15, 0.0)) * 0.6 + vnoise(cp * 3.1 - vec2(0.0, uTime * 0.2)) * 0.4;
  float crest = smoothstep(0.52, 0.95, vCrest + fn * 0.42 - 0.12) * lod;
  float band = sin(vShore * 0.95 - uTime * 1.1 + fn * 5.0) * 0.5 + 0.5;
  float shoreF = (1.0 - vLand) * (smoothstep(7.5, 0.0, vShore) * smoothstep(0.35, 0.8, band * 0.7 + fn * 0.55)
               + smoothstep(1.6, 0.0, vShore) * 0.85);
  float foam = clamp(crest * 0.85 + shoreF, 0.0, 1.0);
  col = mix(col, uFoam, foam * 0.92);
  // 雨点涟漪
  if (uRain > 0.01) {
    vec2 rp = cp * 2.2; vec2 ip = floor(rp); vec2 fp = fract(rp) - 0.5;
    float h = hash12(ip); float t = fract(uTime * (0.8 + h) + h * 7.0);
    float ring = smoothstep(0.03, 0.0, abs(length(fp) - t * 0.42)) * (1.0 - t);
    col += vec3(0.35) * ring * uRain * lod * step(0.5, h);
  }

  // 大气雾 -> 与天空地平线颜色融合
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  vec3 hz3 = skyBase(normalize(vec3(-V.x, 0.015, -V.z)));
  col = mix(col, mix(uFogColor, hz3, 0.65), clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`;

function buildGrid(nx, nz) {
  const f = (a) => 110 * a + 1500 * Math.pow(Math.abs(a), 5) * Math.sign(a);
  const pos = new Float32Array(nx * nz * 3);
  let o = 0;
  for (let j = 0; j < nz; j++) {
    const b = -1 + (1.62 * j) / (nz - 1);
    for (let i = 0; i < nx; i++) {
      const a = -1 + (2 * i) / (nx - 1);
      pos[o++] = f(a); pos[o++] = 0; pos[o++] = f(b);
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  o = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

export class Ocean {
  constructor(scene, sky, quality) {
    this.sky = sky;
    this.waveScale = 1;
    this.shoreData = new Uint16Array(SHORE_N * 4);
    this.shoreTex = new THREE.DataTexture(this.shoreData, SHORE_N, 1, THREE.RGBAFormat, THREE.HalfFloatType);
    this.shoreTex.minFilter = this.shoreTex.magFilter = THREE.LinearFilter;
    this.shoreTex.wrapS = this.shoreTex.wrapT = THREE.ClampToEdgeWrapping;
    this.shoreTex.needsUpdate = true;
    this.waves = WAVES.map(([len, deg, amp]) => {
      const k = TAU / len, a = deg * Math.PI / 180;
      return { k, dx: Math.cos(a), dz: Math.sin(a), amp: len * 0.0125 * amp, w: Math.sqrt(9.81 * k) * 0.85 };
    });
    const su = sky.uniforms;
    this.uniforms = {
      uWave: { value: this.waves.map(w => new THREE.Vector4(w.dx, w.dz, w.k, w.amp)) },
      uPhase: { value: new Float32Array(NW) },
      uWaveScale: { value: 1 }, uShore: { value: this.shoreTex },
      uTime: { value: 0 }, uDist: { value: 0 }, uRain: { value: 0 },
      uDeep: { value: sky.pal.wd }, uShallow: { value: sky.pal.ws }, uFoam: { value: new THREE.Color(1, 1, 1) },
      uFogColor: { value: sky.pal.fog }, uFogDensity: { value: 0.003 },
      uSunDir: su.uSunDir, uMoonDir: su.uMoonDir, uZenith: su.uZenith, uHorizon: su.uHorizon, uGround: su.uGround,
      uSunColor: su.uSunColor, uSunGlow: su.uSunGlow, uNight: su.uNight,
    };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, defines: { FBM_OCT: 3 } });
    this.mesh = new THREE.Mesh(buildGrid(quality >= 2 ? 230 : 150, quality >= 2 ? 190 : 124), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);
  }

  // 任意点的海面高度（船、浮标、鲸鱼用）。x/z 为世界坐标
  heightAt(x, z, time, dist) {
    let y = 0;
    for (let i = 0; i < 3; i++) {
      const w = this.waves[i];
      const f = w.k * (w.dx * x + w.dz * (z - dist)) - w.w * time;
      y += w.amp * Math.sin(f);
    }
    return y * this.waveScale;
  }

  // track: Track, dist: 行驶距离
  update(time, dist, track, rain = 0) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uDist.value = dist % 8192;
    u.uWaveScale.value = this.waveScale;
    u.uRain.value = rain;
    u.uFogDensity.value = this.sky.scene.fog.density;
    const p = this.sky.pal;
    const sk = 0.22 * this.sky.sun.intensity * (this.sky.sunDir.y > 0.02 ? 1 : 0), hk = 0.55 * p.hemI;
    u.uFoam.value.setRGB(p.hemS.r * hk + p.sun.r * sk + 0.02, p.hemS.g * hk + p.sun.g * sk + 0.02, p.hemS.b * hk + p.sun.b * sk + 0.02);
    const ph = u.uPhase.value;
    for (let i = 0; i < NW; i++) {
      const w = this.waves[i];
      let f = (-w.k * w.dz * dist - w.w * time) % TAU;
      ph[i] = f;
    }
    // 岸线纹理
    const d = this.shoreData, P = this._P || (this._P = {});
    const toH = THREE.DataUtils.toHalfFloat;
    for (let i = 0; i < SHORE_N; i++) {
      const s = dist - SHORE_BACK + (i / (SHORE_N - 1)) * SHORE_RANGE;
      track.params(s, P);
      const x = track.cx(s) + track.shoreU(s, P);
      d[i * 4] = toH(x); d[i * 4 + 1] = toH(P.bridge); d[i * 4 + 2] = toH(0); d[i * 4 + 3] = toH(1);
    }
    this.shoreTex.needsUpdate = true;
  }
}
