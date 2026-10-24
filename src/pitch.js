import * as THREE from 'three';
import { FIELD, TEAMS } from './config.js';

const { halfL: L, halfW: W, goalHalfW: GW, goalH: GH, goalDepth: GD, postR } = FIELD;

function canvasTex(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  t.anisotropy = 8;
  return t;
}

function grassTexture() {
  const margin = 2.2, ppm = 80;
  const wm = (L + margin) * 2, hm = (W + margin) * 2;
  const w = Math.round(wm * ppm), h = Math.round(hm * ppm);
  const tex = canvasTex(w, h, (g) => {
    // mowing stripes along the length
    const stripes = 14;
    for (let i = 0; i < stripes; i++) {
      g.fillStyle = i % 2 ? '#3f8f3a' : '#47a042';
      g.fillRect((i * w) / stripes, 0, w / stripes + 1, h);
    }
    // subtle cross stripes for a checker mowing pattern
    for (let j = 0; j < 8; j++) {
      g.fillStyle = j % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.03)';
      g.fillRect(0, (j * h) / 8, w, h / 8 + 1);
    }
    // grain
    const img = g.getImageData(0, 0, w, h), d = img.data;
    for (let p = 0; p < d.length; p += 4) {
      const n = (Math.random() - 0.5) * 22;
      d[p] += n * 0.6; d[p + 1] += n; d[p + 2] += n * 0.5;
    }
    g.putImageData(img, 0, 0);
    // worn patches near the goal mouths and centre
    const wear = (x, y, r, a) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(120,110,60,${a})`); gr.addColorStop(1, 'rgba(120,110,60,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    };
    const X = (x) => (x + L + margin) * ppm, Y = (z) => (z + W + margin) * ppm;
    wear(X(-L + 0.8), Y(0), 1.6 * ppm, 0.22); wear(X(L - 0.8), Y(0), 1.6 * ppm, 0.22); wear(X(0), Y(0), 1.2 * ppm, 0.12);
    // lines
    g.strokeStyle = 'rgba(245,248,240,0.92)'; g.lineWidth = 0.08 * ppm; g.lineCap = 'square';
    g.strokeRect(X(-L), Y(-W), 2 * L * ppm, 2 * W * ppm);
    g.beginPath(); g.moveTo(X(0), Y(-W)); g.lineTo(X(0), Y(W)); g.stroke();
    g.beginPath(); g.arc(X(0), Y(0), 2.0 * ppm, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(245,248,240,0.95)';
    g.beginPath(); g.arc(X(0), Y(0), 0.12 * ppm, 0, Math.PI * 2); g.fill();
    for (const s of [-1, 1]) {
      const x0 = X(s * L), dx = -s * 3.2 * ppm;
      g.beginPath(); g.moveTo(x0, Y(-3.4)); g.lineTo(x0 + dx, Y(-3.4)); g.lineTo(x0 + dx, Y(3.4)); g.lineTo(x0, Y(3.4)); g.stroke();
      g.beginPath(); g.arc(X(s * (L - 4.2)), Y(0), 0.1 * ppm, 0, Math.PI * 2); g.fill();
      // penalty arc
      g.beginPath();
      const cx = X(s * (L - 4.2)), r = 1.6 * ppm;
      if (s > 0) g.arc(cx, Y(0), r, Math.PI - 0.93, Math.PI + 0.93); else g.arc(cx, Y(0), r, -0.93, 0.93);
      g.stroke();
      // corner arcs
      for (const t of [-1, 1]) {
        g.beginPath();
        const ccx = X(s * L), ccy = Y(t * W);
        const a0 = Math.atan2(-t, -s);
        g.arc(ccx, ccy, 0.5 * ppm, a0 - Math.PI / 4, a0 + Math.PI / 4); g.stroke();
      }
    }
  });
  return { tex, wm, hm };
}

function netTexture(cells = 8) {
  return canvasTex(256, 256, (g, w) => {
    g.clearRect(0, 0, w, w);
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 3;
    const s = w / cells;
    for (let i = 0; i <= cells; i++) {
      g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, w); g.stroke();
      g.beginPath(); g.moveTo(0, i * s); g.lineTo(w, i * s); g.stroke();
    }
  }, { srgb: true });
}

function boardTexture(seed) {
  const ads = [
    ['POCKET FOOTBALL', '#0b1e3f', '#ffd23f'],
    ['KICK · OFF', '#f2f2f2', '#d7263d'],
    ['NIGHT CUP 26', '#1b998b', '#ffffff'],
    ['HOLD  ▸  RELEASE', '#2e294e', '#f4d35e'],
    ['FAIR PLAY', '#ffffff', '#1b4965'],
    ['MINI ARENA', '#d7263d', '#ffffff'],
  ];
  return canvasTex(1024, 64, (g, w, h) => {
    const n = 4;
    for (let i = 0; i < n; i++) {
      const [txt, bg, fg] = ads[(i + seed) % ads.length];
      g.fillStyle = bg; g.fillRect((i * w) / n, 0, w / n, h);
      g.fillStyle = fg; g.font = 'bold 34px "Barlow Condensed", "Arial Narrow", sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(txt, (i + 0.5) * (w / n), h / 2 + 2);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(((i + 1) * w) / n - 2, 0, 2, h);
    }
  });
}

export class Pitch {
  constructor(scene) {
    this.scene = scene;
    this.crowd = null;
    this.flags = [];
    this._build();
  }

  _build() {
    const s = this.scene;

    // sky dome with a dusk gradient
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color(0x0d1b3d) }, mid: { value: new THREE.Color(0x3c5a8f) }, bot: { value: new THREE.Color(0xf0a56b) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;
        void main(){ float h = vP.y; vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.7, h)) : mix(bot, mid, smoothstep(-0.05, 0.12, h));
        gl_FragColor = vec4(c, 1.0); }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), skyMat);
    s.add(sky);

    // surroundings ground
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), new THREE.MeshStandardMaterial({ color: 0x2b3b2a, roughness: 1 }));
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; outer.receiveShadow = true; s.add(outer);

    // pitch
    const { tex, wm, hm } = grassTexture();
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(wm, hm), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0 }));
    pitch.rotation.x = -Math.PI / 2; pitch.receiveShadow = true; s.add(pitch);

    // concourse slab around the pitch
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.9 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(wm + 8, 0.05, hm + 8), slabMat);
    slab.position.y = -0.03; slab.receiveShadow = true; s.add(slab);

    this._buildBoards();
    this._buildFence();
    for (const side of [-1, 1]) this._buildGoal(side);
    this._buildStands();
    this._buildFloodlights();
  }

  _buildBoards() {
    const H = FIELD.boardH, T = 0.12;
    const mk = (len, seed) => {
      const tex = boardTexture(seed); tex.repeat.set(Math.max(1, Math.round(len / 9)), 1); tex.wrapS = THREE.RepeatWrapping;
      const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 });
      const side = new THREE.MeshStandardMaterial({ color: 0x1c2028, roughness: 0.7 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, H, T), [side, side, side, side, face, face]);
      m.castShadow = true; m.receiveShadow = true;
      return m;
    };
    for (const z of [-1, 1]) {
      const b = mk(2 * L + 2 * T, z > 0 ? 0 : 2);
      b.position.set(0, H / 2, z * (W + T / 2)); this.scene.add(b);
    }
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      const len = W - GW;
      const b = mk(len, 3 + z);
      b.rotation.y = Math.PI / 2;
      b.position.set(x * (L + T / 2), H / 2, z * (GW + len / 2)); this.scene.add(b);
    }
  }

  _buildFence() {
    const tex = netTexture(10); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const H = FIELD.fenceH, base = FIELD.boardH;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, color: 0xd8e2ee });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.5, metalness: 0.6 });
    const addPanel = (len, x, z, rotY, h = H - base, y0 = base) => {
      const t = tex.clone(); t.needsUpdate = true; t.repeat.set(len / 0.6, h / 0.6);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, h), mat.clone()); m.material.map = t;
      m.position.set(x, y0 + h / 2, z); m.rotation.y = rotY; this.scene.add(m);
    };
    addPanel(2 * L, 0, -W - 0.15, 0); // near (+z) side left open for the camera
    for (const s of [-1, 1]) {
      addPanel(2 * W, s * (L + 0.15), 0, Math.PI / 2, H - GH - 0.1, GH + 0.1);
      for (const z of [-1, 1]) addPanel(W - GW, s * (L + 0.15), z * (GW + (W - GW) / 2), Math.PI / 2, GH + 0.1 - base, base);
    }
    const postGeo = new THREE.CylinderGeometry(0.05, 0.05, H, 8);
    const addPost = (x, z) => { const p = new THREE.Mesh(postGeo, postMat); p.position.set(x, H / 2, z); p.castShadow = true; this.scene.add(p); };
    for (let x = -L; x <= L + 0.01; x += 2.75) addPost(x, -W - 0.2);
    for (let z = -W; z <= W - 3; z += 3.5) { addPost(-L - 0.2, z); addPost(L + 0.2, z); }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(2 * L + 0.4, 0.06, 0.06), postMat);
    rail.position.set(0, H, -(W + 0.2)); this.scene.add(rail);
  }

  _buildGoal(side) {
    const g = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.6, metalness: 0.4 });
    const postGeo = new THREE.CylinderGeometry(postR, postR, GH + postR, 16);
    for (const z of [-GW, GW]) {
      const p = new THREE.Mesh(postGeo, white); p.position.set(side * L, (GH + postR) / 2, z); p.castShadow = true; g.add(p);
      const back = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, GH, 8), dark);
      back.position.set(side * (L + GD), GH / 2, z); g.add(back);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, GD, 8), dark);
      top.rotation.z = Math.PI / 2; top.position.set(side * (L + GD / 2), GH, z); g.add(top);
      const bot = top.clone(); bot.position.y = 0.03; g.add(bot);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(postR, postR, 2 * GW + 2 * postR, 16), white);
    bar.rotation.x = Math.PI / 2; bar.position.set(side * L, GH, 0); bar.castShadow = true; g.add(bar);
    const backBar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2 * GW, 8), dark);
    backBar.rotation.x = Math.PI / 2; backBar.position.set(side * (L + GD), GH, 0); g.add(backBar);

    // nets
    const tex = netTexture(8); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const netMat = (rx, ry) => { const t = tex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.9, color: 0xf2f4f8 }); };
    const cell = 0.14;
    const backNet = new THREE.Mesh(new THREE.PlaneGeometry(2 * GW, GH, 12, 8), netMat(2 * GW / cell / 8, GH / cell / 8));
    backNet.rotation.y = Math.PI / 2; backNet.position.set(side * (L + GD), GH / 2, 0); g.add(backNet);
    const topNet = new THREE.Mesh(new THREE.PlaneGeometry(GD, 2 * GW, 6, 12), netMat(GD / cell / 8, 2 * GW / cell / 8));
    topNet.rotation.x = -Math.PI / 2; topNet.position.set(side * (L + GD / 2), GH, 0); g.add(topNet);
    for (const z of [-GW, GW]) {
      const sn = new THREE.Mesh(new THREE.PlaneGeometry(GD, GH, 6, 8), netMat(GD / cell / 8, GH / cell / 8));
      sn.position.set(side * (L + GD / 2), GH / 2, z); g.add(sn);
    }
    this.scene.add(g);
    // keep a reference so the net can bulge when the ball hits it
    (this.goalNets ||= {})[side] = { back: backNet, rest: backNet.geometry.attributes.position.array.slice(), bulge: 0, at: new THREE.Vector2() };
  }

  bulgeNet(side, y, z, strength) {
    const n = this.goalNets[side]; if (!n) return;
    n.bulge = Math.min(0.45, strength * 0.035); n.at.set(z, y - GH / 2);
  }

  _buildStands() {
    const standMat = new THREE.MeshStandardMaterial({ color: 0x5a6270, roughness: 0.85 });
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x8c1c2b, roughness: 0.7 });
    const rows = 6, rowD = 0.85, rowH = 0.5;
    const people = [];
    const mkStand = (cx, cz, len, rotY) => {
      const grp = new THREE.Group(); grp.position.set(cx, 0, cz); grp.rotation.y = rotY;
      for (let r = 0; r < rows; r++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(len, rowH * (r + 1), rowD), standMat);
        step.position.set(0, (rowH * (r + 1)) / 2, r * rowD); step.receiveShadow = true; grp.add(step);
        const seat = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.3), seatMat);
        seat.position.set(0, rowH * (r + 1) + 0.06, r * rowD + 0.2); grp.add(seat);
        for (let x = -len / 2 + 0.4; x < len / 2 - 0.3; x += 0.62) {
          if (Math.random() < 0.25) continue;
          people.push({ grp, local: new THREE.Vector3(x + (Math.random() - 0.5) * 0.2, rowH * (r + 1) + 0.12, r * rowD + 0.25), phase: Math.random() * 10 });
        }
      }
      // roof
      const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 1, 0.15, rows * rowD + 1.5), new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.6, metalness: 0.3 }));
      roof.position.set(0, rowH * rows + 3.4, rows * rowD / 2 + 0.4); roof.rotation.x = -0.08; grp.add(roof);
      this.scene.add(grp); grp.updateMatrixWorld(true);
    };
    // the near (+z) side is left open for the broadcast camera
    mkStand(0, -(W + 2.0), 2 * L + 4, Math.PI);
    mkStand(-(L + 3.0), 0, 2 * W + 2, -Math.PI / 2);
    mkStand(L + 3.0, 0, 2 * W + 2, Math.PI / 2);

    // crowd as one instanced mesh (body + head merged into a simple capsule)
    const geo = new THREE.CapsuleGeometry(0.17, 0.42, 2, 6); geo.translate(0, 0.38, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    const inst = new THREE.InstancedMesh(geo, mat, people.length);
    const palette = [0x2f7cf6, 0xf26b1d, 0xf2f2f2, 0x2a2a2a, 0x2f7cf6, 0xf26b1d, 0xe4c46a, 0x6b8e5a, 0xa23b72];
    const c = new THREE.Color(), m = new THREE.Matrix4(), p = new THREE.Vector3();
    people.forEach((pp, i) => {
      p.copy(pp.local).applyMatrix4(pp.grp.matrixWorld); pp.world = p.clone();
      m.makeTranslation(p.x, p.y, p.z); inst.setMatrixAt(i, m);
      c.setHex(palette[Math.floor(Math.random() * palette.length)]).multiplyScalar(0.7 + Math.random() * 0.3);
      inst.setColorAt(i, c);
      pp.team = pp.world.x < 0 ? 0 : 1; // fans gather behind "their" goal half
    });
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(inst);
    this.crowd = { inst, people, excite: [0, 0] };
  }

  _buildFloodlights() {
    const mastMat = new THREE.MeshStandardMaterial({ color: 0x30353d, metalness: 0.6, roughness: 0.4 });
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 3 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * (L + 5), z = sz * (W + 6.5), h = 15;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, h, 8), mastMat);
      mast.position.set(x, h / 2, z); mast.castShadow = true; this.scene.add(mast);
      const head = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.3, 0.25), lampMat);
      head.position.set(x, h + 0.4, z); head.lookAt(0, 0, 0); this.scene.add(head);
    }
  }

  update(dt, t) {
    // crowd idle sway, jumps when excited
    const cr = this.crowd;
    if (cr) {
      cr.excite[0] = Math.max(0, cr.excite[0] - dt * 0.25);
      cr.excite[1] = Math.max(0, cr.excite[1] - dt * 0.25);
      const m = new THREE.Matrix4();
      for (let i = 0; i < cr.people.length; i++) {
        const pp = cr.people[i];
        const ex = cr.excite[pp.team];
        const jump = ex > 0 ? Math.max(0, Math.sin(t * 9 + pp.phase * 3)) * 0.35 * ex : 0;
        const sway = Math.sin(t * 1.3 + pp.phase) * 0.02;
        m.makeTranslation(pp.world.x + sway, pp.world.y + jump, pp.world.z);
        cr.inst.setMatrixAt(i, m);
      }
      cr.inst.instanceMatrix.needsUpdate = true;
    }
    // net bulge relaxation
    for (const side of [-1, 1]) {
      const n = this.goalNets?.[side]; if (!n) continue;
      if (n.bulge > 0.001 || n._dirty) {
        const pos = n.back.geometry.attributes.position, a = pos.array, r = n.rest;
        // the back net plane is rotated 90° about y: local x = -world z, local z = world x
        for (let i = 0; i < a.length; i += 3) {
          const d2 = (r[i] + n.at.x) ** 2 + (r[i + 1] - n.at.y) ** 2;
          const edge = (1 - Math.abs(r[i]) / (FIELD.goalHalfW + 0.01)) * (1 - (Math.abs(r[i + 1]) / (FIELD.goalH / 2 + 0.01)) * 0.6);
          a[i + 2] = r[i + 2] + side * n.bulge * Math.exp(-d2 / 0.35) * edge;
        }
        pos.needsUpdate = true;
        n.bulge *= Math.exp(-dt * 5); n._dirty = n.bulge > 0.001;
      }
    }
  }

  cheer(team, amount = 1) { if (this.crowd) this.crowd.excite[team] = amount; }
}
