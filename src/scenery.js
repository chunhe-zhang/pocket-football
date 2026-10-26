import * as THREE from 'three';
import { FIELD } from './config.js';

// Everything round the pitch that isn't grass or flowers: candy-coloured stands packed with
// bouncing fans, bunting, hot-air balloons, a ferris wheel and a castle on the horizon,
// a rainbow, drifting clouds, and fireworks when somebody scores. Rebuilt per arena.

const rnd = (a, b) => a + Math.random() * (b - a);
const PASTEL = [0xff8fc4, 0xffd23f, 0x7fd8ff, 0xa98bff, 0x7fe0a0, 0xff9f6b, 0xfff1a8];

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// a little cheering fan: body in white (tinted per fan), head with hair on top
const FAN_BODY = () => canvasTex(64, 64, (g) => {
  g.fillStyle = '#fff';
  g.beginPath(); g.ellipse(32, 50, 17, 14, 0, 0, Math.PI * 2); g.fill();                 // body
  g.lineWidth = 7; g.strokeStyle = '#fff'; g.lineCap = 'round';
  g.beginPath(); g.moveTo(18, 44); g.lineTo(9, 26); g.moveTo(46, 44); g.lineTo(55, 26); g.stroke();   // arms up
});
const FAN_HEAD = (hair) => canvasTex(64, 64, (g) => {
  g.fillStyle = '#ffe1cc'; g.beginPath(); g.arc(32, 34, 17, 0, Math.PI * 2); g.fill();
  g.fillStyle = hair; g.beginPath(); g.arc(32, 30, 18, Math.PI * 1.02, Math.PI * 1.98); g.fill();
  g.fillRect(14, 26, 6, 14); g.fillRect(44, 26, 6, 14);
  g.fillStyle = '#3a2a3a'; g.beginPath(); g.arc(25, 37, 2.4, 0, Math.PI * 2); g.arc(39, 37, 2.4, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ff8fa8'; g.beginPath(); g.arc(21, 42, 3, 0, Math.PI * 2); g.arc(43, 42, 3, 0, Math.PI * 2); g.fill();
});

export class Scenery {
  constructor(scene) {
    this.scene = scene;
    this.root = null;
    this.fw = [];               // fireworks
    this.excite = 0;
    this._tex = { body: FAN_BODY(), heads: ['#5a3a2a', '#f2c14e', '#e86a8a', '#6a7bd8', '#2a2a3a'].map(FAN_HEAD) };
  }

  build() {
    if (this.root) { this.scene.remove(this.root); this.root.traverse((o) => { o.geometry?.dispose?.(); }); }
    this.root = new THREE.Group(); this.scene.add(this.root);
    const HX = FIELD.hx, HZ = FIELD.hz;
    this.fans = [];
    // stands: the far side and both ends (the camera side stays open)
    const back = HZ + 3.2, side = HX + 3.4;
    this._stand(0, -back, 2 * HX + 4, 0);                 // far side, facing +z
    this._stand(-side - 0.6, 0, 2 * HZ - 1, Math.PI / 2);  // left end, facing +x
    this._stand(side + 0.6, 0, 2 * HZ - 1, -Math.PI / 2);  // right end
    this._buildCrowd();
    this._bunting(HX, HZ);
    this._balloons(HX);
    this._ferrisWheel(-HX - 38, -HZ - 48);
    this._castle(HX + 34, -HZ - 55);
    this._rainbow(-HZ - 95);
    this._clouds();
    this._fireworks();
  }

  /** a block of stepped, candy-striped seating with a canopy */
  _stand(cx, cz, len, rotY) {
    const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = rotY;
    const tiers = 5, depth = 1.3, step = 0.55;
    for (let k = 0; k < tiers; k++) {
      const col = PASTEL[(k * 2) % PASTEL.length];
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, step * (k + 1), depth), new THREE.MeshLambertMaterial({ color: col }));
      m.position.set(0, (step * (k + 1)) / 2, -k * depth); m.castShadow = k === tiers - 1; m.receiveShadow = true; g.add(m);
      // white seat edge
      const e = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.12), new THREE.MeshLambertMaterial({ color: 0xffffff }));
      e.position.set(0, step * (k + 1) + 0.03, -k * depth + depth / 2 - 0.06); g.add(e);
      // fan spots on this tier
      for (let x = -len / 2 + 0.5; x < len / 2 - 0.4; x += 0.7) {
        if (Math.random() < 0.12) continue;
        const p = new THREE.Vector3(x + rnd(-0.08, 0.08), step * (k + 1), -k * depth + rnd(-0.15, 0.15));
        this.fans.push({ local: p, g });
      }
    }
    // a striped back wall with a scalloped trim (no roof: it would hide the fans from the camera)
    const wallH = 1.6, wy = step * tiers + wallH / 2, wz = -(tiers - 1) * depth - depth / 2 - 0.1;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(len, wallH, 0.2), new THREE.MeshLambertMaterial({ map: canvasTex(256, 32, (c, w, h) => { for (let i = 0; i < 16; i++) { c.fillStyle = i % 2 ? '#ffffff' : '#ff8fc4'; c.fillRect((i * w) / 16, 0, w / 16 + 1, h); } }) }));
    wall.position.set(0, wy, wz); g.add(wall);
    for (let x = -len / 2; x < len / 2; x += 0.9) {
      const sc = new THREE.Mesh(new THREE.CircleGeometry(0.45, 12, 0, Math.PI), new THREE.MeshLambertMaterial({ color: PASTEL[Math.floor(Math.abs(x * 1.3)) % PASTEL.length], side: THREE.DoubleSide }));
      sc.position.set(x + 0.45, wy + wallH / 2, wz); g.add(sc);
    }
    // bunches of party balloons at both ends of the stand
    for (const ex of [-len / 2 - 0.4, len / 2 + 0.4]) this._balloonBunch(g, ex, 0, -1.5);
    this.root.add(g);
  }

  _buildCrowd() {
    const n = this.fans.length;
    const make = (map, size) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map, size, vertexColors: true, alphaTest: 0.5, transparent: false }));
      pts.frustumCulled = false; this.root.add(pts); return pts;
    };
    this.bodies = make(this._tex.body, 2.9);
    // heads in five hair colours
    this.headSets = this._tex.heads.map((t) => make(t, 2.2));
    const w = new THREE.Vector3(), c = new THREE.Color();
    this.root.updateMatrixWorld(true);
    this.fans.forEach((f, i) => {
      f.g.updateMatrixWorld(true);
      w.copy(f.local).applyMatrix4(f.g.matrixWorld);
      f.base = w.clone(); f.ph = Math.random() * 6.28; f.sp = rnd(5, 9); f.hs = Math.floor(Math.random() * this.headSets.length);
      c.setHex(PASTEL[Math.floor(Math.random() * PASTEL.length)]).offsetHSL(0, 0, rnd(-0.08, 0.05));
      this.bodies.geometry.attributes.color.setXYZ(i, c.r, c.g, c.b);
      for (const hs of this.headSets) hs.geometry.attributes.color.setXYZ(i, 1, 1, 1);
    });
    this.bodies.geometry.attributes.color.needsUpdate = true;
  }

  _bunting(HX, HZ) {
    // strings of little flags over the boards on the three open sides
    const tri = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.16, 0), new THREE.Vector2(0.16, 0), new THREE.Vector2(0, -0.36)]));
    const runs = [[[-HX - 1, -HZ - 1.2], [HX + 1, -HZ - 1.2]], [[-HX - 1.2, -HZ - 1], [-HX - 1.2, HZ + 1]], [[HX + 1.2, -HZ - 1], [HX + 1.2, HZ + 1]]];
    const flags = [];
    for (const [a, b] of runs) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.floor(L / 0.55), segs = Math.max(1, Math.round(L / 8));
      for (let i = 0; i <= n; i++) {
        const u = i / n, x = a[0] + (b[0] - a[0]) * u, z = a[1] + (b[1] - a[1]) * u;
        const su = (u * segs) % 1, y = 3.6 - Math.sin(su * Math.PI) * 0.7;
        flags.push({ x, y, z, ang: Math.atan2(b[0] - a[0], b[1] - a[1]) + Math.PI / 2 });
      }
      for (let s = 0; s <= segs; s++) {
        const u = s / segs, pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.7, 6), new THREE.MeshLambertMaterial({ color: 0xffffff }));
        pole.position.set(a[0] + (b[0] - a[0]) * u, 1.85, a[1] + (b[1] - a[1]) * u); this.root.add(pole);
      }
    }
    const inst = new THREE.InstancedMesh(tri, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), flags.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    flags.forEach((f, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.ang);
      m4.compose(new THREE.Vector3(f.x, f.y, f.z), q, new THREE.Vector3(1, 1, 1)); inst.setMatrixAt(i, m4);
      inst.setColorAt(i, c.setHSL((i * 0.13) % 1, 0.85, 0.62));
    });
    this.flags = { inst, list: flags };
    this.root.add(inst);
  }

  _balloonBunch(parent, x, y, z) {
    const g = new THREE.Group(); g.position.set(x, y, z);
    for (let k = 0; k < 7; k++) {
      const h = 3.2 + Math.random() * 1.8, a = (k / 7) * Math.PI * 2, r = k ? 0.45 : 0;
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.38, 14, 12), new THREE.MeshLambertMaterial({ color: PASTEL[(k + Math.floor(x)) % PASTEL.length], emissive: 0xffffff, emissiveIntensity: 0.12 }));
      b.scale.set(1, 1.18, 1); b.position.set(Math.cos(a) * r, h, Math.sin(a) * r); g.add(b);
      const str = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, h, 3), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      str.position.set(Math.cos(a) * r * 0.5, h / 2, Math.sin(a) * r * 0.5); g.add(str);
    }
    (this.bunches || (this.bunches = [])).push(g);
    parent.add(g);
  }

  _balloons(HX) {
    this.balloons = [];
    const stripes = (a, b) => canvasTex(128, 64, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? a : b; g.fillRect((i * w) / 8, 0, w / 8 + 1, h); } });
    const cols = [['#ff6fa8', '#ffe066'], ['#7fd8ff', '#ffffff'], ['#a98bff', '#ffd1e6'], ['#7fe0a0', '#ff9f6b']];
    for (let k = 0; k < 4; k++) {
      const g = new THREE.Group();
      const env = new THREE.Mesh(new THREE.SphereGeometry(2.4, 24, 18), new THREE.MeshLambertMaterial({ map: stripes(...cols[k]) }));
      env.scale.set(1, 1.18, 1); g.add(env);
      const neck = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.6, 16, 1, true), new THREE.MeshLambertMaterial({ color: new THREE.Color(cols[k][0]), side: THREE.DoubleSide }));
      neck.rotation.x = Math.PI; neck.position.y = -2.9; g.add(neck);
      const basket = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), new THREE.MeshLambertMaterial({ color: 0x9a6a44 }));
      basket.position.y = -4.3; g.add(basket);
      const a = (k / 4) * Math.PI * 2 + 0.6, r = HX + 16 + k * 5;
      this.balloons.push({ g, a, r, h: 11 + k * 2.5, sp: 0.012 + k * 0.004, ph: k * 1.7 });
      this.root.add(g);
    }
  }

  _ferrisWheel(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const R = 11, hub = R + 2.5;
    const white = new THREE.MeshLambertMaterial({ color: 0xffffff }), pink = new THREE.MeshLambertMaterial({ color: 0xff8fc4 });
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, hub * 1.15, 8), white);
      leg.position.set(s * 3.6, hub / 2, 0); leg.rotation.z = s * 0.28; g.add(leg);
    }
    const wheel = new THREE.Group(); wheel.position.y = hub; g.add(wheel);
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.32, 8, 48), pink));
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(R * 0.55, 0.2, 8, 36), white));
    for (let i = 0; i < 12; i++) {
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, R * 2, 6), white); sp.rotation.z = (i / 12) * Math.PI; wheel.add(sp);
    }
    this.gondolas = [];
    for (let i = 0; i < 12; i++) {
      const go = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.4, 1.4), new THREE.MeshLambertMaterial({ color: PASTEL[i % PASTEL.length] }));
      g.add(go); this.gondolas.push({ go, a: (i / 12) * Math.PI * 2 });
    }
    this.wheel = { g, wheel, R, hub, a: 0 };
    this.root.add(g);
  }

  _castle(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = -0.5;
    const wall = new THREE.MeshLambertMaterial({ color: 0xfff0f6 }), roofA = new THREE.MeshLambertMaterial({ color: 0xff7fb5 }), roofB = new THREE.MeshLambertMaterial({ color: 0x7fb8ff });
    const keep = new THREE.Mesh(new THREE.BoxGeometry(12, 9, 8), wall); keep.position.y = 4.5; g.add(keep);
    const tower = (tx, tz, r, h, roof) => {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16), wall); t.position.set(tx, h / 2, tz); g.add(t);
      const c = new THREE.Mesh(new THREE.ConeGeometry(r * 1.25, r * 2.6, 16), roof); c.position.set(tx, h + r * 1.3, tz); g.add(c);
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.8), new THREE.MeshLambertMaterial({ color: 0xffd23f, side: THREE.DoubleSide }));
      fl.position.set(tx + 0.7, h + r * 2.6 + 0.6, tz); g.add(fl);
    };
    tower(-6.5, 4, 2, 13, roofA); tower(6.5, 4, 2, 13, roofB); tower(-6.5, -4, 1.8, 11, roofB); tower(6.5, -4, 1.8, 11, roofA); tower(0, 0, 2.6, 17, roofA);
    const door = new THREE.Mesh(new THREE.CircleGeometry(1.8, 16, 0, Math.PI), new THREE.MeshLambertMaterial({ color: 0xa98bff }));
    door.position.set(0, 0, 4.02); g.add(door);
    this.root.add(g);
  }

  _rainbow(z) {
    const cols = [0xff6b6b, 0xffa94d, 0xffe066, 0x69db7c, 0x4dabf7, 0x9775fa];
    cols.forEach((c, i) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(70 - i * 2.2, 1.1, 8, 64, Math.PI), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, fog: false }));
      m.position.set(0, -8, z); this.root.add(m);
    });
  }

  _clouds() {
    this.clouds = [];
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.35, flatShading: true });
    for (let k = 0; k < 9; k++) {
      const g = new THREE.Group();
      for (let p = 0; p < 5; p++) { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(rnd(2.2, 3.8), 1), mat); s.position.set(p * 2.6 - 5, rnd(-0.6, 0.8), rnd(-1, 1)); g.add(s); }
      g.position.set(rnd(-90, 90), rnd(28, 44), rnd(-110, -50)); g.scale.setScalar(rnd(0.9, 1.6));
      this.clouds.push({ g, sp: rnd(0.4, 1.0) }); this.root.add(g);
    }
  }

  _fireworks() {
    const n = 360, geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const dot = canvasTex(32, 32, (g) => { const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); });
    this.fwPts = new THREE.Points(geo, new THREE.PointsMaterial({ map: dot, size: 0.9, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.fwPts.frustumCulled = false; this.root.add(this.fwPts);
    this.fwP = Array.from({ length: n }, () => ({ p: new THREE.Vector3(0, -50, 0), v: new THREE.Vector3(), life: 0 }));
    this.fwNext = 0; this.fwQueue = 0; this.fwT = 0;
  }

  /** a goal: fans jump, fireworks go up over the stands */
  celebrate() { this.excite = 1; this.fwQueue = 6; }

  _burst() {
    const HX = FIELD.hx, HZ = FIELD.hz, c = new THREE.Color().setHSL(Math.random(), 0.9, 0.62);
    const o = new THREE.Vector3(rnd(-HX, HX), rnd(13, 19), -HZ - rnd(6, 12));
    for (let k = 0; k < 60; k++) {
      const P = this.fwP[this.fwNext]; this.fwNext = (this.fwNext + 1) % this.fwP.length;
      P.p.copy(o); P.v.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(5, 8)); P.life = rnd(1.0, 1.6); P.c = c;
    }
  }

  update(dt, t) {
    if (!this.root) return;
    this.excite = Math.max(0, this.excite - dt * 0.25);
    // fans: a gentle bounce, everyone on their feet after a goal
    const B = this.bodies.geometry.attributes.position, amp = 0.05 + this.excite * 0.35;
    this.fans.forEach((f, i) => {
      const y = Math.max(0, Math.sin(t * f.sp + f.ph)) * amp;
      B.setXYZ(i, f.base.x, f.base.y + 0.5 + y, f.base.z);
      this.headSets.forEach((hs, k) => hs.geometry.attributes.position.setXYZ(i, f.base.x, k === f.hs ? f.base.y + 1.0 + y : -99, f.base.z));
    });
    B.needsUpdate = true; for (const hs of this.headSets) hs.geometry.attributes.position.needsUpdate = true;
    // balloons drift round, bobbing
    for (const b of this.balloons) { b.a += b.sp * dt; b.g.position.set(Math.cos(b.a) * b.r, b.h + Math.sin(t * 0.4 + b.ph) * 1.2, -FIELD.hz - 10 - Math.abs(Math.sin(b.a)) * 12); }
    for (const [i, g] of (this.bunches || []).entries()) g.rotation.z = Math.sin(t * 1.3 + i) * 0.06;
    // ferris wheel turns
    const W = this.wheel; W.a += dt * 0.12; W.wheel.rotation.z = W.a;
    for (const go of this.gondolas) { const a = go.a + W.a; go.go.position.set(Math.cos(a) * W.R, W.hub + Math.sin(a) * W.R - 1, 0); }
    for (const c of this.clouds) { c.g.position.x += c.sp * dt; if (c.g.position.x > 110) c.g.position.x = -110; }
    // fireworks
    if (this.fwQueue > 0) { this.fwT -= dt; if (this.fwT <= 0) { this._burst(); this.fwQueue--; this.fwT = 0.35; } }
    const P = this.fwPts.geometry.attributes.position, C = this.fwPts.geometry.attributes.color;
    this.fwP.forEach((p, i) => {
      if (p.life > 0) { p.life -= dt; p.v.y -= 3 * dt; p.v.multiplyScalar(1 - dt * 0.8); p.p.addScaledVector(p.v, dt); const k = Math.max(0, p.life); C.setXYZ(i, p.c.r * k, p.c.g * k, p.c.b * k); }
      else { C.setXYZ(i, 0, 0, 0); }
      P.setXYZ(i, p.p.x, p.life > 0 ? p.p.y : -60, p.p.z);
    });
    P.needsUpdate = true; C.needsUpdate = true;
  }
}
