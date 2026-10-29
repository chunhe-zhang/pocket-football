import * as THREE from 'three';
import { glow, GLOW_PASS } from './post.js';

// Pooled particles for everything small that flies off the ball and the players: grass and dust,
// sparks, and the elements (fire, ice, lightning, wind, ghost light, earth smoke).
// Two point clouds share one pool layout: "lit" kinds glow (additive, a hot white core, colour
// that cools over their life, flicker), "matter" kinds (grass, dust, smoke, petals) are drawn
// normally. Each kind has its own little shape drawn in the shader: a flame tongue, an ice
// crystal, a four-point star for sparks and lightning, a wisp for wind, a soft orb for ghosts,
// a blade of grass, a puff of smoke.
const N = 3200;
const KINDS = {
  grass: [[0.33, 0.62, 0.3], [0.42, 0.72, 0.36], [0.28, 0.5, 0.25], [0.5, 0.42, 0.28]],
  dust:  [[0.95, 0.93, 0.88], [0.88, 0.9, 0.85]],
  petal: [[1.0, 0.72, 0.85], [1.0, 0.85, 0.92], [0.98, 0.6, 0.78]],
  spark: [[1.0, 1.0, 0.9], [1.0, 0.92, 0.55], [1.0, 0.8, 0.35]],
  fire:  [[1.0, 0.85, 0.3], [1.0, 0.55, 0.12], [1.0, 0.36, 0.08], [1.0, 0.95, 0.6]],
  ice:   [[0.55, 0.86, 1.0], [0.35, 0.72, 1.0], [0.8, 0.96, 1.0]],
  bolt:  [[0.45, 0.85, 1.0], [0.25, 0.6, 1.0], [0.85, 0.97, 1.0]],
  wind:  [[0.3, 0.85, 0.5], [0.55, 0.95, 0.7], [0.85, 1.0, 0.9]],
  ghost: [[0.6, 0.4, 1.0], [0.78, 0.62, 1.0], [0.45, 0.25, 0.85]],
  smoke: [[0.42, 0.4, 0.45], [0.55, 0.52, 0.55], [1.0, 0.82, 0.3]],
};
// shader shape ids
const SHAPE = { grass: 1, dust: 2, petal: 3, smoke: 2, spark: 4, bolt: 4, fire: 5, ice: 6, wind: 7, ghost: 8 };
const LIT = new Set(['spark', 'bolt', 'fire', 'ice', 'wind', 'ghost']);
// how each kind falls (m/s²; negative floats up), how it spreads, how long it lives
const GRAV = { fire: -3.2, smoke: -0.8, ghost: -0.9, wind: 0, bolt: 0, ice: 3.5, spark: 7, grass: 9, petal: 2.5, dust: 0.3 };
const GROW = { dust: 0.3, fire: 0.1, smoke: 0.55, ghost: 0.22, wind: 0.16, ice: -0.02 };
const LIFE = { dust: [0.45, 0.2], fire: [0.35, 0.35], smoke: [0.6, 0.5], ghost: [0.5, 0.4], wind: [0.35, 0.3], bolt: [0.18, 0.18], ice: [0.5, 0.45], spark: [0.3, 0.35], grass: [0.6, 0.5], petal: [0.9, 0.6] };
const DRAG = { dust: 3, fire: 2.4, smoke: 1.8, ghost: 2.2, wind: 1.4, bolt: 3.5, ice: 2.2, spark: 2.2, grass: 1.2, petal: 1.6 };

const VERT = `attribute float size; attribute float alpha; attribute float shape; attribute float spin; attribute float heat;
  varying vec3 vC; varying float vA; varying float vS; varying float vR; varying float vH;
  uniform float scale;
  void main(){ vC = color; vA = alpha; vS = shape; vR = spin; vH = heat;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(0.0, size) * scale / -mv.z; gl_Position = projectionMatrix * mv; }`;
