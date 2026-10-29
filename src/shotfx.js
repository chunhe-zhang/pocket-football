import * as THREE from 'three';
import { glow } from './post.js';

// The big-moment effects drawn with their own shaders (they all glow, see post.js):
//  · a comet tail behind a special shot — a tapering ribbon of the element's energy, white-hot down
//    its spine, with the element's own texture flowing back along it (licking flame, crackling
//    electric streaks, glittering frost, spiralling wind, smoky ghost-light, heavy molten rock),
//    and a burning halo round the ball;
//  · a skill going off — a column of energy shooting up round the player and a spinning sigil
//    burnt into the turf under the feet.
// Purely visual: reads the ball and the athletes, never touches the game.

const COL = { thunder: [0.55, 0.38, 1.0], blaze: [1.0, 0.4, 0.08], frost: [0.3, 0.68, 1.0], gale: [0.2, 0.95, 0.5], phantom: [0.66, 0.3, 1.0], cannon: [1.0, 0.62, 0.18] };
const KIND = { blaze: 0, thunder: 1, frost: 2, gale: 3, phantom: 4, cannon: 5 };

const NOISE = `
  float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }`;

// ---- comet tail ---------------------------------------------------------------------------
const SEG = 30;
const TAIL_VS = `attribute float along; attribute float side; varying float vU; varying float vS;
  void main(){ vU = along; vS = side; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const TAIL_FS = `uniform vec3 color; uniform vec3 color2; uniform float time; uniform float power; uniform int kind;
  varying float vU; varying float vS;
  ${NOISE}
  void main(){
    float u = vU, s = vS, as = abs(s);
    float n = fbm(vec2(u * 7.0 - time * 9.0, s * 1.7 + time * 0.7));
    float body = exp(-as * as * 2.6);                         // soft edges
    float spine = exp(-as * as * 26.0) * pow(1.0 - u, 1.6);   // white-hot core down the middle
    float fade = pow(1.0 - u, 1.25) * smoothstep(0.0, 0.04, u + 0.02);
    float a = 0.0; vec3 c = color;
    if (kind == 0) {          // fire: tongues that lick off the edges, yellow inside, deep red outside
      float t = fbm(vec2(u * 10.0 - time * 14.0, s * 3.0));
      a = smoothstep(0.15, 0.85, body * (0.55 + t) - u * 0.35);
      c = mix(color2, color, smoothstep(0.2, 0.9, body + (1.0 - u) * 0.4));
    } else if (kind == 1) {   // lightning: hard bright streaks that flicker along the tail
      float k = step(0.62, vn(vec2(u * 26.0 - time * 40.0, floor(s * 4.0 + 4.0) + floor(time * 18.0))));
      a = body * 0.45 + k * exp(-as * as * 5.0) * 1.2;
    } else if (kind == 2) {   // frost: a cold haze glittering with crystals
      float g = step(0.9, h21(floor(vec2(u * 60.0, s * 8.0) + floor(time * 20.0))));
      a = body * (0.4 + 0.5 * n) + g * body * 1.4; c = mix(color, vec3(1.0), g * 0.6);
    } else if (kind == 3) {   // wind: spiralling bands
      float b = 0.5 + 0.5 * sin(u * 34.0 - time * 26.0 + s * 4.0);
      a = body * (0.25 + 0.9 * pow(b, 3.0));
    } else if (kind == 4) {   // ghost-light: wisps with a dark heart
      a = body * smoothstep(0.35, 0.8, n + 0.2) * 1.1; c = mix(color * 0.5, color, n);
      spine *= 0.4;
    } else {                  // earth: molten and heavy, embers in it
      float e = step(0.93, h21(floor(vec2(u * 40.0 - time * 10.0, s * 6.0))));
      a = body * (0.5 + 0.6 * n) + e * 1.5; c = mix(color2, color, n);
    }
    vec3 col = c * 0.9 * a + mix(c, vec3(1.0), 0.35) * spine * 0.85;
    float alpha = clamp((a * 0.65 + spine * 0.8) * fade * power, 0.0, 1.0);
    gl_FragColor = vec4(col * fade * power, alpha);
  }`;

class Comet {
  constructor(scene) {
    this.pts = Array.from({ length: SEG }, () => new THREE.Vector3());
    this.n = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(SEG * 2 * 3);
    const along = new Float32Array(SEG * 2), side = new Float32Array(SEG * 2), idx = [];
    for (let i = 0; i < SEG; i++) {
      along[i * 2] = along[i * 2 + 1] = i / (SEG - 1); side[i * 2] = -1; side[i * 2 + 1] = 1;
      if (i < SEG - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('along', new THREE.BufferAttribute(along, 1)); g.setAttribute('side', new THREE.BufferAttribute(side, 1));
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: TAIL_VS, fragmentShader: TAIL_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: { color: { value: new THREE.Color() }, color2: { value: new THREE.Color() }, time: { value: 0 }, power: { value: 0 }, kind: { value: 0 } },
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 7;
    scene.add(glow(this.mesh));
    // the halo round the ball
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.halo.renderOrder = 7; scene.add(glow(this.halo));
    this.power = 0; this.kind = null; this._d = new THREE.Vector3(); this._v = new THREE.Vector3(); this._r = new THREE.Vector3();
  }

  update(dt, t, ball, cam, ids) {
    const on = ids.length > 0 && !ball.hidden && !ball.heldBy;
    if (on && this.kind !== ids[0]) { this.kind = ids[0]; this.n = 0; }
    this.power += ((on ? 1 : 0) - this.power) * Math.min(1, dt * (on ? 10 : 5));
    const vis = this.power > 0.01 && this.kind;
    this.mesh.visible = this.halo.visible = !!vis;
    if (!vis) { this.n = 0; return; }
    // the path: newest first, one point a frame, the tail dragging a bit behind fast shots
    if (on) { this.pts.unshift(this.pts.pop()); this.pts[0].copy(ball.pos); this.n = Math.min(SEG, this.n + 1); }
    const n = Math.max(2, this.n), P = this.pts;
    const sp = Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z);
    const W = (0.2 + Math.min(0.28, sp * 0.012)) * (ids.length > 1 ? 1.35 : 1);
    for (let i = 0; i < SEG; i++) {
      const p = P[Math.min(i, n - 1)];
      const a = P[Math.max(0, Math.min(i, n - 1) - 1)], b = P[Math.min(n - 1, i + 1)];
      this._d.subVectors(a, b); if (this._d.lengthSq() < 1e-8) this._d.set(1, 0, 0);
      this._v.subVectors(cam.position, p);
      this._r.crossVectors(this._d, this._v).normalize();
      const u = i / (SEG - 1), w = W * (1 - u * 0.75) * (i === 0 ? 0.6 : 1);
      const j = i * 6;
      this.pos[j] = p.x - this._r.x * w; this.pos[j + 1] = p.y - this._r.y * w; this.pos[j + 2] = p.z - this._r.z * w;
      this.pos[j + 3] = p.x + this._r.x * w; this.pos[j + 4] = p.y + this._r.y * w; this.pos[j + 5] = p.z + this._r.z * w;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    const c = COL[this.kind] || [1, 1, 1], U = this.mat.uniforms;
    U.color.value.setRGB(c[0], c[1], c[2]);
    U.color2.value.setRGB(c[0] * 0.8, c[1] * 0.25, c[2] * 0.2);
    if (this.kind === 'blaze') U.color.value.setRGB(1.0, 0.75, 0.25);
    U.time.value = t; U.power.value = this.power; U.kind.value = KIND[this.kind] ?? 0;
    this.halo.position.copy(ball.pos);
    this.halo.scale.setScalar((0.75 + 0.1 * Math.sin(t * 40)) * (ids.length > 1 ? 1.3 : 1));
    this.halo.material.color.setRGB(c[0] * 0.85, c[1] * 0.85, c[2] * 0.85);
    this.halo.material.opacity = this.power * 0.75;
    this.halo.material.rotation = t * 3;
  }
}

let _halo = null;
function haloTex() {
  if (_halo) return _halo;
  const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  // four soft rays
  g.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 4; k++) {
    g.save(); g.translate(s / 2, s / 2); g.rotate(k * Math.PI / 4 + 0.3);
    const lg = g.createLinearGradient(-s / 2, 0, s / 2, 0); lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.35)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg; g.fillRect(-s / 2, -2, s, 4); g.restore();
  }
  _halo = new THREE.CanvasTexture(cv); _halo.colorSpace = THREE.SRGBColorSpace;
  return _halo;
}

// ---- skill burst: energy column + ground sigil -------------------------------------------------
const PILLAR_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const PILLAR_FS = `uniform vec3 color; uniform float time; uniform float life; uniform int kind; varying vec2 vUv;
  ${NOISE}
  void main(){
    float y = vUv.y, x = vUv.x;
    float n = fbm(vec2(x * 9.0 + (kind == 3 ? y * 4.0 + time * 3.0 : 0.0), y * 3.0 - time * (kind == 0 ? 5.0 : 3.0)));
    float streak = pow(fbm(vec2(x * 24.0, y * 1.2 - time * 6.0)), 3.0) * 3.0;
    float top = 1.0 - smoothstep(0.35, 1.0, y), bottom = smoothstep(0.0, 0.06, y);
    float a = (n * 0.12 + streak * 0.55) * top * bottom;
    if (kind == 1) a = (step(0.78, vn(vec2(x * 40.0, y * 6.0 - floor(time * 20.0)))) * 0.9 + n * 0.08) * top * bottom;
    float env = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.4, 1.0, life));
    vec3 c = mix(color, vec3(1.0), smoothstep(0.8, 1.6, a) * 0.3) * 0.9;
    gl_FragColor = vec4(c * a * env, clamp(a * env * 0.75, 0.0, 1.0));
  }`;
const SIGIL_FS = `uniform vec3 color; uniform float time; uniform float life; varying vec2 vUv;
  void main(){
    vec2 p = (vUv - 0.5) * 2.0; float r = length(p), ang = atan(p.y, p.x);
    float grow = smoothstep(0.0, 0.25, life);
    float R = 0.62 + 0.3 * grow;
    float ring1 = exp(-pow((r - R) * 40.0, 2.0));
    float ring2 = exp(-pow((r - R * 0.72) * 60.0, 2.0)) * 0.7;
    float ticks = step(0.75, fract((ang + time * 1.4) * 24.0 / 6.2832)) * step(abs(r - R * 0.86), 0.035);
    float runes = step(0.55, fract((ang - time * 0.8) * 8.0 / 6.2832)) * step(abs(r - R * 0.58), 0.02);
    float fill = exp(-r * r * 3.0) * 0.25;
    float a = (ring1 + ring2 + ticks + runes * 0.8 + fill) * (1.0 - smoothstep(0.55, 1.0, life)) * grow;
    gl_FragColor = vec4(color * 0.85 * a, clamp(a * 0.7, 0.0, 1.0));
  }`;

export class ShotFx {
  constructor(scene) {
    this.scene = scene; this.t = 0;
    this.comet = new Comet(scene);
    this.bursts = [];
    this.pillarGeo = new THREE.CylinderGeometry(0.42, 0.62, 2.6, 28, 1, true); this.pillarGeo.translate(0, 1.3, 0);
    this.sigilGeo = new THREE.PlaneGeometry(3.4, 3.4); this.sigilGeo.rotateX(-Math.PI / 2);
  }

  /** a skill goes off at the athlete: the column and the sigil (they follow the player for a moment) */
  burst(a, kind) {
    const c = COL[kind]; if (!c || !a.pos) return;
    if (this.bursts.length > 8) this._kill(this.bursts.shift());
    const color = new THREE.Color(c[0], c[1], c[2]);
    const pm = new THREE.ShaderMaterial({ vertexShader: PILLAR_VS, fragmentShader: PILLAR_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: { color: { value: color }, time: { value: 0 }, life: { value: 0 }, kind: { value: KIND[kind] ?? 0 } } });
    const sm = new THREE.ShaderMaterial({ vertexShader: PILLAR_VS, fragmentShader: SIGIL_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: { color: { value: color }, time: { value: 0 }, life: { value: 0 } } });
    const pillar = new THREE.Mesh(this.pillarGeo, pm), sigil = new THREE.Mesh(this.sigilGeo, sm);
    pillar.renderOrder = 7; sigil.renderOrder = 3; sigil.position.y = 0.03;
    this.scene.add(glow(pillar), glow(sigil));
    this.bursts.push({ a, pillar, sigil, pm, sm, t: 0, life: kind === 'phantom' ? 0.6 : 0.85 });
  }

  _kill(b) { this.scene.remove(b.pillar, b.sigil); b.pm.dispose(); b.sm.dispose(); }

  update(dt, game) {
    this.t += dt;
    const ball = game.ball, type = ball.specialType;
    const ids = type ? type.replace('!', '').split('+').filter((id) => COL[id]) : [];
    this.comet.update(dt, this.t, ball, game.camera, game.state === 'menu' ? [] : ids);
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]; b.t += dt;
      const u = b.t / b.life;
      if (u >= 1) { this._kill(b); this.bursts.splice(i, 1); continue; }
      const p = b.a.pos;
      b.pillar.position.set(p.x, 0, p.z); b.sigil.position.set(p.x, 0.03, p.z);
      b.pillar.scale.set(0.6 + u * 0.9, 0.4 + Math.min(1, u * 4) * 0.8, 0.6 + u * 0.9);
      b.pm.uniforms.time.value = b.sm.uniforms.time.value = this.t;
      b.pm.uniforms.life.value = u; b.sm.uniforms.life.value = u;
    }
  }
}
