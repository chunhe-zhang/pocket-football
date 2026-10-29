// Sphere contact in SI units. J is impulse / mass; a football is a thin shell
// with I = 2/3 m r². Animated bodies act as moving surfaces of infinite mass.
export function sphereContact(v, spin, n, surface, radius, restitution, friction) {
  const vx = v.x - surface.x, vy = v.y - surface.y, vz = v.z - surface.z;
  const vn = vx * n.x + vy * n.y + vz * n.z;
  if (vn >= 0) return 0;
  const jn = -(1 + restitution) * vn;
  v.x += jn * n.x; v.y += jn * n.y; v.z += jn * n.z;
  const rx = -radius * n.x, ry = -radius * n.y, rz = -radius * n.z;
  const sx = vx - vn * n.x + spin.y * rz - spin.z * ry;
  const sy = vy - vn * n.y + spin.z * rx - spin.x * rz;
  const sz = vz - vn * n.z + spin.x * ry - spin.y * rx;
  const slip = Math.hypot(sx, sy, sz);
  if (slip > 1e-8) {
    // Effective tangential inverse mass = 1 + mr²/I = 2.5; Coulomb cap.
    const k = -Math.min(slip / 2.5, friction * jn) / slip;
    const jx = sx * k, jy = sy * k, jz = sz * k;
    v.x += jx; v.y += jy; v.z += jz;
    const invI = 1.5 / (radius * radius);
    spin.x += (ry * jz - rz * jy) * invI;
    spin.y += (rz * jx - rx * jz) * invI;
    spin.z += (rx * jy - ry * jx) * invI;
  }
  return -vn;
}

const FLOOR = { x: 0, y: 1, z: 0 }, STILL = { x: 0, y: 0, z: 0 };
/** The same free-flight / turf integrator is used by simulation and anticipation. */
export function advanceFreeBall(p, v, w, h, ball, gravityScale = 1) {
  const R = ball.r, grounded = p.y <= R + 0.002 && Math.abs(v.y) < 0.35;
  if (!grounded) {
    v.y -= ball.gravity * h * gravityScale;
    const drag = Math.max(0, 1 - ball.drag * Math.hypot(v.x, v.y, v.z) * h);
    v.x *= drag; v.y *= drag; v.z *= drag;
    const x = v.x, y = v.y, z = v.z;
    v.x += ball.magnus * (w.y * z - w.z * y) * h;
    v.z += ball.magnus * (w.x * y - w.y * x) * h;
    v.y += ball.magnus * 0.4 * (w.z * x - w.x * z) * h;
    const decay = Math.max(0, 1 - 0.25 * h); w.x *= decay; w.y *= decay; w.z *= decay;
  } else {
    v.y = 0; p.y = R;
    const gs = Math.hypot(v.x, v.z), dec = (ball.rollDecel + ball.rollQuad * gs * gs) * h;
    if (gs > 0) { const k = Math.max(0, gs - dec) / gs; v.x *= k; v.z *= k; }
    const x = v.x, z = v.z;
    v.x += ball.magnus * 0.25 * w.y * z * h;
    v.z -= ball.magnus * 0.25 * w.y * x * h;
    w.x = v.z / R; w.z = -v.x / R; w.y *= Math.max(0, 1 - 2.5 * h);
    if (gs < 0.02) v.x = v.z = 0;
  }
  p.x += v.x * h; p.y += v.y * h; p.z += v.z * h;
  let impact = 0;
  if (p.y < R) {
    p.y = R;
    if (v.y < -0.35) {
      impact = -v.y;
      sphereContact(v, w, FLOOR, STILL, R, ball.bounce * (impact > 6 ? 1 : 0.9), 0.45);
      if (v.y < 0.6) v.y = 0;
    } else v.y = 0;
  }
  return impact;
}
