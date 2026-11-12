// 存档（localStorage）：钱包、最高分、成就、任务、装扮、设置
import { MISSIONS } from './data.js';
import { todayKey } from './util.js';

const KEY = 'pelicanRide.save.v1';
const DEF = () => ({
  v: 1, fish: 0,
  best: { adventure: 0, daily: 0, dist: 0 }, dailyDate: '',
  total: { fish: 0, dist: 0, runs: 0, tricks: 0, missions: 0, bought: 0, gold: 0 },
  ach: {}, missions: [], missionSeq: 0,
  owned: { hat: ['helmet'], glasses: ['none'], scarf: ['red'], paint: ['teal'], trail: ['none'] },
  equip: { hat: 'helmet', glasses: 'none', scarf: 'red', paint: 'teal', trail: 'none' },
  up: { magnet: 0, helmet: 0, chili: 0, appetite: 0, radar: 0 },
  settings: { quality: 2, master: 0.8, music: 0.6, sfx: 0.9, musicOn: true, shake: true, fps: false, hints: true },
  seen: {},
});

export class Save {
  constructor() {
    this.d = DEF();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const o = JSON.parse(raw); this._merge(this.d, o); }
    } catch (e) { /* 隐私模式等：仅本次会话有效 */ }
    if (this.d.dailyDate !== todayKey()) { this.d.dailyDate = todayKey(); this.d.best.daily = 0; }
    while (this.d.missions.length < 3) this.addMission();
    this.flush();
  }
  _merge(dst, src) {
    for (const k in src) {
      if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) this._merge(dst[k], src[k]);
      else dst[k] = src[k];
    }
  }
  flush() { try { localStorage.setItem(KEY, JSON.stringify(this.d)); } catch (e) { /* ignore */ } }
  reset() { this.d = DEF(); while (this.d.missions.length < 3) this.addMission(); this.flush(); }

  addMission() {
    const d = this.d, active = new Set(d.missions.map(m => m.id));
    const pool = MISSIONS.filter(m => !active.has(m.id));
    const seq = d.missionSeq++;
    // 伪随机但稳定：序号决定模板，完成越多目标越高
    const tpl = pool[(seq * 7 + 3) % pool.length];
    const tier = Math.min(tpl.goals.length - 1, Math.floor(d.total.missions / 4 + (seq % 2)));
    const goal = tpl.goals[tier];
    d.missions.push({ id: tpl.id, goal, prog: 0, reward: 100 + tier * 80 + (tpl.kind === 'run' ? 40 : 0), done: false });
  }
  owns(cat, id) { return this.d.owned[cat].includes(id); }
}
