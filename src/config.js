// All units are metres / seconds / radians.

export const FIELD = {
  map: 'classic',
  lives: 2, kickoff: 5, follow: false, square: false,
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
  chargeTime: 0.55,      // seconds to reach full power
  chargeAutoRelease: 0.35,
  passChargeTime: 0.42,  // a pass fills its bar a lot quicker
  staminaDrain: 0.32,
  staminaRegen: 0.38,
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
    lives: 2, kickoff: 5, follow: false,
    islands: [], bumpers: [], pads: [], springs: [], portals: [], boosts: [], vortices: [], wheels: [] },
  // 方块乐园: a small square where each whole side is a goal and the middle is packed with
  // square gadgets (four of each, the layout repeats every 90°, so it's fair to everyone).
  // Kick it hard and see where it ends up.
  // classic five-a-side: a long rectangle, one goal at each end, boards round the sides (no throw-ins)
  pitch5: {
    name: '六人制球场', hx: 25, hz: 15.5, cornerR: 2.8, goalHalfW: 2.7, goalH: 2.1, boxHalfW: 8.5, boxDepth: 7,
    lives: 99, kickoff: 7, follow: false, goals: 2, lines: true, noStands: true, wave: 0.95,   // wavy boards: nobody knows where it'll bounce   // fixed camera: the whole pitch, no panning
    islands: [], bumpers: [], pads: [], springs: [], portals: [], boosts: [], vortices: [], wheels: [] },
  track: {
    name: '方块乐园', hx: 10, hz: 10, cornerR: 0.02, goalHalfW: 10, goalH: 2.2, boxHalfW: 10, boxDepth: 2.4,
    lives: 3, kickoff: 3, follow: false, square: true, shields: true,   // goals start behind a barrier that has to be broken first
    // sixteen flat tiles in a 4 × 4 grid: nothing stands up, the players run straight over all of them,
    // only the ball reacts. Each ring of four is the same tile turned 90°, so every goal faces the same park.
    islands: [],
    bumpers: [],
    pads: [],
    vortices: rot4({ x: 2.25, z: 2.25, r: 1.25, sq: true }),      // the middle four: whirlpools
    portals: rot4({ x: 6.25, z: 6.25, r: 1.15, sq: true }),       // the corners: diagonal partners
    springs: rot4({ x: 2.25, z: 6.25, r: 1.15, sq: true }),       // in front of each goal (left of centre): bounce pads
    boosts: rot4({ x: -2.25, z: 6.25, r: 1.15, sq: true }),       // and right of centre: speed tiles
    wheels: [],
  },
};

/** is (x, z) inside a device / obstacle footprint (round or square)? */
export function inShape(o, x, z, grow = 0) {
  return o.sq ? Math.abs(x - o.x) < o.r + grow && Math.abs(z - o.z) < o.r + grow : Math.hypot(x - o.x, z - o.z) < o.r + grow;
}

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

