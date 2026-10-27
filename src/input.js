// Keyboard + touch input, converted into per-player "intents".
// Screen up = world -z, screen right = world +x (broadcast camera on the +z side).

const SCHEMES = {
  solo: { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], kick: ['Space', 'KeyJ'], lob: ['KeyK'], sprint: ['ShiftLeft', 'ShiftRight'], tackle: ['KeyL', 'KeyE'], pass: ['KeyI', 'KeyQ'] },
  p1: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], kick: ['KeyF', 'Space'], lob: ['KeyG'], sprint: ['ShiftLeft'], tackle: ['KeyH'], pass: ['KeyR'] },
  p2: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], kick: ['Enter', 'NumpadEnter'], lob: ['Slash', 'Numpad0'], sprint: ['ShiftRight'], tackle: ['Period', 'Numpad1'], pass: ['Comma', 'Numpad2'] },
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { active: false, x: 0, y: 0, kick: false, lob: false, sprint: false, tackle: false, pass: false };
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

  /** standard-mapping gamepad: left stick moves, A shoots, B chips, X tackles, Y passes, RB/RT sprints */
  padIntent(index, out) {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    const p = pads[index];
    if (!p) { out.move.set(0, 0); out.kick = out.lob = out.sprint = out.tackle = out.pass = out.swap = false; return out; }
    let x = p.axes[0] || 0, z = p.axes[1] || 0;
    const m = Math.hypot(x, z);
    if (m < 0.2) { x = 0; z = 0; } else if (m > 1) { x /= m; z /= m; }
    // d-pad as a fallback
    const b = (i) => !!p.buttons[i]?.pressed;
    if (b(14)) x = -1; if (b(15)) x = 1; if (b(12)) z = -1; if (b(13)) z = 1;
    out.move.set(x, z); out.kick = b(0); out.lob = b(1); out.tackle = b(2); out.pass = b(3); out.swap = false; out.sprint = b(5) || b(7) || b(4) || b(6);
    out.analog = true;
    return out;
  }

  get padCount() { return navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean).length : 0; }

  intent(scheme, out) {
    if (scheme.startsWith('pad')) return this.padIntent(+scheme.slice(3), out);
    const s = SCHEMES[scheme];
    let x = (this.any(s.right) ? 1 : 0) - (this.any(s.left) ? 1 : 0);
    let z = (this.any(s.down) ? 1 : 0) - (this.any(s.up) ? 1 : 0);
    let kick = this.any(s.kick), lob = this.any(s.lob), sprint = this.any(s.sprint), tackle = this.any(s.tackle), pass = this.any(s.pass);
    let analog = false;
    if (scheme !== 'p2' && this.touch.active) {
      x = this.touch.x; z = this.touch.y; analog = true;
    }
    if (scheme !== 'p2') {
      kick = kick || this.touch.kick; lob = lob || this.touch.lob; sprint = sprint || this.touch.sprint; tackle = tackle || this.touch.tackle; pass = pass || this.touch.pass;
    }
    const m = Math.hypot(x, z);
    if (m > 1) { x /= m; z /= m; }
    out.move.set(x, z); out.kick = kick; out.lob = lob; out.sprint = sprint; out.tackle = tackle; out.pass = pass; out.swap = false;
    out.analog = analog;
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
    for (const [sel, key] of [['#btn-kick', 'kick'], ['#btn-lob', 'lob'], ['#btn-sprint', 'sprint'], ['#btn-tackle', 'tackle'], ['#btn-pass', 'pass']]) {
      const b = root.querySelector(sel);
      b.addEventListener('touchstart', (e) => { this.touch[key] = true; b.classList.add('down'); e.preventDefault(); }, { passive: false });
      const up = (e) => { this.touch[key] = false; b.classList.remove('down'); e.preventDefault(); };
      b.addEventListener('touchend', up); b.addEventListener('touchcancel', up);
    }
  }
}
