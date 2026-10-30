import assert from 'node:assert/strict';
import { constrainCarry, SnapshotTimeline, sampleBallSnapshot } from '../src/ball-motion.js';

for (const fps of [30, 60, 144]) {
  const p = { x: 1.6, y: 0.16, z: 0 }, carrier = { x: 0, z: 0 };
  for (let i = 0; i < fps; i++) {
    const before = p.x;
    const movement = constrainCarry(p, carrier, 1 / fps);
    assert.ok(movement <= 2.5 / fps + 1e-10, `bounded carry at ${fps} fps`);
    assert.ok(p.x <= before && p.x >= 0.82, 'settles without overshoot');
  }
  assert.ok(p.x < 0.821, `carry converges at ${fps} fps`);
}
const snap = (t, x, speed = 80, revision = 1) => ({ t, br: revision, b: [x, 0.16, 0, speed, 0, 0] });
const out = {};
assert.equal(sampleBallSnapshot(snap(0, 0), snap(0.05, 4), 0.025, out), false);
assert.equal(out.x, 2, '80 m/s strike is interpolated, not mistaken for a teleport');
const old0 = snap(0, 0), old1 = snap(0.05, 4); delete old0.br; delete old1.br;
assert.equal(sampleBallSnapshot(old0, old1, 0.025, out), false, 'old host fallback respects velocity');
assert.equal(out.x, 2);
sampleBallSnapshot(snap(0, 0, 0, 1), snap(0.05, 10, 0, 2), 0.049, out);
assert.equal(out.x, 0, 'portal is not applied ahead of its timestamp');
assert.equal(sampleBallSnapshot(snap(0, 0, 0, 1), snap(0.05, 10, 0, 2), 0.05, out), true);
assert.equal(out.x, 10);
sampleBallSnapshot(snap(1, 80), snap(1, 80), 2, out);
assert.ok(out.x <= 81.2, 'lost connection has bounded extrapolation');

// Twenty snapshots/sec, alternating latency and an occasional dropped packet.
// Different local/remote clock origins must not affect the playout clock.
const packets = [];
let lastReceive = 0;
for (let i = 0; i < 100; i++) {
  if (i % 13 === 7) continue;
  const recv = Math.max(lastReceive + 0.001, i * 0.05 + [0.04, 0.075, 0.045, 0.06][i % 4]);
  lastReceive = recv;
  packets.push({ ...snap(1000 + i * 0.05, i * 4), recv: 50 + recv });
}
for (const fps of [30, 60, 144]) {
  const timeline = new SnapshotTimeline(), received = [];
  let next = 0, previous = null, maxStep = 0;
  for (let f = 0; f < fps * 5; f++) {
    const now = 50 + f / fps;
    while (next < packets.length && packets[next].recv <= now) received.push(packets[next++]);
    if (!received.length) continue;
    const t = timeline.advance(received.at(-1), received[0], now, 1 / fps);
    if (previous !== null) {
      assert.ok(t >= previous - 1e-10, 'packet arrival never rewinds the clock');
      assert.ok(t - previous <= 1.15 / fps + 1e-10, 'packet arrival never jumps the clock');
      maxStep = Math.max(maxStep, t - previous);
    }
    previous = t;
  }
  console.log(`PASS: ${fps} fps, jitter/drop test, maximum playout step ${maxStep.toFixed(5)}s`);
}
console.log('PASS: bounded carry, fast strikes, legacy snapshots, timed portals and bounded packet loss.');
