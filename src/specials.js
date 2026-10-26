import * as THREE from 'three';
import { CHAR, BALL } from './config.js';

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
    // lightning bolt: a jagged line from the ball back along its path
    const n = 18;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.bolt = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xbff4ff, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }));
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
    const ball = game.ball, type = ball.specialType, def = type ? CHAR[type] : null;
    // ---- the ball ----
    const on = !!def;
    this.aura.visible = this.core.visible = on;
    ball.trail.tint = on ? this._c.set(def.color) : null;
    ball.trail.wide = on ? (type === 'cannon' ? 3 : 2.2) : 1;
    let ballVisible = true;
    if (on) {
      const p = ball.pos;
      const pulse = 1 + 0.18 * Math.sin(this.t * 40);
      this.aura.position.copy(p); this.core.position.copy(p);
      this.aura.material.color.set(def.color); this.core.material.color.set(def.color);
      this.aura.scale.setScalar(pulse * (type === 'cannon' ? 1.5 : 1));
      this.core.material.opacity = type === 'phantom' ? 0.25 : 0.5;
      if (type === 'phantom') ballVisible = Math.sin(this.t * 26) > 0.55;     // flickers in and out
      this.aura.visible = this.core.visible = ballVisible;
      // particles streaming off it
      const kind = PARTS[type], v = ball.vel, sp = Math.hypot(v.x, v.z) || 1;
      const n = type === 'phantom' ? 2 : type === 'cannon' ? 6 : 5;
      if (ballVisible || type !== 'phantom') this.particles.burst(p, { x: -v.x / sp, z: -v.z / sp }, n, 2.6, kind, type === 'cannon' ? 0.3 : 0.2);
      if (type === 'gale' && Math.random() < 0.5) this.particles.burst(p, { x: v.z / sp, z: -v.x / sp }, 2, 3, 'wind', 0.08);
    }
    ball.root.visible = ballVisible;
    ball.root.scale.setScalar(on && type === 'cannon' ? 1.35 : 1);
    // ---- the lightning bolt ----
    this.hist.unshift(ball.pos.clone()); if (this.hist.length > 18) this.hist.length = 18;
    const bolting = type === 'thunder';
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
