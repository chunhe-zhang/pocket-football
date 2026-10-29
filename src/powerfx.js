import * as THREE from 'three';
import { FireFlame, installFireSprite } from './fire-flame.js';
import { WindPresence, EarthPresence, ShadowPresence } from './element-presence.js';

// Big, readable effects for the characters' skill moves (过人): proper flames, ice spikes,
// wind wings and a whirlwind, lightning flashes, ghost after-images and shockwaves.
// Built from additive sprites and a few meshes so they read from the far broadcast camera.
// start(athlete, kind) is called on host and guests alike (the host mirrors it as an event).

function tex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const radial = (stops) => tex(128, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
});

const TEX = {};
function textures() {
  if (TEX.flame) return TEX;
  TEX.flame = radial([[0, 'rgba(255,250,200,1)'], [0.2, 'rgba(255,210,60,0.95)'], [0.45, 'rgba(255,110,20,0.85)'], [0.75, 'rgba(220,40,10,0.45)'], [1, 'rgba(160,20,0,0)']]);
  TEX.glow = radial([[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]);
  TEX.smoke = radial([[0, 'rgba(90,85,95,0.75)'], [0.6, 'rgba(80,75,85,0.35)'], [1, 'rgba(70,65,75,0)']]);
  TEX.snow = tex(128, (g, s) => {
    g.translate(s / 2, s / 2); g.strokeStyle = 'rgba(235,250,255,1)'; g.lineCap = 'round';
    for (let k = 0; k < 6; k++) {
      g.rotate(Math.PI / 3); g.lineWidth = 7; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -52); g.stroke();
      g.lineWidth = 5; for (const y of [-22, -38]) { g.beginPath(); g.moveTo(0, y); g.lineTo(12, y - 12); g.moveTo(0, y); g.lineTo(-12, y - 12); g.stroke(); }
    }
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 30); gr.addColorStop(0, 'rgba(180,235,255,0.9)'); gr.addColorStop(1, 'rgba(180,235,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 30, 0, Math.PI * 2); g.fill();
  });
  TEX.wind = tex(128, (g, s) => {
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineCap = 'round';
    for (let k = 0; k < 3; k++) { g.lineWidth = 7 - k * 2; g.beginPath(); g.arc(s / 2, s / 2, 22 + k * 16, -0.3, Math.PI * 0.9); g.stroke(); }
  });
  TEX.ring = tex(256, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.25)'); gr.addColorStop(0.85, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
  TEX.swirl = tex(256, (g, s) => {
    g.clearRect(0, 0, s, s);
    for (let k = 0; k < 7; k++) {
      const y = (k / 7) * s;
      const gr = g.createLinearGradient(0, y, s, y + 30); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.strokeStyle = gr; g.lineWidth = 10; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(s * 0.3, y + 25, s * 0.7, y - 15, s, y + 30); g.stroke();
    }
  });
  TEX.swirl.wrapS = TEX.swirl.wrapT = THREE.RepeatWrapping;
  TEX.feather = tex(256, (g, s) => {
    // a feathered wing, pointing up and out to the right
    g.translate(20, s - 20);
    for (let k = 0; k < 7; k++) {
      const a = -0.25 - k * 0.19, L = 150 + k * 12 - (k > 4 ? (k - 4) * 30 : 0);
      g.save(); g.rotate(a);
      const gr = g.createLinearGradient(0, 0, L, 0); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(210,255,225,0.75)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(L / 2, 0, L / 2, 15, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(40,160,90,0.95)'; g.lineWidth = 4; g.stroke();
      g.strokeStyle = 'rgba(120,230,160,0.8)'; g.lineWidth = 2; g.beginPath(); g.moveTo(4, 0); g.lineTo(L - 6, 0); g.stroke();
      g.restore();
    }
  });
  TEX.portal = tex(256, (g, s) => {
    g.translate(s / 2, s / 2);
    for (let k = 0; k < 5; k++) {
      g.rotate((Math.PI * 2) / 5);
      const gr = g.createLinearGradient(0, 0, s / 2, 0); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(160,100,255,0)');
      g.strokeStyle = gr; g.lineWidth = 14; g.beginPath(); g.moveTo(0, 0);
      for (let r = 0; r < s / 2; r += 4) g.lineTo(Math.cos(r / 26) * r, Math.sin(r / 26) * r);
      g.stroke();
    }
    const gr = g.createRadialGradient(0, 0, s * 0.3, 0, 0, s / 2); gr.addColorStop(0, 'rgba(180,120,255,0)'); gr.addColorStop(0.85, 'rgba(200,150,255,0.9)'); gr.addColorStop(1, 'rgba(200,150,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, s / 2, 0, Math.PI * 2); g.fill();
  });
  TEX.hitbox = tex(256, (g, s) => {
    // a rounded slab on the grass: soft glowing fill, bright rim, chevrons pointing the way it slides
    const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    const gr = g.createLinearGradient(0, s, 0, 0); gr.addColorStop(0, 'rgba(255,255,255,0.08)'); gr.addColorStop(1, 'rgba(255,255,255,0.42)');
    rr(10, 10, s - 20, s - 20, 70); g.fillStyle = gr; g.fill();
    g.lineWidth = 12; g.strokeStyle = 'rgba(255,255,255,1)'; g.stroke();
    g.lineWidth = 9; g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineCap = 'round';
    for (const y of [70, 120, 170]) { g.beginPath(); g.moveTo(s * 0.3, y + 26); g.lineTo(s * 0.5, y); g.lineTo(s * 0.7, y + 26); g.stroke(); }
  });
  TEX.streak = tex(128, (g, s) => {
    const gr = g.createLinearGradient(0, 0, s, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, s * 0.42, s, s * 0.16);
  });
  return TEX;
}

const N = 320;
const SLIDE_COL = { thunder: 0x5fe1ff, blaze: 0xff6a2b, frost: 0x9fe6ff, gale: 0x6dff9a, phantom: 0xb58cff, cannon: 0xffd23f };

export class PowerFx {
  constructor(scene) {
    this.scene = scene;
    const T = textures();
    this.T = T;
    // pooled sprites
    this.sp = []; this.fireClock = { value: 0 };
    for (let i = 0; i < N; i++) {
      const m = new THREE.SpriteMaterial({ map: T.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      installFireSprite(m, this.fireClock, i * 1.73);
      const s = new THREE.Sprite(m); s.visible = false; s.renderOrder = 6; scene.add(s);
      this.sp.push({ s, life: 0, max: 1, vel: new THREE.Vector3(), s0: 1, s1: 1, grav: 0, spin: 0, a0: 1 });
    }
    this.next = 0;
    this.fx = [];
    // reusable meshes
    const flat = (map, color) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map, color, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })); m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 5; scene.add(m); return m; };
    this.ringA = flat(T.ring, 0xffffff); this.ringB = flat(T.ring, 0xffffff);
    // ice spikes
    this.spikes = new THREE.Group(); this.spikes.visible = false; scene.add(this.spikes);
    const iceMat = new THREE.MeshStandardMaterial({ color: 0xbfeaff, emissive: 0x4fb8ff, emissiveIntensity: 0.45, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.88 });
    this.iceMat = iceMat;
    for (let k = 0; k < 14; k++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.16 + (k % 3) * 0.05, 1, 5), iceMat);
      c.castShadow = true; c.userData.a = (k / 14) * Math.PI * 2 + (k % 2) * 0.15; c.userData.h = 0.6 + ((k * 7) % 5) * 0.16; c.userData.tilt = 0.25 + (k % 3) * 0.12;
      this.spikes.add(c);
    }
    // whirlwind under the cyclone leap
    const cone = new THREE.CylinderGeometry(0.95, 0.25, 1.8, 28, 1, true); cone.translate(0, 0.9, 0);
    this.twister = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ map: T.swirl, color: 0xbfffd5, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
    this.twister.visible = false; this.twister.renderOrder = 5; scene.add(this.twister);
    // wings
    const wingGeo = new THREE.PlaneGeometry(1.7, 1.7); wingGeo.translate(0.8, 0.65, 0);
    const wingMat = new THREE.MeshBasicMaterial({ map: T.feather, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, opacity: 0.95 });
    this.wings = new THREE.Group();
    this.wingR = new THREE.Mesh(wingGeo, wingMat); this.wingL = new THREE.Mesh(wingGeo, wingMat); this.wingL.scale.x = -1;
    this.wings.add(this.wingR, this.wingL); this.wings.visible = false; this.wings.renderOrder = 5; scene.add(this.wings);
    // a fire cloak and a frost cloak round the body while the move plays
    this.cloak = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 2.1, 24, 1, true).translate(0, 1.05, 0), new THREE.MeshBasicMaterial({ map: T.swirl, color: 0xff7a2a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
    this.cloak.visible = false; this.cloak.renderOrder = 5; scene.add(this.cloak);
    this._v = new THREE.Vector3();
    // pools for the shorter effects
    this.shocks = []; for (let i = 0; i < 8; i++) { const m = flat(T.ring, 0xffffff); this.shocks.push({ m, life: 0 }); }
    this.portals = []; for (let i = 0; i < 4; i++) {
      const m = flat(T.portal, 0xc49aff); m.material.blending = THREE.NormalBlending;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 3.2, 20, 1, true).translate(0, 1.6, 0), new THREE.MeshBasicMaterial({ map: T.swirl, color: 0x7a3cff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
      beam.visible = false; beam.renderOrder = 5; scene.add(beam);
      this.portals.push({ m, beam, life: 0 });
    }
    // slide tackles: the area the slide covers, drawn on the grass in the element's colour
    this.boxes = []; for (let i = 0; i < 6; i++) { const m = flat(T.hitbox, 0xffffff); m.material.blending = THREE.AdditiveBlending; this.boxes.push(m); }
    this.bolts = []; for (let i = 0; i < 24; i++) {
      const n = 12, g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
      const idx = []; for (let k = 0; k < n - 1; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } g.setIndex(idx);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xaef4ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
      m.frustumCulled = false; m.visible = false; m.renderOrder = 7; scene.add(m);
      this.bolts.push({ m, life: 0, a: new THREE.Vector3(), b: new THREE.Vector3(), w: 0.1, n });
    }
  }

  /** a pair of wings for one player (the cyclone's sprint) */
  _wingsFor(a) {
    this._wingMap = this._wingMap || new Map();
    let w = this._wingMap.get(a);
    if (!w) {
      const g = new THREE.Group();
      const R = new THREE.Mesh(this.wingR.geometry, this.wingR.material.clone()), L = new THREE.Mesh(this.wingR.geometry, R.material); L.scale.x = -1;
      g.add(R, L); g.visible = false; g.renderOrder = 5; this.scene.add(g);
      w = { g, R, L, k: 0 }; this._wingMap.set(a, w);
    }
    return w;
  }

  /**
   * Every frame: what sprinting looks like for each character, plus the fire / ice they leave.
   * patches: [{ x, z, kind: 'fire' | 'ice', life, max }]
   */
  trails(patches, athletes, dt) {
    const T = this.T;
    // ice: pale discs on the grass; fire: flames licking up off the ground
    this._iceDecals = this._iceDecals || [];
    let n = 0;
    for (const p of patches) {
      const u = p.life / p.max;
      if (p.kind === 'fire') {
        if (Math.random() < dt * 9) this.puff(T.flame, { x: p.x + (Math.random() - 0.5) * 0.4, y: 0.1, z: p.z + (Math.random() - 0.5) * 0.4 }, { x: 0, y: 1.5 + Math.random(), z: 0 }, 0.5, 0.5 * u + 0.15, 0.1, 0xffffff, -1, true, 0.9);
      } else {
        let d = this._iceDecals[n];
        if (!d) {
          d = new THREE.Mesh(new THREE.CircleGeometry(0.42, 18), new THREE.MeshStandardMaterial({ color: 0xd8f4ff, emissive: 0x6fc8ff, emissiveIntensity: 0.35, roughness: 0.05, metalness: 0.3, transparent: true, depthWrite: false }));
          d.rotation.x = -Math.PI / 2; d.renderOrder = 1; this.scene.add(d); this._iceDecals.push(d);
        }
        d.visible = true; d.position.set(p.x, 0.015 + n * 0.0001, p.z); d.material.opacity = 0.75 * Math.min(1, u * 3);
        if (Math.random() < dt * 1.5) this.puff(T.snow, { x: p.x, y: 0.15, z: p.z }, { x: 0, y: 0.5, z: 0 }, 0.5, 0.2, 0.3, 0xe6f8ff, 0, true);
        n++;
      }
    }
    for (let i = n; i < this._iceDecals.length; i++) this._iceDecals[i].visible = false;
    // the sprint itself
    for (const a of athletes) {
      const w = a.charId === 'gale' ? this._wingsFor(a) : null;
      const on = a.sprinting && !a.out;
      if (w) {
        w.k += ((on ? 1 : 0) - w.k) * Math.min(1, dt * 8);
        w.g.visible = w.k > 0.02;
        if (w.g.visible) {
          const flap = Math.sin(performance.now() / 1000 * 14) * 0.45;
          w.g.position.set(a.pos.x, a.char.root.position.y + 1.25, a.pos.z); w.g.rotation.set(0, a.facing, 0); w.g.translateZ(-0.2);
          w.g.scale.setScalar(w.k);
          w.R.rotation.set(0, -0.5 - flap * 0.4, 0.25 + flap); w.L.rotation.set(0, 0.5 + flap * 0.4, -0.25 - flap);
          w.R.material.opacity = 0.95 * w.k;
          if (on && Math.random() < dt * 8) this.puff(T.wind, { x: a.pos.x, y: 1.2, z: a.pos.z }, { x: -a.vel.x * 0.4, y: 0.4, z: -a.vel.z * 0.4 }, 0.35, 0.35, 0.6, 0x9fffc0, 0, false, 0.6);
        }
      }
      if (!on) continue;
      const p = a.pos, v = a.vel, vl = Math.hypot(v.x, v.z) || 1, bx = -v.x / vl, bz = -v.z / vl;
      if (a.charId === 'thunder') {
        if (this.refinedLightning) continue;
        if (Math.random() < dt * 14) this.bolt({ x: p.x + bx * 0.3, y: 0.3 + Math.random() * 1.2, z: p.z + bz * 0.3 }, { x: p.x + bx * (1 + Math.random()), y: Math.random() * 1.3, z: p.z + bz * (1 + Math.random()) + (Math.random() - 0.5) }, 0.1, 0.05);
        if (Math.random() < dt * 12) this.puff(T.glow, { x: p.x, y: 0.9, z: p.z }, { x: 0, y: 0, z: 0 }, 0.15, 0.8, 0.3, 0x3fb8ff, 0, false, 0.5);
      } else if (a.charId === 'blaze') {
        if (Math.random() < dt * 14) this.puff(T.flame, { x: p.x + bx * 0.3, y: 0.25 + Math.random() * 0.8, z: p.z + bz * 0.3 }, { x: bx * 2, y: 1.5, z: bz * 2 }, 0.4, 0.45, 0.1, 0xffffff, -1, true, 0.85);
      } else if (a.charId === 'frost') {
        if (Math.random() < dt * 10) this.puff(T.snow, { x: p.x + (Math.random() - 0.5) * 0.6, y: 0.4 + Math.random() * 1.2, z: p.z + (Math.random() - 0.5) * 0.6 }, { x: bx, y: 0.3, z: bz }, 0.6, 0.25, 0.35, 0xe6f8ff, 0, true);
      } else if (a.charId === 'phantom') {
        if (Math.random() < dt * 12) this.puff(T.glow, { x: p.x + bx * 0.4, y: 0.4 + Math.random() * 1.2, z: p.z + bz * 0.4 }, { x: 0, y: 0.6, z: 0 }, 0.5, 0.6, 0.15, 0x9060ff, 0, false, 0.7);
      } else if (a.charId === 'cannon') {
        if (Math.random() < dt * 12) this.puff(T.smoke, { x: p.x + bx * 0.5, y: 0.2, z: p.z + bz * 0.5 }, { x: bx, y: 0.5, z: bz }, 0.6, 0.4, 1.2, 0xffffff, -0.2, true, 0.55);
        if (Math.random() < dt * 10) this.puff(T.streak, { x: p.x + (Math.random() - 0.5), y: 0.5 + Math.random(), z: p.z + (Math.random() - 0.5) }, { x: -bx * 6, y: 0, z: -bz * 6 }, 0.15, 0.8, 1.1, 0xffe8a0, 0, false, 0.7);
      }
    }
  }

  /** a flat shockwave ring on the grass */
  shock(x, z, color, R1, life = 0.5, normal = false) {
    const S = this.shocks.find((q) => q.life <= 0) || this.shocks[0];
    Object.assign(S, { life, max: life, x, z, R1 }); S.m.material.color.set(color);
    S.m.material.blending = normal ? THREE.NormalBlending : THREE.AdditiveBlending; S.m.material.needsUpdate = true;
  }
  /** a purple portal on the ground with a beam of light */
  portal(x, z, life = 0.6) {
    const P = this.portals.find((q) => q.life <= 0) || this.portals[0];
    Object.assign(P, { life, max: life, x, z });
  }
  /** a jagged lightning bolt between two points (re-jittered every frame while it lives) */
  bolt(a, b, life = 0.2, w = 0.12, color = 0xaef4ff) {
    let B = this.bolts.find(q => q.life <= 0);
    if (!B) { B = this.bolts.reduce((a, b) => a.w * a.life < b.w * b.life ? a : b); if (B.w * B.life > w * life) return; }
    B.a.set(a.x, a.y, a.z); B.b.set(b.x, b.y, b.z); B.life = B.max = life; B.w = w; B.m.material.color.set(color);
  }
  _updatePools(dt, cam) {
    for (const S of this.shocks) {
      if (S.life <= 0) { S.m.visible = false; continue; }
      S.life -= dt; const u = 1 - S.life / S.max;
      S.m.visible = S.life > 0; S.m.position.set(S.x, 0.07, S.z); S.m.scale.setScalar(0.5 + S.R1 * Math.sqrt(u)); S.m.material.opacity = (1 - u) * 0.9;
    }
    for (const P of this.portals) {
      if (P.life <= 0) { P.m.visible = P.beam.visible = false; continue; }
      P.life -= dt; const u = 1 - P.life / P.max, k = Math.min(1, u * 6) * Math.min(1, (1 - u) * 3);
      P.m.visible = P.beam.visible = P.life > 0;
      P.m.position.set(P.x, 0.08, P.z); P.m.scale.setScalar(2.2 * k + 0.01); P.m.rotation.z += dt * 9; P.m.material.opacity = 0.95 * k;
      P.beam.position.set(P.x, 0, P.z); P.beam.scale.set(k, 0.4 + k * 0.8, k); P.beam.rotation.y += dt * 6; P.beam.material.opacity = 0.75 * k; P.beam.material.map.offset.y -= dt * 2;
    }
    const side = this._v;
    for (const B of this.bolts) {
      if (B.life <= 0) { B.m.visible = false; continue; }
      B.life -= dt; B.m.visible = B.life > 0;
      const pa = B.m.geometry.attributes.position.array, n = B.n;
      // ribbon facing the camera-ish: widen sideways relative to the bolt, a little up
      const dx = B.b.x - B.a.x, dy = B.b.y - B.a.y, dz = B.b.z - B.a.z, L = Math.hypot(dx, dy, dz) || 1;
      side.set(-dz / L, 0, dx / L); if (side.lengthSq() < 0.01) side.set(1, 0, 0);
      if (cam) { const cx = cam.x - B.a.x, cy = cam.y - B.a.y, cz = cam.z - B.a.z; side.set(dy * cz - dz * cy, dz * cx - dx * cz, dx * cy - dy * cx).normalize(); }
      for (let k = 0; k < n; k++) {
        const u = k / (n - 1), j = k === 0 || k === n - 1 ? 0 : L * 0.12;
        const x = B.a.x + dx * u + (Math.random() - 0.5) * j, y = B.a.y + dy * u + (Math.random() - 0.5) * j, z = B.a.z + dz * u + (Math.random() - 0.5) * j;
        const w = B.w * (1 - Math.abs(u - 0.5) * 0.8) * (0.7 + Math.random() * 0.6);
        pa.set([x + side.x * w, y + side.y * w, z + side.z * w, x - side.x * w, y - side.y * w, z - side.z * w], k * 6);
      }
      B.m.geometry.attributes.position.needsUpdate = true;
      B.m.material.opacity = Math.min(1, B.life / B.max * 2);
    }
  }

  /** one additive sprite: tex, position, velocity, life, start and end size, colour */
  puff(map, p, v, life, s0, s1, color = 0xffffff, grav = 0, normal = false, a0 = 1) {
    const P = this.sp[this.next]; this.next = (this.next + 1) % N;
    P.s.material.map = map; P.s.material.color.set(color);
    P.fire = map === this.T.flame; P.s.material.userData.realFire = P.fire; P.s.material.userData.fireSeed.value = Math.random() * 40;
    P.s.material.blending = (normal || P.fire) ? THREE.NormalBlending : THREE.AdditiveBlending;
    if (map === this.T.smoke) P.s.layers.disable(1); else P.s.layers.enable(1);   // fire and light glow, smoke doesn't
    P.s.material.rotation = P.fire ? (Math.random() - .5) * .25 : Math.random() * 6.28; P.spin = (Math.random() - .5) * (P.fire ? .25 : 4);
    P.s.position.set(p.x, p.y, p.z); P.vel.set(v.x, v.y, v.z);
    P.life = P.max = life; P.s0 = s0; P.s1 = s1; P.grav = grav; P.a0 = a0;
    P.s.scale.setScalar(s0); P.s.visible = true; P.s.material.opacity = a0; P.s.material.needsUpdate = true;
  }

  start(a, kind, extra = null) {
    if (kind === 'element-hit') { const old = this.fx.find(f => f.kind === kind && f.a === a && f.element === extra?.element); if (old) { old.t = 0; return; } }
    this._wave(a, kind, extra);
    if (typeof kind === 'string' && !kind.includes(':') && kind !== 'hit') this.skill?.burst(a, kind);
    // Refined particles complement the move's silhouette; they do not replace it.
    this.fx.push({ a, kind, t: 0, blasted: false, x: a.pos.x, z: a.pos.z, ...(extra || {}) });
  }

  /** the screen ripples out from it (heat haze): a big hit, a skill going off, a slide */
  _wave(a, kind, extra) {
    const P = this.post; if (!P || !a.pos) return;
    const COL = { thunder: 0x8f6bff, blaze: 0xff5a1a, frost: 0x8fe4ff, gale: 0x6dffb0, phantom: 0xb07bff, cannon: 0xffc35a };
    const at = this._wp || (this._wp = new THREE.Vector3());
    at.set(a.pos.x, 0.8, a.pos.z);
    if (kind === 'hit') P.shockwave(at, 0.9, extra?.color ?? 0xffffff);
    else if (COL[kind] && !extra?.off) P.shockwave(at, 0.75, COL[kind]);
    else if (kind.startsWith?.('slide:')) P.shockwave(at.setY(0.2), 0.35);
  }

  update(dt, cam) {
    const T = this.T; this.fireClock.value += dt;
    this._updatePools(dt, cam);
    // sprites
    for (const P of this.sp) {
      if (P.life <= 0) continue;
      P.life -= dt;
      if (P.life <= 0) { P.s.visible = false; continue; }
      P.vel.y -= P.grav * dt;
      P.s.position.addScaledVector(P.vel, dt);
      const u = 1 - P.life / P.max;
      const size = P.s0 + (P.s1 - P.s0) * u;
      if (P.fire) P.s.scale.set(size * .85, size * 1.75, 1); else P.s.scale.setScalar(size);
      P.s.material.opacity = P.a0 * Math.min(1, (1 - u) * 1.6) * Math.min(1, u * 12 + 0.2);
      P.s.material.rotation += P.spin * dt;
    }
    this.templates ||= Object.fromEntries(['ringA', 'ringB', 'spikes', 'twister', 'wings', 'cloak'].map(k => [k, this[k]]));
    for (const f of this.fx) {
      // Concurrent skills own their meshes, so a second player cannot hide the first one's burst.
      if (!f.visual && ['blaze', 'frost', 'gale', 'slide:gale'].includes(f.kind)) {
        f.visual = {};
        for (const [k, template] of Object.entries(this.templates)) {
          const o = template.clone(true); o.visible = false;
          o.traverse(n => { if (n.material) n.material = Array.isArray(n.material) ? n.material.map(m => m.clone()) : n.material.clone(); });
          this.scene.add(o); f.visual[k] = o;
        }
      }
      Object.assign(this, f.visual || this.templates);
      this.wingR = this.wings.children[0]; this.wingL = this.wings.children[1];
      let ringOn = false, spikesOn = false, twistOn = false, wingsOn = false, cloakOn = false;
      f.t += dt;
      const a = f.a, p = a.pos, t = f.t;
      if (!f.presence) {
        if (f.kind === 'gale') f.presence = new WindPresence(this.scene);
        else if (f.kind === 'cannon' || (f.kind === 'element-hit' && f.element === 'cannon')) f.presence = new EarthPresence(this.scene, p);
        else if (f.kind === 'phantom') f.presence = new ShadowPresence(this.scene, p);
      }
      if (f.kind === 'element-hit') {
        if (!f.go) { f.go = true; this.shock(p.x, p.z, f.color, 2.2, .65, true); }
        f.clock = (f.clock || 0) - dt;
        if (f.clock <= 0 && !a.out) {
          const y = .6 + (a.char?.airY || 0), fire = f.element === 'blaze';
          for (let k = 0; k < 3; k++) this.puff(fire ? T.flame : T.glow,
            { x: p.x + (Math.random() - .5) * .6, y: y + Math.random() * .7, z: p.z + (Math.random() - .5) * .6 },
            { x: -(a.vel?.x || 0) * .15, y: fire ? 1.8 : .8, z: -(a.vel?.z || 0) * .15 },
            .55, fire ? .8 : .5, .12, fire ? 0xffffff : f.color, -1, true, .95);
          f.clock = .055;
        }
        f.done = t > (f.element === 'frost' ? 1.5 : 1.0);
      } else if (f.kind === 'blaze') {
        // A turbulent sheet of flame expands at the blast; the centre lifts into a plume.
        if (!f.flame) f.flame = new FireFlame(this.scene, p);
        f.flame.update(t);
        f.emitClock = (f.emitClock || 0) - dt;
        if (t < .7 && f.emitClock <= 0) {
          const ang = Math.random() * Math.PI * 2, r = .3 + Math.random() * .35;
          this.puff(T.flame, { x: p.x + Math.cos(ang) * r, y: .12, z: p.z + Math.sin(ang) * r }, { x: .2 * Math.cos(ang), y: 1.6, z: .2 * Math.sin(ang) }, .6, .6, .18, 0xffffff, -.6, true, .9);
          f.emitClock = .035;
        }
        if (!f.blasted && t >= .25) {
          f.blasted = true; f.bx = p.x; f.bz = p.z;
          for (let k = 0; k < 28; k++) {
            const angle = Math.random() * Math.PI * 2, speed = 2 + Math.random() * 5;
            this.puff(T.glow, { x: p.x, y: .3, z: p.z }, { x: Math.cos(angle) * speed, y: 1.3 + Math.random() * 3.5, z: Math.sin(angle) * speed }, .65 + Math.random() * .5, .025 + Math.random() * .045, .005, 0xffa030, 3, false, .95);
          }
          for (let k = 0; k < 7; k++) {
            const angle = k / 7 * Math.PI * 2;
            this.puff(T.smoke, { x: p.x + Math.cos(angle) * .6, y: .65, z: p.z + Math.sin(angle) * .6 }, { x: Math.cos(angle) * 1.3, y: 1.5, z: Math.sin(angle) * 1.3 }, 1.1, .6, 1.8, 0xb5a297, -.25, true, .35);
          }
          this.post?.shockwave(new THREE.Vector3(p.x, .6, p.z), .55, 0xff6a20);
        }
        if (f.blasted && t < .85) {
          ringOn = true;
          this._ring(this.ringA, f.bx, f.bz, (t - .25) / .6, 7.0, 0xe84712);
          this.ringA.material.opacity *= .32;
        }
        f.done = t > 1.2;
      } else if (f.kind === 'frost') {
        cloakOn = t < 0.5;
        if (t < 0.5) { this.cloak.position.set(p.x, 0, p.z); this.cloak.rotation.y -= dt * 7; this.cloak.material.color.set(0x8fdcff); this.cloak.material.opacity = Math.min(1, t * 5); this.cloak.material.map.offset.y += dt * 1.5; this.cloak.scale.set(1, 1, 1); }
        if (Math.random() < 0.7) this.puff(T.snow, { x: p.x + (Math.random() - 0.5) * 1.2, y: 0.3 + Math.random() * 1.6, z: p.z + (Math.random() - 0.5) * 1.2 }, { x: 0, y: 0.6, z: 0 }, 0.6, 0.25, 0.4, 0xd8f4ff, 0, true);
        if (!f.blasted && t >= 0.25) {
          f.blasted = true; f.bx = p.x; f.bz = p.z;
          for (let k = 0; k < 30; k++) {
            const ang = (k / 30) * 6.28, sp = 5 + Math.random() * 3;
            this.puff(T.snow, { x: p.x, y: 0.5 + Math.random() * 0.8, z: p.z }, { x: Math.cos(ang) * sp, y: 0.5 + Math.random() * 1.5, z: Math.sin(ang) * sp }, 0.8, 0.35, 0.6, 0xe6f8ff, 0.5, true);
          }
          this.puff(T.glow, { x: p.x, y: 1, z: p.z }, { x: 0, y: 0, z: 0 }, 0.4, 2, 6, 0xbfeaff, 0, true, 0.55);
        }
        if (f.blasted) {
          const u = t - 0.25;
          if (u < 0.6) { ringOn = true; this._ring(this.ringA, f.bx, f.bz, u / 0.45, 7, 0x6fcfff); this._ring(this.ringB, f.bx, f.bz, (u - 0.08) / 0.45, 5, 0xe8f8ff); }
          // Cold mist stays below the crown, preserving the readable solid ice silhouette.
        f.mistClock = (f.mistClock || 0) - dt;
        if (t < 1.5 && f.mistClock <= 0) {
          const angle = t * 8;
          this.puff(T.smoke, { x: p.x + Math.cos(angle) * 1.2, y: .12, z: p.z + Math.sin(angle) * 1.2 }, { x: Math.cos(angle) * .5, y: .25, z: Math.sin(angle) * .5 }, .65, .65, 1.2, 0xd7f0ff, 0, true, .24);
          f.mistClock = .1;
        }
          // a crown of ice spikes erupts round me, holds, then melts into the grass
          spikesOn = u < 2.0;
          const grow = Math.min(1, u / 0.12), sink = u > 1.6 ? Math.max(0, 1 - (u - 1.6) / 0.4) : 1;
          this.spikes.position.set(f.bx, 0, f.bz);
          for (const c of this.spikes.children) {
            const R0 = 1.4 + (c.userData.h - 0.6) * 1.2, h = c.userData.h * 1.6 * grow * sink;
            c.position.set(Math.cos(c.userData.a) * R0, h * 0.45, Math.sin(c.userData.a) * R0);
            c.scale.set(1, Math.max(0.001, h), 1);
            c.rotation.set(0, 0, 0); c.rotateOnWorldAxis(new THREE.Vector3(-Math.sin(c.userData.a), 0, Math.cos(c.userData.a)), -c.userData.tilt);
          }
        }
        f.done = t > 2.4;
      } else if (f.kind === 'gale') {
        // wings out, a whirlwind lifting me, wind streaks all round
        const on = !!a.power && a.power.type === 'gale';
        wingsOn = on || t < 0.9; twistOn = on || t < 0.9;
        const flap = Math.sin(t * 22) * 0.55;
        f.dustClock = (f.dustClock || 0) - dt;
        if ((on || t < .9) && f.dustClock <= 0) {
          const angle = t * 9;
          this.puff(T.smoke, { x: p.x + Math.cos(angle) * .8, y: .1, z: p.z + Math.sin(angle) * .8 }, { x: -Math.sin(angle) * 2, y: 1.4, z: Math.cos(angle) * 2 }, .7, .45, 1.3, 0xd5e9db, -.1, true, .25);
          f.dustClock = .075;
        }
        this.wings.scale.setScalar(1.4);
        this.wings.position.set(p.x, a.char.root.position.y + 1.25, p.z);
        this.wings.rotation.set(0, a.facing, 0);
        this.wingR.rotation.set(0, -0.35 - flap * 0.5, 0.15 + flap);
        this.wingL.rotation.set(0, 0.35 + flap * 0.5, -0.15 - flap);
        this.wings.translateZ(-0.18);
        if (on) f.lastOn = t;
        const fade = Math.min(1, t * 6) * Math.max(0, 1 - Math.max(0, t - (f.lastOn ?? .75)) / .35);
        wingsOn = twistOn = fade > .01;
        this.wingR.material.opacity = 0.95 * fade;
        this.twister.position.set(p.x, 0, p.z); this.twister.rotation.y -= dt * 14; this.twister.material.map.offset.x += dt * 1.5;
        this.twister.scale.set(1, 0.6 + a.char.root.position.y * 0.9, 1); this.twister.material.opacity = 0.9 * fade;
        if (Math.random() < 0.6) {
          const ang = Math.random() * 6.28, r = 0.6 + Math.random() * 0.4;
          this.puff(T.wind, { x: p.x + Math.cos(ang) * r, y: 0.3 + Math.random() * 1.6, z: p.z + Math.sin(ang) * r }, { x: -Math.sin(ang) * 4, y: 1.2, z: Math.cos(ang) * 4 }, 0.35, 0.35, 0.6, 0x9fffc0, 0, false, 0.7);
        }
        f.done = !on && t > (f.lastOn ?? .75) + .35;
      } else if (f.kind === 'thunder') {
        // crackling body, bolts arcing along the zigzag, a strike from the sky where I land
        if (t < 0.48) {
          this.puff(T.glow, { x: p.x, y: 0.9, z: p.z }, { x: 0, y: 0, z: 0 }, 0.18, 0.9, 0.3, 0x3fb8ff, 0, false, 0.55);
          if (f.last) this.bolt({ x: f.last.x, y: 0.9, z: f.last.z }, { x: p.x, y: 0.9, z: p.z }, 0.18, 0.14);
          f.last = { x: p.x, z: p.z };
          if (Math.random() < 0.7) { const a1 = Math.random() * 6.28; this.bolt({ x: p.x, y: 1.1, z: p.z }, { x: p.x + Math.cos(a1) * 0.9, y: 0.2 + Math.random(), z: p.z + Math.sin(a1) * 0.9 }, 0.08, 0.05, 0xffffff); }
          if (Math.random() < 0.4) this.puff(T.streak, { x: p.x, y: 0.6 + Math.random() * 0.8, z: p.z }, { x: 0, y: 0, z: 0 }, 0.2, 0.9, 0.3, 0x6fd8ff, 0, false, 0.6);
        }
        if (!f.struck && t >= 0.42 && !f.off) {      // (off the ball — 闪电抢断 — no strike from the sky)
          f.struck = true;
          this.bolt({ x: p.x + 0.4, y: 9, z: p.z - 0.6 }, { x: p.x, y: 0.1, z: p.z }, 0.3, 0.35, 0xdff9ff);
          this.bolt({ x: p.x - 0.5, y: 8, z: p.z + 0.3 }, { x: p.x, y: 0.1, z: p.z }, 0.22, 0.18);
          for (let k = 0; k < 6; k++) {
            const angle = k * Math.PI / 3 + .2;
            this.bolt({ x: p.x, y: .15, z: p.z }, { x: p.x + Math.cos(angle) * 2.1, y: .08, z: p.z + Math.sin(angle) * 2.1 }, .26, .035, 0xbca4ff);
          }
          this.shock(p.x, p.z, 0x6fe0ff, 4, 0.45);
          this.puff(T.glow, { x: p.x, y: 0.5, z: p.z }, { x: 0, y: 0, z: 0 }, 0.3, 1.2, 3.2, 0x3fb8ff, 0, false, 0.6);
        }
        f.done = t > 0.7;
      } else if (f.kind === 'phantom') {
        // a portal swallows me, another spits me out; purple wisps trail between them
        if (!f.opened) { f.opened = true; this.portal(p.x, p.z, 0.55); f.ox = p.x; f.oz = p.z; }
        if (!f.out && t >= 0.16) { f.out = true; this.portal(p.x, p.z, 0.6); this.shock(p.x, p.z, 0xb07cff, 3, 0.4); }
        if (t < 0.5 && Math.random() < 0.8) this.puff(T.glow, { x: (f.out ? p.x : f.ox) + (Math.random() - 0.5) * 0.6, y: 0.3 + Math.random() * 1.6, z: (f.out ? p.z : f.oz) + (Math.random() - 0.5) * 0.6 }, { x: 0, y: 1.2, z: 0 }, 0.45, 0.5, 0.1, 0xa070ff);
        f.done = t > 1.35;
      } else if (f.kind === 'cannon') {
        // a burst of smoke at the start, rocket flames from the heels, speed lines, a shockwave on every hit
        if (!f.go) { f.go = true; this.shock(p.x, p.z, 0xffffff, 3, 0.4, true); for (let k = 0; k < 10; k++) { const a1 = Math.random() * 6.28; this.puff(T.smoke, { x: p.x, y: 0.2, z: p.z }, { x: Math.cos(a1) * 3, y: 0.6, z: Math.sin(a1) * 3 }, 0.7, 0.6, 1.6, 0xffffff, -0.2, true, 0.75); } }
        if (t < 0.55) {
          const v = a.vel, vl = Math.hypot(v.x, v.z) || 1, bx = -v.x / vl, bz = -v.z / vl;
          if (Math.random() < 0.5) this.puff(T.flame, { x: p.x + bx * 0.4, y: 0.4, z: p.z + bz * 0.4 }, { x: bx * 3, y: 0.6, z: bz * 3 }, 0.22, 0.4, 0.1, 0xffffff, 0, true, 0.85);
          this.puff(T.smoke, { x: p.x + bx * 0.6, y: 0.4, z: p.z + bz * 0.6 }, { x: bx, y: 0.5, z: bz }, 0.6, 0.5, 1.4, 0xffffff, -0.2, true, 0.6);
          for (let k = 0; k < 2; k++) this.puff(T.streak, { x: p.x + (Math.random() - 0.5) * 1.2, y: 0.4 + Math.random() * 1.4, z: p.z + (Math.random() - 0.5) * 1.2 }, { x: -bx * 6, y: 0, z: -bz * 6 }, 0.18, 1.0, 1.4, 0xffe8a0);
        }
        f.done = t > 1.5;
      } else if (f.kind === 'hit') {
        // a cannon / tackle impact
        if (!f.go) { f.go = true; this.shock(p.x, p.z, f.color || 0xffd23f, 3.5, 0.4); this.puff(T.glow, { x: p.x, y: 1, z: p.z }, { x: 0, y: 0, z: 0 }, 0.25, 1.2, 3, f.color || 0xffd23f); for (let k = 0; k < 8; k++) { const a1 = Math.random() * 6.28; this.puff(T.streak, { x: p.x, y: 1, z: p.z }, { x: Math.cos(a1) * 6, y: (Math.random() - 0.3) * 4, z: Math.sin(a1) * 6 }, 0.25, 0.8, 1.2, 0xffffff); } }
        f.done = true;
      } else if (f.kind.startsWith('slide:')) {
        // every character's slide tackle carries their element, and shows exactly what it covers
        const k = f.kind.slice(6), on = t < (k === 'frost' ? 0.75 : k === 'thunder' ? 0.5 : 0.6) && (a.slide !== null || t < 0.1);
        const col = SLIDE_COL[k] || 0xffffff, reach = a.slide?.reach || (k === 'cannon' ? 1.5 : 1.15);
        if (!f.box) { f.box = this.boxes.find((m) => !m.userData.busy) || this.boxes[0]; f.box.userData.busy = true; this.shock(p.x, p.z, col, 2.2, 0.35); this.puff(T.glow, { x: p.x, y: 0.4, z: p.z }, { x: 0, y: 0, z: 0 }, 0.25, 1.2, 2.6, col, 0, false, 0.6); }
        const bx = f.box, fade = on ? Math.min(1, t * 10) : Math.max(0, 1 - (t - 0.6) * 6);
        bx.visible = fade > 0.01;
        if (bx.visible) {
          const fx = Math.sin(a.facing), fz = Math.cos(a.facing), L = reach + 0.75, W = reach * 1.45;
          bx.position.set(p.x + fx * (reach * 0.5 - 0.1), 0.05, p.z + fz * (reach * 0.5 - 0.1));
          bx.rotation.set(-Math.PI / 2, 0, a.facing + Math.PI);
          bx.scale.set(W, L, 1); bx.material.color.set(col); bx.material.opacity = fade * (0.75 + 0.25 * Math.sin(t * 40));
          // the rim crackles with the element
          if (on && Math.random() < 0.9) {
            const u = Math.random() * 2 - 1, ex = p.x + fx * reach + -fz * u * W * 0.5, ez = p.z + fz * reach + fx * u * W * 0.5;
            if (k === 'thunder') this.bolt({ x: p.x, y: 0.3, z: p.z }, { x: ex, y: 0.15, z: ez }, 0.07, 0.07, 0xdff9ff);
            else if (k === 'blaze') this.puff(T.flame, { x: ex, y: 0.2, z: ez }, { x: fx * 2, y: 2.4, z: fz * 2 }, 0.45, 0.6, 0.2, 0xffffff, -1, true, 0.95);
            else if (k === 'frost') this.puff(T.snow, { x: ex, y: 0.25, z: ez }, { x: fx, y: 1, z: fz }, 0.6, 0.45, 0.25, 0xe6f8ff, 0, true);
            else if (k === 'gale') this.puff(T.wind, { x: ex, y: 0.35, z: ez }, { x: -fx * 4, y: 0.5, z: -fz * 4 }, 0.3, 0.5, 0.7, 0x9fffc0, 0, false, 0.8);
            else if (k === 'phantom') this.puff(T.glow, { x: ex, y: 0.3, z: ez }, { x: 0, y: 1.4, z: 0 }, 0.4, 0.5, 0.1, 0xa070ff, 0, false, 0.85);
            else this.puff(T.smoke, { x: ex, y: 0.15, z: ez }, { x: fx * 2, y: 0.8, z: fz * 2 }, 0.5, 0.5, 1.1, 0xffe8a0, -0.2, true, 0.6);
          }
        } else bx.userData.busy = false;
        if (!on && !bx.visible) bx.userData.busy = false;
        if (on) {
          if (k === 'thunder') { if (f.last) this.bolt({ x: f.last.x, y: 0.3, z: f.last.z }, { x: p.x, y: 0.3, z: p.z }, 0.25, 0.12); f.last = { x: p.x, z: p.z }; this.puff(T.glow, { x: p.x, y: 0.4, z: p.z }, { x: 0, y: 0, z: 0 }, 0.2, 1.2, 0.4, 0x6fe0ff); }
          if (k === 'blaze') for (let q = 0; q < 2; q++) this.puff(T.flame, { x: p.x + (Math.random() - 0.5) * 0.4, y: 0.15, z: p.z + (Math.random() - 0.5) * 0.4 }, { x: 0, y: 1.6, z: 0 }, 0.7, 0.55, 0.15, 0xffffff, -1, true, 0.9);
          if (k === 'frost') { this.puff(T.snow, { x: p.x + (Math.random() - 0.5) * 0.6, y: 0.2, z: p.z + (Math.random() - 0.5) * 0.6 }, { x: 0, y: 0.8, z: 0 }, 0.6, 0.35, 0.5, 0xe6f8ff, 0, true); if (!f.lastIce || Math.hypot(p.x - f.lastIce.x, p.z - f.lastIce.z) > 0.5) { f.lastIce = { x: p.x, z: p.z }; this.shock(p.x, p.z, 0x9fe6ff, 0.6, 1.2, true); } }
          if (k === 'gale') { this.twister.visible = true; twistOn = true; this.twister.position.set(p.x, 0, p.z); this.twister.rotation.y -= dt * 16; this.twister.scale.set(1.4, 0.55, 1.4); this.twister.material.opacity = 0.75; if (Math.random() < 0.6) { const a1 = Math.random() * 6.28; this.puff(T.wind, { x: p.x + Math.cos(a1) * 1.4, y: 0.3, z: p.z + Math.sin(a1) * 1.4 }, { x: -Math.cos(a1) * 3, y: 0.4, z: -Math.sin(a1) * 3 }, 0.35, 0.4, 0.6, 0x9fffc0, 0, false, 0.7); } }
          if (k === 'phantom' && t < 0.3) this.puff(T.glow, { x: p.x, y: 0.5, z: p.z }, { x: 0, y: 0.5, z: 0 }, 0.4, 0.8, 0.2, 0xa070ff);
          if (k === 'cannon') { this.puff(T.smoke, { x: p.x, y: 0.2, z: p.z }, { x: 0, y: 0.6, z: 0 }, 0.6, 0.5, 1.3, 0xffffff, -0.2, true, 0.6); }
        }
        if (k === 'phantom' && !f.opened && f.from) { f.opened = true; this.portal(f.from.x, f.from.z, 0.45); this.portal(p.x, p.z, 0.5); }
        f.done = t > 0.95;
        if (f.done) f.box.userData.busy = false, f.box.visible = false;
      }
      if (!ringOn) { this.ringA.visible = false; this.ringB.visible = false; }
      this.spikes.visible = spikesOn; this.twister.visible = twistOn; this.wings.visible = wingsOn; this.cloak.visible = cloakOn;
      if (f.presence) {
        const strength = f.kind === 'gale' ? Math.max(0, 1 - Math.max(0, t - (f.lastOn ?? .75)) / .35) : 1;
        f.presence.update(t, a, strength);
        if (f.done) f.presence.dispose();
      }
      if (f.done && f.flame) f.flame.dispose();
      if (f.done && f.visual) for (const o of Object.values(f.visual)) {
        this.scene.remove(o); o.traverse(n => { if (n.material) for (const m of [].concat(n.material)) m.dispose(); });
      }
    }
    Object.assign(this, this.templates); this.wingR = this.wings.children[0]; this.wingL = this.wings.children[1];
    this.fx = this.fx.filter((f) => !f.done);
  }

  _ring(m, x, z, u, R1, color) {
    if (u <= 0 || u >= 1) { m.visible = false; return; }
    m.visible = true; m.position.set(x, 0.06, z);
    m.scale.setScalar(0.6 + R1 * Math.sqrt(u));
    m.material.color.set(color); m.material.opacity = (1 - u) * 0.8;
  }
}
