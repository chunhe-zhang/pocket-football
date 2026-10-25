// All units are metres / seconds / radians.

export const FIELD = {
  half: 9,          // pitch half size (x and z)
  cornerR: 6.6,     // big rounded corners: the arena is almost a circle
  boxDepth: 2.8,    // penalty box in front of each goal (where you may dive)
  boxHalfW: 2.7,
  halfL: 9,         // kept for code that thinks in length/width
  halfW: 9,
  goalHalfW: 1.6,   // half width of goal mouth
  goalH: 1.7,       // crossbar height
  goalDepth: 1.15,  // depth of the goal box behind the line
  postR: 0.06,
  boardH: 0.65,     // perimeter board height (visual)
  fenceH: 4.2,      // netting fence height (visual; physics walls are infinite)
};

export const BALL = {
  r: 0.16,              // a little bigger than a real ball so it reads well on screen
  gravity: 9.81,
  bounce: 0.58,          // vertical restitution on grass
  bounceFriction: 0.88,  // horizontal speed kept on a bounce
  rollDecel: 0.56,       // m/s^2 rolling resistance on grass
  rollQuad: 0.0058,      // extra speed-dependent rolling resistance
  drag: 0.008,           // quadratic air drag factor (1/m)
  magnus: 0.0035,        // curl strength
  wallBounce: 0.9,       // lively boards
  wallKick: 1.5,         // boards add a little pop (m/s) to hard hits
  postBounce: 0.7,
  netDamp: 0.18,
};

export const PLAYER = {
  radius: 0.3,
  height: 1.8,
  walkSpeed: 1.6,
  runSpeed: 5.0,
  sprintSpeed: 6.9,
  accel: 20,
  decel: 26,
  turnRate: 11,
  chargeTime: 0.8,       // seconds to reach full power
  chargeAutoRelease: 0.35,
  staminaDrain: 0.32,
  staminaRegen: 0.2,
  shotSpeed: [11, 25],   // base + power * k (m/s)
  chipSpeed: [8, 10],
};

export const ANIM = {
  walkNatural: 1.51,     // measured from the X Bot walk clip (m/s)
  runNatural: 3.45,      // measured from the X Bot run clip (m/s)
  kickDuration: 0.64,
  kickContact: 0.33,     // normalised time of foot-ball contact
  touchDuration: 0.3,
};

// One player per goal. `side` is the goal they defend: axis + sign.
export const TEAMS = [
  { name: 'BLUE', cn: '蓝', color: 0x3d82ff, css: '#3d82ff', axis: 'x', sign: -1,
    cpuName: '蓝莓',
    kit: { shirt: '#3d82ff', shorts: '#1f2c5c', number: '#ffffff', no: '10', hair: null, outline: 0x1b1630 } },
  { name: 'ORANGE', cn: '橙', color: 0xff7d33, css: '#ff7d33', axis: 'x', sign: 1,
    cpuName: '橘子',
    kit: { shirt: '#ff7d33', shorts: '#2c2a33', number: '#ffffff', no: '7', hair: '#545a86', hairMode: 'multiply', outline: 0x24160f } },
  { name: 'PURPLE', cn: '紫', color: 0xa064ff, css: '#a064ff', axis: 'z', sign: -1,
    cpuName: '葡萄',
    kit: { shirt: '#a064ff', shorts: '#2a1f4d', number: '#ffffff', no: '9', hair: '#d9c8ff', hairMode: 'color', outline: 0x1d1530 } },
  { name: 'PINK', cn: '粉', color: 0xff4fa0, css: '#ff4fa0', axis: 'z', sign: 1,
    cpuName: '桃桃',
    kit: { shirt: '#ff4fa0', shorts: '#4a1832', number: '#ffffff', no: '11', hair: '#ff9cc8', hairMode: 'color', outline: 0x2a1020 } },
];

export const MATCH = {
  durations: [90, 180, 300],
  defaultDuration: 180,
  goalPause: 3.2,
  kickoffDelay: 1.3,
};

// ---- goals ---------------------------------------------------------------------
// For a goal on axis 'x' with sign s: the goal line is x = s·half, the mouth spans z.
export function goalInfo(team) {
  const t = TEAMS[team], H = FIELD.half;
  const ax = t.axis === 'x' ? 1 : 0, az = 1 - ax;
  return {
    team, axis: t.axis, sign: t.sign,
    centre: { x: ax * t.sign * H, z: az * t.sign * H },
    inward: { x: -ax * t.sign, z: -az * t.sign },  // unit vector from the goal into the pitch
  };
}
export const GOALS = TEAMS.map((_, i) => goalInfo(i));
/** which goal (team index) a goal-line side belongs to */
export function goalIndexFor(axis, sign) { return GOALS.findIndex((g) => g.axis === axis && g.sign === sign); }

// ---- rounded arena -------------------------------------------------------------------
/** keep a point inside the rounded-square pitch, `margin` metres from the walls. Returns true if moved. */
export function clampToArena(p, margin = 0) {
  const H = FIELD.half - margin, C = FIELD.half - FIELD.cornerR, Rr = FIELD.cornerR - margin;
  let moved = false;
  if (Math.abs(p.x) > H) { p.x = Math.sign(p.x) * H; moved = true; }
  if (Math.abs(p.z) > H) { p.z = Math.sign(p.z) * H; moved = true; }
  if (Math.abs(p.x) > C && Math.abs(p.z) > C) {
    const cx = Math.sign(p.x) * C, cz = Math.sign(p.z) * C, dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
    if (d > Rr) { p.x = cx + (dx / d) * Rr; p.z = cz + (dz / d) * Rr; moved = true; }
  }
  return moved;
}
export function insideArena(x, z, margin = 0) {
  const H = FIELD.half + margin, C = FIELD.half - FIELD.cornerR;
  if (Math.abs(x) > H || Math.abs(z) > H) return false;
  if (Math.abs(x) > C && Math.abs(z) > C) return Math.hypot(Math.abs(x) - C, Math.abs(z) - C) <= FIELD.cornerR + margin;
  return true;
}

// ---- obstacles -----------------------------------------------------------------------
// Four little flower planters around the centre circle, between the goal lanes.
export const OBSTACLES = [[2.7, 2.7], [-2.7, 2.7], [2.7, -2.7], [-2.7, -2.7]].map(([x, z]) => ({ x, z, r: 0.42, h: 0.55 }));

/** push a point (players: margin = body radius) out of the obstacles. Returns true if moved. */
export function pushOutOfObstacles(p, margin = 0) {
  let moved = false;
  for (const o of OBSTACLES) {
    const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), min = o.r + margin;
    if (d < min) { const k = d > 1e-4 ? min / d : 0; p.x = o.x + (d > 1e-4 ? dx * k : min); p.z = o.z + dz * k; moved = true; }
  }
  return moved;
}

/** is a point inside a team's own penalty box? */
export function inOwnBox(team, x, z) {
  const g = GOALS[team];
  const A = g.axis, depth = g.sign * (A === 'x' ? x : z), along = A === 'x' ? z : x;
  return depth > FIELD.half - FIELD.boxDepth && Math.abs(along) < FIELD.boxHalfW;
}
