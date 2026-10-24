// Keyboard + touch input, converted into per-player "intents".
// Screen up = world -z, screen right = world +x (broadcast camera on the +z side).

const SCHEMES = {
  solo: { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], kick: ['Space', 'KeyJ'], lob: ['KeyK'], sprint: ['ShiftLeft', 'ShiftRight'] },
  p1: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], kick: ['KeyF', 'Space'], lob: ['KeyG'], sprint: ['ShiftLeft'] },
  p2: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], kick: ['Enter', 'NumpadEnter'], lob: ['Slash', 'Numpad0'], sprint: ['ShiftRight', 'Period'] },
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { active: false, x: 0, y: 0, kick: false, lob: false, sprint: false };
    this.pressed = new Set(); // keys pressed since last frame (for menus / toggles)
    const block = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash']);
    addEventListener('keydown', (e) => {
      if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
      if (block.has(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); });
  }

  any(list) { return list.some((k) => this.keys.has(k)); }

  wasPressed(code) { return this.pressed.has(code); }
  endFrame() { this.pressed.clear(); }

  intent(scheme, out) {
    const s = SCHEMES[scheme];
    let x = (this.any(s.right) ? 1 : 0) - (this.any(s.left) ? 1 : 0);
    let z = (this.any(s.down) ? 1 : 0) - (this.any(s.up) ? 1 : 0);
    let kick = this.any(s.kick), lob = this.any(s.lob), sprint = this.any(s.sprint);
    if (scheme !== 'p2' && this.touch.active) {
      x = this.touch.x; z = this.touch.y;
    }
    if (scheme !== 'p2') {
      kick = kick || this.touch.kick; lob = lob || this.touch.lob; sprint = sprint || this.touch.sprint;
    }
    const m = Math.hypot(x, z);
    if (m > 1) { x /= m; z /= m; }
    out.move.set(x, z); out.kick = kick; out.lob = lob; out.sprint = sprint;
    return out;
  }

  /** Builds the on-screen joystick + buttons; only shown on touch devices. */
  attachTouch(root) {
    const stick = root.querySelector('#stick'), knob = root.querySelector('#knob');
    let id = null, cx = 0, cy = 0;
    const R = 56;
    const move = (t) => {
      let dx = t.clientX - cx, dy = t.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const mag = Math.min(1, d / R);
      this.touch.x = (dx / R); this.touch.y = (dy / R);
      this.touch.active = mag > 0.12;
    };
    stick.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0]; id = t.identifier;
      const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      move(t); e.preventDefault();
    }, { passive: false });
    stick.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) if (t.identifier === id) move(t);
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) if (t.identifier === id) {
        id = null; this.touch.active = false; this.touch.x = this.touch.y = 0; knob.style.transform = '';
      }
    };
    stick.addEventListener('touchend', end); stick.addEventListener('touchcancel', end);
    for (const [sel, key] of [['#btn-kick', 'kick'], ['#btn-lob', 'lob'], ['#btn-sprint', 'sprint']]) {
      const b = root.querySelector(sel);
      b.addEventListener('touchstart', (e) => { this.touch[key] = true; b.classList.add('down'); e.preventDefault(); }, { passive: false });
      const up = (e) => { this.touch[key] = false; b.classList.remove('down'); e.preventDefault(); };
      b.addEventListener('touchend', up); b.addEventListener('touchcancel', up);
    }
  }
}
