// 天空：昼夜调色板、太阳/月亮、星空银河、程序化云、彩虹、极光、流星 + 场景灯光
import * as THREE from 'three';
import { clamp, lerp, smoothstep, TAU } from './util.js';

export const GLSL_NOISE = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; mat2 r = mat2(0.8,-0.6,0.6,0.8);
  for(int i=0;i<FBM_OCT;i++){ s += a*vnoise(p); p = r*p*2.03 + 11.7; a *= 0.5; } return s; }
`;

export const GLSL_SKY_BASE = /* glsl */`
uniform vec3 uSunDir; uniform vec3 uMoonDir;
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround;
uniform vec3 uSunColor; uniform float uSunGlow; uniform float uNight;
vec3 skyBase(vec3 dir){
  float y = dir.y;
  float h = pow(1.0 - clamp(y, 0.0, 1.0), 3.2);
  vec3 col = mix(uZenith, uHorizon, h);
  if (y < 0.0) col = mix(uHorizon, uGround, smoothstep(0.0, -0.35, y));
  float sd = max(dot(dir, uSunDir), 0.0);
  float glow = pow(sd, 5.0) * 0.26 + pow(sd, 40.0) * 0.42 + pow(sd, 350.0) * 1.0;
  col += uSunColor * glow * uSunGlow * (0.4 + 0.6 * h);
  float md = max(dot(dir, uMoonDir), 0.0);
  col += vec3(0.35, 0.45, 0.75) * (pow(md, 20.0) * 0.06 + pow(md, 260.0) * 0.22) * uNight;
  return col;
}
`;

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = viewMatrix * vec4(mat3(modelMatrix) * position, 0.0);
  p.w = 1.0;
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // 贴到远平面
}`;

const SKY_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform float uTime; uniform vec2 uCloudOff; uniform float uCover;
uniform vec3 uCloudLit; uniform vec3 uCloudDark;
uniform float uRainbow; uniform float uAurora; uniform float uFlash; uniform float uMoonPhase;
uniform vec3 uMeteorA; uniform vec3 uMeteorB; uniform float uMeteorT;
${GLSL_NOISE}
${GLSL_SKY_BASE}

