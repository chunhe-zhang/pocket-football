import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../vendor/three/three.module.js';
import { AnimationPose } from '../src/animation-pose.js';
// A constant quaternion channel is cached by THREE.PropertyMixer. Applying a
// breathing offset for ten seconds must not accumulate or snap at a loop seam.
const root = new THREE.Group(), bone = new THREE.Bone(); bone.name = 'Chest'; root.add(bone);
const mixer = new THREE.AnimationMixer(root);
const clip = new THREE.AnimationClip('constant', 1, [new THREE.QuaternionKeyframeTrack('Chest.quaternion', [0, 1], [0,0,0,1,0,0,0,1])]);
mixer.clipAction(clip).play();
const pose = new AnimationPose();
for (let i = 0; i < 600; i++) {
  pose.sample(root, mixer, 1 / 60); bone.rotateX(0.025);
  assert.ok(Math.abs(bone.rotation.x - 0.025) < 1e-6, `no cumulative layer drift at frame ${i}`);
}
// Exercise real scheduling code with a renderer/model test double. A hero and
// thumbnail must share one simulation step even when thumbnails skip draws.
const source = fs.readFileSync(new URL('../src/showroom.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export class Showroom', 'class Showroom');
const Showroom = new Function(`${source}; return Showroom;`)();
const room = Object.create(Showroom.prototype);
Object.assign(room, { renderer: { setPixelRatio() {}, render() {} }, camera: { position: { set() {} }, lookAt() {} }, t: 0, frame: 0, dpr: 1, selected: 'thunder' });
const counts = new Map();
room._model = id => {
  if (!counts.has(id)) counts.set(id, { time: 0, calls: 0, yaw: 0, x: 0, height: 1.65, disc: {}, ring: { material: {} }, ch: { group: {}, setFacing() {}, updateVisualDetails() {}, update(dt) { const m = counts.get(id); m.time += dt; m.calls++; } } });
  return counts.get(id);
};
const card = (id, hero = false) => ({ dataset: { c: id }, classList: { contains: () => hero }, getContext: () => ({ clearRect() {}, drawImage() {} }) });
const cards = [card('thunder', true), card('thunder'), card('blaze'), card('frost')];
room.models = counts;
for (let i = 0; i < 120; i++) room.update(1 / 60, cards);
for (const [id, m] of counts) { assert.equal(m.calls, 120, id); assert.ok(Math.abs(m.time - 2) < 1e-9, id); }
assert.ok(Math.abs(counts.get('thunder').yaw) < 0.3, 'portrait never spins away');

// The fixed-step accumulator must advance the same physics time at 30/60/144 Hz.
const avatar = fs.readFileSync(new URL('../src/avatar.js', import.meta.url), 'utf8');
const springCode = avatar.slice(avatar.indexOf('class SpringBones'), avatar.indexOf('export function dyeHair'));
const SpringBones = new Function(`${springCode}; return SpringBones;`)();
for (const fps of [30, 60, 144]) {
  const s = Object.create(SpringBones.prototype); s.needsReset = false; s.accumulator = 0;
  let n = 0; s._step = dt => { assert.equal(dt, 1 / 60); n++; };
  for (let i = 0; i < fps * 5; i++) s.update(1 / fps);
  assert.equal(n, 300, `spring physics at ${fps} Hz`);
}
console.log('PASS: one model update per frame, real elapsed time, stable facing, 30/60/144 Hz physics.');