const FRAG = `varying vec3 vC; varying float vA; varying float vS; varying float vR; varying float vH;
  uniform float lit; uniform float glowPass;
  void main(){
    vec2 p = gl_PointCoord - 0.5;
    float c = cos(vR), s = sin(vR); p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    float r = length(p), a = 0.0, core = 0.0;
    int k = int(vS + 0.5);
    if (k == 1) {            // a blade of grass
      a = smoothstep(0.09, 0.03, abs(p.x) + p.y * p.y * 0.4) * smoothstep(0.48, 0.3, abs(p.y));
    } else if (k == 2) {     // dust / smoke puff: soft, lumpy
      float l = 0.42 + 0.06 * sin(atan(p.y, p.x) * 5.0 + vR * 3.0);
      a = smoothstep(l, l * 0.3, r) * 0.85;
    } else if (k == 3) {     // petal
      a = smoothstep(0.26, 0.2, length(vec2(p.x * 1.8, p.y)));
    } else if (k == 4) {     // a four-pointed star: sparks, lightning
      float st = max(smoothstep(0.06, 0.0, abs(p.x)) * smoothstep(0.5, 0.0, abs(p.y)), smoothstep(0.06, 0.0, abs(p.y)) * smoothstep(0.5, 0.0, abs(p.x)));
      a = max(st, smoothstep(0.22, 0.0, r)); core = smoothstep(0.12, 0.0, r);
    } else if (k == 5) {     // a flame tongue: round at the bottom, licking up to a point
      vec2 q = vec2(p.x * (1.0 + (p.y + 0.5) * 1.3), p.y + 0.12);
      a = smoothstep(0.34, 0.12, length(q) + max(0.0, -p.y) * 0.25); core = smoothstep(0.2, 0.0, length(q + vec2(0.0, 0.08)));
    } else if (k == 6) {     // an ice crystal: a hexagonal glint with a bright centre
      vec2 h = abs(p); float hex = max(h.x * 0.866 + h.y * 0.5, h.y);
      a = smoothstep(0.36, 0.28, hex) * (0.55 + 0.45 * smoothstep(0.1, 0.32, hex)); core = smoothstep(0.1, 0.0, r);
      a = max(a, smoothstep(0.03, 0.0, abs(p.x)) * smoothstep(0.5, 0.2, abs(p.y)) * 0.8);
    } else if (k == 7) {     // a wind wisp: a thin curved stroke
      float arc = abs(r - 0.3); float side = smoothstep(-0.1, 0.25, p.x);
      a = smoothstep(0.05, 0.0, arc) * side * smoothstep(0.5, 0.0, abs(p.y));
    } else {                 // ghost orb: soft glow with a dimmer halo
      a = smoothstep(0.5, 0.0, r) * 0.7 + smoothstep(0.18, 0.0, r) * 0.5; core = smoothstep(0.1, 0.0, r) * 0.6;
    }
    if (a < 0.01) discard;
    vec3 col = vC;
    if (lit > 0.5) { col = mix(col, vec3(1.0), clamp(core * 0.55 + vH * 0.3, 0.0, 0.85)); a = min(1.0, a * 1.15); }
    if (glowPass > 0.5) col *= 1.0 + 0.8 * clamp(core + vH * 0.5, 0.0, 1.0);   // hotter in the glow: the cores burn
    gl_FragColor = vec4(col, a * vA);
  }`;

class Cloud {
  constructor(scene, lit, n) {
    this.n = n;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.size = new Float32Array(n); this.alpha = new Float32Array(n);
    this.shape = new Float32Array(n); this.spin = new Float32Array(n); this.heat = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n); this.grow = new Float32Array(n);
    this.grav = new Float32Array(n); this.drag = new Float32Array(n); this.rot = new Float32Array(n); this.base = new Float32Array(n * 3);
    this.kind = new Uint8Array(n); this.s0 = new Float32Array(n);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('shape', new THREE.BufferAttribute(this.shape, 1));
    g.setAttribute('spin', new THREE.BufferAttribute(this.spin, 1));
    g.setAttribute('heat', new THREE.BufferAttribute(this.heat, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, vertexColors: true, toneMapped: false,
      blending: THREE.NormalBlending,          // additive washes out to white over the bright grass
      uniforms: { scale: { value: 600 }, lit: { value: lit ? 1 : 0 }, glowPass: GLOW_PASS }, vertexShader: VERT, fragmentShader: FRAG,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false; this.points.renderOrder = lit ? 6 : 4;
    scene.add(this.points);
    if (lit) glow(this.points);
  }
}

const KIND_ID = Object.fromEntries(Object.keys(KINDS).map((k, i) => [k, i]));
const KIND_NAME = Object.keys(KINDS);

export class Particles {
  constructor(scene) {
    this.lit = new Cloud(scene, true, Math.round(N * 0.65));
    this.mat = new Cloud(scene, false, Math.round(N * 0.35));
    this._c = new THREE.Color();
  }