vec3 spectrum(float t){ // 0..1 紫->红
  return clamp(vec3(abs(t*6.0-3.0)-1.0, 2.0-abs(t*6.0-2.0), 2.0-abs(t*6.0-4.0)), 0.0, 1.0);
}
float starField(vec3 d, float scale, float thresh){
  vec3 p = d * scale; vec3 ip = floor(p); vec3 fp = fract(p) - 0.5;
  float h = hash13(ip);
  float s = step(thresh, h);
  vec3 off = vec3(hash13(ip+1.7), hash13(ip+5.3), hash13(ip+9.1)) - 0.5;
  float r = length(fp - off*0.6);
  float tw = 0.65 + 0.35 * sin(uTime * (1.5 + h * 6.0) + h * 80.0);
  return s * smoothstep(0.16, 0.0, r) * tw * (0.5 + 0.5 * fract(h * 37.0));
}
void main(){
  vec3 dir = normalize(vDir);
  vec3 col = skyBase(dir);
  float up = clamp(dir.y, 0.0, 1.0);

  // ---- 星空 + 银河 ----
  if (uNight > 0.01 && dir.y > -0.02) {
    float st = starField(dir, 150.0, 0.90) + starField(dir, 70.0, 0.93) * 1.8;
    vec3 mwN = normalize(vec3(0.55, 0.45, -0.7));
    float band = exp(-pow(dot(dir, mwN) * 3.6, 2.0));
    float mw = band * (0.25 + 0.75 * fbm(dir.xz * 5.0 + dir.y * 3.0));
    st += starField(dir, 260.0, 0.82) * band * 1.2;
    col += (vec3(0.85, 0.9, 1.0) * st * 1.6 + vec3(0.30, 0.34, 0.60) * mw * 0.42) * uNight * smoothstep(-0.02, 0.2, dir.y);
  }

  // ---- 流星 ----
  if (uMeteorT > 0.0 && uMeteorT < 1.0) {
    vec3 head = normalize(mix(uMeteorA, uMeteorB, uMeteorT));
    vec3 tail = normalize(mix(uMeteorA, uMeteorB, max(uMeteorT - 0.22, 0.0)));
    vec3 ab = tail - head; float tt = clamp(dot(dir - head, ab) / dot(ab, ab), 0.0, 1.0);
    float dd = length(dir - (head + ab * tt));
    col += vec3(0.9, 0.95, 1.0) * smoothstep(0.004, 0.0, dd) * (1.0 - tt) * 2.5 * sin(uMeteorT * 3.14159) * uNight;
  }

  // ---- 太阳圆盘 ----
  float sd = dot(dir, uSunDir);
  float disc = smoothstep(0.99945, 0.99972, sd);
  col += uSunColor * disc * 3.2 * clamp(uSunGlow * 1.5, 0.0, 1.0);

  // ---- 月亮（带月相）----
  float md = dot(dir, uMoonDir);
  if (md > 0.9990) {
    vec3 mx = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 my = cross(mx, uMoonDir);
    vec2 q = vec2(dot(dir, mx), dot(dir, my)) / 0.036;
    float r2 = dot(q, q);
    if (r2 < 1.0) {
      float z = sqrt(1.0 - r2);
      vec3 n = vec3(q, z);
      vec3 L = normalize(vec3(cos(uMoonPhase), 0.25, sin(uMoonPhase)));
      float lit = smoothstep(-0.05, 0.25, dot(n, L));
      float crater = 0.8 + 0.2 * vnoise(q * 4.0 + 3.0) - 0.15 * smoothstep(0.55, 0.45, vnoise(q * 2.2 + 9.0));
      float edge = smoothstep(1.0, 0.86, r2);
      col = mix(col, vec3(1.0, 0.97, 0.88) * (0.04 + lit * 1.9) * crater, edge * (0.25 + 0.75 * uNight));
    }
  }

  // ---- 极光 ----
  if (uAurora > 0.01 && dir.y > 0.02) {
    vec2 p = dir.xz / (dir.y + 0.35);
    float w = fbm(vec2(p.x * 1.2 + uTime * 0.02, p.y * 0.4));
    float curtain = pow(0.5 + 0.5 * sin(p.x * 5.0 + w * 9.0 + uTime * 0.25), 6.0);
    float fade = smoothstep(0.05, 0.3, dir.y) * smoothstep(0.95, 0.4, dir.y);
    vec3 ac = mix(vec3(0.1, 1.0, 0.55), vec3(0.55, 0.3, 1.0), smoothstep(0.25, 0.75, dir.y + w * 0.3));
    col += ac * curtain * fade * uAurora * 0.6 * step(dir.z, 0.6);
  }

  // ---- 云 ----
  if (dir.y > 0.0) {
    vec2 uv = dir.xz / (dir.y + 0.10);
    vec2 sun2 = normalize(uSunDir.xz + 1e-4) * 0.10;
    // 低层积云
    vec2 u1 = uv * 0.42 + uCloudOff;
    float n1 = fbm(u1);
    float lo1 = 0.74 - uCover * 0.56;
    float c1 = smoothstep(lo1, lo1 + 0.2, n1);
    float l1 = clamp((n1 - fbm(u1 + sun2)) * 3.5 + 0.55, 0.0, 1.0);
    // 高层卷云
    vec2 u2 = uv * vec2(0.16, 0.5) + uCloudOff * 0.45 + 7.3;
    float n2 = fbm(u2);
    float c2 = smoothstep(0.46, 0.78, n2) * 0.55 * (0.4 + uCover);
    float fade = smoothstep(0.0, 0.16, dir.y);
    float sdc = max(sd, 0.0);
    vec3 lit = uCloudLit + uSunColor * (pow(sdc, 6.0) * 0.55 + pow(sdc, 60.0) * 0.9) * uSunGlow;
    lit += vec3(0.6, 0.7, 1.0) * pow(max(md, 0.0), 30.0) * 0.25 * uNight;
    vec3 cc = mix(uCloudDark, lit, l1) + vec3(uFlash);
    col = mix(col, mix(uCloudDark, lit, 0.8) + vec3(uFlash * 0.5), c2 * fade);
    col = mix(col, cc, c1 * fade * 0.93);
  }

  // ---- 彩虹 ----
  if (uRainbow > 0.01 && dir.y > 0.0) {
    float ang = degrees(acos(clamp(dot(dir, -uSunDir), -1.0, 1.0)));
    float t = (ang - 39.5) / 3.2;
    if (t > 0.0 && t < 1.0) {
      float a = sin(t * 3.14159);
      col += spectrum(t) * a * a * uRainbow * 0.45 * smoothstep(0.0, 0.12, dir.y);
    }
    float t2 = (ang - 50.0) / 4.0; // 副虹（颜色反向，更淡）
    if (t2 > 0.0 && t2 < 1.0) col += spectrum(1.0 - t2) * pow(sin(t2 * 3.14159), 2.0) * uRainbow * 0.12 * smoothstep(0.0, 0.12, dir.y);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------- 调色板关键帧 ----------
const C = (h) => new THREE.Color(h);
const KEYS = [
  { t: 0.0,  zen: '#02040d', hor: '#0b1430', gnd: '#04060e', sun: '#000000', sunI: 0.0, hemS: '#4a62b0', hemG: '#14162a', hemI: 0.95, fog: '#0a1226', cl: '#27314f', cd: '#0a0e1c', wd: '#030915', ws: '#0c3344', night: 1.0, exp: 1.25 },
  { t: 4.4,  zen: '#04081a', hor: '#1a1e44', gnd: '#05070f', sun: '#000000', sunI: 0.0, hemS: '#4c62ac', hemG: '#14162a', hemI: 0.95, fog: '#101630', cl: '#2b3252', cd: '#0c0f1e', wd: '#040a18', ws: '#0e3446', night: 1.0, exp: 1.22 },
  { t: 5.4,  zen: '#1d2a66', hor: '#e58a86', gnd: '#141428', sun: '#ff7a55', sunI: 0.5, hemS: '#7a82c8', hemG: '#2a2030', hemI: 0.7,  fog: '#8a6c8c', cl: '#f0a59a', cd: '#3a3458', wd: '#0a1a38', ws: '#3d6f86', night: 0.35, exp: 1.12 },
  { t: 6.3,  zen: '#3f6fc4', hor: '#ffc09a', gnd: '#2a3350', sun: '#ffa868', sunI: 2.0, hemS: '#a8c0f0', hemG: '#4a3c38', hemI: 0.8,  fog: '#e2b6a4', cl: '#ffe0c6', cd: '#8a7da0', wd: '#0c2f58', ws: '#3fa0a8', night: 0.0, exp: 1.05 },
  { t: 8.0,  zen: '#2f78d8', hor: '#cfe6fb', gnd: '#35506c', sun: '#fff0d2', sunI: 3.0, hemS: '#bcd8ff', hemG: '#5a5040', hemI: 0.9,  fog: '#bcd9f2', cl: '#ffffff', cd: '#9fb0c8', wd: '#0a3f74', ws: '#35b6b8', night: 0.0, exp: 1.0 },
  { t: 12.0, zen: '#1f6fd8', hor: '#bfe2ff', gnd: '#3a5a78', sun: '#fff8ea', sunI: 3.3, hemS: '#c2dcff', hemG: '#605644', hemI: 0.95, fog: '#b6d8f5', cl: '#ffffff', cd: '#a6b6cc', wd: '#08427c', ws: '#30c0c0', night: 0.0, exp: 1.0 },
  { t: 15.5, zen: '#2a74d6', hor: '#cfe4f6', gnd: '#3a5874', sun: '#fff2d6', sunI: 3.1, hemS: '#c0d8ff', hemG: '#605440', hemI: 0.92, fog: '#c2daf0', cl: '#fffaf0', cd: '#a3b0c6', wd: '#0a3f76', ws: '#35b8ba', night: 0.0, exp: 1.0 },
  { t: 17.2, zen: '#4d74c4', hor: '#ffca92', gnd: '#3d4864', sun: '#ffb866', sunI: 2.9, hemS: '#c2c6f0', hemG: '#5c4638', hemI: 0.85, fog: '#f0c8a6', cl: '#ffe6c2', cd: '#9a86a6', wd: '#0e3a6a', ws: '#44aab0', night: 0.0, exp: 1.03 },
  { t: 18.2, zen: '#444a9c', hor: '#ff9160', gnd: '#30304e', sun: '#ff7438', sunI: 2.3, hemS: '#b0a2dc', hemG: '#503632', hemI: 0.78, fog: '#e69a7c', cl: '#ffb489', cd: '#6d5682', wd: '#10284e', ws: '#4c8a9a', night: 0.0, exp: 1.08 },
  { t: 19.0, zen: '#232766', hor: '#c75c7c', gnd: '#1c1c36', sun: '#ff5244', sunI: 0.8, hemS: '#8078c0', hemG: '#30242e', hemI: 0.7,  fog: '#8a547c', cl: '#d87a8e', cd: '#3a3058', wd: '#0a1836', ws: '#34607e', night: 0.3, exp: 1.14 },
  { t: 20.0, zen: '#080c24', hor: '#272a5c', gnd: '#080a16', sun: '#000000', sunI: 0.0, hemS: '#5266b4', hemG: '#16162a', hemI: 0.92, fog: '#161b3c', cl: '#333a60', cd: '#0e1122', wd: '#040b1a', ws: '#103648', night: 0.9, exp: 1.22 },
  { t: 21.5, zen: '#02040d', hor: '#0b1430', gnd: '#04060e', sun: '#000000', sunI: 0.0, hemS: '#4a62b0', hemG: '#14162a', hemI: 0.95, fog: '#0a1226', cl: '#27314f', cd: '#0a0e1c', wd: '#030915', ws: '#0c3344', night: 1.0, exp: 1.25 },
  { t: 24.0, zen: '#02040d', hor: '#0b1430', gnd: '#04060e', sun: '#000000', sunI: 0.0, hemS: '#4a62b0', hemG: '#14162a', hemI: 0.95, fog: '#0a1226', cl: '#27314f', cd: '#0a0e1c', wd: '#030915', ws: '#0c3344', night: 1.0, exp: 1.25 },
].map(k => ({ ...k, zen: C(k.zen), hor: C(k.hor), gnd: C(k.gnd), sun: C(k.sun), hemS: C(k.hemS), hemG: C(k.hemG), fog: C(k.fog), cl: C(k.cl), cd: C(k.cd), wd: C(k.wd), ws: C(k.ws) }));
const COLOR_KEYS = ['zen', 'hor', 'gnd', 'sun', 'hemS', 'hemG', 'fog', 'cl', 'cd', 'wd', 'ws'];
const NUM_KEYS = ['sunI', 'hemI', 'night', 'exp'];
const GRAY = new THREE.Color();

export class Sky {
  constructor(scene, quality) {
    this.scene = scene;
    this.time = 17.2;          // 时刻 0..24
    this.flow = 1;             // 是否流动
    this.rate = 0.03;          // 游戏小时 / 秒
    this.cover = 0.42;         // 云量（基础）
    this.overcast = 0;         // 阴雨程度 0..1（天气系统驱动）
    this.rainbow = 0; this.aurora = 0; this.flash = 0;
    this.elapsed = 0;
    this.cloudOff = new THREE.Vector2(3.1, 1.7);
    this.pal = {};
    for (const k of COLOR_KEYS) this.pal[k] = new THREE.Color();
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.lightDir = new THREE.Vector3(0, 1, 0);
    this.night = 0; this.day = 1; this.sunVis = 1;
    this.meteor = { t: 2, cd: 6 };

    // 所有“看天”的 shader 共用同一组 uniform（海面反射也用）
    this.uniforms = {
      uSunDir: { value: this.sunDir }, uMoonDir: { value: this.moonDir },
      uZenith: { value: this.pal.zen }, uHorizon: { value: this.pal.hor }, uGround: { value: this.pal.gnd },
      uSunColor: { value: this.pal.sun }, uSunGlow: { value: 1 }, uNight: { value: 0 },
      uTime: { value: 0 }, uCloudOff: { value: this.cloudOff }, uCover: { value: 0.4 },
      uCloudLit: { value: this.pal.cl }, uCloudDark: { value: this.pal.cd },
      uRainbow: { value: 0 }, uAurora: { value: 0 }, uFlash: { value: 0 }, uMoonPhase: { value: 0.9 },
      uMeteorA: { value: new THREE.Vector3(0, 1, 0) }, uMeteorB: { value: new THREE.Vector3(0, 1, 0) }, uMeteorT: { value: 2 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      defines: { FBM_OCT: quality >= 2 ? 5 : 4 },
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = -1000;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);

    // 灯光
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sh = this.sun.shadow;
    sh.mapSize.set(2048, 2048);
    sh.camera.near = 1; sh.camera.far = 260;
    sh.camera.left = -42; sh.camera.right = 42; sh.camera.top = 42; sh.camera.bottom = -42;
    sh.bias = -0.0006; sh.normalBias = 0.05;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);
    this.fill = new THREE.DirectionalLight(0xffffff, 0.3); // 逆光补光，避免主角背光死黑
    scene.add(this.fill, this.fill.target);
    scene.fog = new THREE.FogExp2(0xffffff, 0.003);
    this.fogBase = 0.0030;
    this.fogMul = 1;
    this.exposure = 1;
    this.setTime(this.time);
  }

  setQuality(q) {
    this.material.defines.FBM_OCT = q >= 2 ? 5 : 4; this.material.needsUpdate = true;
    const size = q >= 3 ? 4096 : q >= 1 ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.mapSize.set(size, size); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; } }
  }

  setTime(h) { this.time = ((h % 24) + 24) % 24; this._computePalette(); }

  _computePalette() {
    const t = this.time;
    let i = 0; while (i < KEYS.length - 2 && t >= KEYS[i + 1].t) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const f = clamp((t - a.t) / (b.t - a.t));
    const p = this.pal;
    for (const k of COLOR_KEYS) p[k].copy(a[k]).lerp(b[k], f);
    for (const k of NUM_KEYS) p[k] = lerp(a[k], b[k], f);
    // 阴雨：整体压暗、去饱和
    const oc = this.overcast;
    if (oc > 0.001) {
      for (const k of ['zen', 'hor', 'fog', 'cl', 'cd', 'ws', 'wd', 'hemS']) {
        const c = p[k]; const l = c.r * 0.3 + c.g * 0.5 + c.b * 0.2;
        GRAY.setRGB(l * 0.78, l * 0.82, l * 0.9);
        c.lerp(GRAY, oc * (k === 'cl' ? 0.75 : 0.62));
      }
      p.sunI *= 1 - oc * 0.72;
      p.hemI *= 1 - oc * 0.12;
    }
    // 太阳 / 月亮方向
    const th = (t - 6) / 12 * Math.PI;
    const el = Math.sin(th) * 1.08; // 最高约 62°
    const az = (8.5 + 56.5 * Math.cos(th)) * Math.PI / 180;
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    const thm = th + Math.PI * 0.92;
    const elm = Math.sin(thm) * 0.85;
    const azm = (-18 + 42 * Math.cos(thm)) * Math.PI / 180;
    this.moonDir.set(Math.sin(azm) * Math.cos(elm), Math.sin(elm), -Math.cos(azm) * Math.cos(elm)).normalize();
    this.night = p.night;
    this.day = 1 - p.night;
    this.sunVis = smoothstep(-0.06, 0.06, this.sunDir.y);
    const moonVis = smoothstep(0.0, 0.15, this.moonDir.y) * p.night;
    // 主光源：白天太阳，夜里月亮
    const useMoon = this.sunDir.y < 0.02;
    const L = this.lightDir;
    if (!useMoon) {
      L.copy(this.sunDir); L.y = Math.max(L.y, 0.16); L.normalize();
      this.sun.color.copy(p.sun);
      this.sun.intensity = p.sunI * smoothstep(0.0, 0.10, this.sunDir.y) + 0.001;
    } else {
      L.copy(this.moonDir); L.y = Math.max(L.y, 0.3); L.normalize();
      this.sun.color.setRGB(0.55, 0.68, 1.0);
      this.sun.intensity = 0.95 * moonVis * (1 - this.overcast * 0.6) + 0.001;
    }
    this.hemi.color.copy(p.hemS); this.hemi.groundColor.copy(p.hemG); this.hemi.intensity = p.hemI;
    this.fill.color.copy(p.hemS); this.fill.intensity = 0.28 * this.day + 0.10;
    const u = this.uniforms;
    u.uSunGlow.value = this.sunVis * (1 - oc * 0.8) * (p.sunI > 0.01 || this.sunDir.y > -0.1 ? 1 : 0);
    u.uNight.value = p.night * (1 - oc * 0.85);
    u.uCover.value = clamp(this.cover + oc * 0.5, 0, 0.98);
    this.exposure = p.exp;
    this.scene.fog.color.copy(p.fog);
    this.scene.fog.density = this.fogBase * this.fogMul * (1 + oc * 1.4);
  }

  update(dt, camera, travel = 0) {
    this.elapsed += dt;
    if (this.flow) this.time = (this.time + dt * this.rate * this.flow) % 24;
    this._computePalette();
    const u = this.uniforms;
    u.uTime.value = this.elapsed;
    // 云随风飘 + 随行进产生一点视差
    this.cloudOff.set(3.1 + this.elapsed * 0.006, 1.7 + this.elapsed * 0.0025 - travel * 0.00012);
    u.uRainbow.value = this.rainbow * this.sunVis * clamp(1 - this.sunDir.y * 1.2);
    u.uAurora.value = this.aurora * this.night;
    u.uFlash.value = this.flash;
    // 月相缓慢变化
    u.uMoonPhase.value = 0.9 + this.elapsed * 0.004;
    // 流星
    const m = this.meteor;
    if (m.t < 1) { m.t += dt * 1.4; u.uMeteorT.value = m.t; }
    else if (this.night > 0.8) {
      m.cd -= dt;
      if (m.cd <= 0) {
        m.cd = 5 + Math.random() * 14; m.t = 0;
        const a = (Math.random() - 0.5) * 2.2 + Math.PI, e = 0.35 + Math.random() * 0.6;
        const A = u.uMeteorA.value.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
        u.uMeteorB.value.set(A.x + (Math.random() - 0.5) * 0.5, A.y - 0.22 - Math.random() * 0.15, A.z + (Math.random() - 0.5) * 0.3).normalize();
      }
    }
    // 天穹跟随相机
    this.mesh.matrix.makeScale(1, 1, 1);
    this.mesh.matrixWorld.copy(this.mesh.matrix);
  }

  // 让阴影相机跟住目标
  aimLights(target) {
    const L = this.lightDir;
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(L, 120);
    this.sun.target.updateMatrixWorld();
    this.fill.target.position.copy(target);
    this.fill.position.set(target.x - L.x * 30, target.y + 14, target.z + 40);
    this.fill.target.updateMatrixWorld();
  }

  get clock() { const h = Math.floor(this.time), m = Math.floor((this.time - h) * 60); return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m; }
}
