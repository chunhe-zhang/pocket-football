const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** Ease a small control error without ever pulling a distant ball to a player. */
export function constrainCarry(position, carrier, dt, radius = 0.82) {
  const dx = position.x - carrier.x, dz = position.z - carrier.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= radius || dt <= 0) return 0;
  const correction = Math.min((distance - radius) * (1 - Math.exp(-12 * dt)), 2.5 * dt);
  position.x -= dx / distance * correction;
  position.z -= dz / distance * correction;
  return correction;
}

/** A continuously advancing playout clock; packet arrival jitter cannot rewind it. */
export class SnapshotTimeline {
  constructor(delay = 0.12) { this.delay = delay; this.time = null; }
  advance(newest, oldest, now, dt) {
    const target = newest.t + Math.max(0, now - newest.recv) - this.delay;
    if (this.time === null || this.time < oldest.t - 0.5) this.time = Math.max(oldest.t, target);
    else {
      const rate = clamp(1 + (target - this.time) * 3, 0.85, 1.15);
      this.time += Math.max(0, dt) * rate;
    }
    this.time = Math.max(oldest.t, Math.min(this.time, newest.t + 0.08));
    return this.time;
  }
}

/** Snapshot coordinates plus explicit discontinuities, independent of shot speed. */
export function sampleBallSnapshot(s0, s1, renderTime, out) {
  const a = s0.b, b = s1.b, span = s1.t - s0.t;
  const u = span > 0 ? clamp((renderTime - s0.t) / span, 0, 1) : 1;
  const distance = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const speed = Math.max(Math.hypot(a[3], a[4], a[5]), Math.hypot(b[3], b[4], b[5]));
  const jump = s0.br !== undefined && s1.br !== undefined
    ? s0.br !== s1.br
    : distance > Math.max(3, speed * Math.max(0, span) * 1.5 + 0.5);
  if (jump) {
    // A real portal/reset happens at its snapshot timestamp, never early.
    const p = u < 1 ? a : b;
    out.x = p[0]; out.y = p[1]; out.z = p[2];
  } else {
    out.x = a[0] + (b[0] - a[0]) * u;
    out.y = a[1] + (b[1] - a[1]) * u;
    out.z = a[2] + (b[2] - a[2]) * u;
    // Bridge a brief buffer underrun. Bound both time and travel so a lost
    // connection cannot send the ball flying indefinitely through the arena.
    const extra = Math.min(0.08, Math.max(0, renderTime - s1.t), 1.2 / Math.max(speed, 1));
    out.x += b[3] * extra; out.y = Math.max(0.16, out.y + b[4] * extra); out.z += b[5] * extra;
  }
  return jump && u >= 1;
}