  /**
   * @param p origin {x,y,z}; dir rough direction {x,z} (may be zero);
   * n count; speed m/s; kind (see KINDS); size metres
   */
  burst(p, dir, n = 12, speed = 3, kind = 'grass', size = 0.05) {
    const pal = KINDS[kind] || KINDS.grass, kid = KIND_ID[kind] ?? 0;
    const lit = LIT.has(kind), C = lit ? this.lit : this.mat;
    const dl = Math.hypot(dir.x || 0, dir.z || 0) || 1;
    const floaty = kind !== 'grass' && kind !== 'spark' && kind !== 'petal';
    // energy kinds get a few extra, finer motes to read as a richer cloud
    const count = lit ? Math.round(n * 1.35) : n;
    for (let k = 0; k < count; k++) {
      const i = C.next; C.next = (C.next + 1) % C.n;
      const extra = k >= n;                                  // the fine motes
      const j = i * 3;
      const sx = (Math.random() - 0.5) * (lit ? 0.3 : 0.15), sz = (Math.random() - 0.5) * (lit ? 0.3 : 0.15);
      C.pos[j] = p.x + sx; C.pos[j + 1] = p.y + 0.03 + (lit ? (Math.random() - 0.5) * 0.15 : 0); C.pos[j + 2] = p.z + sz;
      const s = speed * (0.35 + Math.random() * 0.9) * (extra ? 1.3 : 1);
      const a = (Math.random() - 0.5) * (floaty ? 2.2 : 1.6);
      const dx = (dir.x || 0) / dl, dz = (dir.z || 0) / dl, ca = Math.cos(a), sa = Math.sin(a);
      let fx = dl > 0.01 ? dx * ca - dz * sa : Math.random() - 0.5, fz = dl > 0.01 ? dx * sa + dz * ca : Math.random() - 0.5;
      if (dl <= 0.01) { const ang = Math.random() * 6.283; fx = Math.cos(ang); fz = Math.sin(ang); }
      let up;
      if (kind === 'dust') up = 0.2 + Math.random() * 0.4;
      else if (kind === 'grass' || kind === 'petal') up = 1.2 + Math.random() * 1.8;
      else if (kind === 'spark') up = 0.8 + Math.random() * 2.4;
      else if (kind === 'fire') up = 0.6 + Math.random() * speed * 0.4;
      else if (kind === 'bolt') up = (Math.random() - 0.5) * speed * 0.9;
      else up = (Math.random() - 0.3) * speed * 0.6;
      C.vel[j] = fx * s; C.vel[j + 1] = up; C.vel[j + 2] = fz * s;
      C.grav[i] = GRAV[kind] ?? 9; C.drag[i] = DRAG[kind] ?? 1.5;
      const c = pal[Math.floor(Math.random() * pal.length)];
      C.base.set(c, j); C.col.set(c, j);
      const L = LIFE[kind] || [0.5, 0.4];
      C.max[i] = C.life[i] = (L[0] + Math.random() * L[1]) * (extra ? 0.7 : 1);
      C.s0[i] = C.size[i] = size * (0.6 + Math.random() * 0.8) * (extra ? 0.55 : 1) * (lit ? 1.5 : 1) * (kind === 'bolt' ? 1.7 : kind === 'wind' ? 1.4 : 1);
      C.grow[i] = (GROW[kind] || 0) * (extra ? 0.5 : 1);
      C.shape[i] = SHAPE[kind] || 2; C.kind[i] = kid;
      C.spin[i] = Math.random() * 6.283;
      C.rot[i] = (Math.random() - 0.5) * (kind === 'grass' || kind === 'petal' ? 14 : kind === 'ice' ? 6 : kind === 'wind' ? 9 : 3);
      C.heat[i] = lit ? 1 : 0;
    }
  }

