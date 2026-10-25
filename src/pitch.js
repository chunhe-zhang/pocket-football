import * as THREE from 'three';
import { FIELD, TEAMS, GOALS, insideArena } from './config.js';

const { half: H, goalHalfW: GW, goalH: GH, goalDepth: GD, postR, cornerR: RC } = FIELD;
const CC = H - RC; // centre of each corner arc, on both axes

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
  const margin = 1.6, ppm = 80;
  const wm = (H + margin) * 2;
  const w = Math.round(wm * ppm);
  const tex = canvasTex(w, w, (g) => {
    const stripes = 12;
    for (let i = 0; i < stripes; i++) {
      g.fillStyle = i % 2 ? '#4fbf55' : '#5ccc5e';
      g.fillRect((i * w) / stripes, 0, w / stripes + 1, w);
    }
    for (let j = 0; j < stripes; j++) {
      g.fillStyle = j % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(0,40,0,0.035)';
      g.fillRect(0, (j * w) / stripes, w, w / stripes + 1);
    }
    const img = g.getImageData(0, 0, w, w), d = img.data;
    for (let p = 0; p < d.length; p += 4) {
      const n = (Math.random() - 0.5) * 18;
      d[p] += n * 0.5; d[p + 1] += n; d[p + 2] += n * 0.4;
    }
    g.putImageData(img, 0, 0);
    const X = (x) => (x + H + margin) * ppm, Y = (z) => (z + H + margin) * ppm;
    // the turf follows the rounded boards; outside it the meadow shows through
    const rounded = (half, r) => {
      g.beginPath();
      g.moveTo(X(-half + r), Y(-half)); g.lineTo(X(half - r), Y(-half)); g.arcTo(X(half), Y(-half), X(half), Y(-half + r), r * ppm);
      g.lineTo(X(half), Y(half - r)); g.arcTo(X(half), Y(half), X(half - r), Y(half), r * ppm);
      g.lineTo(X(-half + r), Y(half)); g.arcTo(X(-half), Y(half), X(-half), Y(half - r), r * ppm);
      g.lineTo(X(-half), Y(-half + r)); g.arcTo(X(-half), Y(-half), X(-half + r), Y(-half), r * ppm);
      g.closePath();
    };
    g.save(); rounded(H + 0.35, RC + 0.35); g.globalCompositeOperation = 'destination-in'; g.fillStyle = '#000'; g.fill(); g.restore();
    // team-coloured goal areas
    for (const goal of GOALS) {
      const t = TEAMS[goal.team];
      g.save();
      g.translate(X(goal.centre.x), Y(goal.centre.z));
      g.rotate(Math.atan2(goal.inward.z, goal.inward.x));
      // local +x points into the pitch
      g.fillStyle = t.css + '33'; g.fillRect(0, -3.2 * ppm, 3 * ppm, 6.4 * ppm);
      g.strokeStyle = t.css; g.lineWidth = 0.09 * ppm;
      g.strokeRect(0, -3.2 * ppm, 3 * ppm, 6.4 * ppm);
      g.fillStyle = t.css; g.fillRect(-0.06 * ppm, -GW * ppm, 0.14 * ppm, 2 * GW * ppm);
      g.beginPath(); g.arc(4.1 * ppm, 0, 0.12 * ppm, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    // boundary
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 0.09 * ppm;
    rounded(H, RC); g.stroke();
    // rainbow centre circle
    const segs = 72, cr = 2.4 * ppm;
    g.lineWidth = 0.18 * ppm;
    for (let i = 0; i < segs; i++) {
      g.strokeStyle = `hsl(${(i / segs) * 360}, 90%, 62%)`;
      g.beginPath(); g.arc(X(0), Y(0), cr, (i / segs) * Math.PI * 2, ((i + 1.15) / segs) * Math.PI * 2); g.stroke();
    }
    g.fillStyle = '#fff'; g.beginPath(); g.arc(X(0), Y(0), 0.16 * ppm, 0, Math.PI * 2); g.fill();

  });
  return { tex, size: wm };
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
    this.wind = { value: 0 };
    this.excite = 0;
    this._build();
  }

  _build() {
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

    // pitch
    const { tex, size } = grassTexture();
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, alphaTest: 0.5 }));
    pitch.rotation.x = -Math.PI / 2; pitch.receiveShadow = true; s.add(pitch);

    this._buildBoards();
    this._buildFence();
    for (const g of GOALS) this._buildGoal(g);
    this._buildFlowers();
    this._buildTrees();
    this._buildPetals();
  }

  _buildBoards() {
    const BH = FIELD.boardH, T = 0.12;
    const tex = flowerBoardTexture();
    const face = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 });
    const top = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const withRepeat = (len) => { const t = tex.clone(); t.needsUpdate = true; t.repeat.set(len / 5, 1); const f = face.clone(); f.map = t; f.emissiveMap = t; return f; };
    const seg = CC - GW; // from the goal post to where the corner curve starts
    for (const goal of GOALS) {
      for (const z of [-1, 1]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(seg, BH, T), [top, top, top, top, withRepeat(seg), withRepeat(seg)]);
        m.castShadow = true; m.receiveShadow = true;
        const along = z * (GW + seg / 2);
        if (goal.axis === 'x') { m.rotation.y = Math.PI / 2; m.position.set(goal.sign * (H + T / 2), BH / 2, along); }
        else m.position.set(along, BH / 2, goal.sign * (H + T / 2));
        this.scene.add(m);
      }
    }
    // curved corner boards (quarter cylinders) with a white rim
    const arcLen = (Math.PI / 2) * RC;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const start = Math.atan2(sx, sz) - Math.PI / 4;
      const geo = new THREE.CylinderGeometry(RC + T / 2, RC + T / 2, BH, 32, 1, true, start, Math.PI / 2);
      const mat = withRepeat(arcLen); mat.side = THREE.DoubleSide;
      const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
      m.position.set(sx * CC, BH / 2, sz * CC); this.scene.add(m);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(RC + T / 2, 0.04, 6, 32, Math.PI / 2), top);
      rim.rotation.x = Math.PI / 2; rim.rotation.z = -start + Math.PI / 2 - Math.PI / 2;
      rim.position.set(sx * CC, BH, sz * CC);
      // torus arc runs from +x towards +y in its own plane; after the x-rotation +y maps to -z
      rim.rotation.set(Math.PI / 2, 0, Math.atan2(sz, sx) - Math.PI / 4);
      this.scene.add(rim);
    }
  }

  _buildFence() {
    // light netting on the far side and both ends (straight runs + curved corners); camera side open
    const tex = netTexture(10); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const FH = 2.6, base = FIELD.boardH, h = FH - base;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
    const postMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const net = (geo, len) => { const t = tex.clone(); t.needsUpdate = true; t.repeat.set(len / 0.6, h / 0.6); const m = new THREE.Mesh(geo, mat.clone()); m.material.map = t; return m; };
    const panel = (len, x, z, rotY) => { const m = net(new THREE.PlaneGeometry(len, h), len); m.position.set(x, base + h / 2, z); m.rotation.y = rotY; this.scene.add(m); };
    panel(2 * CC, 0, -H - 0.2, 0);
    panel(2 * CC, -H - 0.2, 0, Math.PI / 2);
    panel(2 * CC, H + 0.2, 0, Math.PI / 2);
    const arcLen = (Math.PI / 2) * (RC + 0.2);
    for (const [sx, sz] of [[-1, -1], [1, -1]]) {
      const start = Math.atan2(sx, sz) - Math.PI / 4;
      const m = net(new THREE.CylinderGeometry(RC + 0.2, RC + 0.2, h, 24, 1, true, start, Math.PI / 2), arcLen);
      m.position.set(sx * CC, base + h / 2, sz * CC); this.scene.add(m);
    }
    const postGeo = new THREE.CylinderGeometry(0.04, 0.04, FH, 8);
    const post = (x, z) => { const p = new THREE.Mesh(postGeo, postMat); p.position.set(x, FH / 2, z); this.scene.add(p); };
    for (let a = -CC; a <= CC + 0.01; a += 3) { post(a, -H - 0.22); post(-H - 0.22, a); post(H + 0.22, a); }
    for (const [sx, sz] of [[-1, -1], [1, -1]]) for (const k of [0.25, 0.5, 0.75]) {
      const ang = Math.atan2(sx, sz) - Math.PI / 4 + k * Math.PI / 2;
      post(sx * CC + Math.sin(ang) * (RC + 0.22), sz * CC + Math.cos(ang) * (RC + 0.22));
    }
  }

  _buildGoal(goal) {
    const g = new THREE.Group();
    // built as if the goal were on the +x side, then rotated into place
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
    const tint = new THREE.MeshStandardMaterial({ color: TEAMS[goal.team].color, roughness: 0.5 });
    const postGeo = new THREE.CylinderGeometry(postR, postR, GH + postR, 16);
    for (const z of [-GW, GW]) {
      const p = new THREE.Mesh(postGeo, white); p.position.set(H, (GH + postR) / 2, z); p.castShadow = true; g.add(p);
      const back = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, GH, 8), tint); back.position.set(H + GD, GH / 2, z); g.add(back);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, GD, 8), tint); top.rotation.z = Math.PI / 2; top.position.set(H + GD / 2, GH, z); g.add(top);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(postR, postR, 2 * GW + 2 * postR, 16), white);
    bar.rotation.x = Math.PI / 2; bar.position.set(H, GH, 0); bar.castShadow = true; g.add(bar);
    const backBar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2 * GW, 8), tint);
    backBar.rotation.x = Math.PI / 2; backBar.position.set(H + GD, GH, 0); g.add(backBar);

    const tex = netTexture(8); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const netCol = new THREE.Color(TEAMS[goal.team].color).lerp(new THREE.Color(0xffffff), 0.55);
    const netMat = (rx, ry) => { const t = tex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.95, color: netCol }); };
    const cell = 0.14;
    const backNet = new THREE.Mesh(new THREE.PlaneGeometry(2 * GW, GH, 12, 8), netMat(2 * GW / cell / 8, GH / cell / 8));
    backNet.rotation.y = Math.PI / 2; backNet.position.set(H + GD, GH / 2, 0); g.add(backNet);
    const topNet = new THREE.Mesh(new THREE.PlaneGeometry(GD, 2 * GW), netMat(GD / cell / 8, 2 * GW / cell / 8));
    topNet.rotation.x = -Math.PI / 2; topNet.position.set(H + GD / 2, GH, 0); g.add(topNet);
    for (const z of [-GW, GW]) {
      const sn = new THREE.Mesh(new THREE.PlaneGeometry(GD, GH), netMat(GD / cell / 8, GH / cell / 8));
      sn.position.set(H + GD / 2, GH / 2, z); g.add(sn);
    }
    // rotate +x into this goal's outward direction
    const out = { x: -goal.inward.x, z: -goal.inward.z };
    g.rotation.y = Math.atan2(-out.z, out.x);
    this.scene.add(g);
    g.updateMatrixWorld(true);
    this.goalNets[goal.team] = { back: backNet, rest: backNet.geometry.attributes.position.array.slice(), bulge: 0, at: new THREE.Vector3() };
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
    const perVariant = 1300;
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
        p.set(rnd(-H - 15, H + 15), 0, rnd(-H - 15, H + 15));
        const ex = Math.max(Math.abs(p.x), Math.abs(p.z));
        if (insideArena(p.x, p.z, 0.45)) continue;
        // keep the space behind the goals clear
        if (GOALS.some((g) => {
          const along = g.axis === 'x' ? Math.abs(p.z) : Math.abs(p.x), out = g.axis === 'x' ? p.x * g.sign : p.z * g.sign;
          return along < GW + 0.5 && out > H - 0.1 && out < H + GD + 0.5;
        })) continue;
        // denser close to the pitch
        if (Math.random() > 1.25 - (ex - H) / 16) continue;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
        const k = rnd(0.7, 1.35); sc.set(k, k * rnd(0.85, 1.2), k);
        m4.compose(p, q, sc); inst.setMatrixAt(n++, m4);
      }
      inst.count = n;
      this.scene.add(inst);
    }
  }

  _buildTrees() {
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a5a44 });
    const blossomMats = [0xffb3d1, 0xff9cc6, 0xffc9e0].map((c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true }));
    const spots = [];
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + rnd(-0.08, 0.08), r = rnd(H + 13, H + 22);
      spots.push([Math.cos(a) * r, Math.sin(a) * r]);
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
      this.scene.add(tree);
    }
  }

  _buildPetals() {
    const n = 420, pos = new Float32Array(n * 3);
    this.petalData = [];
    for (let i = 0; i < n; i++) {
      const p = { x: rnd(-H - 14, H + 14), y: rnd(0, 9), z: rnd(-H - 14, H + 14), sx: rnd(0.2, 0.6), sy: rnd(0.25, 0.6), ph: Math.random() * 10 };
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
      pole.position.set(x * (H - 0.05), 0.65, z * (H - 0.05)); this.scene.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.28), new THREE.MeshLambertMaterial({ color: hues[i++], side: THREE.DoubleSide }));
      flag.position.set(x * (H - 0.05) + 0.21, 1.15, z * (H - 0.05)); this.scene.add(flag);
    }
  }

  update(dt, t) {
    this.time = t;
    this.excite = Math.max(0, this.excite - dt * 0.4);
    this.wind.value += dt * (1 + this.excite * 3);
    // petals drift and loop
    if (this.petals) {
      const a = this.petals.geometry.attributes.position.array;
      const gust = 1 + this.excite * 2.5;
      this.petalData.forEach((p, i) => {
        p.y -= p.sy * dt; p.x += (p.sx + Math.sin(t * 0.7 + p.ph) * 0.3) * dt * gust; p.z += Math.cos(t * 0.5 + p.ph) * 0.25 * dt * gust;
        if (p.y < 0) { p.y = rnd(6, 10); p.x = rnd(-H - 14, H + 14); p.z = rnd(-H - 14, H + 14); }
        if (p.x > H + 16) p.x -= 2 * H + 30;
        a[i * 3] = p.x; a[i * 3 + 1] = p.y; a[i * 3 + 2] = p.z;
      });
      this.petals.geometry.attributes.position.needsUpdate = true;
    }
    for (const n of Object.values(this.goalNets)) {
      if (n.bulge > 0.001 || n._dirty) {
        const pos = n.back.geometry.attributes.position, a = pos.array, r = n.rest;
        for (let i = 0; i < a.length; i += 3) {
          const d2 = (r[i] - n.at.x) ** 2 + (r[i + 1] - n.at.y) ** 2;
          const edge = (1 - Math.abs(r[i]) / (GW + 0.01)) * (1 - (Math.abs(r[i + 1]) / (GH / 2 + 0.01)) * 0.6);
          a[i + 2] = r[i + 2] + n.bulge * Math.exp(-d2 / 0.35) * edge;
        }
        pos.needsUpdate = true;
        n.bulge *= Math.exp(-dt * 5); n._dirty = n.bulge > 0.001;
      }
    }
  }

  cheer(_team, amount = 1) { this.excite = Math.max(this.excite, amount); }
}
