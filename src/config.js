// All units are metres / seconds / radians.

export const FIELD = {
  map: 'classic',
  half: 12,         // largest half extent (x or z)
  hx: 12, hz: 12,   // half extents along x and z (the arena is a rounded rectangle)
  cornerR: 8.8,     // big rounded corners: the arena is almost a circle
  islands: [],      // capsules the players run round (track map): { ax, az, bx, bz, r }
  bumpers: [],      // pinball mushrooms: { x, z, r }
  pads: [],         // speed strips: { x, z, len, wid, dx, dz }
  springs: [],      // bounce pads: { x, z, r }
  portals: [],      // teleport discs, paired with the one opposite: { x, z, r, idx }
  boosts: [],       // speed rings
  vortices: [],     // whirlpools
  wheels: [],       // wheels of fortune
  boxDepth: 2.8,    // penalty box in front of each goal (where you may dive)
  boxHalfW: 2.7,
  halfL: 12,        // kept for code that thinks in length/width
  halfW: 12,
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
  passChargeTime: 0.7,   // a pass fills its bar a little quicker
  staminaDrain: 0.32,
  staminaRegen: 0.2,
  shotSpeed: [7.5, 27.5], // base + power^1.15 * k (m/s): a tap is a pass, full power a rocket
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
  lives: 2,          // goals you can concede; the last one knocks you out
  kickoffDelay: 1.3,
};

// ---- maps ------------------------------------------------------------------------------
/** the same device in all four quarters: rotate (x, z) by 90° steps round the centre */
const rot4 = (o) => [0, 1, 2, 3].map((k) => {
  let { x, z } = o;
  for (let n = 0; n < k; n++) [x, z] = [-z, x];
  return { ...o, x, z, idx: k };
});
const circleIsland = (o) => ({ ax: o.x, az: o.z, bx: o.x, bz: o.z, r: o.r });

export const MAPS = {
  classic: { name: '经典圆场', hx: 12, hz: 12, cornerR: 8.8, goalHalfW: 1.6, goalH: 1.7, boxHalfW: 2.7, boxDepth: 2.8,
    islands: [], bumpers: [], pads: [], springs: [], portals: [], boosts: [], vortices: [], wheels: [] },
  // 机关乐园: a big near-circle full of round gadgets, every one repeated in all four quarters
  // (a 90° turn maps the arena onto itself, so every goal faces exactly the same layout)
  track: {
    name: '机关乐园', hx: 22, hz: 22, cornerR: 17, goalHalfW: 2.0, goalH: 1.85, boxHalfW: 3.1, boxDepth: 3.0,
    islands: rot4({ x: 6.2, z: 6.2, r: 2.3 }).map(circleIsland),          // round flower beds round the centre circle
    bumpers: rot4({ x: 11.6, z: 4.2, r: 0.6 }),                             // pinball mushrooms
    pads: [],
    springs: rot4({ x: 5, z: 0, r: 0.9 }),                                  // bounce pads on the way to each goal
    portals: rot4({ x: 11.6, z: 11.6, r: 1.15 }),                           // each one leads to the diagonally opposite one
    boosts: rot4({ x: 11.5, z: 0, r: 1.1 }),                                // speed rings in front of each goal
    vortices: rot4({ x: 4.4, z: 12, r: 1.9 }),                              // whirlpools that swing the ball round
    wheels: rot4({ x: 15.2, z: 7.6, r: 1.25 }),                             // wheels of fortune: off it goes in a random direction
  },
};

// ---- goals ---------------------------------------------------------------------
// For a goal on axis 'x' with sign s: the goal line is x = s·hx, the mouth spans z.
export function goalInfo(team) {
  const t = TEAMS[team], L = t.axis === 'x' ? FIELD.hx : FIELD.hz;
  const ax = t.axis === 'x' ? 1 : 0, az = 1 - ax;
  return {
    team, axis: t.axis, sign: t.sign, line: L,
    centre: { x: ax * t.sign * L, z: az * t.sign * L },
    inward: { x: -ax * t.sign, z: -az * t.sign },  // unit vector from the goal into the pitch
  };
}
// 2v2 team mode: the two sides
export const SIDES = [
  { name: '星星队', icon: '★', css: '#ffc93c' },
  { name: '月亮队', icon: '☾', css: '#62d8ff' },
];

export const GOALS = TEAMS.map((_, i) => goalInfo(i));
/** which goal (team index) a goal-line side belongs to */
export function goalIndexFor(axis, sign) { return GOALS.findIndex((g) => g.axis === axis && g.sign === sign); }
/** half extent along an axis */
export const halfOf = (A) => (A === 'x' ? FIELD.hx : FIELD.hz);

// bumpers are the round obstacles (kept under the old name the physics already uses)
export const OBSTACLES = [];

