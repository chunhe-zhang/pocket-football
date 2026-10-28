import * as THREE from 'three';
import { FIELD, BALL, goalIndexFor, clampToArena, OBSTACLES, halfOf, islandClosest, padAt, inShape, inOwnBox, comboOf, waveOff, waveSlope } from './config.js';

const { goalDepth: GD, postR } = FIELD;   // goal width / height come from the map (FIELD.goalHalfW / goalH)
const R = BALL.r;
const UP = new THREE.Vector3(0, 1, 0);

// Panel layout of a classic 32-panel ball (truncated icosahedron): 12 pentagon
// centres (icosahedron vertices) + 20 hexagon centres (icosahedron face centres).
function panelCentres() {
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const pos = ico.attributes.position, verts = [], faces = [];
  for (let i = 0; i < pos.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, i), b = new THREE.Vector3().fromBufferAttribute(pos, i + 1), c = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
    faces.push(a.clone().add(b).add(c).normalize());
    for (const v of [a, b, c]) if (!verts.some((u) => u.distanceTo(v) < 1e-3)) verts.push(v.clone().normalize());
  }
  return [...verts, ...faces];
}

function ballMaterial() {
  const centres = panelCentres();
  // every pentagon gets its own hue round the colour wheel; hexagons stay white
  const hues = centres.slice(0, 12).map((_, i) => new THREE.Color().setHSL(i / 12, 0.85, 0.56));
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.4, clearcoat: 0.85, clearcoatRoughness: 0.18 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uC = { value: centres };
    sh.uniforms.uHue = { value: hues };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBallN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBallN = normalize(position);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBallN; uniform vec3 uC[32]; uniform vec3 uHue[12];')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 n = normalize(vBallN);
        float d1 = -2.0, d2 = -2.0; int i1 = 0;
        for (int i = 0; i < 32; i++) {
          float d = dot(n, uC[i]) + (i < 12 ? -0.012 : 0.0);
          if (d > d1) { d2 = d1; d1 = d; i1 = i; } else if (d > d2) { d2 = d; }
        }
        float w = fwidth(d1 - d2) * 1.2 + 0.004;
        float seam = smoothstep(0.0, w, d1 - d2);
        vec3 col = vec3(0.98);
        float r = dot(n, uC[i1]);
        if (i1 < 12) {
          vec3 hue = uHue[0];
          for (int k = 0; k < 12; k++) if (k == i1) hue = uHue[k];
          // coloured pentagon with a white sparkle dot in the middle
          col = mix(hue, vec3(1.0), smoothstep(0.9985, 0.9992, r) * 0.9);
          col = mix(vec3(0.98), col, smoothstep(0.944, 0.948, r));
        } else {
          col *= 0.94 + 0.06 * smoothstep(0.9, 0.99, r);
        }
        col = mix(vec3(0.3, 0.3, 0.38), col, seam);
        diffuseColor.rgb *= col;`);
  };
  return m;
}

// Rainbow ribbon that follows the ball. A flat strip (wide side up, so the
// raised broadcast camera sees it), colours cycle along its length.
class RainbowTrail {
  constructor(scene, n = 44) {
    this.n = n; this.pts = Array.from({ length: n }, () => new THREE.Vector3()); this.heat = 0; this.t = 0;
    this.tint = null; this.wide = 1;   // special shots: one element colour, a fatter ribbon
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 2 * 4), 4));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
    scene.add(this.mesh);
    this.col = new THREE.Color(); this._s = new THREE.Vector3(); this._d = new THREE.Vector3();
  }
  reset(p) { for (const q of this.pts) q.copy(p); this.heat = 0; }
  update(dt, pos, speed) {
    this.t += dt;
    const target = THREE.MathUtils.clamp((speed - 2.5) / 6, 0, 1);
    this.heat += (target - this.heat) * Math.min(1, dt * (target > this.heat ? 10 : 2.5));
    for (let i = this.n - 1; i > 0; i--) this.pts[i].copy(this.pts[i - 1]);
    this.pts[0].copy(pos);
    const pa = this.mesh.geometry.attributes.position.array, ca = this.mesh.geometry.attributes.color.array;
    for (let i = 0; i < this.n; i++) {
      const p = this.pts[i], q = this.pts[Math.min(this.n - 1, i + 1)];
      this._d.copy(i === 0 ? this.pts[0] : p).sub(i === 0 ? this.pts[1] : q);
      if (i > 0) this._d.copy(this.pts[i - 1]).sub(p);
      this._s.crossVectors(this._d, UP);
      if (this._s.lengthSq() < 1e-8) this._s.set(1, 0, 0);
      const u = i / (this.n - 1);
      this._s.setLength(R * 0.95 * this.wide * (1 - u * 0.7));
      pa.set([p.x + this._s.x, p.y, p.z + this._s.z, p.x - this._s.x, p.y, p.z - this._s.z], i * 6);
      if (this.tint) { this.col.copy(this.tint).offsetHSL(0, 0, 0.25 * (1 - u) * Math.sin(this.t * 30 + i)); }
      else this.col.setHSL((u * 1.2 - this.t * 0.6) % 1 + 1, 0.95, 0.6);
      const a = this.heat * Math.pow(1 - u, 1.3) * 0.85;
      ca.set([this.col.r, this.col.g, this.col.b, a, this.col.r, this.col.g, this.col.b, a], i * 8);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
    this.mesh.visible = this.heat > 0.01;
  }
}

export class Ball {
  constructor(scene, sfx) {
    this.sfx = sfx;
    this.pos = new THREE.Vector3(0, R, 0);
    this.vel = new THREE.Vector3();
    this.spin = new THREE.Vector3();       // angular velocity (rad/s, world)
    this.lastTouch = null;
    this.events = [];
    this.goalTeam = -1;                    // index of the goal the ball is sitting in
    this.closedGoals = new Set();          // goals of knocked-out players are boarded up
    this.shields = new Set();              // goals behind an energy barrier: the first hit breaks it, bouncing the ball away

    // root (position) → squash node (deforms along an impact axis) → spinning mesh
    this.root = new THREE.Group();
    this.squashNode = new THREE.Group();
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 40), ballMaterial());
    this.mesh.castShadow = true;
    this.root.add(this.squashNode); this.squashNode.add(this.mesh);
    // dark toon outline, like the players: the ball pops against the grass
    this.squashNode.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.1, 32, 18), new THREE.MeshBasicMaterial({ color: 0x1b1630, side: THREE.BackSide })));
    scene.add(this.root);
    // a pulsing gold ring on the ground under the ball, and a thin line up to it when it's in the air
    this.marker = new THREE.Mesh(new THREE.RingGeometry(R * 1.7, R * 2.3, 40), new THREE.MeshBasicMaterial({ color: 0xffe45c, transparent: true, opacity: 0.9, depthWrite: false }));
    this.marker.rotation.x = -Math.PI / 2; this.marker.renderOrder = 2;
    scene.add(this.marker);
    this.stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 6), new THREE.MeshBasicMaterial({ color: 0xffe45c, transparent: true, opacity: 0.45, depthWrite: false }));
    scene.add(this.stem);
    this._mt = 0;
    this.spinQ = new THREE.Quaternion();
    this.sq = { axis: new THREE.Vector3(0, 1, 0), amp: 0, t: 1 };
    this._alignQ = new THREE.Quaternion(); this._invQ = new THREE.Quaternion();
    this.colliders = [];   // body-part spheres, refreshed by the game each frame
    this._hit = new Set();

    // soft contact shadow that keeps height readable even when the ball is high up
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    this.blob.rotation.x = -Math.PI / 2; this.blob.renderOrder = 1;
    scene.add(this.blob);

    this.trail = new RainbowTrail(scene);
    this._tmp = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this.reset(0, 0);
  }

  reset(x = 0, z = 0) {
    this.pos.set(x, R, z); this.vel.set(0, 0, 0); this.spin.set(0, 0, 0);
    this.lastTouch = null; this.goalTeam = -1;
    this.special = null; this.specialType = null;
    this.chain = null; this.passEls = null; this.passBy = null; this.hidden = false;
    this.heldBy = null;
    this.sq.amp = 0;
    this.trail.reset(this.pos);
    this.sync();
  }

  get speed() { return this.vel.length(); }
  get groundSpeed() { return Math.hypot(this.vel.x, this.vel.z); }

  strike(vel, spin = null, by = null) {
    this.vel.copy(vel);
    if (spin) this.spin.copy(spin);
    this.lastTouch = by; this.guardT = 0; this.loftKind = null; this.dribbleGuard = 0; this.passToT = 0; this.shotDist = null; this.shotZone = null;
    this.endSpecial();     // any new strike ends a special shot in flight
  }

  /** a goalkeeper catches it: it sits in his hands until he lets go */
  hold(keeper) {
    this.endSpecial();
    this.heldBy = keeper; this.lastTouch = keeper;
    this.vel.set(0, 0, 0); this.spin.set(0, 0, 0);
  }
  release() { this.heldBy = null; }

  /**
   * A special shot is in flight (see _special and _bodies). els: one element per player in the move
   * (a solo shot has one). goal: where the shooter was aiming in the goal (for the teleport).
   */
  startSpecial(els, owner, dir, power = 1, goal = null) {
    if (typeof els === 'string') els = [els];
    const l = Math.hypot(dir.x, dir.z) || 1, c = { ...comboOf(els) };
    // from range the keeper has time: a two-man combo's unstoppable trick (through him, teleport,
    // blast) often fades into a plain thunderbolt he can get to; even a 合击 from very far sometimes
    const dist = this.shotDist ?? 12;
    // two-man combos are never a sure thing: deadly close in (their trick usually comes off), a plain
    // hard shot from range. Only a three-man 合击 can't be stopped — and even that fades from very far
    const zone = this.shotZone || 'box';
    c.range = zone === 'small' ? 0.05 : zone === 'box' ? Math.max(0.25, Math.min(0.6, (dist - 6) / 10)) : Math.max(0.75, Math.min(1, (dist - 8) / 12));   // ~0 in the 小禁区 … 1 from far out
    if (c.level === 2 && c.gk !== 'parry' && Math.random() < 0.3 + 0.62 * c.range) { c.gk = 'parry'; c.faded = true; }
    if (c.level === 2 && c.pierceGk) c.pierceGk *= 1 - 0.85 * c.range;
    if (c.level === 2 && c.aura && Math.random() < c.range) c.aura = null;     // the aura doesn't carry that far
    if (c.level >= 3 && dist > 15 && Math.random() < Math.min(0.6, (dist - 15) / 10)) { c.gk = 'parry'; c.faded = true; }
    this.special = { els, ids: c.ids, combo: c, type: c.ids.length === 1 ? c.ids[0] : c.key, has: (id) => c.ids.includes(id), owner, power, t: 0, hit: new Set(), aura: new Set(), dx: dir.x / l, dz: dir.z / l, sgn: Math.random() < 0.5 ? -1 : 1, goal };
    this.specialType = c.key + (c.n > c.ids.length ? '!' : '');      // '!' = more players than elements (stronger look)
    this.spin.set(0, 0, 0); this.hidden = false;
    this.passEls = null;
    return c;
  }
  endSpecial() {
    if (this.special) this.events.push({ type: 'specialEnd', kind: this.special.type });
    this.special = null; this.specialType = null; this.hidden = false;
  }

  /** visual squash along an impact direction (any vector), amount ~0..0.25 */
  squash(n, amount) {
    const a = Math.min(0.24, amount);
    if (a < 0.02 || a < this._sqNow() * 0.8) return;
    this.sq.axis.set(n.x, n.y, n.z).normalize(); this.sq.amp = a; this.sq.t = 0;
  }
  _sqNow() { return this.sq.amp * Math.exp(-this.sq.t * 26); }

  update(dt) {
    this.events.length = 0;
    this._hit.clear();
    this.noCatchT = Math.max(0, (this.noCatchT || 0) - dt);
    this.guardT = Math.max(0, (this.guardT || 0) - dt);   // a pass just played: clear of the marker's legs for a moment
    this.dribbleGuard = Math.max(0, (this.dribbleGuard || 0) - dt);
    this.passToT = Math.max(0, (this.passToT || 0) - dt);       // a pass on its way: team-mates it isn't for let it run   // under close control: opponents must tackle for it
    if (this.heldBy) {
      const k = this.heldBy;
      if (k.out || !k.holding) this.heldBy = null;
      else { k.handPos(this.pos); this.vel.set(0, 0, 0); this.sync(dt); return this.events; }
    }
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps && !this.heldBy; i++) this._step(h, (i + 1) / steps);
    this.sync(dt);
    return this.events;
  }

  /** @param u how far through the frame this substep ends (bodies are swept from their last pose) */
  _step(h, u = 1) {
    this._clockT = (this._clockT || 0) + h;
    const p = this.pos, v = this.vel, w = this.spin;
    const grounded = p.y <= R + 0.002 && Math.abs(v.y) < 0.35;
    const sp = this.special;
    if (sp) this._special(h);
    if (!grounded) {
      v.y -= BALL.gravity * h * (sp && !sp.lob ? (sp.has('thunder') ? 0.25 : sp.has('cannon') ? 0.5 : sp.has('gale') ? 0.7 : 0.8) : 1);
      const s = v.length();
      if (s > 0) v.multiplyScalar(Math.max(0, 1 - BALL.drag * s * h));
      v.x += BALL.magnus * (w.y * v.z - w.z * v.y) * h;
      v.z += BALL.magnus * (w.x * v.y - w.y * v.x) * h;
      v.y += BALL.magnus * 0.4 * (w.z * v.x - w.x * v.z) * h;
      w.multiplyScalar(Math.max(0, 1 - 0.25 * h));
    } else {
      v.y = 0; p.y = R;
      const gs = Math.hypot(v.x, v.z);
      if (gs > 0) {
        const dec = (BALL.rollDecel + BALL.rollQuad * gs * gs) * h;
        const k = Math.max(0, gs - dec) / gs;
        v.x *= k; v.z *= k;
        v.x += BALL.magnus * 0.25 * w.y * v.z * h;
        v.z -= BALL.magnus * 0.25 * w.y * v.x * h;
      }
      w.set(v.z / R, w.y * Math.max(0, 1 - 2.5 * h), -v.x / R);
      if (gs < 0.02) { v.x = 0; v.z = 0; }
    }

    p.addScaledVector(v, h);

    if (p.y < R) {
      p.y = R;
      if (v.y < -0.35) {
        const impact = -v.y;
        v.y = impact * BALL.bounce * (impact > 6 ? 1 : 0.9);
        if (v.y < 0.6) v.y = 0;
        const contactX = v.x + w.z * R, contactZ = v.z - w.x * R;
        v.x -= contactX * (1 - BALL.bounceFriction) * 0.9;
        v.z -= contactZ * (1 - BALL.bounceFriction) * 0.9;
        w.x = v.z / R * 0.6 + w.x * 0.4; w.z = -v.x / R * 0.6 + w.z * 0.4;
        if (impact > 1.2) this.events.push({ type: 'bounce', v: impact });
        if (impact > 3) this.events.push({ type: 'squash', n: [0, 1, 0], a: impact / 45 });
      } else v.y = 0;
    }

    this._walls('x', 'z');
    this._walls('z', 'x');
    this._corners();
    this._obstacles();
    if (FIELD.islands.length) this._islands();
    if (FIELD.pads.length || FIELD.springs.length || FIELD.portals.length || FIELD.boosts.length || FIELD.vortices.length || FIELD.wheels.length) this._features(h);
    this._goalFrames();
    this._bodies(u);
  }

  // special shot in flight: its own little bit of physics, and it fizzles out once it has slowed
  _special(h) {
    const sp = this.special, v = this.vel, c = sp.combo, p = this.pos;
    sp.t += h;
    if (sp.has('gale')) {
      // S-bend: a sideways push that swings one way, then the other
      const f = (c.level > 1 ? 40 : 34) * Math.cos(sp.t * 6.8 + 0.3) * sp.sgn;
      v.x += -sp.dz * f * h; v.z += sp.dx * f * h;
    }
    if (c.zig) {
      // lightning zigzag: hard sideways jinks, back and forth
      const f = 70 * Math.sign(Math.sin(sp.t * 26 + 0.5)) * sp.sgn;
      v.x += -sp.dz * f * h; v.z += sp.dx * f * h;
    }
    if (sp.has('thunder') && sp.t < 1.2) {
      // keeps its pace: lightning doesn't slow down
      const s = Math.hypot(v.x, v.z), want = sp.v0 || (sp.v0 = s);
      if (s > 1 && s < want) { v.x *= want / s; v.z *= want / s; }
    }
    // 雷+影: the ball vanishes in a flash and reappears inside the net
    if (c.gk === 'teleport' && sp.goal && !sp.ported) {
      const gd = Math.hypot(sp.goal.x - p.x, sp.goal.z - p.z);
      if (!sp.vanishT && (sp.t > 0.1 || gd < 5)) { sp.vanishT = sp.t; this.hidden = true; this.events.push({ type: 'teleport', from: [p.x, p.y, p.z] }); }
      if (sp.vanishT && sp.t - sp.vanishT > 0.22) {
        sp.ported = true; this.hidden = false;
        const g = sp.goal, A = Math.abs(g.x) > Math.abs(g.z) ? 'x' : 'z', B = A === 'x' ? 'z' : 'x', sg = Math.sign(g[A]) || 1;
        p[A] = sg * (halfOf(A) + 0.55); p[B] = Math.max(-FIELD.goalHalfW + 0.45, Math.min(FIELD.goalHalfW - 0.45, g[B])); p.y = Math.min(FIELD.goalH - 0.5, 0.8);
        v.set(0, 0, 0); v[A] = sg * 14; v.y = 1;
        this.events.push({ type: 'teleport', to: [p.x, p.y, p.z] });
      }
      if (sp.vanishT && !sp.ported) return;                // in between: nowhere
    }
    // a combo homes in on the goal: whatever the wiggles, it's brought back inside the posts and under the bar
    if (c.level > 1 && sp.goal && !(c.gk === 'teleport')) this._home(sp, h);
    // the aura: anyone it flies close past feels it
    if (c.aura && this.pos.y < 2.6) {
      const r = c.aura === 'quake' ? 2.2 : c.aura === 'freeze' ? 1.9 : 1.6;
      for (const col of this.colliders) {
        const who = col.owner;
        if (who === sp.owner || sp.aura.has(who) || sp.hit.has(who) || !sp.owner._isOpp(who)) continue;
        if (who.isKeeper && inOwnBox(who.end, who.pos.x, who.pos.z)) continue;   // the aura sweeps out-field players, not the keeper
        if (Math.hypot(who.pos.x - p.x, who.pos.z - p.z) > r) continue;
        sp.aura.add(who);
        const kind = c.aura === 'freeze' ? 'frost' : c.aura === 'jolt' ? 'thunder' : c.aura === 'quake' ? 'cannon' : 'blaze';
        this.events.push({ type: 'zap', who, kind, els: [kind], n: [sp.dx, 0, sp.dz], mild: true, keeper: false });
      }
    }
    if (sp.t > (c.level > 1 ? 2.6 : 2.2) || this.speed < 7 || this.goalTeam >= 0 || this.pos.y > 4.5) this.endSpecial();
  }

  _home(sp, h) {
    const g = sp.goal, p = this.pos, v = this.vel;
    const A = Math.abs(g.x) > Math.abs(g.z) ? 'x' : 'z', B = A === 'x' ? 'z' : 'x', sg = Math.sign(g[A]) || 1;
    const line = sg * halfOf(A), toLine = (line - p[A]) * sg;
    if (toLine < 0.3 || v[A] * sg < 2) return;
    if (sp.tgtB === undefined) {
      // the spot it was meant for: where it was heading, kept a hand's width inside the post
      const t0 = toLine / Math.abs(v[A]), m = FIELD.goalHalfW - 0.6;
      sp.tgtB = Math.max(-m, Math.min(m, p[B] + v[B] * t0));
    }
    const t = toLine / Math.abs(v[A]);
    const wantB = (sp.tgtB - p[B]) / t;                      // the sideways speed that lands it on the spot
    const k = Math.min(1, h * (toLine < 9 ? 9 : 4));
    v[B] += (wantB - v[B]) * k;
    const yAt = p.y + v.y * t - 0.5 * BALL.gravity * (sp.lob ? 1 : 0.5) * t * t;
    if (yAt > FIELD.goalH - 0.45) v.y -= (yAt - (FIELD.goalH - 0.7)) / Math.max(t, 0.1) * Math.min(1, h * 8);
  }

  // the ball meets heads, chests, thighs, shins and boots as real spheres
  // limbs are capsules (pos → b); everything moves from its previous pose to the
  // current one over the frame, so a fast-swinging leg can't skip past the ball
  _bodies(u = 1) {
    const p = this.pos, v = this.vel, A = this._ca || (this._ca = new THREE.Vector3()), B = this._cb || (this._cb = new THREE.Vector3());
    const Q = this._cq || (this._cq = new THREE.Vector3()), CV = this._cv || (this._cv = new THREE.Vector3());
    for (const c of this.colliders) {
      if (this.heldBy) return;
      if (this.passThrough && c.owner !== this.passThrough) continue;   // a character move carries the ball through people
      if (this.hidden) continue;                                         // vanished (mid-teleport)
      if (this.passToT > 0 && this.passTo && c.owner !== this.passTo && this.lastTouch && c.owner !== this.lastTouch && !this.lastTouch._isOpp(c.owner)) continue;   // a pass runs past team-mates it isn't meant for
      if (this.special && c.owner !== this.special.owner && !this.special.owner._isOpp(c.owner)) continue;   // a shot flies past the shooter's own team
      if (this.guardT > 0 && this.guardBy && c.owner.gi !== this.guardBy.gi && !c.owner.slide && !c.owner.poke) continue;
      if (this.dribbleGuard > 0 && this.dribbleBy && c.owner !== this.dribbleBy && (!this.dribbleBy._isOpp(c.owner) || (!c.owner.slide && !c.owner.poke && !c.owner.isKeeper))) continue;   // a ball under close control runs past team-mates and anyone not tackling
      A.copy(c.prev).lerp(c.pos, u);
      let s = 0;
      if (c.b) {
        B.copy(c.prevB).lerp(c.b, u);
        const ex = B.x - A.x, ey = B.y - A.y, ez = B.z - A.z, L2 = ex * ex + ey * ey + ez * ez;
        s = L2 > 1e-8 ? Math.max(0, Math.min(1, ((p.x - A.x) * ex + (p.y - A.y) * ey + (p.z - A.z) * ez) / L2)) : 0;
        Q.set(A.x + ex * s, A.y + ey * s, A.z + ez * s);
        CV.copy(c.vel).lerp(c.velB, s);
      } else { Q.copy(A); CV.copy(c.vel); }
      const dx = p.x - Q.x, dy = p.y - Q.y, dz = p.z - Q.z;
      const d = Math.hypot(dx, dy, dz), min = R + c.r;
      if (d >= min || d < 1e-6) continue;
      const nx = dx / d, ny = dy / d, nz = dz / d;
      const spc = this.special, spc0 = spc;
      if (spc && c.owner !== spc.owner) {
        const who = c.owner, cb = spc.combo, n = [spc.dx, 0, spc.dz];
        const keeper = inOwnBox(who.end, who.pos.x, who.pos.z) && (!who.role || who.role === 'gk');
        if (!keeper) {
          // out-field players: a combo goes through anyone; a solo shot through people with lightning, fire, ice or earth
          const pierce = cb.level > 1 || spc.has('thunder') || spc.has('blaze') || spc.has('frost') || spc.has('cannon');
          if (pierce && !spc.hit.has(who)) { spc.hit.add(who); this.events.push({ type: 'zap', who, kind: spc.type, els: spc.ids, n, level: cb.level, mild: cb.level === 2 && cb.range > 0.6 }); }
          if (pierce) continue;
          this.endSpecial();
        } else if (cb.level === 1) {
          // a solo shot and the keeper: he gets a body (or the gloves) to it. Only ice still gets him
          if (spc.has('frost') && !spc.hit.has(who)) { spc.hit.add(who); this.events.push({ type: 'zap', who, kind: 'frost', els: ['frost'], n, keeper: true }); }
          this.endSpecial();
        } else {
          // a combo: what it does to the keeper depends on the elements in it
          const through = cb.gk === 'through' || cb.gk === 'blast' || cb.gk === 'teleport' || (cb.pierceGk && Math.random() < cb.pierceGk);
          if (!spc.hit.has(who)) {
            spc.hit.add(who);
            const els = cb.gk === 'freeze' && !spc.has('frost') ? [...spc.ids, 'frost'] : spc.ids;
            this.events.push({ type: 'zap', who, kind: spc.type, els, n, keeper: true, force: through || cb.gk === 'freeze', level: cb.level, blast: cb.gk === 'blast' });
          }
          if (through) continue;                                          // straight through him
          v.multiplyScalar(0.62);
          this.noCatchT = 0.35;                                           // too hot to hold: it's beaten away
          this.endSpecial();
        }
      } else if (spc && c.owner === spc.owner) continue;
      // a goalkeeper's touch: he decides (catch / beat it away / fingertips) right where they meet
      if (c.owner.isKeeper && c.owner.gkContact) {
        const res = c.owner.gkContact(this, c, spc0);
        if (res === 'beat') continue;
        if (res === 'catch') return;
        if (res === 'parry') {
          p.set(Q.x + nx * min, Math.max(R, Q.y + ny * min), Q.z + nz * min);
          this.events.push({ type: 'body', who: c.owner, part: c.part, side: c.side, v: 12, n: [nx, ny, nz] });
          continue;
        }
      }
      p.set(Q.x + nx * min, Math.max(R, Q.y + ny * min), Q.z + nz * min);
      const rvx = v.x - CV.x, rvy = v.y - CV.y, rvz = v.z - CV.z;
      const vn = rvx * nx + rvy * ny + rvz * nz;
      if (vn >= 0) continue;
      const j = -(1 + c.e) * vn;
      v.x += j * nx; v.y += j * ny; v.z += j * nz;
      // grip: part of the sliding speed across the surface is lost
      const tx = rvx - vn * nx, ty = rvy - vn * ny, tz = rvz - vn * nz;
      v.x -= tx * 0.22; v.y -= ty * 0.22; v.z -= tz * 0.22;
      this.spin.multiplyScalar(0.5);
      const key = c.owner.team * 100 + c.idx;
      if (!this._hit.has(key)) {
        this._hit.add(key);
        this.events.push({ type: 'body', who: c.owner, part: c.part, side: c.side, v: -vn, n: [nx, ny, nz] });
      }
    }
  }

  // the four sides are identical: a board everywhere except a goal mouth in the middle
  _walls(A, B) {
    const p = this.pos, v = this.vel, H = halfOf(A);
    const side = Math.sign(p[A]) || 1;
    // wavy boards: the board bulges in and out along its length, and the bounce follows its slope
    const w = FIELD.wave && Math.abs(p[A]) < H ? waveOff(A, p[B], side) : 0;
    if (w > 0) {
      const Hw = H - w;
      if (Math.abs(p[A]) <= Hw - R || Math.abs(p[B]) > halfOf(B)) return;
      const sl = waveSlope(A, p[B], side), L = Math.hypot(1, sl), nA = side / L, nB = sl / L;
      p[A] = side * (Hw - R);
      const vn = v[A] * nA + v[B] * nB;
      if (vn > 0) {
        const pop = vn > 6 ? BALL.wallKick : 0;
        v[A] -= ((1 + BALL.wallBounce) * vn + pop) * nA; v[B] -= ((1 + BALL.wallBounce) * vn + pop) * nB;
        v[B] *= 0.97;
        if (vn > 1.5) this.events.push({ type: 'board', v: vn });
        if (vn > 4) this.events.push({ type: 'squash', n: A === 'x' ? [nA, 0, nB] : [nB, 0, nA], a: vn / 50 });
      }
      return;
    }
    if (Math.abs(p[A]) <= H - R) return;
    if (this.goalTeam >= 0) {
      const g = goalIndexFor(A, side);
      if (g !== this.goalTeam && Math.abs(p[A]) > H) return;
    }
    const gi = goalIndexFor(A, side);
    const mouth = gi >= 0 && Math.abs(p[B]) < FIELD.goalHalfW - R * 0.2 && p.y < FIELD.goalH - R * 0.2 && !this.closedGoals.has(gi) && !this.shields.has(gi);
    const inside = Math.abs(p[A]) > H;
    if (!inside && !mouth) {
      // never let a ball that is inside the other axis' goal be bounced by this wall
      if (Math.abs(p[B]) > halfOf(B)) return;
      p[A] = side * (H - R);
      if (v[A] * side > 0) {
        const s = Math.abs(v[A]);
        // the goal's barrier: the hit shatters it and the ball is flung back out
        if (this.shields.has(gi) && Math.abs(p[B]) < FIELD.goalHalfW && p.y < FIELD.goalH && s > 0.8) {
          this.shields.delete(gi);
          v[A] = -side * (s * 0.95 + 3); v[B] *= 0.9; v.y = Math.max(v.y, 1.5);
          this.events.push({ type: 'shield', team: gi, v: s, x: p.x, y: p.y, z: p.z });
          this.events.push({ type: 'squash', n: A === 'x' ? [1, 0, 0] : [0, 0, 1], a: 0.2 });
          return;
        }
        v[A] = -v[A] * BALL.wallBounce - side * (s > 6 ? BALL.wallKick : 0);
        v[B] *= 0.96;
        if (s > 1.5) this.events.push({ type: 'board', v: s });
        if (s > 4) this.events.push({ type: 'squash', n: A === 'x' ? [1, 0, 0] : [0, 0, 1], a: s / 50 });
      }
      return;
    }
    if (inside) {
      let hitNet = 0;
      if (Math.abs(p[B]) > FIELD.goalHalfW - R) { const sb = Math.sign(p[B]); p[B] = sb * (FIELD.goalHalfW - R); if (v[B] * sb > 0) { hitNet = Math.max(hitNet, Math.abs(v[B])); v[B] *= -BALL.netDamp; v[A] *= 0.7; } }
      if (p.y > FIELD.goalH - R) { p.y = FIELD.goalH - R; if (v.y > 0) { hitNet = Math.max(hitNet, v.y); v.y *= -BALL.netDamp; } }
      if (Math.abs(p[A]) > H + GD - R) {
        p[A] = side * (H + GD - R);
        if (v[A] * side > 0) {
          hitNet = Math.max(hitNet, Math.abs(v[A]));
          this.events.push({ type: 'backnet', v: Math.abs(v[A]), team: goalIndexFor(A, side), y: p.y, along: p[B] });
          v[A] *= -0.06; v[B] *= 0.35; v.y *= 0.4;
        }
      }
      if (hitNet > 2) this.events.push({ type: 'net', v: hitNet });
      if (this.goalTeam < 0 && Math.abs(p[A]) > H + R && Math.abs(p[B]) < FIELD.goalHalfW && p.y < FIELD.goalH) {
        this.goalTeam = goalIndexFor(A, side);
        this.events.push({ type: 'goal', team: this.goalTeam });
      }
      // a ball that is in keeps being held by the net
      if (this.goalTeam === goalIndexFor(A, side) && Math.abs(p[A]) < H + R) {
        p[A] = side * (H + R);
        if (v[A] * side < 0) v[A] *= -0.1;
      }
    }
  }

  // curved boards in the four corners
  _corners() {
    const p = this.pos, v = this.vel, RC = FIELD.cornerR, Cx = FIELD.hx - RC, Cz = FIELD.hz - RC;
    if (Math.abs(p.x) <= Cx || Math.abs(p.z) <= Cz) return;
    const cx = Math.sign(p.x) * Cx, cz = Math.sign(p.z) * Cz;
    const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz), lim = RC - R;
    if (d <= lim) return;
    const nx = dx / d, nz = dz / d;
    p.x = cx + nx * lim; p.z = cz + nz * lim;
    const vn = v.x * nx + v.z * nz;
    if (vn > 0) {
      const pop = vn > 6 ? BALL.wallKick : 0;
      v.x -= ((1 + BALL.wallBounce) * vn + pop) * nx;
      v.z -= ((1 + BALL.wallBounce) * vn + pop) * nz;
      if (vn > 1.5) this.events.push({ type: 'board', v: vn });
      if (vn > 4) this.events.push({ type: 'squash', n: [nx, 0, nz], a: vn / 50 });
    }
  }

  // flower planters: a vertical cylinder with a flat top
  _obstacles() {
    const p = this.pos, v = this.vel;
    for (const o of OBSTACLES) {
      if (p.y > o.h + R) continue;
      if (o.sq) { this._block(o); continue; }
      const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz);
      if (d > o.r + R) continue;
      if (p.y > o.h && d < o.r) {
        // landing on the top: bounce up
        p.y = o.h + R;
        if (v.y < 0) { const imp = -v.y; v.y = imp * 0.55; if (imp > 2) this.events.push({ type: 'board', v: imp }); }
        continue;
      }
      if (d < 1e-5) continue;
      const nx = dx / d, nz = dz / d;
      p.x = o.x + nx * (o.r + R); p.z = o.z + nz * (o.r + R);
      const vn = v.x * nx + v.z * nz;
      if (vn < 0) {
        if (o.bumper) {
          // pinball mushroom: always fires the ball back out, harder than it came in
          const out = Math.max(-vn * 1.25, 5) + 2.5;
          v.x += (-vn + out) * nx; v.z += (-vn + out) * nz;
          this.events.push({ type: 'bumper', v: out, x: o.x, z: o.z });
        } else { v.x -= 1.8 * vn * nx; v.z -= 1.8 * vn * nz; }
        this.spin.multiplyScalar(0.6);
        if (-vn > 1.5) this.events.push({ type: 'board', v: -vn });
        if (-vn > 4) this.events.push({ type: 'squash', n: [nx, 0, nz], a: -vn / 50 });
      }
    }
  }

  // square jelly block: like a bumper, but with flat faces and corners
  _block(o) {
    const p = this.pos, v = this.vel;
    const cx = Math.max(o.x - o.r, Math.min(o.x + o.r, p.x)), cz = Math.max(o.z - o.r, Math.min(o.z + o.r, p.z));
    let nx = p.x - cx, nz = p.z - cz, d = Math.hypot(nx, nz);
    if (d >= R) return;
    if (d < 1e-6) {
      // centre inside the block: out through the nearest face
      const dx = p.x - o.x, dz = p.z - o.z;
      if (o.r - Math.abs(dx) < o.r - Math.abs(dz)) { nx = Math.sign(dx || 1); nz = 0; p.x = o.x + nx * (o.r + R); }
      else { nx = 0; nz = Math.sign(dz || 1); p.z = o.z + nz * (o.r + R); }
    } else { nx /= d; nz /= d; p.x = cx + nx * R; p.z = cz + nz * R; }
    const vn = v.x * nx + v.z * nz;
    if (vn < 0) {
      const out = Math.max(-vn * 1.25, 5) + 2.5;
      v.x += (-vn + out) * nx; v.z += (-vn + out) * nz;
      this.spin.multiplyScalar(0.6);
      this.events.push({ type: 'bumper', v: out, x: o.x, z: o.z });
      if (-vn > 4) this.events.push({ type: 'squash', n: [nx, 0, nz], a: -vn / 50 });
    }
  }

  // island flower beds: low walls all round (capsule shape)
  _islands() {
    const p = this.pos, v = this.vel;
    for (const c of FIELD.islands) {
      const q = islandClosest(c, p.x, p.z), min = c.r + R;
      if (q.d >= min || q.d < 1e-6) continue;
      const nx = (p.x - q.px) / q.d, nz = (p.z - q.pz) / q.d;
      p.x = q.px + nx * min; p.z = q.pz + nz * min;
      const vn = v.x * nx + v.z * nz;
      if (vn < 0) {
        const pop = -vn > 6 ? BALL.wallKick : 0;
        v.x -= ((1 + BALL.wallBounce) * vn - pop) * nx; v.z -= ((1 + BALL.wallBounce) * vn - pop) * nz;
        if (-vn > 1.5) this.events.push({ type: 'board', v: -vn });
        if (-vn > 4) this.events.push({ type: 'squash', n: [nx, 0, nz], a: -vn / 50 });
      }
    }
  }

  // speed strips push a rolling ball along; bounce pads launch it into the air
  _features(h) {
    const p = this.pos, v = this.vel;
    if (p.y < R + 0.05) {
      const pad = padAt(p.x, p.z);
      if (pad) {
        const along = v.x * pad.dx + v.z * pad.dz;
        if (along < 15) { v.x += pad.dx * 9 * h; v.z += pad.dz * 9 * h; }
      }
    }
    for (const s of FIELD.springs) {
      if (inShape(s, p.x, p.z) && p.y < R + 0.08 && v.y <= 0.5 && (this._sprung || 0) <= 0) {
        const gs = Math.hypot(v.x, v.z);
        v.y = 5.2 + gs * 0.25;
        this._sprung = 0.35;
        this.events.push({ type: 'spring', v: v.y, x: s.x, z: s.z });
      }
    }
    if (this._sprung > 0) this._sprung -= h;
    const cd = this._devCD || (this._devCD = {});
    for (const k in cd) if (cd[k] > 0) cd[k] -= h;
    const gs = Math.hypot(v.x, v.z);
    // teleport: in one disc, out of the one diagonally opposite, same speed, same direction
    if (p.y < 1.3 && (cd.portal || 0) <= 0) {
      for (const pt of FIELD.portals) {
        if (!inShape(pt, p.x, p.z)) continue;
        const out = FIELD.portals.find((q) => q.idx === (pt.idx + 2) % 4) || pt;
        let ux = gs > 0.2 ? v.x / gs : (out.x > 0 ? -1 : 1) * 0.7, uz = gs > 0.2 ? v.z / gs : (out.z > 0 ? -1 : 1) * 0.7;
        // a little twist on the way through, so a ball can't shuttle between two portals forever
        const tw = (Math.random() - 0.5) * 0.7, c = Math.cos(tw), sn = Math.sin(tw);
        [ux, uz] = [ux * c - uz * sn, ux * sn + uz * c];
        if (gs > 0.2) { v.x = ux * gs; v.z = uz * gs; }
        this._portalHits = (this._portalHits || []).filter((t) => this._clockT - t < 5); this._portalHits.push(this._clockT);
        if (this._portalHits.length > 3) { v.x *= 0.5; v.z *= 0.5; }
        const ex = (out.r + R + 0.08) * (out.sq ? 1.42 : 1);   // pop out clear of the far edge (square: past the corner too)
        p.x = out.x + ux * ex; p.z = out.z + uz * ex;
        if (gs < 2.5) { v.x = ux * 2.5; v.z = uz * 2.5; }            // never leave a ball sitting inside one
        clampToArena(p, R);
        cd.portal = 0.45;
        this.events.push({ type: 'portal', from: [pt.x, pt.z], to: [out.x, out.z], x: out.x, z: out.z, v: gs });
        this.trail.reset(p);
        break;
      }
    }
    // speed ring: anything rolling or flying low through it comes out a lot faster
    if (p.y < 0.9 && gs > 1) {
      for (const b of FIELD.boosts) {
        const key = 'boost' + b.idx;
        if ((cd[key] || 0) > 0 || !inShape(b, p.x, p.z)) continue;
        const k = Math.min(1.7, 26 / gs);
        v.x *= k; v.z *= k;
        cd[key] = 0.6;
        this.events.push({ type: 'boost', x: b.x, z: b.z, v: gs * k });
      }
    }
    // whirlpool: swings the ball round (anticlockwise seen from above) and flings it off at a new angle
    if (p.y < 0.7) {
      for (const w of FIELD.vortices) {
        const dx = p.x - w.x, dz = p.z - w.z, d = Math.hypot(dx, dz);
        if (!inShape(w, p.x, p.z) || d < 0.05) continue;
        const tx = -dz / d, tz = dx / d, f = 26 * (1 - Math.min(1, d / (w.r * 1.4)) * 0.5);
        v.x += (tx * f - dx / d * 4) * h; v.z += (tz * f - dz / d * 4) * h;
        const s = Math.hypot(v.x, v.z); if (s > 18) { v.x *= 18 / s; v.z *= 18 / s; }
        if ((cd['vortex' + w.idx] || 0) <= 0) { cd['vortex' + w.idx] = 0.8; this.events.push({ type: 'vortex', x: w.x, z: w.z }); }
      }
    }
    // wheel of fortune: same speed, any direction at all
    if (p.y < 0.9) {
      for (const w of FIELD.wheels) {
        const key = 'wheel' + w.idx;
        if ((cd[key] || 0) > 0 || !inShape(w, p.x, p.z)) continue;
        const sp = Math.max(gs, 7), a = Math.random() * Math.PI * 2;
        v.x = Math.cos(a) * sp; v.z = Math.sin(a) * sp;
        p.x = w.x + Math.cos(a) * (w.r * 0.3); p.z = w.z + Math.sin(a) * (w.r * 0.3);
        cd[key] = 0.5;
        this.events.push({ type: 'wheel', x: w.x, z: w.z, v: sp });
      }
    }
  }

  _goalFrames() {
    const p = this.pos;
    for (const A of ['x', 'z']) {
      const H = halfOf(A);
      if (Math.abs(Math.abs(p[A]) - H) > R + postR + 0.05) continue;
      const s = Math.sign(p[A]) || 1;
      if (goalIndexFor(A, s) < 0) continue;
      const pt = (a, y, b) => (A === 'x' ? [s * H, y, b] : [b, y, s * H]);
      this._capsule(...pt(0, 0, -FIELD.goalHalfW), ...pt(0, FIELD.goalH, -FIELD.goalHalfW));
      this._capsule(...pt(0, 0, FIELD.goalHalfW), ...pt(0, FIELD.goalH, FIELD.goalHalfW));
      this._capsule(...pt(0, FIELD.goalH, -FIELD.goalHalfW), ...pt(0, FIELD.goalH, FIELD.goalHalfW));
    }
  }

  _capsule(ax, ay, az, bx, by, bz) {
    const p = this.pos, v = this.vel;
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const t = Math.max(0, Math.min(1, ((p.x - ax) * abx + (p.y - ay) * aby + (p.z - az) * abz) / (abx * abx + aby * aby + abz * abz)));
    const cx = ax + abx * t, cy = ay + aby * t, cz = az + abz * t;
    let nx = p.x - cx, ny = p.y - cy, nz = p.z - cz;
    const d = Math.hypot(nx, ny, nz), minD = R + postR;
    if (d >= minD || d === 0) return;
    nx /= d; ny /= d; nz /= d;
    p.set(cx + nx * minD, cy + ny * minD, cz + nz * minD);
    const vn = v.x * nx + v.y * ny + v.z * nz;
    if (vn < 0) {
      const j = -(1 + BALL.postBounce) * vn;
      v.x += j * nx; v.y += j * ny; v.z += j * nz;
      this.spin.multiplyScalar(0.4);
      if (-vn > 1.5) this.events.push({ type: 'post', v: -vn });
      if (-vn > 4) this.events.push({ type: 'squash', n: [nx, ny, nz], a: -vn / 45 });
    }
  }

  sync(dt = 0) {
    this.root.position.copy(this.pos);
    if (dt > 0) {
      const w = this.spin.length();
      if (w > 1e-4) {
        this._tmp.copy(this.spin).divideScalar(w);
        this._q.setFromAxisAngle(this._tmp, w * dt);
        this.spinQ.premultiply(this._q);
      }
      this.trail.update(dt, this.pos, this.speed);
      this.sq.t += dt;
    }
    // squash: flatten along the impact axis, bulge around it, with a quick wobble back
    const a = this.sq.amp * Math.exp(-this.sq.t * 26) * Math.cos(this.sq.t * 60);
    this._alignQ.setFromUnitVectors(UP, this.sq.axis);
    this.squashNode.quaternion.copy(this._alignQ);
    this.squashNode.scale.set(1 + a * 0.5, 1 - a, 1 + a * 0.5);
    this.mesh.quaternion.copy(this._invQ.copy(this._alignQ).invert()).multiply(this.spinQ);
    const hgt = this.pos.y - R;
    this._mt += dt;
    const pulse = 1 + 0.14 * Math.sin(this._mt * 7);
    this.marker.position.set(this.pos.x, 0.02, this.pos.z);
    this.marker.scale.setScalar(pulse * (1 + Math.min(1.5, hgt * 0.35)));
    this.marker.material.opacity = 0.9 - Math.min(0.4, hgt * 0.12);
    this.stem.visible = hgt > 0.45;
    if (this.stem.visible) { this.stem.scale.y = hgt; this.stem.position.set(this.pos.x, hgt / 2, this.pos.z); }
    const s = R * 3.1 + hgt * 0.25;
    this.blob.position.set(this.pos.x, 0.012, this.pos.z);
    this.blob.scale.set(s, s, 1);
    this.blob.material.opacity = Math.max(0.15, 1 - hgt * 0.22);
    // vanished mid-teleport, or an invisible combo shot: no marker giving it away
    const inv = this.hidden || /phantom\+(blaze|frost|cannon)|(blaze|frost|cannon)\+phantom/.test(this.specialType || '');
    this.marker.visible = this.blob.visible = !inv; if (inv) this.stem.visible = false;
  }

  /** Predict where the ball will be after t seconds (ignores walls, good enough for AI). */
  predict(t, out = new THREE.Vector3()) {
    out.copy(this.pos);
    const gs = this.groundSpeed;
    if (this.pos.y <= R + 0.05 && Math.abs(this.vel.y) < 0.5) {
      const stopT = gs / (BALL.rollDecel + BALL.rollQuad * gs * gs + 1e-6);
      const tt = Math.min(t, stopT);
      const dist = gs * tt - 0.5 * (gs / Math.max(stopT, 1e-3)) * tt * tt;
      if (gs > 0) { out.x += (this.vel.x / gs) * dist; out.z += (this.vel.z / gs) * dist; }
    } else {
      out.x += this.vel.x * t * 0.92; out.z += this.vel.z * t * 0.92;
      out.y = Math.max(R, this.pos.y + this.vel.y * t - 0.5 * BALL.gravity * t * t);
    }
    clampToArena(out, R);
    return out;
  }
}

export { UP };
