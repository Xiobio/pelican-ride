// 输入：键盘 + 触屏 + 手柄，统一成一组状态与“刚按下”事件
const MAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'jump', KeyT: 'trick', KeyJ: 'trick', ShiftLeft: 'boost', ShiftRight: 'boost', KeyE: 'boost',
  KeyB: 'bell', KeyH: 'honk', KeyC: 'cam', KeyP: 'pause', Escape: 'pause', KeyM: 'music', KeyK: 'shot', KeyF: 'full', KeyU: 'hideui', KeyN: 'time', KeyR: 'restart', Enter: 'ok',
};

export class Input {
  constructor() {
    this.down = {}; this.pressed = {}; this.padDown = {}; this.enabled = true;
    this.lastInput = performance.now();
    window.addEventListener('keydown', (e) => {
      const a = MAP[e.code]; if (!a) return;
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (['up', 'down', 'left', 'right', 'jump'].includes(a)) e.preventDefault();
      if (!this.down[a]) this.pressed[a] = true;
      this.down[a] = true; this.lastInput = performance.now();
    });
    window.addEventListener('keyup', (e) => { const a = MAP[e.code]; if (a) this.down[a] = false; });
    window.addEventListener('blur', () => { this.down = {}; });
  }
  // 绑定触屏按钮：data-key 为持续按住，data-tap 为点按
  bindTouch(root) {
    root.querySelectorAll('[data-key]').forEach((el) => {
      const k = el.dataset.key;
      const on = (e) => { e.preventDefault(); if (!this.down[k]) this.pressed[k] = true; this.down[k] = true; el.classList.add('on'); this.lastInput = performance.now(); };
      const off = (e) => { e.preventDefault(); this.down[k] = false; el.classList.remove('on'); };
      el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
    });
  }
  held(a) { return !!(this.down[a] || this.padDown[a]); }
  press(a) { this.pressed[a] = true; this.lastInput = performance.now(); }
  take(a) { if (this.pressed[a]) { this.pressed[a] = false; return true; } return false; }
  get steer() { return Math.max(-1, Math.min(1, (this.down.right ? 1 : 0) - (this.down.left ? 1 : 0) + this.padX)); }
  get throttle() { return (this.down.up ? 1 : 0) - (this.down.down ? 1 : 0); }
  get idle() { return (performance.now() - this.lastInput) / 1000; }
  // 手柄
  pollPad() {
    this.padX = 0;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const x = p.axes[0] || 0; if (Math.abs(x) > 0.18) { this.padX = x; this.lastInput = performance.now(); }
      const b = (i) => p.buttons[i] && p.buttons[i].pressed;
      const set = (name, v) => { if (v && !this.padDown[name]) { this.pressed[name] = true; this.lastInput = performance.now(); } this.padDown[name] = !!v; };
      set('jump', b(0)); set('trick', b(2)); set('boost', b(1) || b(7)); set('bell', b(3)); set('honk', b(4)); set('pause', b(9));
      break;
    }
  }
  endFrame() { this.pressed = {}; }
}
Input.prototype.padX = 0;
