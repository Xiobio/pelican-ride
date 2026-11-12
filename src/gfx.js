// 渲染器 + 后期（泛光、调色、径向速度感）
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { L } from './i18n.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uVig: { value: 0.32 }, uAb: { value: 0 }, uSat: { value: 1.06 }, uSpeed: { value: 0 },
    uFlash: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) }, uFever: { value: 0 }, uTime: { value: 0 }, uHurt: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uVig, uAb, uSat, uSpeed, uFlash, uFever, uTime, uHurt; uniform vec3 uTint;
    varying vec2 vUv;
    vec3 hue(float t){ return clamp(vec3(abs(t*6.0-3.0)-1.0, 2.0-abs(t*6.0-2.0), 2.0-abs(t*6.0-4.0)), 0.0, 1.0); }
    void main(){
      vec2 c = vUv - 0.5; float r2 = dot(c, c);
      vec3 col;
      if (uAb > 0.001) { vec2 o = c * r2 * uAb; col = vec3(texture2D(tDiffuse, vUv - o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + o).b); }
      else col = texture2D(tDiffuse, vUv).rgb;
      if (uSpeed > 0.01) {
        vec3 acc = col;
        for (int i = 1; i <= 5; i++) acc += texture2D(tDiffuse, vUv - c * r2 * uSpeed * float(i) * 0.07).rgb;
        col = acc / 6.0;
      }
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col *= uTint;
      if (uFever > 0.01) {
        float edge = smoothstep(0.08, 0.5, r2 * 1.6);
        vec3 rb = hue(fract(atan(c.y, c.x) / 6.2832 + uTime * 0.25));
        col += rb * edge * uFever * 0.22 * (0.4 + l);
      }
      col *= 1.0 - uVig * smoothstep(0.1, 0.9, r2 * 2.0);
      col = mix(col, vec3(0.9, 0.08, 0.1) * (0.3 + l), uHurt * smoothstep(0.05, 0.5, r2 * 1.3));
      col += uFlash;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export const QUALITY = [
  { name: L('流畅', "Low"), dpr: 1.0, msaa: 0, bloom: false },
  { name: L('均衡', "Medium"), dpr: 1.25, msaa: 2, bloom: true },
  { name: L('精美', "High"), dpr: 1.5, msaa: 4, bloom: true },
  { name: L('极致', "Ultra"), dpr: 2.0, msaa: 4, bloom: true },
];

export class Gfx {
  constructor(container, quality = 2) {
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.info.autoReset = false;
    container.appendChild(renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.12, 4000);
    this.quality = -1;
    this.bloomStrength = 0.42;
    this.setQuality(quality);
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q) {
    q = Math.max(0, Math.min(3, q | 0));
    this.quality = q;
    const Q = QUALITY[q];
    this.dpr = Math.min(window.devicePixelRatio || 1, Q.dpr);
    this.renderer.setPixelRatio(this.dpr);
    if (this.composer) { this.composer.passes.forEach(p => p.dispose && p.dispose()); this.composer.dispose(); }
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    const rt = new THREE.WebGLRenderTarget(Math.max(2, w * this.dpr), Math.max(2, h * this.dpr), { type: THREE.HalfFloatType, samples: Q.msaa });
    const composer = this.composer = new EffectComposer(this.renderer, rt);
    composer.setPixelRatio(this.dpr); composer.setSize(w, h);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = null;
    if (Q.bloom) { this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), this.bloomStrength, 0.6, 1.3); composer.addPass(this.bloom); }
    this.grade = new ShaderPass(GradeShader); composer.addPass(this.grade);
    composer.addPass(new OutputPass());
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.height = h * this.dpr;
  }

  render() { this.renderer.info.reset(); this.composer.render(); }

  // 截图：渲染一帧并导出 PNG
  screenshot(cb) { this.render(); this.renderer.domElement.toBlob(cb, 'image/png'); }
}
