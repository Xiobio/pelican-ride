// 入口：组装各系统并驱动主循环
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Gfx } from './gfx.js';
import { Sky } from './sky.js';
import { Ocean } from './ocean.js';
import { World } from './world.js';
import { Track, ZONES } from './track.js';
import { Pelican } from './pelican.js';
import { Particles } from './particles.js';
import { Entities } from './entities.js';
import { Ambient } from './ambient.js';
import { AudioSys } from './audio.js';
import { Input } from './input.js';
import { Save } from './save.js';
import { CameraRig } from './camera.js';
import { UI } from './ui.js';
import { Game } from './game.js';
import { clamp } from './util.js';

function boot() {
  const test = document.createElement('canvas');
  if (!test.getContext('webgl2')) { document.getElementById('fallback').hidden = false; document.getElementById('fade').classList.add('clear'); return; }

  const save = new Save();
  const q = save.d.settings.quality;
  const gfx = new Gfx(document.getElementById('app'), q);
  const scene = gfx.scene;
  const pm = new THREE.PMREMGenerator(gfx.renderer);
  const env = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();

  const sky = new Sky(scene, q);
  const ocean = new Ocean(scene, sky, q);
  const world = new World(scene, sky, q);
  const track = new Track(1);
  world.setTrack(track);
  const fx = new Particles(world.root, scene);
  const entities = new Entities(world.root, world.props, env);
  const pelican = new Pelican(scene, env);
  pelican.applyCosmetics(save.d.equip);
  const ambient = new Ambient(scene, world, sky, ocean, fx);
  const audio = new AudioSys();
  const input = new Input();
  const cam = new CameraRig(gfx.camera, gfx.renderer.domElement);
  const ui = new UI({ save, audio, input, gfx, sky, pelican, cam });
  const game = new Game({ track, world, entities, pelican, fx, audio, input, save, ui, sky, ambient, cam, gfx, ocean });
  ui.bind(game);
  game.attract();

  const head = new THREE.Vector3(), target = new THREE.Vector3();
  let last = performance.now(), time = 0, fpsT = 0, fpsN = 0, lowT = 0, fpsShown = 60;
  const G = gfx.grade ? null : null;

  function frame(now) {
    requestAnimationFrame(frame);
    const rawDt = Math.min(0.05, Math.max(0.0005, (now - last) / 1000)); last = now;
    if (!window.__noLoop) tick(rawDt, true);
  }
  function tick(rawDt, render) {
    input.pollPad();
    ui.keys();
    const dt = game.update(rawDt);
    const p = game.p, o = game.out, st = game.state;
    time += dt;
    if (game.needWarm) { world.update(p.dist, 0, time, 40); game.needWarm = false; }
    world.update(p.dist, dt, time, 1);
    entities.update(dt, time, p.dist);
    if (dt > 0) pelican.update(dt, o);
    const zoneKey = p.zoneKey;
    ambient.update(dt, time, p.dist, gfx.camera, zoneKey, p.speed, o.x, o.y);
    for (const ev of ambient.events) {
      if (ev.type === 'whale') { audio.whale(); if (st === 'play') { game.R.whale = true; ui.toast('🐋', '鲸鱼！', '快看海面'); } }
      else if (ev.type === 'whaleSplash') { audio.bigSplash(); cam.shake(0.25); if (st === 'play') entities.spawnFlying(p.dist + 20 + p.speed, 8, 0.3); }
      else if (ev.type === 'firework') audio.firework();
      else if (ev.type === 'dolphin' && st === 'play') ui.toast('🐬', '海豚来伴游了', '');
    }
    ambient.events.length = 0;

    // 镜头
    pelican.headWorld(head);
    const gy = track.cy(p.dist);
    cam.update(rawDt, { x: o.x, gy, air: p.y, dist: p.dist, lat: p.lat, speedN: clamp(p.speed / 16), boost: p.boosting ? 1 : 0, head, track });

    // 天空 / 海 / 粒子
    sky.update(st === 'pause' ? 0 : dt, gfx.camera, p.dist);
    sky.aimLights(target.set(o.x, gy, -8));
    ocean.update(time, p.dist, track, game.weather.rain);
    const uScale = gfx.height / (2 * Math.tan(gfx.camera.fov * Math.PI / 360));
    world.uniforms.uScale.value = uScale;
    const light = clamp(sky.pal.hemI * 0.55 + sky.sun.intensity * 0.26, 0.12, 1.25);
    fx.update(dt, time, uScale, light, game.weather.rain, p.speed);
    pelican.setEnvIntensity(0.22 + 0.78 * sky.day * (1 - game.weather.rain * 0.5));
    entities.uSelf.value = sky.night * 0.2;
    entities.M.halo.opacity = 0.32 - sky.night * 0.2; entities.M.ring.emissiveIntensity = 0.5 - sky.night * 0.3; entities.M.gold.emissiveIntensity = 0.7 - sky.night * 0.3;
    entities.M.gloss.envMapIntensity = 0.2 + 0.5 * sky.day; entities.M.bubble.envMapIntensity = 0.2 + 0.4 * sky.day; entities.M.puddle.envMapIntensity = 0.2 + 0.35 * sky.day;

    // 后期
    const gu = gfx.grade.uniforms;
    gu.uTime.value = time;
    gu.uSpeed.value += ((p.boosting ? 0.9 : 0) - gu.uSpeed.value) * Math.min(1, rawDt * 5);
    gu.uAb.value = gu.uSpeed.value * 0.02 + cam.trauma * 0.02;
    gu.uFever.value += ((p.feverT > 0 ? 1 : 0) - gu.uFever.value) * Math.min(1, rawDt * 4);
    gu.uFlash.value = sky.flash * 0.06;
    gu.uSat.value = 1.06 - game.weather.rain * 0.18 + (st === 'over' || st === 'dying' ? -0.45 : 0) * 1;
    gu.uVig.value = 0.3 + (st === 'over' ? 0.25 : 0);
    gfx.renderer.toneMappingExposure = sky.exposure;
    if (gfx.bloom) gfx.bloom.strength = gfx.bloomStrength * (1 + sky.night * 0.35);

    // 声音
    const speedN = clamp(p.speed / 17);
    audio.update(rawDt, {
      speed: speedN, coast: game.coasting ? 1 : 0, boost: p.boosting ? 1 : 0, rain: game.weather.rain, night: sky.night,
      intensity: clamp(0.3 + speedN * 0.35 + Math.min(1, p.combo / 40) * 0.25 + (p.feverT > 0 ? 0.3 : 0) + (p.boosting ? 0.15 : 0)),
      fever: p.feverT > 0 ? 1 : 0, menu: st === 'title' || st === 'garage', air: p.grounded ? 0 : 1, paused: st === 'pause', muffle: st === 'over' || st === 'dying' || st === 'pause',
    });

    ui.hud(rawDt);
    ui.setZoneName(ZONES[zoneKey].name);
    if (render) gfx.render();
    input.endFrame();

    // 帧率统计 + 自动降画质
    fpsT += rawDt; fpsN++;
    if (fpsT >= 0.5) {
      fpsShown = Math.round(fpsN / fpsT); fpsT = 0; fpsN = 0;
      ui.setFps(fpsShown, `${gfx.renderer.info.render.calls} calls · ${(gfx.renderer.info.render.triangles / 1000).toFixed(0)}k tris`);
      if (fpsShown < 28 && !document.hidden) { lowT += 0.5; if (lowT >= 5 && gfx.quality > 0) { lowT = 0; const nq = gfx.quality - 1; save.d.settings.quality = nq; gfx.setQuality(nq); sky.setQuality(nq); save.flush(); ui.toast('⚙️', '已自动降低画质', '可在设置里改回来'); [...document.getElementById('qualitySeg').children].forEach((c, j) => c.classList.toggle('on', j === nq)); } }
      else lowT = Math.max(0, lowT - 0.25);
    }
  }
  requestAnimationFrame(frame);
  window.__g = { tick, game, sky, world, entities, pelican, cam, gfx, ui, save, audio, ambient, track, fx, ocean, input };
}
boot();
