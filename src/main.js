import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { Sfx } from './audio.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Game } from './game.js';
import { FIELD } from './config.js';

const params = new URLSearchParams(location.search);

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
scene.fog = new THREE.Fog(0x2a3a5c, 45, 140);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 400);
camera.position.set(0, 10, 16);

// evening stadium lighting: warm low key light + cool sky fill + floodlight rims
scene.add(new THREE.HemisphereLight(0xbcd2ff, 0x3a4a2a, 1.15));
const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
sun.position.set(-9, 18, 11);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -(FIELD.halfL + 3); sc.right = FIELD.halfL + 3; sc.top = FIELD.halfW + 5; sc.bottom = -(FIELD.halfW + 5);
sc.near = 1; sc.far = 60;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(sun);
const rim = new THREE.DirectionalLight(0xcfe0ff, 0.9);
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
});
camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, () => sfx.init(), { passive: true });

// ---- load assets --------------------------------------------------------------
const loader = new GLTFLoader();
let gltf;
async function loadModel() {
  try {
    return await loader.loadAsync('./assets/models/Xbot.glb', (e) => {
      if (e.total) ui.loading(e.loaded / e.total * 0.9, '正在载入球员模型…');
    });
  } catch (err) {
    // some static hosts refuse .glb; fall back to a base64 text copy if one is published
    const res = await fetch('./assets/models/Xbot.glb.b64.txt');
    if (!res.ok) throw err;
    const bin = Uint8Array.from(atob((await res.text()).trim()), (c) => c.charCodeAt(0));
    return await loader.parseAsync(bin.buffer, './assets/models/');
  }
}
try {
  gltf = await loadModel();
} catch (err) {
  ui.loading(0, '模型载入失败：请通过本地服务器或 GitHub Pages 打开（不能直接双击 index.html）。');
  throw err;
}
ui.loading(0.95, '布置球场…');

const game = new Game({ scene, camera, gltf, sfx, input, ui });
ui.bind(game);
window.__game = game; // handy for debugging in the console
// test hook: advance the simulation deterministically and render one frame
window.__step = (n = 1, dt = 1 / 60, render = true) => { for (let i = 0; i < n; i++) { game.update(dt); input.endFrame(); } if (render) renderer.render(scene, camera); return game.time; };

// warm up shaders so the first frame doesn't hitch
renderer.compile(scene, camera);
ui.loading(1, '');
ui.ready();

if (params.get('autostart')) {
  ui.settings.mode = params.get('autostart') === 'duo' ? 'duo' : 'solo';
  if (params.get('level')) ui.settings.level = params.get('level');
  ui.startMatch();
}

// ---- main loop ------------------------------------------------------------------
let last = performance.now();
const fixed = params.get('fixedstep') ? 1 / 60 : 0; // deterministic stepping for automated tests
const substeps = Math.max(1, +(params.get('simsteps') || 1)); // fast-forward for automated tests
function frame(now = performance.now()) {
  requestAnimationFrame(frame);
  const dt = fixed || Math.min((now - last) / 1000, 1 / 20);
  last = now;
  if (!window.__hold) for (let i = 0; i < substeps; i++) game.update(dt);
  renderer.render(scene, camera);
  input.endFrame();
}
frame();
