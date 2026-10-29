import * as THREE from 'three';
import { EffectComposer } from '../vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from '../vendor/three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three/addons/postprocessing/OutputPass.js';

// The picture after the scene is drawn: a glow that only the effects get (fire, lightning, ice, the
// special shots), heat-haze shockwaves that ripple the screen out from a big impact, and a soft
// flash at the edges of the frame for the biggest moments.
//
// Selective glow: everything that should glow is also put on layer FX. Those objects are drawn a
// second time on their own, at half resolution, over black (behind the depth of the solid world, so
// a player in front still hides them), blurred, and added on top of the frame before tone mapping.
// The grass, the shirts and the white lines never glow however bright the sun makes them.

export const FX_LAYER = 1;
/** put an object (and everything under it) in the glow */
export function glow(obj) { obj.traverse((o) => o.layers.enable(FX_LAYER)); return obj; }
/** shaders that want to be brighter in the glow pass than in the frame read this */
export const GLOW_PASS = { value: 0 };

const MAX_WAVES = 4;
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, tBloom: { value: null }, bloomOn: { value: 1 },
    waves: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector4(0, 0, 0, 0)) },   // x, y (uv), radius, strength
    aspect: { value: 1 }, flash: { value: 0 }, flashColor: { value: new THREE.Color(1, 1, 1) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform sampler2D tBloom; uniform float bloomOn;
    uniform vec4 waves[${MAX_WAVES}]; uniform float aspect; uniform float flash; uniform vec3 flashColor;
    varying vec2 vUv;
    void main(){
      vec2 uv = vUv, off = vec2(0.0); float ring = 0.0;
      for (int i = 0; i < ${MAX_WAVES}; i++) {
        vec4 w = waves[i]; if (w.w <= 0.0) continue;
        vec2 d = uv - w.xy; d.x *= aspect; float r = length(d);
        float band = exp(-pow((r - w.z) * 22.0, 2.0));           // a thin travelling ring of heat haze
        off += (r > 1e-4 ? d / r : vec2(0.0)) * band * w.w * 0.022;
        ring += band * w.w;
      }
      off.x /= aspect;
      vec4 c = texture2D(tDiffuse, uv - off);
      // a touch of colour fringing inside the ripple
      c.r = mix(c.r, texture2D(tDiffuse, uv - off * 1.6).r, clamp(ring, 0.0, 1.0));
      c.b = mix(c.b, texture2D(tDiffuse, uv - off * 0.4).b, clamp(ring, 0.0, 1.0));
      if (bloomOn > 0.5) c.rgb += texture2D(tBloom, uv - off).rgb;
      // edge flash: the frame's border lights up in the effect's colour, the middle stays clear
      vec2 e = vUv - 0.5; float edge = smoothstep(0.25, 0.75, length(e * vec2(1.0, 1.25)));
      c.rgb += flashColor * flash * edge * 0.9;
      gl_FragColor = c;
    }`,
};

export class Post {
  constructor(renderer, scene, camera, { quality = 'high' } = {}) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.quality = quality;           // 'high' | 'low' (no depth pre-pass) | 'off' (plain render)
    this.waves = []; this.flash = 0; this.flashColor = new THREE.Color(1, 1, 1);
    camera.layers.enable(FX_LAYER);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const gl2 = renderer.capabilities.isWebGL2;
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: gl2 ? 4 : 0 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());
    // the glow: effects alone, half resolution
    this.fxRT = new THREE.WebGLRenderTarget(Math.max(1, size.x >> 1), Math.max(1, size.y >> 1), { type: THREE.HalfFloatType });
    this.fxRT.depthTexture = null;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.fxRT.width, this.fxRT.height), 0.42, 0.22, 0.55);
    this.depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });
    this._black = new THREE.Color(0, 0, 0);
    this._v = new THREE.Vector3();
    this.setSize(size.x / renderer.getPixelRatio(), size.y / renderer.getPixelRatio());
  }

  setSize(w, h) {
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr); this.composer.setSize(w, h);
    const W = Math.max(1, Math.round(w * pr / 2)), H = Math.max(1, Math.round(h * pr / 2));
    this.fxRT.setSize(W, H); this.bloom.setSize(W, H);
    this.final.uniforms.aspect.value = w / h;
  }

  /** a ring of heat haze rippling out across the screen from a point in the world */
  shockwave(pos, strength = 1, color = null) {
    const v = this._v.copy(pos).project(this.camera);
    if (v.z > 1 || Math.abs(v.x) > 1.3 || Math.abs(v.y) > 1.3) return;
    if (this.waves.length >= MAX_WAVES) this.waves.shift();
    this.waves.push({ x: v.x * 0.5 + 0.5, y: v.y * 0.5 + 0.5, t: 0, life: 0.55 + 0.25 * strength, s: Math.min(1.6, strength) });
    if (color && strength >= 1.3) this.edgeFlash(color, Math.min(0.3, 0.1 * strength));
  }
  edgeFlash(color, amount = 0.3) { this.flashColor.set(color); this.flash = Math.max(this.flash, amount); }

  update(dt) {
    const U = this.final.uniforms;
    for (let i = this.waves.length - 1; i >= 0; i--) { const w = this.waves[i]; w.t += dt; if (w.t >= w.life) this.waves.splice(i, 1); }
    for (let i = 0; i < MAX_WAVES; i++) {
      const w = this.waves[i], o = U.waves.value[i];
      if (!w) { o.set(0, 0, 0, 0); continue; }
      const u = w.t / w.life;
      o.set(w.x, w.y, 0.03 + u * 0.42 * (0.7 + 0.3 * w.s), w.s * (1 - u) * (1 - u));
    }
    this.flash *= Math.exp(-dt * 6);
    U.flash.value = this.flash; U.flashColor.value.copy(this.flashColor);
  }

  render() {
    const r = this.renderer, s = this.scene, cam = this.camera;
    if (this.quality === 'off') { r.render(s, cam); return; }
    // 1. the glow layer, over black, half size
    const bg = s.background, fog = s.fog, oldMask = cam.layers.mask;
    r.getClearColor(this._cc || (this._cc = new THREE.Color())); const ca = r.getClearAlpha();
    s.background = null; s.fog = null;
    const ac = r.autoClear; r.autoClear = false;
    r.setRenderTarget(this.fxRT); r.setClearColor(this._black, 1); r.clear();
    if (this.quality === 'high') {
      // the solid world's depth first, so effects behind a player are hidden by him
      cam.layers.set(0); s.overrideMaterial = this.depthMat;
      const fxOnly = []; for (const o of this.fxList || []) if (o.layers.isEnabled(FX_LAYER) && o.layers.isEnabled(0)) { fxOnly.push(o); o.layers.disable(0); }
      // only solid things occlude: see-through ones (smoke, sprites, lines) stay out of the depth
      const hidden = []; for (const o of this.hideList || []) if (o.visible) { hidden.push(o); o.visible = false; }
      r.render(s, cam);
      for (const o of hidden) o.visible = true;
      for (const o of fxOnly) o.layers.enable(0);
      s.overrideMaterial = null;
    }
    cam.layers.set(FX_LAYER);
    GLOW_PASS.value = 1;
    r.render(s, cam);
    GLOW_PASS.value = 0;
    cam.layers.mask = oldMask; s.background = bg; s.fog = fog; r.autoClear = ac;
    r.setClearColor(this._cc, ca); r.setRenderTarget(null);
    this.bloom.render(r, null, this.fxRT, 0, false);
    // 2. the frame, the glow added, ripples, tone mapping
    this.final.uniforms.tBloom.value = this.bloom.renderTargetsHorizontal[0].texture;
    this.composer.render();
  }
}

/** sweep the scene for additive (light-emitting) materials and put them in the glow */
export function tagGlow(scene, post = null) {
  const list = [], hide = [];
  scene.traverse((o) => {
    if ((o.isSprite || o.isPoints || o.isLine || (o.isMesh && [].concat(o.material).some((x) => x && x.transparent))) && !o.layers.isEnabled(FX_LAYER)) hide.push(o);
    if (o.layers.isEnabled(FX_LAYER)) { if (o.isMesh || o.isPoints || o.isLine || o.isSprite) list.push(o); return; }
    const m = o.material; if (!m) return;
    const ms = Array.isArray(m) ? m : [m];
    if (ms.some((x) => x.blending === THREE.AdditiveBlending || x.userData?.glow)) { o.layers.enable(FX_LAYER); list.push(o); }
  });
  if (post) { post.fxList = list; post.hideList = hide; }
}
