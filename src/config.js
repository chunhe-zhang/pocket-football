// All units are metres / seconds / radians.

export const FIELD = {
  halfL: 11,        // pitch half length (x)
  halfW: 7,         // pitch half width (z)
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
  rollDecel: 0.42,       // m/s^2 rolling resistance on grass (fast, well-watered pitch)
  rollQuad: 0.005,       // extra speed-dependent rolling resistance
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

export const TEAMS = [
  { name: 'BLUE', color: 0x2f7cf6, css: '#2f7cf6',
    kit: { shirt: '#3d82ff', shorts: '#1f2c5c', number: '#ffffff', no: '10', hair: null, outline: 0x1b1630 } },
  { name: 'ORANGE', color: 0xf26b1d, css: '#f26b1d',
    kit: { shirt: '#ff7d33', shorts: '#2c2a33', number: '#ffffff', no: '7', hair: '#545a86', outline: 0x24160f } },
];

export const MATCH = {
  durations: [90, 180, 300],
  defaultDuration: 180,
  goalPause: 3.4,
  kickoffDelay: 1.3,
};
