import * as THREE from 'three';

// Small pooled particle system for grass kicked up by shots and slides,
// and dust puffs when the ball slaps the ground.
const N = 1400;
const KINDS = {
  grass: [[0.33, 0.62, 0.3], [0.42, 0.72, 0.36], [0.28, 0.5, 0.25], [0.5, 0.42, 0.28]],
  dust:  [[0.95, 0.93, 0.88], [0.88, 0.9, 0.85]],
  petal: [[1.0, 0.72, 0.85], [1.0, 0.85, 0.92], [0.98, 0.6, 0.78]],
  spark: [[1.0, 1.0, 0.9], [1.0, 0.92, 0.55], [1.0, 0.8, 0.35]],
  // special shots
  fire:  [[1.0, 0.85, 0.3], [1.0, 0.55, 0.12], [1.0, 0.3, 0.08], [1.0, 0.95, 0.6]],
  ice:   [[0.85, 0.97, 1.0], [0.6, 0.88, 1.0], [1.0, 1.0, 1.0]],
  bolt:  [[0.75, 0.97, 1.0], [0.4, 0.85, 1.0], [1.0, 1.0, 1.0]],
  wind:  [[0.6, 1.0, 0.72], [0.85, 1.0, 0.9], [0.45, 0.9, 0.6]],
  ghost: [[0.72, 0.55, 1.0], [0.9, 0.8, 1.0], [0.5, 0.35, 0.9]],
  smoke: [[0.35, 0.33, 0.38], [0.5, 0.47, 0.5], [1.0, 0.82, 0.3]],
};
// how each kind falls (m/s²; negative floats up) and how it puffs out
const GRAV = { fire: -2.5, smoke: -0.8, ghost: -0.6, wind: 0, bolt: 0, ice: 4 };
const GROW = { dust: 0.25, fire: 0.18, smoke: 0.5, ghost: 0.2, wind: 0.1 };

export class Particles {
  constructor(scene) {
    this.pos = new Float32Array(N * 3); this.col = new Float32Array(N * 3); this.size = new Float32Array(N);
    this.alpha = new Float32Array(N); this.vel = new Float32Array(N * 3); this.life = new Float32Array(N); this.max = new Float32Array(N); this.grow = new Float32Array(N);
    this.grav = new Float32Array(N); this.drag = new Float32Array(N);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, vertexColors: true,
      uniforms: { scale: { value: 600 } },
      vertexShader: `attribute float size; attribute float alpha; varying vec3 vC; varying float vA;
        uniform float scale;
        void main(){ vC = color; vA = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(0.0, size) * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d); if (r > 0.25) discard;
          gl_FragColor = vec4(vC, vA * smoothstep(0.25, 0.12, r)); }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false; this.points.renderOrder = 4;
    scene.add(this.points);
  }

  /**
   * @param p origin {x,y,z}; dir rough direction {x,z} (may be zero);
   * n count; speed m/s; kind 'grass' | 'dust' | 'petal'
   */
  burst(p, dir, n = 12, speed = 3, kind = 'grass', size = 0.05) {
    const pal = KINDS[kind] || KINDS.grass;
    const dl = Math.hypot(dir.x || 0, dir.z || 0) || 1;
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % N;
      this.pos.set([p.x + (Math.random() - 0.5) * 0.15, p.y + 0.03, p.z + (Math.random() - 0.5) * 0.15], i * 3);
      const s = speed * (0.4 + Math.random() * 0.8);
      const a = (Math.random() - 0.5) * 1.6;
      const dx = (dir.x || 0) / dl, dz = (dir.z || 0) / dl;
      const ca = Math.cos(a), sa = Math.sin(a);
      const fx = dl > 0.01 ? dx * ca - dz * sa : Math.random() - 0.5, fz = dl > 0.01 ? dx * sa + dz * ca : Math.random() - 0.5;
      const soft = kind in GRAV;
      const up = kind === 'dust' ? 0.4 : soft ? (Math.random() - 0.3) * speed * 0.6 : 1.2 + Math.random() * 1.6;
      this.vel.set([fx * s, up * (kind === 'dust' ? 0.5 : 1), fz * s], i * 3);
      this.grav[i] = kind === 'dust' ? 0.3 : soft ? GRAV[kind] : 9;
      this.drag[i] = kind === 'dust' ? 3 : soft ? 2.6 : 1.2;
      const c = pal[Math.floor(Math.random() * pal.length)];
      this.col.set(c, i * 3);
      this.max[i] = this.life[i] = kind === 'dust' ? 0.45 : soft ? 0.35 + Math.random() * 0.4 : 0.6 + Math.random() * 0.5;
      this.size[i] = size * (0.6 + Math.random() * 0.8);
      this.grow[i] = GROW[kind] || 0;
    }
  }

  update(dt) {
    const P = this.pos, V = this.vel;
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const j = i * 3;
      const dust = this.grow[i] > 0;
      V[j + 1] -= this.grav[i] * dt;
      const drag = this.drag[i];
      V[j] *= 1 - drag * dt; V[j + 2] *= 1 - drag * dt;
      P[j] += V[j] * dt; P[j + 1] += V[j + 1] * dt; P[j + 2] += V[j + 2] * dt;
      if (P[j + 1] < 0.01) { P[j + 1] = 0.01; V[j] *= 0.5; V[j + 2] *= 0.5; V[j + 1] = 0; }
      this.size[i] += this.grow[i] * dt;
      if (this.life[i] < 0.15) this.size[i] *= 0.85;
      if (this.life[i] <= 0) this.size[i] = 0;
      this.alpha[i] = Math.max(0, this.life[i] / this.max[i]) * (dust ? 0.55 : 1);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.size.needsUpdate = true; g.attributes.alpha.needsUpdate = true; g.attributes.color.needsUpdate = true;
  }
}
