// 镜头：追随 / 侧拍 / 电影运镜 / 第一视角 / 自由环绕 / 标题与车库机位
import * as THREE from 'three';
import { clamp, lerp, damp, smooth } from './util.js';

const _p = new THREE.Vector3(), _l = new THREE.Vector3();
export const CAM_ORDER = ['chase', 'side', 'cine', 'pov', 'orbit'];

export class CameraRig {
  constructor(camera, dom) {
    this.cam = camera; this.mode = 'title';
    this.pos = new THREE.Vector3(0, 3, 8); this.look = new THREE.Vector3(0, 1, -5); this.fov = 58;
    this.cut = true; this.trauma = 0; this.shakeOn = true;
    this.orbit = { yaw: 0.9, pitch: 0.22, r: 6.5, auto: true, drag: false };
    this.cine = { i: 0, t: 0, dur: 7 };
    this.time = 0;
    let lx = 0, ly = 0;
    dom.addEventListener('pointerdown', (e) => { if (!this.canOrbit()) return; this.orbit.drag = true; this.orbit.auto = false; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('pointermove', (e) => {
      if (!this.orbit.drag) return;
      this.orbit.yaw -= (e.clientX - lx) * 0.006; this.orbit.pitch = clamp(this.orbit.pitch + (e.clientY - ly) * 0.005, -0.08, 1.35);
      lx = e.clientX; ly = e.clientY;
    });
    window.addEventListener('pointerup', () => { this.orbit.drag = false; });
    dom.addEventListener('wheel', (e) => { if (!this.canOrbit()) return; this.orbit.r = clamp(this.orbit.r * (1 + Math.sign(e.deltaY) * 0.1), 2.2, 40); }, { passive: true });
  }
  canOrbit() { return this.mode === 'orbit' || this.mode === 'title' || this.mode === 'garage'; }
  set(mode) { if (mode === this.mode) return; this.mode = mode; this.cut = true; if (mode === 'title') { this.orbit.auto = true; this.orbit.r = 6.2; this.orbit.pitch = 0.2; } if (mode === 'garage') { this.orbit.yaw = 2.55; this.orbit.pitch = 0.16; this.orbit.r = 4.3; this.orbit.auto = false; } if (mode === 'orbit') { this.orbit.r = 7; this.orbit.pitch = 0.25; } }
  shake(a) { this.trauma = Math.min(1, this.trauma + a); }

  // p: {x, gy(地面高度), air(离地), dist, lat, speedN, boost, head(Vector3 世界), track}
  update(dt, p) {
    this.time += dt;
    const tr = p.track, d = p.dist, o = this.orbit;
    let fov = 58, lam = 7;
    const P = _p, L = _l;
    switch (this.mode) {
      case 'chase': {
        const back = 5.3 - p.speedN * 0.4 + p.boost * 0.9;
        P.set(tr.cx(d - back) + p.lat * 0.74, tr.cy(d - back) + 2.55 + p.air * 0.45, back);
        L.set(tr.cx(d + 10) + p.lat * 0.5, tr.cy(d + 10) + 1.45 + p.air * 0.5, -10);
        fov = 60 + p.speedN * 9 + p.boost * 11; lam = 6;
        break;
      }
      case 'side': {
        P.set(tr.cx(d) + 4.4, p.gy + 1.45 + p.air * 0.3, -1.4); L.set(p.x, p.gy + 1.2 + p.air * 0.6, -0.8); fov = 54; lam = 9;
        break;
      }
      case 'pov': {
        P.copy(p.head); P.y += 0.16; P.z += 0.12;
        L.set(tr.cx(d + 26) + p.lat * 0.5, tr.cy(d + 26) + 1.4, -26); fov = 78 + p.boost * 8; lam = 30;
        break;
      }
      case 'cine': {
        const c = this.cine; c.t += dt;
        if (c.t > c.dur) { c.t = 0; c.i = (c.i + 1 + ((Math.random() * 3) | 0)) % 7; c.dur = 5.5 + Math.random() * 4; this.cut = true; }
        const k = c.t / c.dur, x = p.x, y = p.gy, a = p.air;
        switch (c.i) {
          case 0: P.set(x + 2.6 - k * 0.8, y + 0.8, -5.2 + k * 1.5); L.set(x, y + 1.25 + a * 0.6, 0); fov = 42; break;                 // 低机位前侧
          case 1: P.set(x - 9 + k * 3, y + 9 - k * 2, 11 - k * 3); L.set(x, y + 1 + a, -5); fov = 50; break;                       // 航拍
          case 2: P.set(x + 1.7, y + 0.42, 1.9 - k * 1.2); L.set(x, y + 0.75 + a, -0.2); fov = 50; break;                           // 车轮特写
          case 3: P.set(x + 11, y + 2.2 + k, -3 + k * 4); L.set(x, y + 1.2 + a * 0.7, -0.5); fov = 30; break;                       // 长焦侧拍
          case 4: P.set(x + 0.9 - k * 1.8, y + 2.0, -3.4); L.set(x, y + 1.7 + a, 0.1); fov = 44; break;                             // 正面脸部
          case 5: { const an = 2.2 + k * 2.4; P.set(x + Math.sin(an) * 5.2, y + 1.9, Math.cos(an) * 5.2); L.set(x, y + 1.2 + a * 0.7, 0); fov = 50; break; } // 环绕
          default: P.set(tr.cx(d + 34 - k * 22) + 3.4, tr.cy(d + 34 - k * 22) + 1.0, -34 + k * 22); L.set(x, y + 1.2 + a, 0); fov = 38; // 迎面驶来
        }
        lam = 5;
        break;
      }
      case 'garage': case 'title': case 'orbit': default: {
        if (o.auto) o.yaw += dt * (this.mode === 'title' ? 0.11 : 0.08);
        const cp = Math.cos(o.pitch);
        const tx = this.mode === 'garage' ? p.x + 0.55 : this.mode === 'title' ? p.x + 0.0 : p.x;
        L.set(tx, p.gy + 1.15 + p.air * 0.7, this.mode === 'garage' ? -0.35 : 0);
        P.set(L.x + Math.sin(o.yaw) * cp * o.r, L.y + Math.sin(o.pitch) * o.r, L.z + Math.cos(o.yaw) * cp * o.r);
        fov = this.mode === 'garage' ? 40 : 50; lam = 12;
      }
    }
    // 不钻进地形
    {
      const s = d - P.z, u = P.x - tr.cx(s);
      const g = tr.terrainH(u, s, tr.params(s, this._tp || (this._tp = {})), tr.cy(s));
      if (P.y < g + 0.45) P.y = g + 0.45;
      if (P.y < 0.6) P.y = 0.6; // 不钻进海里
    }
    if (this.cut) { this.pos.copy(P); this.look.copy(L); this.fov = fov; this.cut = false; }
    else {
      const k = 1 - Math.exp(-lam * dt);
      this.pos.lerp(P, k); this.look.lerp(L, 1 - Math.exp(-lam * 1.3 * dt)); this.fov = damp(this.fov, fov, 4, dt);
    }
    const cam = this.cam;
    cam.position.copy(this.pos);
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    if (this.shakeOn && this.trauma > 0.001) {
      const s = this.trauma * this.trauma, t = this.time * 38;
      cam.position.x += Math.sin(t * 1.3) * 0.22 * s; cam.position.y += Math.sin(t * 1.7 + 1) * 0.18 * s;
    }
    cam.lookAt(this.look);
    if (this.shakeOn && this.trauma > 0.001) cam.rotation.z += Math.sin(this.time * 47) * 0.03 * this.trauma * this.trauma;
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }
}
