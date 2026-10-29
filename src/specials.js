import * as THREE from 'three';
import { CHAR, BALL, COMBOS } from './config.js';

// Looks of the characters' special shots: the glowing ball, its element trail and particles,
// a crackling bolt behind the lightning shot, ice blocks round frozen players, and a pulsing
// ring under everyone whose special is ready. Runs the same on host and guests: it only
// reads ball.specialType and each athlete's energy / iceT.

const R = BALL.r;
const PARTS = { thunder: 'bolt', blaze: 'fire', frost: 'ice', gale: 'wind', phantom: 'ghost', cannon: 'smoke' };

export class SpecialFx {
  constructor(scene, particles) {
    this.scene = scene; this.particles = particles;
    this.t = 0;
    // glow round the ball
    this.aura = new THREE.Mesh(new THREE.SphereGeometry(R * 2.6, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.aura.renderOrder = 4; this.aura.visible = false; scene.add(this.aura);
    this.core = new THREE.Mesh(new THREE.SphereGeometry(R * 1.35, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
    this.core.renderOrder = 4; this.core.visible = false; scene.add(this.core);
    this.core.material.userData.glow = true;
    // lightning bolt: a jagged line from the ball back along its path
    const n = 18;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.bolt = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xbff4ff, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }));
    this.bolt.material.userData.glow = true;
    this.bolt.frustumCulled = false; this.bolt.visible = false; this.bolt.renderOrder = 5; scene.add(this.bolt);
    this.bolt2 = this.bolt.clone(); this.bolt2.geometry = g.clone(); this.bolt2.material = this.bolt.material.clone(); this.bolt2.material.color.set(0x5fe1ff); scene.add(this.bolt2);
    this.hist = [];
    this.rings = []; this.ice = [];
    this._c = new THREE.Color();
  }

  _ring() {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.66, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.renderOrder = 2; m.visible = false;
    this.scene.add(m); return m;
  }

  _iceBlock() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xbfefff, transparent: true, opacity: 0.45, roughness: 0.05, metalness: 0.1, emissive: 0x7fd8ff, emissiveIntensity: 0.35, depthWrite: false });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.56, 1.95, 6), mat); body.position.y = 0.97; g.add(body);
    for (let k = 0; k < 5; k++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.55, 5), mat);
      const a = (k / 5) * Math.PI * 2;
      sp.position.set(Math.cos(a) * 0.5, 0.25 + (k % 2) * 0.9, Math.sin(a) * 0.5); sp.rotation.z = Math.cos(a) * 0.9; sp.rotation.x = -Math.sin(a) * 0.9;
      g.add(sp);
    }
    g.visible = false; g.renderOrder = 3;
    this.scene.add(g); return g;
  }

  update(dt, game) {
    this.t += dt;
    const ball = game.ball, type = ball.specialType;
    // a special shot: one element, or a combo ('a+b', a trailing '!' when more players than elements)
    const ids = type ? type.replace('!', '').split('+').filter((id) => CHAR[id]) : [];
    const strong = !!type && type.endsWith('!'), combo = ids.length > 1 || strong;
    const on = ids.length > 0;
    // which colour right now: a combo cycles through its elements
    const def = on ? CHAR[ids[Math.floor(this.t * 9) % ids.length]] : null;
    const pair = on && ids.length === 2 ? COMBOS[ids.join('+')] : null;
    const has = (id) => ids.includes(id);
    // a pass carrying elements: a lighter tint and a few sparks
    const pe = !on && ball.passEls ? ball.passEls.split('+').filter((id) => CHAR[id]) : [];
    this.aura.visible = this.core.visible = on;
    if (on) ball.trail.tint = this._c.set(def.color);
    else if (pe.length) ball.trail.tint = this._c.set(CHAR[pe[Math.floor(this.t * 6) % pe.length]].color);
    else ball.trail.tint = null;
    ball.trail.wide = on ? (has('cannon') || combo ? 3 : 2.2) * (ids.length >= 3 ? 1.3 : 1) : pe.length ? 1.4 : 1;
    let ballVisible = !ball.hidden;
    const big = on && (has('cannon') || (pair && pair.big) || ids.length >= 3);
    if (on) {
      const p = ball.pos;
      const pulse = 1 + 0.18 * Math.sin(this.t * 40);
      this.aura.position.copy(p); this.core.position.copy(p);
      this.aura.material.color.set(def.color); this.core.material.color.set(def.color).lerp(this._w || (this._w = new THREE.Color(1, 1, 1)), 0.35).multiplyScalar(1.1);   // a white-hot core: it burns in the glow
      this.aura.scale.setScalar(pulse * (big ? 1.5 : 1) * (combo ? 1.35 : 1) * (ids.length >= 3 ? 1.3 : 1));
      this.core.material.opacity = has('phantom') ? 0.25 : 0.5;
      // the phantom flickers in and out; the invisible combos all but disappear
      if (pair && pair.invis) ballVisible = ballVisible && Math.sin(this.t * 31) > 0.82;
      else if (has('phantom')) ballVisible = ballVisible && Math.sin(this.t * 26) > 0.55;
      this.aura.visible = this.core.visible = ballVisible;
      // particles streaming off it: every element of the move
      const v = ball.vel, sp = Math.hypot(v.x, v.z) || 1;
      if (!ball.hidden) for (const id of ids) {
        if (this.refinedElements) continue; // per-element shaders now track the actual ball
        const n = (id === 'phantom' ? 2 : id === 'cannon' ? 6 : 5) * (combo ? 1 : 1) / (ids.length > 2 ? 1.5 : 1);
        this.particles.burst(p, { x: -v.x / sp, z: -v.z / sp }, Math.max(1, Math.round(n)), combo ? 3.4 : 2.6, PARTS[id], id === 'cannon' ? 0.3 : 0.2);
      }
      if (has('gale') && Math.random() < 0.5) this.particles.burst(p, { x: v.z / sp, z: -v.x / sp }, 2, 3, 'wind', 0.08);
      // a decoy ball: ghosts either side of the real one
      if (pair && pair.decoy && Math.random() < 0.8) for (const s of [-1, 1]) this.particles.burst({ x: p.x + (v.z / sp) * 1.4 * s, y: p.y, z: p.z - (v.x / sp) * 1.4 * s }, { x: -v.x / sp, z: -v.z / sp }, 2, 1.5, 'ghost', 0.22);
      // auras: the ground under it shakes / freezes / burns as it flies
      if (pair && pair.aura && Math.random() < 0.6) this.particles.burst({ x: p.x, y: 0.15, z: p.z }, { x: 0, z: 0 }, 3, 3, pair.aura === 'freeze' ? 'ice' : pair.aura === 'quake' ? 'dust' : pair.aura === 'jolt' ? 'bolt' : 'fire', 0.25);
    } else if (pe.length && Math.random() < 0.7) {
      const v = ball.vel, sp = Math.hypot(v.x, v.z) || 1;
      if (sp > 3) this.particles.burst(ball.pos, { x: -v.x / sp, z: -v.z / sp }, 1, 1.6, PARTS[pe[Math.floor(Math.random() * pe.length)]], 0.12);
    }
    ball.root.visible = ballVisible;
    ball.root.scale.setScalar(big ? (pair && pair.big || ids.length >= 3 ? 1.6 : 1.35) : 1);
    // ---- the lightning bolt ----
    this.hist.unshift(ball.pos.clone()); if (this.hist.length > 18) this.hist.length = 18;
    const bolting = on && ids.includes('thunder') && ballVisible && !this.refinedLightning;
    this.bolt.visible = this.bolt2.visible = bolting;
    if (bolting) {
      for (const [line, j] of [[this.bolt, 0.22], [this.bolt2, 0.35]]) {
        const a = line.geometry.attributes.position.array;
        for (let i = 0; i < 18; i++) {
          const q = this.hist[Math.min(i, this.hist.length - 1)];
          const k = i === 0 ? 0 : j * Math.min(1, i / 4);
          a[i * 3] = q.x + (Math.random() - 0.5) * k; a[i * 3 + 1] = q.y + (Math.random() - 0.5) * k; a[i * 3 + 2] = q.z + (Math.random() - 0.5) * k;
        }
        line.geometry.attributes.position.needsUpdate = true;
      }
    }
    // ---- players: "special ready" rings and ice blocks ----
    const A = game.athletes;
    while (this.rings.length < A.length) this.rings.push(this._ring());
    while (this.ice.length < A.length) this.ice.push(this._iceBlock());
    for (let i = 0; i < this.rings.length; i++) {
      const a = A[i], ring = this.rings[i], ice = this.ice[i];
      const live = a && !a.out && game.state !== 'menu';
      const ready = false;   // every shot is a special now: no 'ready' ring
      ring.visible = ready;
      if (ready) {
        const d = a.charDef;
        ring.position.set(a.pos.x, 0.03, a.pos.z);
        ring.material.color.set(d.color);
        const k = 1 + 0.12 * Math.sin(this.t * 7 + i);
        ring.scale.setScalar(k);
        ring.material.opacity = 0.55 + 0.3 * Math.sin(this.t * 7 + i);
        if (Math.random() < dt * 6) this.particles.burst({ x: a.pos.x + (Math.random() - 0.5) * 0.8, y: 0.1, z: a.pos.z + (Math.random() - 0.5) * 0.8 }, { x: 0, z: 0 }, 1, 0.6, PARTS[d.id], 0.07);
      }
      // frozen players just stand still with a little frost drifting off them (no ice block)
      ice.visible = false;
      if (live && a.iceT > 0 && Math.random() < dt * 10) this.particles.burst({ x: a.pos.x + (Math.random() - 0.5) * 0.5, y: 0.3 + Math.random() * 1.4, z: a.pos.z + (Math.random() - 0.5) * 0.5 }, { x: 0, z: 0 }, 1, 0.4, 'ice', 0.07);
    }
  }
}