/** switch the arena (mutates FIELD / GOALS / OBSTACLES in place, so every importer sees it) */
export function setMap(name) {
  const m = MAPS[name] || MAPS.classic;
  FIELD.map = MAPS[name] ? name : 'classic';
  FIELD.hx = m.hx; FIELD.hz = m.hz; FIELD.half = Math.max(m.hx, m.hz); FIELD.halfL = m.hx; FIELD.halfW = m.hz;
  FIELD.cornerR = m.cornerR;
  FIELD.islands = m.islands.map((c) => ({ ...c }));
  FIELD.bumpers = m.bumpers.map((c) => ({ ...c }));
  FIELD.pads = m.pads.map((c) => ({ ...c }));
  FIELD.springs = m.springs.map((c) => ({ ...c }));
  FIELD.portals = m.portals.map((c) => ({ ...c }));
  FIELD.boosts = m.boosts.map((c) => ({ ...c }));
  FIELD.vortices = m.vortices.map((c) => ({ ...c }));
  FIELD.wheels = m.wheels.map((c) => ({ ...c }));
  FIELD.goalHalfW = m.goalHalfW; FIELD.goalH = m.goalH; FIELD.boxHalfW = m.boxHalfW; FIELD.boxDepth = m.boxDepth;
  GOALS.length = 0; TEAMS.forEach((_, i) => GOALS.push(goalInfo(i)));
  OBSTACLES.length = 0; for (const b of FIELD.bumpers) OBSTACLES.push({ x: b.x, z: b.z, r: b.r, h: 9, bumper: true });
  _nav = null;
}

// ---- rounded arena -------------------------------------------------------------------
/** keep a point inside the rounded-rectangle pitch, `margin` metres from the walls. Returns true if moved. */
export function clampToArena(p, margin = 0) {
  const HX = FIELD.hx - margin, HZ = FIELD.hz - margin, Cx = FIELD.hx - FIELD.cornerR, Cz = FIELD.hz - FIELD.cornerR, Rr = FIELD.cornerR - margin;
  let moved = false;
  if (Math.abs(p.x) > HX) { p.x = Math.sign(p.x) * HX; moved = true; }
  if (Math.abs(p.z) > HZ) { p.z = Math.sign(p.z) * HZ; moved = true; }
  if (Math.abs(p.x) > Cx && Math.abs(p.z) > Cz) {
    const cx = Math.sign(p.x) * Cx, cz = Math.sign(p.z) * Cz, dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
    if (d > Rr) { p.x = cx + (dx / d) * Rr; p.z = cz + (dz / d) * Rr; moved = true; }
  }
  return moved;
}
export function insideArena(x, z, margin = 0) {
  const Cx = FIELD.hx - FIELD.cornerR, Cz = FIELD.hz - FIELD.cornerR;
  if (Math.abs(x) > FIELD.hx + margin || Math.abs(z) > FIELD.hz + margin) return false;
  if (Math.abs(x) > Cx && Math.abs(z) > Cz) return Math.hypot(Math.abs(x) - Cx, Math.abs(z) - Cz) <= FIELD.cornerR + margin;
  return true;
}

// ---- islands (capsules) ----------------------------------------------------------------
/** closest point on an island's spine to (x, z): returns { px, pz, d } (d = distance to the spine) */
export function islandClosest(c, x, z) {
  const ex = c.bx - c.ax, ez = c.bz - c.az, L2 = ex * ex + ez * ez;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - c.ax) * ex + (z - c.az) * ez) / L2)) : 0;
  const px = c.ax + ex * t, pz = c.az + ez * t;
  return { px, pz, d: Math.hypot(x - px, z - pz) };
}
/** is (x, z) on an island (inflated by margin)? */
export function onIsland(x, z, margin = 0) {
  for (const c of FIELD.islands) if (islandClosest(c, x, z).d < c.r + margin) return c;
  return null;
}

/** push a point (players: margin = body radius) out of bumpers and islands. Returns true if moved. */
export function pushOutOfObstacles(p, margin = 0) {
  let moved = false;
  for (const o of OBSTACLES) {
    const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), min = o.r + margin;
    if (d < min) { const k = d > 1e-4 ? min / d : 0; p.x = o.x + (d > 1e-4 ? dx * k : min); p.z = o.z + dz * k; moved = true; }
  }
  for (const c of FIELD.islands) {
    const q = islandClosest(c, p.x, p.z), min = c.r + margin;
    if (q.d < min) {
      if (q.d > 1e-4) { p.x = q.px + ((p.x - q.px) / q.d) * min; p.z = q.pz + ((p.z - q.pz) / q.d) * min; }
      else p.z = q.pz + min;
      moved = true;
    }
  }
  return moved;
}

