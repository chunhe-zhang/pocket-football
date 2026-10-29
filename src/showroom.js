import * as THREE from 'three';
import { CHARS } from './config.js';
import { Character } from './character.js';

// The character picker's live 3D cards. One small extra renderer draws each character in turn into
// its own off-screen canvas, and every card copies its picture out with drawImage. Each character
// wears a kit in its own colour, breathes in its idle pose and the selected one slowly turns round
// and celebrates when it's picked.

const W = 150, H = 190;

export class Showroom {
  constructor(template) {
    this.template = template;
    this.dpr = Math.min(2, devicePixelRatio || 1);
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power', preserveDrawingBuffer: false });
    } catch { this.renderer = null; return; }
    const r = this.renderer;
    r.setPixelRatio(this.dpr); r.setSize(W, H, false);
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.1;
    r.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xf4f8ff, 0x8a7aa0, 1.5));
    const key = new THREE.DirectionalLight(0xfff4e6, 2.4); key.position.set(-2, 4, 5); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xc8d8ff, 1.6); rim.position.set(3, 3, -4); this.scene.add(rim);
    this.camera = new THREE.PerspectiveCamera(24, W / H, 0.1, 30);
    this.models = new Map();   // id -> { ch, x, yaw, spin }
    this.t = 0; this.frame = 0;
    this.selected = null;
  }

  /** build each character's display model the first time it's needed */
  _model(id) {
    let m = this.models.get(id);
    if (m) return m;
    const def = CHARS.find((c) => c.id === id);
    const kit = { shirt: def.css, shorts: '#262236', number: '#ffffff', no: String(CHARS.indexOf(def) + 1), hair: null, outline: 0x1b1630, characterId: id };
    const ch = new Character(this.template, kit);
    ch.setHair(def.hair); ch.setStyle(id);
    const x = this.models.size * 6;             // each on its own spot, far enough apart to never overlap a view
    ch.group.position.set(x, 0, 0);
    ch.setFacing(0);
    // a soft round shadow and a ring in the character's colour to stand on
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2; disc.position.set(x, 0.002, 0);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.52, 40), new THREE.MeshBasicMaterial({ color: def.css, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.004, 0);
    this.scene.add(ch.group, disc, ring);
    m = { ch, x, yaw: 0.35, ring };
    this.models.set(id, m);
    return m;
  }

  select(id, cheer = false) {
    const changed = this.selected !== id;
    this.selected = id;
    const m = this._model(id);
    if (cheer && changed) { m.ch.play(['fistPump', 'celebrate', 'airplane'][Math.floor(Math.random() * 3)]); m.ch.expr?.set?.('happy', 1); m.happyT = 1.8; }
  }

  /** draw every visible card; called once per frame while a picker is on screen */
  update(dt, cards) {
    if (!this.renderer || !cards.length) return;
    this.t += dt; this.frame++;
    const r = this.renderer;
    cards.forEach((cv, i) => {
      const id = cv.dataset.c, sel = id === this.selected;
      // the picked card animates every frame, the rest take turns (keeps phones cool)
      if (!sel && cv._drawn && (this.frame + i) % 3) return;
      const m = this._model(id);
      const step = sel ? dt : dt * 3;
      m.yaw = sel ? m.yaw + step * 0.8 : m.yaw + (0.35 - m.yaw) * Math.min(1, step * 3);
      m.ch.setFacing(m.yaw);
      if (m.happyT > 0 && (m.happyT -= step) <= 0) m.ch.expr?.set?.('happy', 0);
      m.ch.update(step, { speed: 0 });
      m.ring.material.opacity = sel ? 0.65 + 0.3 * Math.sin(this.t * 4) : 0.35;
      const c = this.camera;
      c.position.set(m.x, 1.05, 4.25); c.lookAt(m.x, 0.84, 0);
      r.render(this.scene, c);
      const ctx = cv._ctx || (cv._ctx = cv.getContext('2d'));
      if (cv.width !== W * this.dpr) { cv.width = W * this.dpr; cv.height = H * this.dpr; }
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(r.domElement, 0, 0, cv.width, cv.height);
      cv._drawn = true;
    });
  }
}
