import assert from 'node:assert/strict';
import { Expressions } from '../src/expressions.js';

function rig(extra = {}) {
  const names = ['happy', 'angry', 'surprised', 'sad', 'relaxed', 'aa', 'oh', 'blink', 'lookLeft'];
  const mesh = { isMesh: true, morphTargetInfluences: [...names.map(() => 0), 0.37] };
  const node = { traverse(fn) { fn(mesh); } };
  const presets = Object.fromEntries(names.map((name, index) => [name, { morphTargetBinds: [{ node: 0, index, weight: 1 }], ...extra[name] }]));
  const expression = new Expressions(presets, () => node, () => 0.5);
  return { expression, mesh, names };
}

for (const fps of [30, 60, 144]) {
  const { expression: e, mesh } = rig();
  e.pulse('surprised', 0.8, 0.4);
  for (let i = 0; i < fps * 2; i++) e.update(1 / fps);
  assert.ok(e.value.surprised < 1e-5, `transient recovers at ${fps} Hz`);
  assert.equal(e.emoting, false);
  assert.equal(mesh.morphTargetInfluences.at(-1), 0.37, 'unrelated morphs survive');
  e.set('happy', 1); e.set('angry', 1); e.set('aa', 1); e.set('oh', 1);
  for (let i = 0; i < fps; i++) e.update(1 / fps);
  assert.ok(mesh.morphTargetInfluences[0] + mesh.morphTargetInfluences[1] <= 1.000001);
  assert.ok(mesh.morphTargetInfluences[5] + mesh.morphTargetInfluences[6] <= 1.000001);
  e.pulse('sad', 0.7);
  assert.equal(e.target.happy, 0); assert.equal(e.target.angry, 0);
  e.set('aa', Infinity); assert.equal(e.target.aa, 0);
  assert.ok(mesh.morphTargetInfluences.every(Number.isFinite));
}
const { expression: e, mesh } = rig({ happy: { overrideMouth: 'blend', overrideBlink: 'blend', overrideLookAt: 'block' } });
e.set('happy', 0.6); e.set('aa', 1); e.set('blink', 1); e.set('lookLeft', 1);
for (let i = 0; i < 120; i++) e.update(1 / 60);
assert.ok(Math.abs(mesh.morphTargetInfluences[5] - 0.4) < 1e-6, 'VRM mouth suppression');
assert.ok(Math.abs(mesh.morphTargetInfluences[7] - 0.4) < 1e-6, 'VRM blink suppression');
assert.equal(mesh.morphTargetInfluences[8], 0); assert.equal(e.lookWeight, 0);
const binary = rig({ happy: { isBinary: true, overrideMouth: 'block' } });
binary.expression.set('happy', 0.49); binary.expression.set('aa', 1);
for (let i = 0; i < 120; i++) binary.expression.update(1 / 60);
assert.equal(binary.mesh.morphTargetInfluences[0], 0);
assert.ok(binary.mesh.morphTargetInfluences[5] > 0.99);
binary.expression.set('happy', 0.51);
for (let i = 0; i < 120; i++) binary.expression.update(1 / 60);
assert.equal(binary.mesh.morphTargetInfluences[0], 1);
assert.equal(binary.mesh.morphTargetInfluences[5], 0);
console.log('PASS: transient recovery at 30/60/144 Hz, expression budgets, VRM overrides, binary thresholds and authored morph preservation.');
