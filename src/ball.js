import * as THREE from 'three';
import { FIELD, BALL } from './config.js';

const { halfL: L, halfW: W, goalHalfW: GW, goalH: GH, goalDepth: GD, postR } = FIELD;
const R = BALL.r;
const UP = new THREE.Vector3(0, 1, 0);

function ballGeometry() {
  // classic two-tone ball: black pentagon patches centred on the 12 icosahedron vertices
  const geo = new THREE.SphereGeometry(R, 64, 40);
  const ico = new THREE.IcosahedronGeometry(1, 0).attributes.position;
  const centres = [];
  for (let i = 0; i < ico.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(ico, i).normalize();
    if (!centres.some((c) => c.distanceTo(v) < 1e-3)) centres.push(v);
  }
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(pos, i).normalize();
    let best = -1; for (const c of centres) best = Math.max(best, n.dot(c));
    // pentagon-ish patch with a soft seam ring
    let v = 0.95;
    if (best > 0.935) v = 0.05; else if (best > 0.92) v = 0.55;
    // faint seams between the white hexagons
    else if (best > 0.79 && best < 0.80) v = 0.75;
    col.set([v, v, v * 0.98], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

export class Ball {
  constructor(scene, sfx) {
    this.sfx = sfx;
    this.pos = new THREE.Vector3(0, R, 0);
    this.vel = new THREE.Vector3();
    this.spin = new THREE.Vector3();       // angular velocity (rad/s, world)
    this.lastTouch = null;
    this.onGround = true;
    this.events = [];
    this.goalSide = 0;                     // +1/-1 once the ball is fully inside a goal

    this.mesh = new THREE.Mesh(ballGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.0 }));
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    // soft contact shadow that keeps height readable even when the ball is high up
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    this.blob.rotation.x = -Math.PI / 2; this.blob.renderOrder = 1;
    scene.add(this.blob);

    // speed trail for hard shots
    this.trailN = 18;
    this.trailPts = Array.from({ length: this.trailN }, () => new THREE.Vector3());
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.trailN * 3), 3));
    const tc = new Float32Array(this.trailN * 4);
    tg.setAttribute('color', new THREE.BufferAttribute(tc, 4));
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
    this.trail.frustumCulled = false; this.trailHeat = 0;
    scene.add(this.trail);

    this._tmp = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this.reset(0, 0);
  }

  reset(x = 0, z = 0) {
    this.pos.set(x, R, z); this.vel.set(0, 0, 0); this.spin.set(0, 0, 0);
    this.lastTouch = null; this.goalSide = 0; this.trailHeat = 0;
    for (const p of this.trailPts) p.copy(this.pos);
    this.sync();
  }

  get speed() { return this.vel.length(); }
  get groundSpeed() { return Math.hypot(this.vel.x, this.vel.z); }

  /** Launch the ball. dir is a unit vector (may include elevation). */
  strike(vel, spin = null, by = null) {
    this.vel.copy(vel);
    if (spin) this.spin.copy(spin);
    this.lastTouch = by;
    this.onGround = this.pos.y <= R + 0.01 && vel.y <= 0;
    if (vel.length() > 16) this.trailHeat = 1;
  }

  update(dt) {
    this.events.length = 0;
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this._step(h);
    this.sync(dt);
    return this.events;
  }

  _step(h) {
    const p = this.pos, v = this.vel, w = this.spin;

    const grounded = p.y <= R + 0.002 && Math.abs(v.y) < 0.35;
    if (!grounded) {
      v.y -= BALL.gravity * h;
      // quadratic drag
      const s = v.length();
      if (s > 0) v.multiplyScalar(Math.max(0, 1 - BALL.drag * s * h));
      // Magnus curl (mostly from side spin)
      v.x += BALL.magnus * (w.y * v.z - w.z * v.y) * h;
      v.z += BALL.magnus * (w.x * v.y - w.y * v.x) * h;
      v.y += BALL.magnus * 0.4 * (w.z * v.x - w.x * v.z) * h;
      w.multiplyScalar(Math.max(0, 1 - 0.25 * h));
    } else {
      // rolling: resistance + spin locks to rolling motion
      v.y = 0; p.y = R;
      const gs = Math.hypot(v.x, v.z);
      if (gs > 0) {
        const dec = (BALL.rollDecel + 0.012 * gs * gs) * h;
        const k = Math.max(0, gs - dec) / gs;
        v.x *= k; v.z *= k;
        // leftover side spin bends a rolling ball a touch, then fades
        v.x += BALL.magnus * 0.25 * w.y * v.z * h;
        v.z -= BALL.magnus * 0.25 * w.y * v.x * h;
      }
      w.set(v.z / R, w.y * Math.max(0, 1 - 2.5 * h), -v.x / R);
      if (gs < 0.02) { v.x = 0; v.z = 0; }
    }

    p.addScaledVector(v, h);

    // ground bounce
    if (p.y < R) {
      p.y = R;
      if (v.y < -0.35) {
        const impact = -v.y;
        v.y = impact * BALL.bounce * (impact > 6 ? 1 : 0.9);
        if (v.y < 0.6) v.y = 0;
        // friction at contact couples spin and horizontal velocity
        const contactX = v.x + w.z * R, contactZ = v.z - w.x * R;
        v.x -= contactX * (1 - BALL.bounceFriction) * 0.9;
        v.z -= contactZ * (1 - BALL.bounceFriction) * 0.9;
        w.x = v.z / R * 0.6 + w.x * 0.4; w.z = -v.x / R * 0.6 + w.z * 0.4;
        if (impact > 1.2) this.events.push({ type: 'bounce', v: impact });
      } else v.y = 0;
    }

    this._collideWorld();
  }

  _collideWorld() {
    const p = this.pos, v = this.vel;
    const inGoalX = Math.abs(p.x) > L - R;
    const side = Math.sign(p.x) || 1;

    // side walls (boards + fence), treated as infinitely high
    if (Math.abs(p.z) > W - R && Math.abs(p.x) <= L + 0.01) {
      p.z = Math.sign(p.z) * (W - R);
      if (v.z * Math.sign(p.z) > 0) {
        const s = Math.abs(v.z);
        v.z = -v.z * BALL.wallBounce; v.x *= 0.92;
        if (s > 1.5) this.events.push({ type: 'board', v: s });
      }
    }

    if (inGoalX) {
      const mouth = Math.abs(p.z) < GW - R * 0.2 && p.y < GH - R * 0.2;
      const insideGoal = Math.abs(p.x) > L;
      if (!insideGoal && !mouth) {
        // hits the end board / fence above the crossbar
        p.x = side * (L - R);
        if (v.x * side > 0) {
          const s = Math.abs(v.x);
          v.x = -v.x * BALL.wallBounce; v.z *= 0.92;
          if (s > 1.5) this.events.push({ type: 'board', v: s });
        }
      }
      if (insideGoal) {
        // inside the goal box: nets absorb the ball
        let hitNet = 0;
        if (Math.abs(p.z) > GW - R) { p.z = Math.sign(p.z) * (GW - R); if (v.z * Math.sign(p.z) > 0) { hitNet = Math.max(hitNet, Math.abs(v.z)); v.z *= -BALL.netDamp; v.x *= 0.7; } }
        if (p.y > GH - R) { p.y = GH - R; if (v.y > 0) { hitNet = Math.max(hitNet, v.y); v.y *= -BALL.netDamp; } }
        if (Math.abs(p.x) > L + GD - R) {
          p.x = side * (L + GD - R);
          if (v.x * side > 0) { hitNet = Math.max(hitNet, Math.abs(v.x)); this.events.push({ type: 'backnet', v: Math.abs(v.x), side, y: p.y, z: p.z }); v.x *= -0.06; v.z *= 0.35; v.y *= 0.4; }
        }
        if (hitNet > 2) this.events.push({ type: 'net', v: hitNet });
        if (!this.goalSide && Math.abs(p.x) > L + R && Math.abs(p.z) < GW && p.y < GH) {
          this.goalSide = side;
          this.events.push({ type: 'goal', side });
        }
      }
    }

    // once a goal is in, the net holds the ball (it can't dribble back out)
    if (this.goalSide && Math.abs(p.x) < L + R) {
      p.x = this.goalSide * (L + R);
      if (v.x * this.goalSide < 0) v.x *= -0.1;
    }

    // goal frame: posts and crossbars as capsules
    if (Math.abs(Math.abs(p.x) - L) < R + postR + 0.05) {
      const px = side * L;
      this._capsule(px, 0, -GW, px, GH, -GW);
      this._capsule(px, 0, GW, px, GH, GW);
      this._capsule(px, GH, -GW, px, GH, GW);
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
    }
  }

  sync(dt = 0) {
    this.mesh.position.copy(this.pos);
    if (dt > 0) {
      const w = this.spin.length();
      if (w > 1e-4) {
        this._tmp.copy(this.spin).divideScalar(w);
        this._q.setFromAxisAngle(this._tmp, w * dt);
        this.mesh.quaternion.premultiply(this._q);
      }
    }
    const hgt = this.pos.y - R;
    const s = 0.34 + hgt * 0.25;
    this.blob.position.set(this.pos.x, 0.012, this.pos.z);
    this.blob.scale.set(s, s, 1);
    this.blob.material.opacity = Math.max(0.15, 1 - hgt * 0.22);

    // trail
    if (dt > 0) {
      for (let i = this.trailN - 1; i > 0; i--) this.trailPts[i].copy(this.trailPts[i - 1]);
      this.trailPts[0].copy(this.pos);
      if (this.speed < 10) this.trailHeat = Math.max(0, this.trailHeat - dt * 2.5);
      const pa = this.trail.geometry.attributes.position.array, ca = this.trail.geometry.attributes.color.array;
      for (let i = 0; i < this.trailN; i++) {
        this.trailPts[i].toArray(pa, i * 3);
        const a = this.trailHeat * (1 - i / this.trailN) * 0.8;
        ca.set([1, 0.95, 0.8, a], i * 4);
      }
      this.trail.geometry.attributes.position.needsUpdate = true;
      this.trail.geometry.attributes.color.needsUpdate = true;
      this.trail.visible = this.trailHeat > 0.01;
    }
  }

  /** Predict where the ball will be after t seconds (ignores walls, good enough for AI). */
  predict(t, out = new THREE.Vector3()) {
    out.copy(this.pos);
    const gs = this.groundSpeed;
    if (this.pos.y <= R + 0.05 && Math.abs(this.vel.y) < 0.5) {
      const stopT = gs / (BALL.rollDecel + 0.012 * gs * gs + 1e-6);
      const tt = Math.min(t, stopT);
      const dist = gs * tt - 0.5 * (gs / Math.max(stopT, 1e-3)) * tt * tt;
      if (gs > 0) { out.x += (this.vel.x / gs) * dist; out.z += (this.vel.z / gs) * dist; }
    } else {
      out.x += this.vel.x * t * 0.92; out.z += this.vel.z * t * 0.92;
      out.y = Math.max(R, this.pos.y + this.vel.y * t - 0.5 * BALL.gravity * t * t);
    }
    out.x = Math.max(-L + R, Math.min(L - R, out.x));
    out.z = Math.max(-W + R, Math.min(W - R, out.z));
    return out;
  }
}

export { UP };