// ---- characters: everyone has their own special shot -----------------------------------
// Every 爆射 firmer than a side-footed pass (30% charge or more) is the special shot.
export const CHARS = [
  { id: 'thunder', name: '雷', skill: '闪电射门', icon: '⚡', css: '#5fe1ff', color: 0x5fe1ff, hair: '#ffe14a',
    desc: '贯穿人墙，碰到的人全身麻痹', move: 'Z 字闪电冲刺，从防守人身边折到他身后', speed: 1.26 },
  { id: 'blaze', name: '火', skill: '火焰射门', icon: '🔥', css: '#ff6a2b', color: 0xff6a2b, hair: '#ff4a2a',
    desc: '火球穿过人群，烧到的人被掀翻', move: '怒吼爆炎，把身边的人全部震飞', speed: 1.18 },
  { id: 'frost', name: '冰', skill: '冰冻射门', icon: '❄️', css: '#9fe6ff', color: 0x9fe6ff, hair: '#d8f6ff',
    desc: '穿人的寒冰球，碰到的人被冻住', move: '寒气爆发，把身边的人冻成冰雕', speed: 1.12 },
  { id: 'gale', name: '风', skill: '旋风射门', icon: '🌪️', css: '#6dff9a', color: 0x6dff9a, hair: '#5fe08a',
    desc: '走 S 形弯道，门将很难判断', move: '旋转腾空，带着球从人头上飞过去', speed: 1.14 },
  { id: 'phantom', name: '影', skill: '幻影射门', icon: '👻', css: '#b58cff', color: 0xb58cff, hair: '#9a6bff',
    desc: '球忽隐忽现，门将来不及反应', move: '原地消失，瞬移到防守人身后', speed: 1.16 },
  { id: 'cannon', name: '土', skill: '重炮射门', icon: '🪨', css: '#ffd23f', color: 0xffd23f, hair: '#3b3546',
    desc: '最快最重，撞谁谁倒（门将站得住）', move: '低头往前猛冲，挡路的人被撞飞', speed: 1.3 },
];
export const CHAR = Object.fromEntries(CHARS.map((c) => [c.id, c]));

/**
 * Combo shots: a move where several players hit the ball first time, one after another, ends in a
 * shot carrying every one of their elements. Two elements make one of these named pairs (key: the
 * two ids sorted); three or more players make a 合击 that nothing stops.
 *   gk: what it does to the goalkeeper: 'teleport' (vanishes and reappears in the net),
 *       'blast' / 'through' (straight through him), 'freeze' (frozen, the ball spills), 'parry'
 *       (too hot to hold: beaten away). aura: what it does to anyone it flies past.
 */
export const COMBOS = {
  'phantom+thunder': { name: '瞬影雷闪', gk: 'teleport' },
  'blaze+cannon':    { name: '熔岩爆破', gk: 'blast', big: true },
  'frost+gale':      { name: '暴风雪', gk: 'freeze', aura: 'freeze' },
  'gale+phantom':    { name: '幻风分身', gk: 'parry', decoy: true },
  'blaze+thunder':   { name: '雷火流星', gk: 'parry', fast: 1.22, pierceGk: 0.5 },
  'frost+thunder':   { name: '冰雷折线', gk: 'freeze', zig: true },
  'gale+thunder':    { name: '雷暴旋风', gk: 'parry', zig: true, aura: 'jolt' },
  'cannon+thunder':  { name: '雷霆地震', gk: 'through', aura: 'quake' },
  'blaze+frost':     { name: '冰火蒸汽', gk: 'freeze', aura: 'knock' },
  'blaze+gale':      { name: '火龙卷', gk: 'parry', aura: 'knock', pierceGk: 0.35 },
  'blaze+phantom':   { name: '隐形火焰', gk: 'through', invis: true },
  'frost+phantom':   { name: '隐形寒冰', gk: 'freeze', invis: true },
  'cannon+frost':    { name: '冰山撞击', gk: 'through', big: true },
  'cannon+gale':     { name: '沙暴', gk: 'parry', aura: 'quake', pierceGk: 0.35 },
  'cannon+phantom':  { name: '幽灵巨石', gk: 'through', invis: true, big: true },
};
const NUM = ['', '', '双', '三', '四', '五', '六'];
/** what a strike carrying these elements (one per player in the move, repeats allowed) is */
export function comboOf(els) {
  const ids = [...new Set(els)].sort(), n = els.length;
  if (n <= 1) return { ids, n, level: 1, key: ids.join('+'), name: '', gk: 'save' };
  if (n >= 3) return { ids, n, level: 3, key: ids.join('+'), name: `${NUM[Math.min(6, n)]}人合击`, gk: 'through', aura: 'knock', big: true };
  if (ids.length === 1) return { ids, n, level: 2, key: ids[0], name: `双${CHAR[ids[0]].name}合击`, gk: 'parry', pierceGk: 0.3 };
  return { ids, n, level: 2, key: ids.join('+'), ...COMBOS[ids.join('+')] };
}
export const randomChar = () => CHARS[Math.floor(Math.random() * CHARS.length)].id;
/** which goal (team index) a goal-line side belongs to */
export function goalIndexFor(axis, sign) { return GOALS.findIndex((g) => g.axis === axis && g.sign === sign); }
/** half extent along an axis */
export const halfOf = (A) => (A === 'x' ? FIELD.hx : FIELD.hz);

