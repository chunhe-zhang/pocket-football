import * as THREE from 'three';
import { FIELD, TEAMS, GOALS, insideArena, OBSTACLES, waveOff, SMALL_BOX } from './config.js';
import { Scenery } from './scenery.js';

const { goalDepth: GD, postR } = FIELD;   // goal width / height come from the map (FIELD.goalHalfW / goalH)

function canvasTex(w, h, draw, { repeat = null } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  t.anisotropy = 8;
  return t;
}

const rnd = (a, b) => a + Math.random() * (b - a);
// 6v6 second half: the sides have changed ends, so each goal wears the other side's colour
let SWAP = false;
const teamOf = (gt) => TEAMS[SWAP && GOALS.length === 2 ? gt ^ 1 : gt];

function drawBlossom(g, x, y, r, petal, centre, petals = 5, rot = Math.random() * 6) {
  g.save(); g.translate(x, y); g.rotate(rot);
  g.fillStyle = petal;
  for (let i = 0; i < petals; i++) {
    g.rotate((Math.PI * 2) / petals);
    g.beginPath(); g.ellipse(0, -r * 0.55, r * 0.42, r * 0.6, 0, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = centre; g.beginPath(); g.arc(0, 0, r * 0.25, 0, Math.PI * 2); g.fill();
  g.restore();
}

const PINKS = ['#ff9ecb', '#ffb7d9', '#ff7fb8', '#ffd1e6', '#f7a8ff', '#ffffff', '#ff6fa8'];

function grassTexture() {
  const HX = FIELD.hx, HZ = FIELD.hz, RC = FIELD.cornerR;
  const margin = 1.6;
  const wmx = (HX + margin) * 2, wmz = (HZ + margin) * 2;
  const ppm = Math.min(80, 4096 / Math.max(wmx, wmz));
  const w = Math.round(wmx * ppm), hgt = Math.round(wmz * ppm);
  const tex = canvasTex(w, hgt, (g) => {
    const stripes = Math.round(wmx / 2.1);
    for (let i = 0; i < stripes; i++) {
      g.fillStyle = i % 2 ? '#4fbf55' : '#5ccc5e';
      g.fillRect((i * w) / stripes, 0, w / stripes + 1, hgt);
    }
    const stripesZ = Math.round(wmz / 2.1);
    for (let j = 0; j < stripesZ; j++) {
      g.fillStyle = j % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(0,40,0,0.035)';
      g.fillRect(0, (j * hgt) / stripesZ, w, hgt / stripesZ + 1);
    }
    const img = g.getImageData(0, 0, w, hgt), d = img.data;
    for (let p = 0; p < d.length; p += 4) {
      const n = (Math.random() - 0.5) * 18;
      d[p] += n * 0.5; d[p + 1] += n; d[p + 2] += n * 0.4;
    }
    g.putImageData(img, 0, 0);
    const X = (x) => (x + HX + margin) * ppm, Y = (z) => (z + HZ + margin) * ppm;
    // the turf follows the rounded boards; outside it the meadow shows through
    const rounded = (hx, hz, r) => {
      g.beginPath();
      g.moveTo(X(-hx + r), Y(-hz)); g.lineTo(X(hx - r), Y(-hz)); g.arcTo(X(hx), Y(-hz), X(hx), Y(-hz + r), r * ppm);
      g.lineTo(X(hx), Y(hz - r)); g.arcTo(X(hx), Y(hz), X(hx - r), Y(hz), r * ppm);
      g.lineTo(X(-hx + r), Y(hz)); g.arcTo(X(-hx), Y(hz), X(-hx), Y(hz - r), r * ppm);
      g.lineTo(X(-hx), Y(-hz + r)); g.arcTo(X(-hx), Y(-hz), X(-hx + r), Y(-hz), r * ppm);
      g.closePath();
    };
    g.save(); rounded(HX + 0.35, HZ + 0.35, RC + 0.35); g.globalCompositeOperation = 'destination-in'; g.fillStyle = '#000'; g.fill(); g.restore();
    // track map: dashed lane line round the islands, like a running track
    if (FIELD.square) {
      // a game-board grid of dashed lines
      g.save(); g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 0.06 * ppm; g.setLineDash([0.5 * ppm, 0.4 * ppm]);
      for (let a = -HX + 2.5; a < HX - 0.1; a += 2.5) { g.beginPath(); g.moveTo(X(a), Y(-HZ)); g.lineTo(X(a), Y(HZ)); g.stroke(); g.beginPath(); g.moveTo(X(-HX), Y(a)); g.lineTo(X(HX), Y(a)); g.stroke(); }
      g.restore();
    } else if (FIELD.islands.length || FIELD.portals.length) {
      // concentric guide rings, like the rings of a target
      g.save(); g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 0.07 * ppm; g.setLineDash([0.8 * ppm, 0.6 * ppm]);
      for (const r of [9, 15.5]) { g.beginPath(); g.arc(X(0), Y(0), r * ppm, 0, Math.PI * 2); g.stroke(); }
      g.restore();
      // soft shadow at the foot of each flower bed
      for (const c of FIELD.islands) {
        g.save(); g.fillStyle = 'rgba(30,70,30,0.35)'; g.strokeStyle = g.fillStyle; g.lineCap = 'round';
        if (Math.hypot(c.bx - c.ax, c.bz - c.az) < 0.01) { g.beginPath(); g.arc(X(c.ax), Y(c.az), (c.r + 0.2) * ppm, 0, Math.PI * 2); g.fill(); }
        else { g.beginPath(); g.moveTo(X(c.ax), Y(c.az)); g.lineTo(X(c.bx), Y(c.bz)); g.lineWidth = (c.r * 2 + 0.4) * ppm; g.stroke(); }
        g.restore();
      }
    }
    // team-coloured goal areas
    for (const goal of GOALS) {
      const t = teamOf(goal.team);
      g.save();
      g.translate(X(goal.centre.x), Y(goal.centre.z));
      g.rotate(Math.atan2(goal.inward.z, goal.inward.x));
      // local +x points into the pitch
      const BD = FIELD.boxDepth * ppm, BW = FIELD.boxHalfW * ppm;
      if (GOALS.length === 2) {
        // 6v6: 大禁区 and 小禁区 drawn like real markings — bold white lines with a team-colour edge,
        // the goal area shaded deeper so the two zones read at a glance
        const SD = SMALL_BOX.depth * ppm, SW = (FIELD.goalHalfW + SMALL_BOX.side) * ppm;
        g.fillStyle = t.css + '30'; g.fillRect(0, -BW, BD, 2 * BW);
        g.fillStyle = t.css + '60'; g.fillRect(0, -SW, SD, 2 * SW);
        for (const [d, w] of [[BD, BW], [SD, SW]]) {
          g.strokeStyle = t.css; g.lineWidth = 0.32 * ppm; g.strokeRect(0, -w, d, 2 * w);
          g.strokeStyle = 'rgba(255,255,255,0.97)'; g.lineWidth = 0.17 * ppm; g.strokeRect(0, -w, d, 2 * w);
        }
      } else {
        g.fillStyle = t.css + '33'; g.fillRect(0, -BW, BD, 2 * BW);
        g.strokeStyle = t.css; g.lineWidth = 0.09 * ppm;
        g.strokeRect(0, -BW, BD, 2 * BW);
      }
      g.fillStyle = t.css; g.fillRect(-0.06 * ppm, -FIELD.goalHalfW * ppm, 0.14 * ppm, 2 * FIELD.goalHalfW * ppm);
      g.beginPath(); g.arc(BD + 1.1 * ppm, 0, 0.12 * ppm, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    // five-a-side: halfway line, penalty spots, corner arcs
    if (FIELD.lines) {
      g.save(); g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = 0.1 * ppm;
      g.beginPath(); g.moveTo(X(0), Y(-HZ)); g.lineTo(X(0), Y(HZ)); g.stroke();
      g.beginPath(); g.arc(X(0), Y(0), 3.2 * ppm, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#fff';
      for (const s of [-1, 1]) {
        g.beginPath(); g.arc(X(s * (HX - 6)), Y(0), 0.13 * ppm, 0, Math.PI * 2); g.fill();
        // the arc at the top of the box
        g.beginPath(); g.arc(X(s * (HX - FIELD.boxDepth)), Y(0), 1.6 * ppm, s < 0 ? -Math.PI / 2 : Math.PI / 2, s < 0 ? Math.PI / 2 : Math.PI * 1.5); g.stroke();
      }
      g.restore();
    }
    // names painted on the grass in each half: 大禁区 by the edge of the box, 小禁区 in the goal area
    if (GOALS.length === 2) {
      g.save(); g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const goal of GOALS) {
        const A = goal.axis, ix = goal.inward.x, iz = goal.inward.z, lx = A === 'x' ? 0 : 1, lz = A === 'x' ? 1 : 0;
        const put = (txt, depth, lat, size, alpha) => {
          const px = goal.centre.x + ix * depth + lx * lat, pz = goal.centre.z + iz * depth + lz * lat;
          g.font = `800 ${Math.round(size * ppm)}px "PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif`;
          g.lineWidth = size * ppm * 0.16; g.strokeStyle = 'rgba(30,90,40,0.45)'; g.strokeText(txt, X(px), Y(pz));
          g.fillStyle = `rgba(255,255,255,${alpha})`; g.fillText(txt, X(px), Y(pz));
        };
        put('大禁区', FIELD.boxDepth - 1.0, -(FIELD.boxHalfW - 2.6), 0.95, 0.72);
        put('小禁区', SMALL_BOX.depth * 0.5, FIELD.goalHalfW + SMALL_BOX.side * 0.5 - 0.1, 0.5, 0.8);
      }
      g.restore();
    }
    // boundary
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 0.09 * ppm;
    rounded(HX, HZ, RC); g.stroke();
    // centre circle (plain white; the five-a-side pitch draws its own, larger one)
    if (!FIELD.lines) { g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = 0.1 * ppm; g.beginPath(); g.arc(X(0), Y(0), 2.4 * ppm, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = '#fff'; g.beginPath(); g.arc(X(0), Y(0), 0.16 * ppm, 0, Math.PI * 2); g.fill();

  });
  return { tex, sx: wmx, sz: wmz };
}

function netTexture(cells = 8) {
  return canvasTex(256, 256, (g, w) => {
    g.clearRect(0, 0, w, w);
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 3;
    const s = w / cells;
    for (let i = 0; i <= cells; i++) {
      g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, w); g.stroke();
      g.beginPath(); g.moveTo(0, i * s); g.lineTo(w, i * s); g.stroke();
    }
  });
}

function flowerBoardTexture() {
  return canvasTex(1024, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#ffe3f0'); gr.addColorStop(1, '#ffc2dd');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    // leaves
    for (let i = 0; i < 120; i++) {
      g.fillStyle = Math.random() < 0.5 ? '#7cc576' : '#5fae63';
      g.save(); g.translate(rnd(0, w), rnd(h * 0.3, h)); g.rotate(rnd(-1, 1));
      g.beginPath(); g.ellipse(0, 0, rnd(4, 9), rnd(10, 18), 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
    for (let i = 0; i < 170; i++) {
      const x = rnd(0, w), y = rnd(h * 0.05, h * 0.95);
      drawBlossom(g, x, y, rnd(9, 20), PINKS[Math.floor(Math.random() * PINKS.length)], Math.random() < 0.5 ? '#ffd23f' : '#ff5f9e');
    }
    // seamless edges
    const strip = g.getImageData(0, 0, 24, h); g.putImageData(strip, w - 24, 0);
  }, { repeat: [1, 1] });
}

function flowerSprite(petal, centre) {
  const t = canvasTex(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    g.strokeStyle = '#4f9e4f'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(64, 128); g.quadraticCurveTo(58, 90, 64, 52); g.stroke();
    g.fillStyle = '#5fae5f';
    g.beginPath(); g.ellipse(50, 98, 7, 15, -0.7, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(78, 88, 7, 15, 0.7, 0, Math.PI * 2); g.fill();
    drawBlossom(g, 64, 40, 34, petal, centre, 5, 0.3);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export class Pitch {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.goalNets = {};
    this.seals = {};
    this.wind = { value: 0 };
    this.excite = 0;
    this.pulses = [];
    this._buildStatic();
    this.scenery = new Scenery(scene);
    this.setMap();
  }

  /** (re)build everything that depends on the arena shape */
  setMap(swap = false) {
    SWAP = swap; this.swapped = swap;
    if (this.root) {
      this.scene.remove(this.root);
      this.root.traverse((o) => { o.geometry?.dispose?.(); for (const m of [].concat(o.material || [])) { m.map?.dispose?.(); m.dispose?.(); } });
    }
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.goalNets = {}; this.seals = {}; this.pulses = []; this.padMats = []; this.bumperMeshes = []; this.springMeshes = [];
    this.devices = [];   // portals / boosts / vortices / wheels: { kind, x, z, spin, k, ... }
    this.shields = {};   // team -> { mesh, mat, k, target, flash }
    const { tex, sx, sz } = grassTexture();
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, alphaTest: 0.5 }));
    pitch.rotation.x = -Math.PI / 2; pitch.receiveShadow = true; this.root.add(pitch);
    this._buildBoards();
    this._buildPlanters();
    this._buildFence();
    for (const g of GOALS) { this._buildGoal(g); this._buildSeal(g); }
    this._buildIslands();
    this._buildBumpers();
    this._buildPads();
    this._buildSprings();
    this._buildDevices();
    this._buildShields();
    this._buildFlowers();
    this._buildTrees();
    if (!this.petals) this._buildPetals();
    this.scenery.build();
  }

  _buildStatic() {
    const s = this.scene;

    // pastel sky dome
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color(0x6db8ff) }, mid: { value: new THREE.Color(0xbfe4ff) }, bot: { value: new THREE.Color(0xffd6ea) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;
        void main(){ float h = vP.y; vec3 c = h > 0.15 ? mix(mid, top, smoothstep(0.15, 0.75, h)) : mix(bot, mid, smoothstep(-0.02, 0.15, h));
        gl_FragColor = vec4(c, 1.0); }`,
    });
    s.add(new THREE.Mesh(new THREE.SphereGeometry(190, 32, 16), skyMat));

    // meadow ground (green with fallen petals)
    const meadowTex = canvasTex(512, 512, (g, w) => {
      g.fillStyle = '#6fbf63'; g.fillRect(0, 0, w, w);
      for (let i = 0; i < 1600; i++) { g.fillStyle = Math.random() < 0.7 ? 'rgba(60,130,60,0.35)' : 'rgba(150,215,120,0.35)'; g.fillRect(rnd(0, w), rnd(0, w), 3, rnd(4, 9)); }
      for (let i = 0; i < 500; i++) { g.fillStyle = PINKS[Math.floor(Math.random() * PINKS.length)]; g.beginPath(); g.arc(rnd(0, w), rnd(0, w), rnd(1.5, 3.5), 0, Math.PI * 2); g.fill(); }
    }, { repeat: [40, 40] });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshLambertMaterial({ map: meadowTex }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; s.add(ground);
  }

  _buildBoards() {
    const BH = FIELD.boardH, T = 0.12, RC = FIELD.cornerR, CX = FIELD.hx - RC, CZ = FIELD.hz - RC;
    const tex = flowerBoardTexture();
    const face = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 });
    const top = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const withRepeat = (len) => { const t = tex.clone(); t.needsUpdate = true; t.repeat.set(len / 5, 1); const f = face.clone(); f.map = t; f.emissiveMap = t; return f; };
    for (const [axis, sign] of [['x', -1], ['x', 1], ['z', -1], ['z', 1]]) {
      const goal = GOALS.find((g) => g.axis === axis && g.sign === sign);
      const line = axis === 'x' ? FIELD.hx : FIELD.hz, run = axis === 'x' ? CZ : CX;
      // with a goal: from the post to where the corner curve starts; without: the whole side
      const gap = goal ? FIELD.goalHalfW : 0, seg = run - gap;
      if (seg < 0.05) continue;
      if (FIELD.wave) { this._waveBoard(axis, sign, line, goal ? [[-run, -gap], [gap, run]] : [[-run, run]], BH, tex, top); continue; }
      for (const z of goal ? [-1, 1] : [0]) {
        const len = goal ? seg : 2 * run;
        const m = new THREE.Mesh(new THREE.BoxGeometry(len, BH, T), [top, top, top, top, withRepeat(len), withRepeat(len)]);
        m.castShadow = true; m.receiveShadow = true;
        const along = goal ? z * (gap + seg / 2) : 0;
        if (axis === 'x') { m.rotation.y = Math.PI / 2; m.position.set(sign * (line + T / 2), BH / 2, along); }
        else m.position.set(along, BH / 2, sign * (line + T / 2));
        this.root.add(m);
      }
    }
    // curved corner boards (quarter cylinders) with a white rim
    const arcLen = (Math.PI / 2) * RC;
    if (RC > 0.5) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const start = Math.atan2(sx, sz) - Math.PI / 4;
      const geo = new THREE.CylinderGeometry(RC + T / 2, RC + T / 2, BH, 32, 1, true, start, Math.PI / 2);
      const mat = withRepeat(arcLen); mat.side = THREE.DoubleSide;
      const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
      m.position.set(sx * CX, BH / 2, sz * CZ); this.root.add(m);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(RC + T / 2, 0.04, 6, 32, Math.PI / 2), top);
      rim.rotation.x = Math.PI / 2; rim.rotation.z = -start + Math.PI / 2 - Math.PI / 2;
      rim.position.set(sx * CX, BH, sz * CZ);
      // torus arc runs from +x towards +y in its own plane; after the x-rotation +y maps to -z
      rim.rotation.set(Math.PI / 2, 0, Math.atan2(sz, sx) - Math.PI / 4);
      this.root.add(rim);
    }
  }

  /** a wavy board: a ribbon of flower panels following the bulges, with a white rail along the top */
  _waveBoard(axis, sign, line, ranges, BH, tex, rail) {
    const T = 0.12;
    for (const [a, b] of ranges) {
      const n = Math.max(2, Math.ceil((b - a) / 0.2)), pos = [], uv = [], idx = [], top = [];
      for (let i = 0; i <= n; i++) {
        const s = a + ((b - a) * i) / n, A = sign * (line - waveOff(axis, s, sign) + T / 2);
        const x = axis === 'x' ? A : s, z = axis === 'x' ? s : A;
        pos.push(x, 0, z, x, BH, z); uv.push(s / 5, 0, s / 5, 1);
        top.push(new THREE.Vector3(x, BH, z));
        if (i < n) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      const t = tex.clone(); t.needsUpdate = true; t.wrapS = THREE.RepeatWrapping;
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.25, side: THREE.DoubleSide }));
      m.castShadow = true; m.receiveShadow = true; this.root.add(m);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(top), n, 0.06, 6, false), rail);
      this.root.add(tube);
    }
  }

  // little round flower planters in the middle of the pitch
  _buildPlanters() {
    const pot = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const band = new THREE.MeshStandardMaterial({ color: 0xff8fc4, roughness: 0.6 });
    const soil = new THREE.MeshLambertMaterial({ color: 0x7a5236 });
    const leaf = new THREE.MeshLambertMaterial({ color: 0x5fb35f, flatShading: true });
    const petals = [0xff6fa8, 0xffd23f, 0xffffff, 0xb17cff, 0xff9ecb].map((c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true }));
    for (const [i, o] of OBSTACLES.filter((x) => !x.bumper).entries()) {
      const g = new THREE.Group(); g.position.set(o.x, 0, o.z);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r * 0.82, o.h, 28), pot);
      body.position.y = o.h / 2; body.castShadow = true; body.receiveShadow = true; g.add(body);
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(o.r + 0.005, o.r * 0.97, 0.1, 28, 1, true), band);
      stripe.position.y = o.h - 0.12; g.add(stripe);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(o.r, 0.035, 8, 28), pot);
      rim.rotation.x = Math.PI / 2; rim.position.y = o.h; g.add(rim);
      const dirt = new THREE.Mesh(new THREE.CircleGeometry(o.r * 0.95, 24), soil);
      dirt.rotation.x = -Math.PI / 2; dirt.position.y = o.h - 0.03; g.add(dirt);
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + i, rr = k === 0 ? 0 : o.r * 0.55;
        const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 0), leaf);
        bush.position.set(Math.cos(a) * rr, o.h + 0.06, Math.sin(a) * rr); g.add(bush);
        const fl = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 0), petals[(k + i) % petals.length]);
        fl.position.set(Math.cos(a) * rr * 1.05, o.h + 0.16 + (k % 2) * 0.05, Math.sin(a) * rr * 1.05); g.add(fl);
      }
      this.root.add(g);
    }
  }

  _buildFence() {
    if (FIELD.square) return;    // every side is a goal: nothing to fence
    // light netting on the far side and both ends (straight runs + curved corners); camera side open
    const tex = netTexture(10); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const FH = 2.6, base = FIELD.boardH, h = FH - base, RC = FIELD.cornerR, CX = FIELD.hx - RC, CZ = FIELD.hz - RC, HX = FIELD.hx, HZ = FIELD.hz;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
    const postMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const net = (geo, len) => { const t = tex.clone(); t.needsUpdate = true; t.repeat.set(len / 0.6, h / 0.6); const m = new THREE.Mesh(geo, mat.clone()); m.material.map = t; return m; };
    const panel = (len, x, z, rotY) => { if (len < 0.1) return; const m = net(new THREE.PlaneGeometry(len, h), len); m.position.set(x, base + h / 2, z); m.rotation.y = rotY; this.root.add(m); };
    panel(2 * CX, 0, -HZ - 0.2, 0);
    panel(2 * CZ, -HX - 0.2, 0, Math.PI / 2);
    panel(2 * CZ, HX + 0.2, 0, Math.PI / 2);
    const arcLen = (Math.PI / 2) * (RC + 0.2);
    for (const [sx, sz] of [[-1, -1], [1, -1]]) {
      const start = Math.atan2(sx, sz) - Math.PI / 4;
      const m = net(new THREE.CylinderGeometry(RC + 0.2, RC + 0.2, h, 24, 1, true, start, Math.PI / 2), arcLen);
      m.position.set(sx * CX, base + h / 2, sz * CZ); this.root.add(m);
    }
    const postGeo = new THREE.CylinderGeometry(0.04, 0.04, FH, 8);
    const post = (x, z) => { const p = new THREE.Mesh(postGeo, postMat); p.position.set(x, FH / 2, z); this.root.add(p); };
    for (let a = -CX; a <= CX + 0.01; a += 3) post(a, -HZ - 0.22);
    for (let a = -CZ; a <= CZ + 0.01; a += 3) { post(-HX - 0.22, a); post(HX + 0.22, a); }
    for (const [sx, sz] of [[-1, -1], [1, -1]]) for (const k of [0.25, 0.5, 0.75]) {
      const ang = Math.atan2(sx, sz) - Math.PI / 4 + k * Math.PI / 2;
      post(sx * CX + Math.sin(ang) * (RC + 0.22), sz * CZ + Math.cos(ang) * (RC + 0.22));
    }
  }

  _buildGoal(goal) {
    const g = new THREE.Group(), H = goal.line;
    // built as if the goal were on the +x side, then rotated into place
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
    const tint = new THREE.MeshStandardMaterial({ color: teamOf(goal.team).color, roughness: 0.5 });
    const postGeo = new THREE.CylinderGeometry(postR, postR, FIELD.goalH + postR, 16);
    for (const z of [-FIELD.goalHalfW, FIELD.goalHalfW]) {
      const p = new THREE.Mesh(postGeo, white); p.position.set(H, (FIELD.goalH + postR) / 2, z); p.castShadow = true; g.add(p);
      const back = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, FIELD.goalH, 8), tint); back.position.set(H + GD, FIELD.goalH / 2, z); g.add(back);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, GD, 8), tint); top.rotation.z = Math.PI / 2; top.position.set(H + GD / 2, FIELD.goalH, z); g.add(top);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(postR, postR, 2 * FIELD.goalHalfW + 2 * postR, 16), white);
    bar.rotation.x = Math.PI / 2; bar.position.set(H, FIELD.goalH, 0); bar.castShadow = true; g.add(bar);
    const backBar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2 * FIELD.goalHalfW, 8), tint);
    backBar.rotation.x = Math.PI / 2; backBar.position.set(H + GD, FIELD.goalH, 0); g.add(backBar);

    const tex = netTexture(8); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const netCol = new THREE.Color(teamOf(goal.team).color).lerp(new THREE.Color(0xffffff), 0.55);
    const netMat = (rx, ry) => { const t = tex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.95, color: netCol }); };
    const cell = 0.14;
    const backNet = new THREE.Mesh(new THREE.PlaneGeometry(2 * FIELD.goalHalfW, FIELD.goalH, 12, 8), netMat(2 * FIELD.goalHalfW / cell / 8, FIELD.goalH / cell / 8));
    backNet.rotation.y = Math.PI / 2; backNet.position.set(H + GD, FIELD.goalH / 2, 0); g.add(backNet);
    const topNet = new THREE.Mesh(new THREE.PlaneGeometry(GD, 2 * FIELD.goalHalfW), netMat(GD / cell / 8, 2 * FIELD.goalHalfW / cell / 8));
    topNet.rotation.x = -Math.PI / 2; topNet.position.set(H + GD / 2, FIELD.goalH, 0); g.add(topNet);
    for (const z of [-FIELD.goalHalfW, FIELD.goalHalfW]) {
      const sn = new THREE.Mesh(new THREE.PlaneGeometry(GD, FIELD.goalH), netMat(GD / cell / 8, FIELD.goalH / cell / 8));
      sn.position.set(H + GD / 2, FIELD.goalH / 2, z); g.add(sn);
    }
    // rotate +x into this goal's outward direction
    const out = { x: -goal.inward.x, z: -goal.inward.z };
    g.rotation.y = Math.atan2(-out.z, out.x);
    this.root.add(g);
    g.updateMatrixWorld(true);
    this.goalNets[goal.team] = { back: backNet, rest: backNet.geometry.attributes.position.array.slice(), bulge: 0, at: new THREE.Vector3() };
  }

  // flower board that rises up to close a knocked-out player's goal
  _buildSeal(goal) {
    const W = 2 * FIELD.goalHalfW + 0.3, Hh = FIELD.goalH + 0.12, T = 0.14;
    const tex = flowerBoardTexture(); tex.repeat.set(W / 2.2, 1);
    const face = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.22 });
    const trim = new THREE.MeshStandardMaterial({ color: teamOf(goal.team).color, roughness: 0.5 });
    const g = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.BoxGeometry(T, Hh, W), [trim, trim, trim, trim, face, face]);
    // BoxGeometry faces: +x,-x,+y,-y,+z,-z; the flower print goes on the faces seen from the pitch
    panel.material = [face, face, trim, trim, trim, trim];
    panel.position.y = Hh / 2; panel.castShadow = true; panel.receiveShadow = true; g.add(panel);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(T + 0.06, 0.08, W + 0.06), trim);
    cap.position.y = Hh; g.add(cap);
    // a big cross so it reads as "closed" from across the pitch
    for (const s of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(T + 0.02, 0.12, Math.hypot(W, Hh) * 0.8), trim);
      bar.position.set(0, Hh / 2, 0); bar.rotation.x = s * Math.atan2(Hh, W); g.add(bar);
    }
    // place on the goal line, built along local z (the mouth direction)
    const along = goal.axis === 'x' ? 'z' : 'x';
    g.position.set(goal.centre.x - goal.inward.x * 0.08, 0, goal.centre.z - goal.inward.z * 0.08);
    g.rotation.y = along === 'z' ? 0 : Math.PI / 2;
    g.visible = false;
    this.root.add(g);
    this.seals[goal.team] = { g, h: Hh, k: 0, target: 0 };
  }

  /** close (on=true) or reopen a goal; instant skips the rising animation */
  sealGoal(team, on, instant = false) {
    const s = this.seals[team]; if (!s) return;
    s.target = on ? 1 : 0;
    if (instant) s.k = s.target;
    s.g.visible = s.k > 0.001 || on;
    s.g.position.y = (s.k - 1) * s.h;
  }

  /** world-space hit point on a back net */
  bulgeNet(team, point, strength) {
    const n = this.goalNets[team]; if (!n) return;
    n.bulge = Math.min(0.45, strength * 0.035);
    n.at.copy(point); n.back.worldToLocal(n.at);
  }

  _buildFlowers() {
    const variants = [['#ff8fc4', '#ffd23f'], ['#ffc3df', '#ff6fa8'], ['#ffffff', '#ffb000'], ['#f59bff', '#ffe066'], ['#ff6fa8', '#fff2a8']];
    const geo = new THREE.PlaneGeometry(0.55, 0.55); geo.translate(0, 0.27, 0);
    const geo2 = geo.clone(); geo2.rotateY(Math.PI / 2);
    const both = new THREE.BufferGeometry();
    const merge = (a, b) => {
      for (const name of ['position', 'normal', 'uv']) {
        const A = a.attributes[name].array, B = b.attributes[name].array, out = new Float32Array(A.length + B.length);
        out.set(A); out.set(B, A.length); both.setAttribute(name, new THREE.BufferAttribute(out, a.attributes[name].itemSize));
      }
      const ia = a.index.array, ib = b.index.array, n = a.attributes.position.count;
      both.setIndex([...ia, ...Array.from(ib, (i) => i + n)]);
    };
    merge(geo, geo2);
    this.flowerMats = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const area = (FIELD.hx + 15) * (FIELD.hz + 15) * 4, perVariant = Math.min(900, Math.round(420 * area / 2916));
    for (const [petal, centre] of variants) {
      const mat = new THREE.MeshLambertMaterial({ map: flowerSprite(petal, centre), alphaTest: 0.5, side: THREE.DoubleSide });
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = this.wind;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
            float sway = sin(uTime * 1.8 + ip.x * 0.6 + ip.z * 0.45) * 0.08 * position.y * 3.0;
            transformed.x += sway; transformed.z += sway * 0.6;`);
      };
      this.flowerMats.push(mat);
      const inst = new THREE.InstancedMesh(both, mat, perVariant);
      let n = 0, guard = 0;
      while (n < perVariant && guard++ < perVariant * 20) {
        p.set(rnd(-FIELD.hx - 15, FIELD.hx + 15), 0, rnd(-FIELD.hz - 15, FIELD.hz + 15));
        const ex = Math.max(Math.abs(p.x) - FIELD.hx, Math.abs(p.z) - FIELD.hz);
        if (insideArena(p.x, p.z, 0.45)) continue;
        // keep the space behind the goals clear
        if (GOALS.some((g) => {
          const along = g.axis === 'x' ? Math.abs(p.z) : Math.abs(p.x), out = g.axis === 'x' ? p.x * g.sign : p.z * g.sign;
          return along < FIELD.goalHalfW + 0.5 && out > g.line - 0.1 && out < g.line + GD + 0.5;
        })) continue;
        // denser close to the pitch
        if (ex > 2.6) continue;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
        const k = rnd(0.7, 1.35); sc.set(k, k * rnd(0.85, 1.2), k);
        m4.compose(p, q, sc); inst.setMatrixAt(n++, m4);
      }
      inst.count = n;
      this.root.add(inst);
    }
  }

  _buildTrees() {
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a5a44 });
    const blossomMats = [0xffb3d1, 0xff9cc6, 0xffc9e0].map((c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true }));
    const spots = [];
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + rnd(-0.08, 0.08), k = rnd(16, 26);
      spots.push([Math.cos(a) * (FIELD.hx + k), Math.sin(a) * (FIELD.hz + k)]);
    }
    for (const [x, z] of spots) {
      const tree = new THREE.Group();
      const h = rnd(2.6, 3.6);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, h, 7), trunkMat);
      trunk.position.y = h / 2; trunk.castShadow = true; tree.add(trunk);
      for (let k = 0; k < 5; k++) {
        const b = new THREE.Mesh(new THREE.IcosahedronGeometry(rnd(1.1, 1.8), 1), blossomMats[k % 3]);
        b.position.set(rnd(-1.1, 1.1), h + rnd(0, 1.2), rnd(-1.1, 1.1)); b.castShadow = true; tree.add(b);
      }
      tree.position.set(x, 0, z); tree.rotation.y = Math.random() * 6;
      const s = rnd(0.9, 1.3); tree.scale.setScalar(s);
      this.root.add(tree);
    }
  }

  _buildPetals() {
    const n = 420, pos = new Float32Array(n * 3);
    this.petalData = [];
    for (let i = 0; i < n; i++) {
      const p = { x: rnd(-26, 26), y: rnd(0, 9), z: rnd(-26, 26), sx: rnd(0.2, 0.6), sy: rnd(0.25, 0.6), ph: Math.random() * 10 };
      this.petalData.push(p);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const sprite = canvasTex(32, 32, (c) => { c.fillStyle = '#ffb7d5'; c.beginPath(); c.ellipse(16, 16, 9, 14, 0.5, 0, Math.PI * 2); c.fill(); });
    this.petals = new THREE.Points(g, new THREE.PointsMaterial({ map: sprite, size: 0.16, transparent: true, depthWrite: false, alphaTest: 0.1 }));
    this.petals.frustumCulled = false;
    this.scene.add(this.petals);
  }

  _buildFlags() {
    const poleMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const hues = [0xff5fa2, 0xffd23f, 0x6fd3ff, 0xa064ff];
    let i = 0;
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 6), poleMat);
      pole.position.set(x * (FIELD.hx - 0.05), 0.65, z * (FIELD.hz - 0.05)); this.root.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.28), new THREE.MeshLambertMaterial({ color: hues[i++], side: THREE.DoubleSide }));
      flag.position.set(x * (FIELD.hx - 0.05) + 0.21, 1.15, z * (FIELD.hz - 0.05)); this.root.add(flag);
    }
  }

  // ---- track map features ----------------------------------------------------------------
  /** raised flower beds the players run round, with a light net above so the ball's wall reads */
  _buildIslands() {
    if (!FIELD.islands.length) return;
    const tex = flowerBoardTexture();
    for (const c of FIELD.islands) {
      const ex = c.bx - c.ax, ez = c.bz - c.az, L = Math.hypot(ex, ez), ang = Math.atan2(ez, ex);
      const shape = new THREE.Shape();
      shape.moveTo(-L / 2, -c.r); shape.lineTo(L / 2, -c.r);
      shape.absarc(L / 2, 0, c.r, -Math.PI / 2, Math.PI / 2, false);
      shape.lineTo(-L / 2, c.r);
      shape.absarc(-L / 2, 0, c.r, Math.PI / 2, Math.PI * 1.5, false);
      const BH = 0.55;
      const geo = new THREE.ExtrudeGeometry(shape, { depth: BH, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2, curveSegments: 24 });
      geo.rotateX(-Math.PI / 2);
      const t = tex.clone(); t.needsUpdate = true; t.repeat.set((2 * L + 2 * Math.PI * c.r) / 5, 1);
      const side = new THREE.MeshLambertMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.22 });
      const topMat = new THREE.MeshLambertMaterial({ color: 0x6cbf5c });
      const bed = new THREE.Mesh(geo, [topMat, side]);
      bed.castShadow = true; bed.receiveShadow = true;
      const g = new THREE.Group(); g.add(bed);
      g.position.set((c.ax + c.bx) / 2, 0, (c.az + c.bz) / 2); g.rotation.y = -ang;
      // flowers and a couple of blossom trees on top
      const fl = [0xff6fa8, 0xffd23f, 0xffffff, 0xb17cff, 0xff9ecb].map((col) => new THREE.MeshLambertMaterial({ color: col, flatShading: true }));
      const leaf = new THREE.MeshLambertMaterial({ color: 0x4fa64f, flatShading: true });
      const bushGeo = new THREE.IcosahedronGeometry(0.28, 0), flGeo = new THREE.IcosahedronGeometry(0.12, 0);
      for (let k = 0; k < Math.round(L * c.r * 1.6); k++) {
        let x, z; do { x = rnd(-L / 2 - c.r, L / 2 + c.r); z = rnd(-c.r, c.r); } while (Math.hypot(Math.max(0, Math.abs(x) - L / 2), z) > c.r - 0.35);
        const b = new THREE.Mesh(bushGeo, leaf); b.position.set(x, BH + 0.15, z); b.scale.setScalar(rnd(0.7, 1.3)); g.add(b);
        const f = new THREE.Mesh(flGeo, fl[k % fl.length]); f.position.set(x + rnd(-0.15, 0.15), BH + 0.38, z + rnd(-0.15, 0.15)); g.add(f);
      }
      const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a5a44 }), bl = new THREE.MeshLambertMaterial({ color: 0xffb3d1, flatShading: true });
      for (const x of L < 0.01 ? [0] : [-L / 2, L / 2]) {
        const tr = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 2.2, 7), trunkMat); trunk.position.y = 1.1; tr.add(trunk);
        for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(rnd(0.9, 1.3), 1), bl); b.position.set(rnd(-0.7, 0.7), 2.4 + rnd(0, 0.8), rnd(-0.7, 0.7)); b.castShadow = true; tr.add(b); }
        tr.position.set(x, BH, 0); g.add(tr);
      }
      // translucent net fence on the bed's edge
      const ntex = netTexture(10); ntex.wrapS = ntex.wrapT = THREE.RepeatWrapping;
      const perim = 2 * L + 2 * Math.PI * c.r, NH = 1.8;
      ntex.repeat.set(perim / 0.6, NH / 0.6);
      const pts = [];
      for (let k = 0; k <= 64; k++) {
        const u = k / 64 * perim;
        let x, z;
        if (u < L) { x = -L / 2 + u; z = -c.r; }
        else if (u < L + Math.PI * c.r) { const a = -Math.PI / 2 + (u - L) / c.r; x = L / 2 + Math.cos(a) * c.r; z = Math.sin(a) * c.r; }
        else if (u < 2 * L + Math.PI * c.r) { x = L / 2 - (u - L - Math.PI * c.r); z = c.r; }
        else { const a = Math.PI / 2 + (u - 2 * L - Math.PI * c.r) / c.r; x = -L / 2 + Math.cos(a) * c.r; z = Math.sin(a) * c.r; }
        pts.push(new THREE.Vector3(x, 0, z));
      }
      const pos = [], uv = [], idx = [];
      pts.forEach((q, k) => { pos.push(q.x, BH, q.z, q.x, BH + NH, q.z); uv.push(k / 64, 0, k / 64, 1); if (k) { const a = (k - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } });
      const ng = new THREE.BufferGeometry();
      ng.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); ng.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); ng.setIndex(idx);
      const net = new THREE.Mesh(ng, new THREE.MeshBasicMaterial({ map: ntex, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
      g.add(net);
      this.root.add(g);
    }
  }

  /** pinball mushrooms: red caps with white spots that flash and bounce when hit */
  _buildBumpers() {
    const capTex = canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#ff4f7b'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff'; for (let i = 0; i < 26; i++) { g.beginPath(); g.arc(rnd(0, w), rnd(0, h * 0.75), rnd(7, 14), 0, Math.PI * 2); g.fill(); }
    });
    for (const b of FIELD.bumpers) {
      if (b.sq) {
        const g = new THREE.Group(); g.position.set(b.x, 0, b.z);
        const capMat = new THREE.MeshStandardMaterial({ map: capTex, roughness: 0.3, emissive: 0xff2e6a, emissiveIntensity: 0 });
        const box = new THREE.Mesh(new THREE.BoxGeometry(b.r * 2, 0.7, b.r * 2), capMat);
        box.position.y = 0.35; box.castShadow = true; box.receiveShadow = true; g.add(box);
        const lid = new THREE.Mesh(new THREE.BoxGeometry(b.r * 2 + 0.08, 0.08, b.r * 2 + 0.08), new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffd23f, emissiveIntensity: 0.35 }));
        lid.position.y = 0.72; g.add(lid);
        this.root.add(g);
        this.bumperMeshes.push({ x: b.x, z: b.z, g, capMat, k: 0 });
        continue;
      }
      const g = new THREE.Group(); g.position.set(b.x, 0, b.z);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(b.r * 0.92, b.r, 0.62, 24), new THREE.MeshStandardMaterial({ color: 0xfff4e6, roughness: 0.6 }));
      stem.position.y = 0.31; stem.castShadow = true; g.add(stem);
      const capMat = new THREE.MeshStandardMaterial({ map: capTex, roughness: 0.4, emissive: 0xff2e6a, emissiveIntensity: 0 });
      const cap = new THREE.Mesh(new THREE.SphereGeometry(b.r * 1.45, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
      cap.position.y = 0.58; cap.scale.y = 0.75; cap.castShadow = true; g.add(cap);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(b.r * 1.02, 0.05, 8, 28), new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffd23f, emissiveIntensity: 0.4 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.12; g.add(ring);
      this.root.add(g);
      this.bumperMeshes.push({ x: b.x, z: b.z, g, capMat, k: 0 });
    }
  }

  /** speed strips: glowing chevrons that scroll in the direction they push */
  _buildPads() {
    for (const p of FIELD.pads) {
      const tex = canvasTex(128, 256, (g, w, h) => {
        g.clearRect(0, 0, w, h);
        g.fillStyle = 'rgba(80,220,255,0.35)'; g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 16; g.lineJoin = 'round';
        for (const y0 of [40, 168]) { g.beginPath(); g.moveTo(18, y0 + 50); g.lineTo(w / 2, y0); g.lineTo(w - 18, y0 + 50); g.stroke(); }
      });
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, p.len / 2.2);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(p.wid, p.len), mat);
      m.rotation.x = -Math.PI / 2; m.rotation.z = Math.atan2(p.dx, -p.dz) + Math.PI;
      m.position.set(p.x, 0.02, p.z); m.renderOrder = 1;
      // the plane's +y (chevron tip) must point along the push direction
      m.rotation.set(-Math.PI / 2, 0, Math.atan2(-p.dx, -p.dz));
      this.root.add(m);
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(p.wid + 0.2, p.len + 0.2), new THREE.MeshBasicMaterial({ color: 0x2bb8ff, transparent: true, opacity: 0.25, depthWrite: false }));
      edge.rotation.copy(m.rotation); edge.position.set(p.x, 0.015, p.z); this.root.add(edge);
      this.padMats.push(tex);
    }
  }

  /** bounce pads: a sprung disc that squashes when it launches the ball */
  _buildSprings() {
    for (const s of FIELD.springs) {
      const g = new THREE.Group(); g.position.set(s.x, 0, s.z);
      const base = new THREE.Mesh(s.sq ? new THREE.BoxGeometry(s.r * 2, 0.08, s.r * 2) : new THREE.CylinderGeometry(s.r, s.r * 1.05, 0.08, 32), new THREE.MeshStandardMaterial({ color: 0x3b3a52, roughness: 0.6 }));
      base.position.y = 0.04; g.add(base);
      const top = new THREE.Group(); g.add(top);
      // flush with the grass: a flat trampoline tile (players run straight over it)
      const discTex = canvasTex(128, 128, (c, w) => {
        for (let r = 6; r >= 1; r--) { c.fillStyle = r % 2 ? '#ffd23f' : '#ff5f9e'; c.beginPath(); c.arc(w / 2, w / 2, (r / 6) * (w / 2 - 2), 0, Math.PI * 2); c.fill(); }
      });
      const disc = new THREE.Mesh(s.sq ? new THREE.BoxGeometry(s.r * 1.8, 0.06, s.r * 1.8) : new THREE.CylinderGeometry(s.r * 0.9, s.r * 0.9, 0.06, 32), s.sq ? new THREE.MeshStandardMaterial({ map: discTex, emissive: 0xffffff, emissiveMap: discTex, emissiveIntensity: 0.2 }) : [new THREE.MeshStandardMaterial({ color: 0xff5f9e }), new THREE.MeshStandardMaterial({ map: discTex, emissive: 0xffffff, emissiveMap: discTex, emissiveIntensity: 0.2 }), new THREE.MeshStandardMaterial({ color: 0xff5f9e })]);
      disc.position.y = 0.075; top.add(disc);
      this.root.add(g);
      this.springMeshes.push({ x: s.x, z: s.z, top, k: 0 });
    }
  }

  /** the round gadgets of the 机关乐园 map */
  _buildDevices() {
    let sq = false;       // the shape of the device being built (set per device below)
    let spinOff = false;  // a square device that doesn't spin can use a square picture
    const disc = (r, tex, y = 0.025) => {
      const flat = sq && spinOff;
      const m = new THREE.Mesh(flat ? new THREE.PlaneGeometry(2 * r, 2 * r) : new THREE.CircleGeometry(r * (sq ? 0.92 : 1), 48), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = 1; return m;
    };
    // square devices that spin: a still square tile under a round spinning disc
    const tile = (g, r, col) => {
      if (!sq || spinOff) return;
      const t = new THREE.Mesh(new THREE.PlaneGeometry(2 * r, 2 * r), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthWrite: false }));
      t.rotation.x = -Math.PI / 2; t.position.y = 0.018; t.renderOrder = 1; g.add(t);
    };
    const rim = (r, col, w = 0.09) => {
      const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.55, roughness: 0.4 });
      if (sq) {
        const g = new THREE.Group();
        for (const [x, z, sx, sz] of [[0, -r, 2 * r + 2 * w, 2 * w], [0, r, 2 * r + 2 * w, 2 * w], [-r, 0, 2 * w, 2 * r], [r, 0, 2 * w, 2 * r]]) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.1, sz), mat); b.position.set(x, 0.05, z); g.add(b);
        }
        return g;
      }
      const m = new THREE.Mesh(new THREE.TorusGeometry(r, w, 8, 48), mat);
      m.rotation.x = Math.PI / 2; m.position.y = 0.06; return m;
    };
    // portals: a swirling disc; the two of a pair share a colour
    const portalCols = [['#b45cff', '#6b2bd6'], ['#ff6ad5', '#c2188f']];
    for (const p of FIELD.portals) {
      sq = !!p.sq; spinOff = false;
      const [c1, c2] = portalCols[p.idx % 2];
      const tex = canvasTex(256, 256, (g, w) => {
        const gr = g.createRadialGradient(w / 2, w / 2, 4, w / 2, w / 2, w / 2);
        gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.25, c1); gr.addColorStop(1, c2);
        g.fillStyle = gr; (sq && spinOff ? g.fillRect(2, 2, w - 4, w - 4) : (g.beginPath(), g.arc(w / 2, w / 2, w / 2 - 2, 0, Math.PI * 2), g.fill()));
        g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 7;
        for (let k = 0; k < 4; k++) { g.beginPath(); for (let t = 0; t < 1; t += 0.02) { const a = k * Math.PI / 2 + t * 4.5, r = t * (w / 2 - 6); const x = w / 2 + Math.cos(a) * r, y = w / 2 + Math.sin(a) * r; t ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
      });
      const g = new THREE.Group(); g.position.set(p.x, 0, p.z);
      tile(g, p.r, c2); const d = disc(p.r, tex); g.add(d); g.add(rim(p.r, new THREE.Color(c1).getHex()));
      // a soft glowing column so you can spot them from across the park
      const col = new THREE.Mesh(sq ? new THREE.BoxGeometry(p.r * 1.95, 1.6, p.r * 1.95) : new THREE.CylinderGeometry(p.r * 0.95, p.r, 1.6, 32, 1, true), new THREE.MeshBasicMaterial({ color: c1, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
      col.scale.y = 0.35; col.position.y = 0.28; g.add(col);
      this.root.add(g);
      this.devices.push({ kind: 'portal', x: p.x, z: p.z, spinner: d, rate: -2.2, k: 0, g, col });
    }
    // speed rings: orange with arrows pointing outwards ("faster whichever way you cross it")
    for (const b of FIELD.boosts) {
      sq = !!b.sq; spinOff = true;
      const tex = canvasTex(256, 256, (g, w) => {
        g.fillStyle = 'rgba(255,140,40,0.35)'; (sq && spinOff ? g.fillRect(2, 2, w - 4, w - 4) : (g.beginPath(), g.arc(w / 2, w / 2, w / 2 - 2, 0, Math.PI * 2), g.fill()));
        g.fillStyle = '#fff';
        for (let k = 0; k < 8; k++) { g.save(); g.translate(w / 2, w / 2); g.rotate(k * Math.PI / 4); g.beginPath(); g.moveTo(0, -w * 0.44); g.lineTo(-w * 0.07, -w * 0.3); g.lineTo(w * 0.07, -w * 0.3); g.closePath(); g.fill(); g.restore(); }
        g.font = `bold ${w * 0.2}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('×1.7', w / 2, w / 2);
      });
      const g = new THREE.Group(); g.position.set(b.x, 0, b.z);
      const d = disc(b.r, tex); g.add(d); g.add(rim(b.r, 0xff8a2a, 0.1));
      this.root.add(g);
      this.devices.push({ kind: 'boost', x: b.x, z: b.z, spinner: null, k: 0, g, glow: d });
    }
    // whirlpools: a turning blue spiral
    for (const v of FIELD.vortices) {
      sq = !!v.sq; spinOff = false;
      const tex = canvasTex(256, 256, (g, w) => {
        const gr = g.createRadialGradient(w / 2, w / 2, 2, w / 2, w / 2, w / 2);
        gr.addColorStop(0, '#0d3a8a'); gr.addColorStop(1, 'rgba(70,170,255,0.55)');
        g.fillStyle = gr; (sq && spinOff ? g.fillRect(2, 2, w - 4, w - 4) : (g.beginPath(), g.arc(w / 2, w / 2, w / 2 - 2, 0, Math.PI * 2), g.fill()));
        g.strokeStyle = 'rgba(220,245,255,0.9)'; g.lineWidth = 6;
        for (let k = 0; k < 3; k++) { g.beginPath(); for (let t = 0.05; t < 1; t += 0.02) { const a = k * 2.094 - t * 7, r = t * (w / 2 - 6); const x = w / 2 + Math.cos(a) * r, y = w / 2 + Math.sin(a) * r; t > 0.06 ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
      });
      const g = new THREE.Group(); g.position.set(v.x, 0, v.z);
      tile(g, v.r, '#0d3a8a'); const d = disc(v.r, tex); g.add(d); g.add(rim(v.r, 0x3b9bff, 0.08));
      this.root.add(g);
      this.devices.push({ kind: 'vortex', x: v.x, z: v.z, spinner: d, rate: 3.2, k: 0, g });
    }
    // wheels of fortune: rainbow segments with a question mark, spinning slowly
    for (const wf of FIELD.wheels) {
      sq = !!wf.sq; spinOff = false;
      const tex = canvasTex(256, 256, (g, w) => {
        const n = 8;
        for (let k = 0; k < n; k++) { g.fillStyle = `hsl(${k * 360 / n}, 85%, 62%)`; g.beginPath(); g.moveTo(w / 2, w / 2); g.arc(w / 2, w / 2, w / 2 - 2, k * Math.PI * 2 / n, (k + 1) * Math.PI * 2 / n); g.closePath(); g.fill(); }
        g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, w / 2, w * 0.18, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#ff4f7b'; g.font = `bold ${w * 0.26}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', w / 2, w / 2 + 2);
      });
      const g = new THREE.Group(); g.position.set(wf.x, 0, wf.z);
      tile(g, wf.r, '#ffffff'); const d = disc(wf.r, tex); g.add(d); g.add(rim(wf.r, 0xffffff, 0.08));
      this.root.add(g);
      this.devices.push({ kind: 'wheel', x: wf.x, z: wf.z, spinner: d, rate: 0.8, k: 0, g });
    }
  }

  /** energy barriers across the goal mouths (方块乐园): a shimmering hex wall in the owner's colour */
  _buildShields() {
    if (!FIELD.shields) return;
    for (const g of GOALS) {
      const W = 2 * FIELD.goalHalfW, Hh = FIELD.goalH;
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uColor: { value: new THREE.Color(teamOf(g.team).color) }, uTime: { value: 0 }, uK: { value: 0 }, uFlash: { value: 0 }, uSize: { value: new THREE.Vector2(W, Hh) } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform vec3 uColor; uniform float uTime; uniform float uK; uniform float uFlash; uniform vec2 uSize; varying vec2 vUv;
          float hexLine(vec2 p) {
            p *= vec2(1.0, 1.1547);
            vec2 a = mod(p, vec2(1.0, 1.732)) - vec2(0.5, 0.866);
            vec2 b = mod(p - vec2(0.5, 0.866), vec2(1.0, 1.732)) - vec2(0.5, 0.866);
            vec2 h = dot(a, a) < dot(b, b) ? a : b;
            h = abs(h);
            float d = max(dot(h, vec2(0.5, 0.866)), h.x);
            return smoothstep(0.42, 0.5, d);
          }
          void main(){
            vec2 p = vUv * uSize * 2.2;
            float line = hexLine(p);
            float wave = 0.5 + 0.5 * sin(p.x * 0.8 - uTime * 3.0 + p.y);
            float edge = smoothstep(0.86, 1.0, vUv.y) + smoothstep(0.08, 0.0, vUv.y) * 0.6;
            vec3 col = mix(uColor, vec3(1.0), 0.45 * line + uFlash);
            float a = (0.2 + 0.6 * line * (0.55 + 0.45 * wave) + 0.5 * edge) * uK + uFlash * 0.9;
            gl_FragColor = vec4(col, min(a, 0.95));
          }`,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, Hh), mat);
      mesh.position.set(g.centre.x + g.inward.x * 0.03, Hh / 2, g.centre.z + g.inward.z * 0.03);
      mesh.rotation.y = g.axis === 'x' ? Math.PI / 2 : 0;
      mesh.renderOrder = 3;
      this.root.add(mesh);
      this.shields[g.team] = { mesh, mat, k: 0, target: 0, flash: 0 };
    }
  }

  /** which goals are shielded (fades the walls in / out) */
  setShields(set, quiet = false) {
    for (const [t, s] of Object.entries(this.shields)) { s.target = set.has(+t) ? 1 : 0; if (quiet && !s.target) s.k = Math.min(s.k, 0.3); }
  }

  /** a shield shatters: white flash, then it's gone */
  breakShield(team) {
    const s = this.shields[team]; if (!s) return;
    s.target = 0; s.flash = 1;
  }

  /** a bumper or bounce pad reacting to the ball */
  pulse(kind, x, z) {
    if (kind === 'portal' || kind === 'boost' || kind === 'vortex' || kind === 'wheel') {
      let best = null, bd = 2.5;
      for (const m of this.devices) { if (m.kind !== kind) continue; const d = Math.hypot(m.x - x, m.z - z); if (d < bd) { bd = d; best = m; } }
      if (best) best.k = 1;
      return;
    }
    const list = kind === 'bumper' ? this.bumperMeshes : this.springMeshes;
    let best = null, bd = 2;
    for (const m of list) { const d = Math.hypot(m.x - x, m.z - z); if (d < bd) { bd = d; best = m; } }
    if (best) best.k = 1;
  }

  update(dt, t) {
    this.time = t;
    this.scenery.update(dt, t);
    for (const tex of this.padMats || []) tex.offset.y -= dt * 1.6;
    for (const s of Object.values(this.shields || {})) {
      s.k += (s.target - s.k) * Math.min(1, dt * (s.target ? 3 : 6));
      s.flash = Math.max(0, s.flash - dt * 2.5);
      s.mat.uniforms.uK.value = s.k; s.mat.uniforms.uFlash.value = s.flash; s.mat.uniforms.uTime.value = t;
      s.mesh.visible = s.k > 0.01 || s.flash > 0.01;
      if (s.flash > 0) s.mesh.scale.set(1, 1 + s.flash * 0.08, 1); else s.mesh.scale.set(1, 1, 1);
    }
    for (const d of this.devices || []) {
      if (d.spinner) d.spinner.rotation.z += dt * d.rate * (1 + d.k * 4);
      if (d.k > 0) {
        d.k = Math.max(0, d.k - dt * 2.5);
        const s = 1 + Math.sin(d.k * Math.PI) * 0.22;
        d.g.scale.set(s, 1, s);
        if (d.col) d.col.material.opacity = 0.16 + d.k * 0.5;
      }
    }
    for (const b of this.bumperMeshes || []) {
      if (b.k <= 0) continue;
      b.k = Math.max(0, b.k - dt * 3.5);
      const s = 1 + Math.sin(b.k * Math.PI) * 0.18;
      b.g.scale.set(s, 1 + (s - 1) * 0.5, s); b.capMat.emissiveIntensity = b.k * 1.2;
    }
    for (const sp of this.springMeshes || []) {
      if (sp.k <= 0) continue;
      sp.k = Math.max(0, sp.k - dt * 3);
      sp.top.position.y = Math.sin((1 - sp.k) * Math.PI) * 0.18 * sp.k;
    }
    for (const s of Object.values(this.seals)) {
      if (s.k !== s.target) {
        s.k += Math.sign(s.target - s.k) * Math.min(Math.abs(s.target - s.k), dt * 2.2);
        const e = s.k < 1 ? 1 - Math.pow(1 - s.k, 3) : 1;
        s.g.position.y = (e - 1) * s.h;
        s.g.visible = s.k > 0.001;
      }
    }
    this.excite = Math.max(0, this.excite - dt * 0.4);
    this.wind.value += dt * (1 + this.excite * 3);
    // petals drift and loop
    if (this.petals) {
      const a = this.petals.geometry.attributes.position.array;
      const gust = 1 + this.excite * 2.5;
      this.petalData.forEach((p, i) => {
        p.y -= p.sy * dt; p.x += (p.sx + Math.sin(t * 0.7 + p.ph) * 0.3) * dt * gust; p.z += Math.cos(t * 0.5 + p.ph) * 0.25 * dt * gust;
        const RX = FIELD.hx + 14, RZ = FIELD.hz + 14;
        if (p.y < 0) { p.y = rnd(6, 10); p.x = rnd(-RX, RX); p.z = rnd(-RZ, RZ); }
        if (p.x > RX + 2) p.x -= 2 * RX + 4;
        a[i * 3] = p.x; a[i * 3 + 1] = p.y; a[i * 3 + 2] = p.z;
      });
      this.petals.geometry.attributes.position.needsUpdate = true;
    }
    for (const n of Object.values(this.goalNets)) {
      if (n.bulge > 0.001 || n._dirty) {
        const pos = n.back.geometry.attributes.position, a = pos.array, r = n.rest;
        for (let i = 0; i < a.length; i += 3) {
          const d2 = (r[i] - n.at.x) ** 2 + (r[i + 1] - n.at.y) ** 2;
          const edge = (1 - Math.abs(r[i]) / (FIELD.goalHalfW + 0.01)) * (1 - (Math.abs(r[i + 1]) / (FIELD.goalH / 2 + 0.01)) * 0.6);
          a[i + 2] = r[i + 2] + n.bulge * Math.exp(-d2 / 0.35) * edge;
        }
        pos.needsUpdate = true;
        n.bulge *= Math.exp(-dt * 5); n._dirty = n.bulge > 0.001;
      }
    }
  }

  cheer(_team, amount = 1) { this.excite = Math.max(this.excite, amount); this.scenery?.celebrate(); }
}