/** does the straight line a→b cross an island (inflated by margin)? */
export function islandBlocks(ax, az, bx, bz, margin = 0) {
  for (const c of FIELD.islands) if (segSegDist(ax, az, bx, bz, c.ax, c.az, c.bx, c.bz) < c.r + margin) return true;
  return false;
}
function segSegDist(ax, az, bx, bz, cx, cz, dx, dz) {
  // distance between two 2D segments (0 if they cross)
  const cross = (ux, uz, vx, vz) => ux * vz - uz * vx;
  const d1 = cross(bx - ax, bz - az, cx - ax, cz - az), d2 = cross(bx - ax, bz - az, dx - ax, dz - az);
  const d3 = cross(dx - cx, dz - cz, ax - cx, az - cz), d4 = cross(dx - cx, dz - cz, bx - cx, bz - cz);
  if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return 0;
  const ps = (px, pz, sx, sz, ex, ez) => { const vx = ex - sx, vz = ez - sz, L = vx * vx + vz * vz; const t = L > 0 ? Math.max(0, Math.min(1, ((px - sx) * vx + (pz - sz) * vz) / L)) : 0; return Math.hypot(px - sx - vx * t, pz - sz - vz * t); };
  return Math.min(ps(ax, az, cx, cz, dx, dz), ps(bx, bz, cx, cz, dx, dz), ps(cx, cz, ax, az, bx, bz), ps(dx, dz, ax, az, bx, bz));
}

// ---- navigation round the islands -------------------------------------------------------
let _nav = null;
function navGraph() {
  if (_nav) return _nav;
  const nodes = [];
  for (const c of FIELD.islands) {
    // a ring of waypoints round each island, a body-width or so off its edge
    const ex = c.bx - c.ax, ez = c.bz - c.az, L0 = Math.hypot(ex, ez);
    if (L0 < 0.01) {
      const off = c.r + 1.5;
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + Math.PI / 8; nodes.push({ x: c.ax + Math.cos(a) * off, z: c.az + Math.sin(a) * off }); }
      continue;
    }
    const L = L0, ux = ex / L, uz = ez / L, nx = -uz, nz = ux;
    const off = c.r + 1.7;
    for (const k of [0.15, 0.5, 0.85]) for (const s of [-1, 1]) nodes.push({ x: c.ax + ex * k + nx * off * s, z: c.az + ez * k + nz * off * s });
    for (const [px, pz, sx, sz] of [[c.ax, c.az, -ux, -uz], [c.bx, c.bz, ux, uz]]) {
      nodes.push({ x: px + sx * off, z: pz + sz * off });
      for (const s of [-1, 1]) nodes.push({ x: px + (sx * 0.72 + nx * s * 0.72) * off, z: pz + (sz * 0.72 + nz * s * 0.72) * off });
    }
  }
  const ok = nodes.filter((n) => insideArena(n.x, n.z, -0.6) && !onIsland(n.x, n.z, 0.9));
  const edges = ok.map(() => []);
  for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) {
    if (islandBlocks(ok[i].x, ok[i].z, ok[j].x, ok[j].z, 0.45)) continue;
    const d = Math.hypot(ok[i].x - ok[j].x, ok[i].z - ok[j].z);
    edges[i].push([j, d]); edges[j].push([i, d]);
  }
  _nav = { nodes: ok, edges };
  return _nav;
}

/**
 * Where to head next to get from a to b without running into an island:
 * b itself if the way is clear, else the first waypoint of the shortest route.
 * Returns { x, z, dist } (dist = length of the whole route).
 */
export function route(ax, az, bx, bz) {
  const direct = Math.hypot(bx - ax, bz - az);
  if (!FIELD.islands.length || !islandBlocks(ax, az, bx, bz, 0.35)) return { x: bx, z: bz, dist: direct };
  const { nodes, edges } = navGraph();
  const n = nodes.length, dist = new Array(n).fill(Infinity), first = new Array(n).fill(-1), done = new Array(n).fill(false);
  for (let i = 0; i < n; i++) if (!islandBlocks(ax, az, nodes[i].x, nodes[i].z, 0.35)) { dist[i] = Math.hypot(nodes[i].x - ax, nodes[i].z - az); first[i] = i; }
  let best = Infinity, bestFirst = -1;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] >= best) break;
    done[u] = true;
    if (!islandBlocks(nodes[u].x, nodes[u].z, bx, bz, 0.35)) {
      const tot = dist[u] + Math.hypot(bx - nodes[u].x, bz - nodes[u].z);
      if (tot < best) { best = tot; bestFirst = first[u]; }
    }
    for (const [v, w] of edges[u]) if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; first[v] = first[u]; }
  }
  if (bestFirst < 0) return { x: bx, z: bz, dist: direct };
  return { x: nodes[bestFirst].x, z: nodes[bestFirst].z, dist: best };
}

// ---- speed strips / bounce pads ---------------------------------------------------------
/** the speed strip under (x, z), if any */
export function padAt(x, z) {
  for (const p of FIELD.pads) {
    const rx = x - p.x, rz = z - p.z;
    const along = rx * p.dx + rz * p.dz, across = -rx * p.dz + rz * p.dx;
    if (Math.abs(along) < p.len / 2 && Math.abs(across) < p.wid / 2) return p;
  }
  return null;
}

/** is a point inside a team's own penalty box? */
export function inOwnBox(team, x, z) {
  const g = GOALS[team];
  const A = g.axis, depth = g.sign * (A === 'x' ? x : z), along = A === 'x' ? z : x;
  return depth > g.line - FIELD.boxDepth && Math.abs(along) < FIELD.boxHalfW;
}