  update(dt) {
    // point sizes are in pixels: keep them a constant size in the world whatever the screen
    const sc = Math.max(360, (typeof window !== 'undefined' ? window.innerHeight * Math.min(2, window.devicePixelRatio || 1) : 600)) * 0.95;
    this.lit.points.material.uniforms.scale.value = this.mat.points.material.uniforms.scale.value = sc;
    this._step(this.lit, dt, true); this._step(this.mat, dt, false);
  }

  _step(C, dt, lit) {
    const P = C.pos, V = C.vel;
    for (let i = 0; i < C.n; i++) {
      if (C.life[i] <= 0) { if (C.size[i] !== 0) { C.size[i] = 0; C.alpha[i] = 0; } continue; }
      C.life[i] -= dt;
      const j = i * 3, u = 1 - Math.max(0, C.life[i]) / C.max[i];         // 0 → 1 over the life
      const kind = KIND_NAME[C.kind[i]];
      V[j + 1] -= C.grav[i] * dt;
      const dr = Math.max(0, 1 - C.drag[i] * dt);
      V[j] *= dr; V[j + 2] *= dr; if (lit) V[j + 1] *= Math.max(0, 1 - C.drag[i] * 0.4 * dt);
      // a little turbulence for the soft kinds: flames lick, ghosts wander, wind swirls
      if (kind === 'fire' || kind === 'ghost' || kind === 'smoke' || kind === 'wind') {
        const w = kind === 'wind' ? 6 : 2.2;
        V[j] += Math.sin(C.spin[i] * 3 + u * 11) * w * dt; V[j + 2] += Math.cos(C.spin[i] * 2 + u * 9) * w * dt;
      }
      P[j] += V[j] * dt; P[j + 1] += V[j + 1] * dt; P[j + 2] += V[j + 2] * dt;
      if (P[j + 1] < 0.02) {
        P[j + 1] = 0.02;
        if (kind === 'grass' || kind === 'spark' || kind === 'petal' || kind === 'ice') { V[j + 1] = Math.abs(V[j + 1]) * 0.25; V[j] *= 0.5; V[j + 2] *= 0.5; }
        else { V[j + 1] = 0; V[j] *= 0.6; V[j + 2] *= 0.6; }
      }
      C.spin[i] += C.rot[i] * dt;
      // size over life: pop in, then grow (smoke) or shrink (sparks, crystals)
      const pop = Math.min(1, u * 8);
      let sz = C.s0[i] * (0.4 + 0.6 * pop) + C.grow[i] * u * C.max[i];
      if (kind === 'spark' || kind === 'bolt' || kind === 'ice') sz *= 1 - u * 0.6;
      if (kind === 'fire') sz *= 1 + 0.35 * Math.sin(u * 3.1);
      C.size[i] = Math.max(0, sz);
      // colour over life
      const b = C.base;
      if (kind === 'fire') {
        // white-hot → yellow → orange → deep red smoke
        const t = u;
        C.col[j] = b[j] * (1 - t * 0.15); C.col[j + 1] = b[j + 1] * (1 - t * 0.75); C.col[j + 2] = b[j + 2] * (1 - t * 0.9);
        C.heat[i] = Math.max(0, 1 - t * 2.5);
      } else if (lit) {
        C.heat[i] = Math.max(0, 1 - u * 3) + (kind === 'bolt' || kind === 'ice' ? (Math.random() < 0.15 ? 0.8 : 0) : 0);   // flicker / twinkle
      }
      // fade: quick in, a long tail out; lightning flickers
      let al = Math.min(1, u * 10) * Math.pow(Math.max(0, 1 - u), lit ? 1.2 : 0.8);
      if (kind === 'bolt') al *= 0.55 + 0.45 * (Math.random() < 0.7 ? 1 : 0);
      if (kind === 'dust') al *= 0.55; else if (kind === 'smoke') al *= 0.7;
      C.alpha[i] = al;
      if (C.life[i] <= 0) { C.size[i] = 0; C.alpha[i] = 0; }
    }
    const g = C.points.geometry.attributes;
    g.position.needsUpdate = g.size.needsUpdate = g.alpha.needsUpdate = g.color.needsUpdate = g.spin.needsUpdate = g.heat.needsUpdate = g.shape.needsUpdate = true;
  }
}