// ---- wavy boards ---------------------------------------------------------------------------
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/**
 * How far the board on the `side` end of axis A bulges into the pitch at s (the coordinate along
 * the board). Two waves of different length laid over each other, so no two bounces are alike;
 * flat at the goal mouths and where the corner curves begin.
 */
export function waveOff(A, s, side) {
  const amp = FIELD.wave; if (!amp) return 0;
  const B = A === 'x' ? 'z' : 'x', run = halfOf(B) - FIELD.cornerR, as = Math.abs(s);
  const hasGoal = GOALS.some((g) => g.axis === A && g.sign === side);
  let taper = 1 - smooth(run - 1.8, run - 0.2, as);
  if (hasGoal) taper *= smooth(FIELD.goalHalfW + 0.4, FIELD.goalHalfW + 2.2, as);
  if (taper <= 0) return 0;
  const ph = (A === 'x' ? 0.7 : 2.1) + (side > 0 ? 1.3 : 0);
  const h1 = 0.5 - 0.5 * Math.cos((2 * Math.PI * s) / 4.6 + ph), h2 = 0.5 - 0.5 * Math.cos((2 * Math.PI * s) / 2.7 + ph * 2.3);
  return amp * taper * (0.62 * h1 + 0.38 * h2);
}
export function waveSlope(A, s, side) { return (waveOff(A, s + 0.02, side) - waveOff(A, s - 0.02, side)) / 0.04; }

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
  FIELD.lives = m.lives; FIELD.kickoff = m.kickoff; FIELD.follow = m.follow; FIELD.square = !!m.square; FIELD.shields = !!m.shields; FIELD.lines = !!m.lines; FIELD.noStands = !!m.noStands; FIELD.wave = m.wave || 0;
  GOALS.length = 0; TEAMS.slice(0, m.goals || 4).forEach((_, i) => GOALS.push(goalInfo(i)));
  OBSTACLES.length = 0; for (const b of FIELD.bumpers) OBSTACLES.push({ x: b.x, z: b.z, r: b.r, h: 9, bumper: true, sq: !!b.sq });
  _nav = null;
}

// ---- rounded arena -------------------------------------------------------------------
/** keep a point inside the rounded-rectangle pitch, `margin` metres from the walls. Returns true if moved. */
export function clampToArena(p, margin = 0) {
  let HX = FIELD.hx - margin, HZ = FIELD.hz - margin;
  const Cx = FIELD.hx - FIELD.cornerR, Cz = FIELD.hz - FIELD.cornerR, Rr = FIELD.cornerR - margin;
  if (FIELD.wave) { HX -= waveOff('x', p.z, Math.sign(p.x) || 1); HZ -= waveOff('z', p.x, Math.sign(p.z) || 1); }
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
  const wx = FIELD.wave ? waveOff('x', z, Math.sign(x) || 1) : 0, wz = FIELD.wave ? waveOff('z', x, Math.sign(z) || 1) : 0;
  if (Math.abs(x) > FIELD.hx - wx + margin || Math.abs(z) > FIELD.hz - wz + margin) return false;
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
    if (o.sq) {
      // square block: push out along the shallower side
      const dx = p.x - o.x, dz = p.z - o.z, e = o.r + margin;
      if (Math.abs(dx) < e && Math.abs(dz) < e) {
        if (e - Math.abs(dx) < e - Math.abs(dz)) p.x = o.x + Math.sign(dx || 1) * e; else p.z = o.z + Math.sign(dz || 1) * e;
        moved = true;
      }
      continue;
    }
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
