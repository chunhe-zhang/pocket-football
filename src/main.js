import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { Sfx } from './audio.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Game } from './game.js';
import { AvatarTemplate } from './avatar.js';
import { FIELD } from './config.js';
import { Showroom } from './showroom.js';
import { Post, tagGlow } from './post.js';

const params = new URLSearchParams(location.search);
let post = null;

// ---- renderer / scene ------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xffe2ef, 55, 170);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 400);
camera.position.set(0, 10, 16);

// sunny garden lighting: warm key light, bright sky fill, a pink rim from the blossoms
scene.add(new THREE.HemisphereLight(0xeaf5ff, 0x86c070, 1.35));
const sun = new THREE.DirectionalLight(0xfff6ea, 2.7);
sun.position.set(-8, 20, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -(FIELD.half + 5); sc.right = FIELD.half + 5; sc.top = FIELD.half + 6; sc.bottom = -(FIELD.half + 6);
sc.near = 1; sc.far = 60;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(sun);
const rim = new THREE.DirectionalLight(0xffd6ea, 0.7);
rim.position.set(10, 12, -12);
scene.add(rim);

// ---- systems ------------------------------------------------------------------
const sfx = new Sfx();
const input = new Input();
const ui = new UI({ sfx, input, camera });

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post?.setSize(innerWidth, innerHeight);
});
camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, () => sfx.init(), { passive: true });

// ---- load assets --------------------------------------------------------------
const loader = new GLTFLoader();
// some static hosts refuse .glb/.vrm; fall back to a base64 text copy if one is published
async function loadModel(url, from, to, label) {
  const progress = (e) => { if (e.total) ui.loading(from + (to - from) * (e.loaded / e.total), label); };
  try {
    return await loader.loadAsync(url, progress);
  } catch (err) {
    const res = await fetch(url + '.b64.txt');
    if (!res.ok) throw err;
    const bin = Uint8Array.from(atob((await res.text()).trim()), (c) => c.charCodeAt(0));
    return await loader.parseAsync(bin.buffer, url.replace(/[^/]*$/, ''));
  }
}
let template;
try {
  const anims = await loadModel('./assets/models/Xbot.glb', 0, 0.3, '正在载入动作数据…');
  const vrm = await loadModel('./assets/models/player.vrm', 0.3, 0.88, '正在载入球员模型…');
  ui.loading(0.9, '载入足球动作捕捉…');
  const mocap = await fetch('./assets/anim/mocap.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const precision = await fetch('./assets/anim/precision-mocap.json').then(r => r.ok ? r.json() : null).catch(() => null);
  if (mocap && precision) mocap.supplements = precision.takes;
  const anderson = await fetch('./assets/anim/anderson-football.json').then(r => r.ok ? r.json() : null).catch(() => null);
  if (mocap && anderson) mocap.supplements = [...(mocap.supplements || []), ...anderson.takes];
  ui.loading(0.92, '套用动作捕捉动画…');
  template = new AvatarTemplate(vrm, anims, mocap);
  const rai = await loadModel('./assets/models/rai-lightning.vrm', 0.92, 0.95, '正在载入雷元素角色…');
  const thunder = new AvatarTemplate(rai, anims, mocap);
  thunder.authoredThunder = true;
  thunder.authoredElement = 'thunder';
  template.variants = new Map([['thunder', thunder]]);
  const textureCache = new Map(), geometryCache = new Map();
  const shareVariant = (gltf, id) => {
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      // These variants retain the same base topology; share immutable buffers.
      if (/^(Body|Face|Hair)$/.test(o.name)) {
        const key = o.name + ':' + o.geometry.attributes.position.count;
        if (geometryCache.has(key)) { o.geometry.dispose(); o.geometry = geometryCache.get(key); }
        else geometryCache.set(key, o.geometry);
      }
      for (const m of [].concat(o.material)) if (m.map && !/TOPS/i.test(m.name)) {
        // The five new variants share a neutral iris; RAI has its own iris.
        const key = m.map.name + (/IRIS/i.test(m.name) && id === 'thunder' ? ':rai' : '');
        if (textureCache.has(key)) { const old = m.map; m.map = textureCache.get(key); if (old !== m.map) old.dispose(); }
        else textureCache.set(key, m.map);
      }
    });
  };
  shareVariant(rai, 'thunder');
  await Promise.all(['blaze', 'frost', 'gale', 'phantom', 'cannon'].map(async (id) => {
    const gltf = await loadModel(`./assets/models/${id}.vrm`, 0.95, 0.98, '正在载入五元素角色…');
    shareVariant(gltf, id);
    const variant = new AvatarTemplate(gltf, anims, mocap);
    variant.authoredElement = id;
    template.variants.set(id, variant);
  }));
} catch (err) {
  ui.loading(0, '模型载入失败：请通过本地服务器或 GitHub Pages 打开（不能直接双击 index.html）。');
  throw err;
}
ui.loading(0.99, '布置球场…');

