import * as THREE from 'three';
import { FIELD, BALL, goalIndexFor } from './config.js';

const { half: H, goalHalfW: GW, goalH: GH, goalDepth: GD, postR } = FIELD;
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
      this._s.setLength(R * 0.95 * (1 - u * 0.7));
      pa.set([p.x + this._s.x, p.y, p.z + this._s.z, p.x - this._s.x, p.y, p.z - this._s.z], i * 6);
      this.col.setHSL((u * 1.2 - this.t * 0.6) % 1 + 1, 0.95, 0.6);
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

    // root (position) → squash node (deforms along an impact axis) → spinning mesh
    this.root = new THREE.Group();
    this.squashNode = new THREE.Group();
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 40), ballMaterial());
    this.mesh.castShadow = true;
    this.root.add(this.squashNode); this.squashNode.add(this.mesh);
    scene.add(this.root);
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
    this.sq.amp = 0;
    this.trail.reset(this.pos);
    this.sync();
  }

  get speed() { return this.vel.length(); }
  get groundSpeed() { return Math.hypot(this.vel.x, this.vel.z); }

  strike(vel, spin = null, by = null) {
    this.vel.copy(vel);
    if (spin) this.spin.copy(spin);
    this.lastTouch = by;
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
    this._goalFrames();
    this._bodies();
  }

  // the ball meets heads, chests, thighs, shins and boots as real spheres
  _bodies() {
    const p = this.pos, v = this.vel;
    for (const c of this.colliders) {
      const dx = p.x - c.pos.x, dy = p.y - c.pos.y, dz = p.z - c.pos.z;
      const d = Math.hypot(dx, dy, dz), min = R + c.r;
      if (d >= min || d < 1e-6) continue;
      const nx = dx / d, ny = dy / d, nz = dz / d;
      p.set(c.pos.x + nx * min, Math.max(R, c.pos.y + ny * min), c.pos.z + nz * min);
      const rvx = v.x - c.vel.x, rvy = v.y - c.vel.y, rvz = v.z - c.vel.z;
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
    const p = this.pos, v = this.vel;
    if (Math.abs(p[A]) <= H - R) return;
    const side = Math.sign(p[A]) || 1;
    if (this.goalTeam >= 0) {
      const g = goalIndexFor(A, side);
      if (g !== this.goalTeam && Math.abs(p[A]) > H) return;
    }
    const mouth = Math.abs(p[B]) < GW - R * 0.2 && p.y < GH - R * 0.2;
    const inside = Math.abs(p[A]) > H;
    if (!inside && !mouth) {
      // never let a ball that is inside the other axis' goal be bounced by this wall
      if (Math.abs(p[B]) > H) return;
      p[A] = side * (H - R);
      if (v[A] * side > 0) {
        const s = Math.abs(v[A]);
        v[A] = -v[A] * BALL.wallBounce - side * (s > 6 ? BALL.wallKick : 0);
        v[B] *= 0.96;
        if (s > 1.5) this.events.push({ type: 'board', v: s });
        if (s > 4) this.events.push({ type: 'squash', n: A === 'x' ? [1, 0, 0] : [0, 0, 1], a: s / 50 });
      }
      return;
    }
    if (inside) {
      let hitNet = 0;
      if (Math.abs(p[B]) > GW - R) { const sb = Math.sign(p[B]); p[B] = sb * (GW - R); if (v[B] * sb > 0) { hitNet = Math.max(hitNet, Math.abs(v[B])); v[B] *= -BALL.netDamp; v[A] *= 0.7; } }
      if (p.y > GH - R) { p.y = GH - R; if (v.y > 0) { hitNet = Math.max(hitNet, v.y); v.y *= -BALL.netDamp; } }
      if (Math.abs(p[A]) > H + GD - R) {
        p[A] = side * (H + GD - R);
        if (v[A] * side > 0) {
          hitNet = Math.max(hitNet, Math.abs(v[A]));
          this.events.push({ type: 'backnet', v: Math.abs(v[A]), team: goalIndexFor(A, side), y: p.y, along: p[B] });
          v[A] *= -0.06; v[B] *= 0.35; v.y *= 0.4;
        }
      }
      if (hitNet > 2) this.events.push({ type: 'net', v: hitNet });
      if (this.goalTeam < 0 && Math.abs(p[A]) > H + R && Math.abs(p[B]) < GW && p.y < GH) {
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

  _goalFrames() {
    const p = this.pos;
    for (const A of ['x', 'z']) {
      if (Math.abs(Math.abs(p[A]) - H) > R + postR + 0.05) continue;
      const s = Math.sign(p[A]) || 1;
      const pt = (a, y, b) => (A === 'x' ? [s * H, y, b] : [b, y, s * H]);
      this._capsule(...pt(0, 0, -GW), ...pt(0, GH, -GW));
      this._capsule(...pt(0, 0, GW), ...pt(0, GH, GW));
      this._capsule(...pt(0, GH, -GW), ...pt(0, GH, GW));
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
    const s = R * 3.1 + hgt * 0.25;
    this.blob.position.set(this.pos.x, 0.012, this.pos.z);
    this.blob.scale.set(s, s, 1);
    this.blob.material.opacity = Math.max(0.15, 1 - hgt * 0.22);
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
    out.x = Math.max(-H + R, Math.min(H - R, out.x));
    out.z = Math.max(-H + R, Math.min(H - R, out.z));
    return out;
  }
}

export { UP };
