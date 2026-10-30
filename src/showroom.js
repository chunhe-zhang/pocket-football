import * as THREE from 'three';
import { CHARS } from './config.js';
import { Character } from './character.js';

// The character picker's live 3D cards. One small extra renderer draws each character in turn into
// its own off-screen canvas, and every card copies its picture out with drawImage. Each character
// wears a kit in its own colour, breathes in its idle pose and the selected one slowly turns round
// and celebrates when it's picked.

const W = 210, H = 266;

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
    ch.teleported(); // reset world-space hair tails after placing each display model
    ch.setFacing(0);
    ch.setPresentation(CHARS.indexOf(def));
    // a soft round shadow and a ring in the character's colour to stand on
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2; disc.position.set(x, 0.002, 0);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.52, 40), new THREE.MeshBasicMaterial({ color: def.css, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.004, 0);
    this.scene.add(ch.group, disc, ring);
    m = { ch, x, yaw: 0.18, ring, height: this.template.variants?.get(id)?.height || this.template.height };
    this.models.set(id, m);
    return m;
  }

  select(id, cheer = false) {
    const changed = this.selected !== id;
    this.selected = id;
    const m = this._model(id);
    if (cheer && changed) { m.ch.acknowledge(); m.ch.expr?.set?.('happy', 0.5); m.happyT = 1.8; }
  }

  /** draw every visible card; called once per frame while a picker is on screen */
  update(dt, cards) {
    if (!this.renderer || !cards.length) return;
    this.t += dt; this.frame++;
    const r = this.renderer;
    // A hero portrait and a card share a model. Advance it exactly once, at the
    // real frame delta; rendering fewer thumbnails must never slow its physics.
    for (const id of new Set(cards.map(cv => cv.dataset.c))) {
      const m = this._model(id), sel = id === this.selected;
      m.yaw += ((sel ? 0.18 : 0.28) - m.yaw) * (1 - Math.exp(-dt * 3));
      m.ch.setFacing(m.yaw);
      if (m.happyT > 0 && (m.happyT -= dt) <= 0) m.ch.expr?.set?.('happy', 0);
      m.ch.update(dt, { speed: 0 });
      m.ring.material.opacity = sel ? 0.72 + 0.08 * Math.sin(this.t * 1.2) : 0.35;
    }
    cards.forEach((cv, i) => {
      const id = cv.dataset.c, sel = id === this.selected;
      // the picked card animates every frame, the rest take turns (keeps phones cool)
      if (!sel && cv._drawn && (this.frame + i) % 3) return;
      const m = this._model(id);
      const c = this.camera;
      const scale = Math.max(1, m.height / 1.65);
      c.position.set(m.x, 1.05 * scale, 4.25 * scale); c.lookAt(m.x, m.height * 0.52, 0);
      // the cover's big stage portrait is drawn at a higher resolution than the little cards
      const hero = cv.classList.contains('hero-cv'), k = hero ? Math.min(3, Math.max(2, this.dpr * 1.6)) : this.dpr;
      if (hero) r.setPixelRatio(k);
      r.render(this.scene, c);
      const ctx = cv._ctx || (cv._ctx = cv.getContext('2d'));
      if (cv.width !== Math.round(W * k)) { cv.width = Math.round(W * k); cv.height = Math.round(H * k); }
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(r.domElement, 0, 0, cv.width, cv.height);
      if (hero) r.setPixelRatio(this.dpr);
      cv._drawn = true;
    });
  }
}