const game = new Game({ scene, camera, template, sfx, input, ui });
// shadows cover whichever arena is loaded
game.onMapChange = () => {
  sc.left = -(FIELD.hx + 5); sc.right = FIELD.hx + 5; sc.top = FIELD.hz + 6; sc.bottom = -(FIELD.hz + 6);
  sc.far = 60 + FIELD.hx; sc.updateProjectionMatrix();
  scene.fog.near = 55 + (FIELD.hx - 12) * 1.5; scene.fog.far = 170 + (FIELD.hx - 12) * 2;
};
ui.showroom = new Showroom(template);
ui.bind(game);
window.__game = game; // handy for debugging in the console
// the picture after the scene: glow on the effects, shockwave ripples. ?fx=off|low|high; phones get 'low'
// (no depth pre-pass), and a phone that can't hold the frame rate drops to 'off' by itself
const touch = matchMedia('(pointer: coarse)').matches;
post = new Post(renderer, scene, camera, { quality: params.get('fx') || (touch ? 'low' : 'high') });
game.post = post; game.powerFx.post = post;
let glowSweep = 0;
const draw = (dt) => {
  if (++glowSweep % 15 === 1) tagGlow(scene, post);
  post.update(dt); post.render();
};
// test hook: advance the simulation deterministically and render one frame
window.__step = (n = 1, dt = 1 / 60, render = true) => { for (let i = 0; i < n; i++) { game.update(dt); input.endFrame(); } if (render) draw(dt); return game.time; };

// warm up shaders so the first frame doesn't hitch
renderer.compile(scene, camera);
ui.loading(1, '');
ui.ready();

if (params.get('autostart')) {
  ui.settings.humans = Math.max(1, Math.min(4, +params.get('autostart') || 1));
  if (params.get('level')) ui.settings.level = params.get('level');
  ui.startLocal();
}

// ---- main loop ------------------------------------------------------------------
let last = performance.now();
const fixed = params.get('fixedstep') ? 1 / 60 : 0; // deterministic stepping for automated tests
const substeps = Math.max(1, +(params.get('simsteps') || 1)); // fast-forward for automated tests
function frame(now = performance.now()) {
  requestAnimationFrame(frame);
  const dt = fixed || Math.max(0, Math.min((now - last) / 1000, 1 / 20));
  last = now;
  if (!window.__hold) for (let i = 0; i < substeps; i++) game.update(dt);
  draw(dt || 1 / 60);
  autoQuality(dt);
  // live character models in the picker (menu / lobby)
  if (ui.showroom) ui.showroom.update(dt || 1 / 60, [...document.querySelectorAll('.char-card canvas')].filter((c) => c.offsetParent));
  input.endFrame();
}
// keep the frame rate: if the glow costs too much on this device, step it down
let slowT = 0, fastN = 0;
function autoQuality(dt) {
  if (fixed || params.get('fx') || !dt) return;
  if (dt > 1 / 40) slowT += dt; else { slowT = Math.max(0, slowT - dt * 0.5); fastN++; }
  if (slowT > 3) { post.quality = post.quality === 'high' ? 'low' : 'off'; slowT = 0; }
}
frame();
