import * as THREE from 'three';
import { clone as cloneSkinned } from '../vendor/three/addons/utils/SkeletonUtils.js';
import { ANIM } from './config.js';
import { dyeHair } from './avatar.js';
import { AnimationPose } from './animation-pose.js';
import { ElementAura } from './element-aura.js';

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const yawAt = (c, t) => {
  const T = c.t; if (t <= T[0]) return c.v[0];
  for (let i = 1; i < T.length; i++) if (t <= T[i]) return c.v[i - 1] + (c.v[i] - c.v[i - 1]) * ((t - T[i - 1]) / (T[i] - T[i - 1] || 1));
  return c.v[c.v.length - 1];
};

const UP = new THREE.Vector3(0, 1, 0);
const smooth = (t) => t * t * (3 - 2 * t);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Keyframed procedural gesture, layered on top of the mocap locomotion.
 * keys: { channel: [[t, value], ...] } with t normalised 0..1.
 * Values are angles (rad) applied in world space around the character's
 * forward / right / up axes, which makes them independent of the rig's
 * local bone axes.
 */
class Gesture {
  constructor(name, duration, keys, { side = 'Right', amp = 1, fadeIn = 0.06, fadeOut = 0.12, loop = false, onEvent = null, events = [] } = {}) {
    Object.assign(this, { name, duration, keys, side, amp, fadeIn, fadeOut, loop, onEvent, events });
    this.t = 0; this.done = false; this.fired = new Set();
  }
  sample(ch) {
    // cubic Hermite through the keys with Catmull-Rom tangents: velocity stays
    // continuous through each key, so a leg can whip *through* the contact pose
    const k = this.keys[ch]; if (!k) return 0;
    const u = this.loop ? (this.t / this.duration) % 1 : clamp(this.t / this.duration, 0, 1);
    if (u <= k[0][0]) return k[0][1] * this.amp;
    const n = k.length;
    for (let i = 1; i < n; i++) {
      if (u <= k[i][0]) {
        const [t0, p0] = k[i - 1], [t1, p1] = k[i];
        const h = t1 - t0, s = (u - t0) / h;
        const m0 = i - 1 > 0 ? ((p1 - k[i - 2][1]) / (t1 - k[i - 2][0])) * h : 0;
        const m1 = i + 1 < n ? ((k[i + 1][1] - p0) / (k[i + 1][0] - t0)) * h : 0;
        const s2 = s * s, s3 = s2 * s;
        const v = (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * m1;
        return v * this.amp;
      }
    }
    return k[n - 1][1] * this.amp;
  }
  get weight() {
    if (this.loop) return clamp(this.t / this.fadeIn, 0, 1) * (this.stopping ? clamp(1 - this.stopT / this.fadeOut, 0, 1) : 1);
    const end = this.duration - this.t;
    return clamp(this.t / this.fadeIn, 0, 1) * clamp(end / this.fadeOut, 0, 1);
  }
  advance(dt) {
    this.t += dt;
    for (const e of this.events) {
      if (!this.fired.has(e.name) && this.t >= e.at * this.duration) { this.fired.add(e.name); this.onEvent?.(e.name, this); }
    }
    if (this.stopping) { this.stopT += dt; if (this.stopT >= this.fadeOut) this.done = true; }
    if (!this.loop && this.t >= this.duration) this.done = true;
  }
  stop() { if (!this.stopping) { this.stopping = true; this.stopT = 0; } }
}

// ---- gesture definitions (normalised time) ---------------------------------
// thigh: + swings the leg forward. knee: + bends (heel back). foot: + points toe down.
// lean: + leans torso forward. twist: + turns torso to the left.
// armOutL/R: + raises the arm sideways. armFwdL/R: + swings the arm forward.
const KICK = (c) => ({
  thigh:  [[0, 0], [0.2, -0.62], [c - 0.07, -0.05], [c, 0.42], [c + 0.13, 1.18], [0.72, 0.42], [1, 0]],
  knee:   [[0, 0], [0.2, 1.6], [c - 0.07, 1.15], [c, 0.18], [c + 0.13, 0.12], [0.72, 0.42], [1, 0]],
  foot:   [[0, 0], [0.2, 0.15], [c, 0.42], [c + 0.13, 0.3], [1, 0]],
  supKnee:[[0, 0], [0.22, 0.3], [c, 0.4], [c + 0.16, 0.34], [0.75, 0.12], [1, 0]],
  supThigh:[[0, 0], [0.22, 0.16], [c, 0.22], [c + 0.16, 0.18], [0.75, 0.06], [1, 0]],
  lean:   [[0, 0], [0.2, 0.06], [c, -0.1], [c + 0.13, -0.2], [0.75, -0.04], [1, 0]],
  twist:  [[0, 0], [0.2, -0.32], [c, 0.08], [c + 0.13, 0.3], [0.75, 0.1], [1, 0]],
  armOutL:[[0, 0], [0.2, 0.75], [c, 1.05], [c + 0.13, 0.95], [0.75, 0.35], [1, 0]],
  armFwdR:[[0, 0], [0.2, 0.35], [c, -0.4], [c + 0.13, -0.55], [0.75, -0.15], [1, 0]],
  armOutR:[[0, 0], [0.2, 0.25], [c, 0.35], [0.75, 0.15], [1, 0]],
  drop:   [[0, 0], [0.2, -0.04], [c, -0.08], [c + 0.16, -0.06], [0.75, -0.02], [1, 0]],
  hop:    [[0, 0], [c + 0.06, 0], [c + 0.2, 0.1], [c + 0.34, 0.02], [0.8, 0], [1, 0]],   // follow-through skip
  headUp: [[0, 0], [0.2, -0.15], [c, -0.3], [c + 0.2, -0.1], [1, 0]],                 // eyes on the ball at contact
});

const CHIP = (c) => ({
  thigh:  [[0, 0], [0.2, -0.45], [c - 0.07, 0.0], [c, 0.36], [c + 0.13, 0.95], [0.72, 0.3], [1, 0]],
  knee:   [[0, 0], [0.2, 1.3], [c - 0.07, 0.9], [c, 0.3], [c + 0.13, 0.3], [0.72, 0.3], [1, 0]],
  foot:   [[0, 0], [0.2, 0.1], [c, -0.2], [c + 0.13, -0.05], [1, 0]],
  supKnee:[[0, 0], [0.22, 0.35], [c, 0.45], [0.75, 0.15], [1, 0]],
  supThigh:[[0, 0], [0.22, 0.2], [c, 0.25], [0.75, 0.08], [1, 0]],
  lean:   [[0, 0], [0.2, 0.02], [c, -0.24], [c + 0.13, -0.3], [0.75, -0.06], [1, 0]],
  twist:  [[0, 0], [0.2, -0.22], [c, 0.06], [c + 0.13, 0.18], [1, 0]],
  armOutL:[[0, 0], [0.2, 0.8], [c, 1.1], [0.75, 0.35], [1, 0]],
  armOutR:[[0, 0], [0.2, 0.5], [c, 0.8], [0.75, 0.3], [1, 0]],
  drop:   [[0, 0], [0.2, -0.05], [c, -0.09], [0.75, -0.03], [1, 0]],
});

// side-foot pass: short backswing, leg turned out so the inside of the boot faces the target,
// body over the ball, a compact follow-through towards the receiver
const PASS = (c) => ({
  thigh:   [[0, 0], [0.22, -0.4], [c - 0.06, -0.06], [c, 0.3], [c + 0.14, 0.62], [0.74, 0.2], [1, 0]],
  knee:    [[0, 0], [0.22, 0.85], [c - 0.06, 0.55], [c, 0.18], [c + 0.14, 0.14], [0.74, 0.25], [1, 0]],
  legOut:  [[0, 0], [0.22, 0.24], [c, 0.3], [c + 0.14, 0.2], [0.74, 0.06], [1, 0]],
  footTurn:[[0, 0], [0.22, 0.85], [c, 1.05], [c + 0.14, 0.9], [0.74, 0.3], [1, 0]],
  foot:    [[0, 0], [c, -0.12], [1, 0]],
  supKnee: [[0, 0], [0.22, 0.3], [c, 0.36], [0.74, 0.12], [1, 0]],
  supThigh:[[0, 0], [0.22, 0.12], [c, 0.17], [0.74, 0.05], [1, 0]],
  lean:    [[0, 0], [0.22, 0.12], [c, 0.1], [c + 0.14, 0.03], [1, 0]],
  twist:   [[0, 0], [0.22, -0.2], [c, 0.05], [c + 0.14, 0.16], [1, 0]],
  armOutL: [[0, 0], [0.22, 0.45], [c, 0.62], [0.74, 0.25], [1, 0]],
  armOutR: [[0, 0], [0.22, 0.22], [c, 0.32], [1, 0]],
  drop:    [[0, 0], [c, -0.05], [1, 0]],
  headUp:  [[0, 0], [c, -0.22], [1, 0]],
});

// standing tackle: a lunge onto the bent standing leg, the other boot stabbing at the ball
const POKE = {
  thigh:   [[0, 0], [0.2, 0.3], [0.38, 1.0], [0.6, 0.8], [1, 0]],
  knee:    [[0, 0], [0.2, 0.9], [0.38, 0.15], [0.6, 0.3], [1, 0]],
  legOut:  [[0, 0], [0.38, 0.3], [0.7, 0.2], [1, 0]],
  footTurn:[[0, 0], [0.38, 0.7], [1, 0]],
  supKnee: [[0, 0], [0.25, 0.5], [0.45, 0.72], [0.8, 0.3], [1, 0]],
  supThigh:[[0, 0], [0.45, 0.3], [1, 0]],
  lean:    [[0, 0], [0.38, 0.28], [0.8, 0.12], [1, 0]],
  drop:    [[0, 0], [0.4, -0.14], [0.8, -0.05], [1, 0]],
  twist:   [[0, 0], [0.38, 0.15], [1, 0]],
  armOutL: [[0, 0], [0.38, 0.8], [1, 0]],
  armOutR: [[0, 0], [0.38, 0.5], [1, 0]],
};

// step-over: the boot circles round the outside of the ball while the hips sell the fake
const STEPOVER = {
  legOut:  [[0, 0], [0.15, -0.35], [0.38, 0.95], [0.62, 0.45], [1, 0]],
  thigh:   [[0, 0], [0.22, 0.8], [0.45, 0.55], [0.7, 0.15], [1, 0]],
  knee:    [[0, 0], [0.22, 1.25], [0.45, 0.8], [1, 0]],
  footTurn:[[0, 0], [0.3, -0.5], [0.5, 0.3], [1, 0]],
  twist:   [[0, 0], [0.28, 0.5], [0.6, -0.35], [1, 0]],
  roll:    [[0, 0], [0.35, 0.16], [0.7, -0.08], [1, 0]],          // sell it: lean the way you're not going
  lean:    [[0, 0], [0.4, 0.14], [1, 0]],
  drop:    [[0, 0], [0.4, -0.08], [0.75, -0.1], [1, 0]],
  supKnee: [[0, 0], [0.4, 0.42], [1, 0]],
  armOutL: [[0, 0], [0.3, 0.95], [0.6, 0.35], [1, 0]],
  armOutR: [[0, 0], [0.3, 0.35], [0.6, 0.9], [1, 0]],
  headUp:  [[0, 0], [0.4, -0.18], [1, 0]],
};

// drag (la croqueta): sole rolls the ball across with a little hop sideways
const DRAG = {
  thigh:   [[0, 0], [0.3, 0.35], [0.7, 0.2], [1, 0]],
  knee:    [[0, 0], [0.3, 0.6], [1, 0]],
  foot:    [[0, 0], [0.3, -0.35], [0.7, -0.2], [1, 0]],
  legOut:  [[0, 0], [0.25, -0.2], [0.6, 0.35], [1, 0]],
  hop:     [[0, 0], [0.4, 0.08], [0.7, 0.02], [1, 0]],
  twist:   [[0, 0], [0.5, 0.2], [1, 0]],
  lean:    [[0, 0], [0.4, 0.06], [1, 0]],
  armOutL: [[0, 0], [0.4, 0.6], [1, 0]],
  armOutR: [[0, 0], [0.4, 0.6], [1, 0]],
};

// drag-back: sole pulls the ball back, body pivots round to take it away
const DRAGBACK = {
  thigh:   [[0, 0], [0.2, 0.6], [0.4, 0.1], [0.6, -0.3], [1, 0]],
  knee:    [[0, 0], [0.2, 0.7], [0.4, 0.4], [0.6, 0.6], [1, 0]],
  foot:    [[0, 0], [0.2, -0.4], [0.45, -0.3], [1, 0]],
  supKnee: [[0, 0], [0.4, 0.35], [0.7, 0.25], [1, 0]],
  lean:    [[0, 0], [0.3, -0.08], [0.6, 0.15], [1, 0]],
  twist:   [[0, 0], [0.45, 0.3], [1, 0]],
  drop:    [[0, 0], [0.5, -0.06], [1, 0]],
  armOutL: [[0, 0], [0.4, 0.65], [1, 0]],
  armOutR: [[0, 0], [0.4, 0.45], [1, 0]],
};

const TOUCH = {
  thigh: [[0, 0], [0.35, 0.42], [0.6, 0.3], [1, 0]],
  knee:  [[0, 0], [0.25, 0.55], [0.45, 0.3], [1, 0]],
  foot:  [[0, 0], [0.4, -0.25], [1, 0]],
  supKnee:[[0, 0], [0.5, 0.18], [1, 0]],          // sit into the standing leg to reach the ball
  lean:  [[0, 0], [0.5, 0.08], [1, 0]],
  drop:  [[0, 0], [0.5, -0.025], [1, 0]],
  headUp:[[0, 0], [0.5, -0.12], [1, 0]],          // eyes on the ball for the touch
  armOutL:[[0, 0], [0.4, 0.25], [1, 0]],
  armOutR:[[0, 0], [0.4, 0.12], [1, 0]],
};

const TRAP = {
  thigh: [[0, 0], [0.3, 0.55], [0.6, 0.35], [1, 0]],
  knee:  [[0, 0], [0.3, 0.6], [0.6, 0.5], [1, 0]],
  foot:  [[0, 0], [0.35, -0.45], [1, 0]],
  lean:  [[0, 0], [0.35, 0.18], [1, 0]],
  armOutL:[[0, 0], [0.35, 0.5], [1, 0]],
  armOutR:[[0, 0], [0.35, 0.45], [1, 0]],
  drop:  [[0, 0], [0.35, -0.05], [1, 0]],
};

const CELEBRATE = {
  armOutL: [[0, 2.3], [0.25, 2.6], [0.5, 2.2], [0.75, 2.6], [1, 2.3]],
  armOutR: [[0, 2.3], [0.25, 2.2], [0.5, 2.6], [0.75, 2.2], [1, 2.3]],
  elbowL:  [[0, 0.3], [0.25, 0.7], [0.5, 0.2], [0.75, 0.7], [1, 0.3]],
  elbowR:  [[0, 0.3], [0.25, 0.2], [0.5, 0.7], [0.75, 0.2], [1, 0.3]],
  lean:    [[0, -0.12], [0.5, -0.2], [1, -0.12]],
  hop:     [[0, 0], [0.25, 0.22], [0.5, 0], [0.75, 0.22], [1, 0]],
  headUp:  [[0, 0.25], [1, 0.25]],
};

const DEJECT = {
  lean:    [[0, 0.22], [0.5, 0.26], [1, 0.22]],
  headUp:  [[0, -0.4], [0.5, -0.45], [1, -0.4]],
  armOutL: [[0, 0.08], [1, 0.08]],
  armOutR: [[0, 0.08], [1, 0.08]],
};

// legOut: + swings the kicking leg out sideways. footTurn: + turns the toe outwards
// (inside of the foot faces forward). body: + reclines the whole body around the hips.
const SLIDE = {
  body:    [[0, 0], [0.14, 0.62], [0.62, 0.66], [0.82, 0.25], [1, 0]],
  drop:    [[0, 0], [0.14, -0.5], [0.62, -0.52], [0.84, -0.18], [1, 0]],
  thigh:   [[0, 0], [0.14, 0.7], [0.62, 0.72], [0.84, 0.2], [1, 0]],
  knee:    [[0, 0], [0.14, 0.12], [0.62, 0.15], [0.84, 0.6], [1, 0]],
  foot:    [[0, 0], [0.14, -0.3], [0.62, -0.3], [1, 0]],
  supThigh:[[0, 0], [0.14, -0.35], [0.62, -0.3], [0.84, 0.1], [1, 0]],
  supKnee: [[0, 0], [0.14, 1.75], [0.62, 1.7], [0.84, 0.8], [1, 0]],
  lean:    [[0, 0], [0.14, 0.2], [0.62, 0.22], [0.84, 0.15], [1, 0]],
  armOutL: [[0, 0], [0.14, 0.9], [0.62, 0.8], [1, 0]],
  armOutR: [[0, 0], [0.14, 0.6], [0.62, 0.5], [1, 0]],
  armFwdL: [[0, 0], [0.14, -0.4], [0.62, -0.5], [1, 0]],
  armFwdR: [[0, 0], [0.14, -0.6], [0.62, -0.6], [1, 0]],
  headUp:  [[0, 0], [0.14, 0.35], [0.62, 0.3], [1, 0]],
};

const STAGGER = {
  lean:    [[0, 0], [0.2, -0.3], [0.55, 0.35], [1, 0]],
  twist:   [[0, 0], [0.25, 0.45], [0.6, -0.2], [1, 0]],
  drop:    [[0, 0], [0.3, -0.12], [0.6, -0.08], [1, 0]],
  armOutL: [[0, 0], [0.2, 1.3], [0.55, 0.6], [1, 0]],
  armOutR: [[0, 0], [0.25, 1.1], [0.6, 0.7], [1, 0]],
  supKnee: [[0, 0], [0.3, 0.45], [0.7, 0.2], [1, 0]],
  thigh:   [[0, 0], [0.3, 0.35], [0.6, -0.1], [1, 0]],
  knee:    [[0, 0], [0.3, 0.5], [1, 0]],
};

const TRAP_FOOT = (c) => ({
  legOut:  [[0, 0], [c, 0.32], [c + 0.25, 0.2], [1, 0]],
  footTurn:[[0, 0], [c, 0.95], [c + 0.25, 0.7], [1, 0]],
  thigh:   [[0, 0], [c - 0.1, 0.42], [c, 0.3], [c + 0.2, 0.05], [1, 0]],   // meet the ball, then give with it
  knee:    [[0, 0], [c - 0.1, 0.5], [c, 0.35], [c + 0.2, 0.25], [1, 0]],
  supKnee: [[0, 0], [c, 0.3], [1, 0]],
  supThigh:[[0, 0], [c, 0.12], [1, 0]],
  armOutL: [[0, 0], [c, 0.45], [1, 0]],
  armOutR: [[0, 0], [c, 0.3], [1, 0]],
  drop:    [[0, 0], [c, -0.05], [1, 0]],
  headUp:  [[0, 0], [c, -0.25], [1, 0]],
});

const TRAP_THIGH = (c) => ({
  thigh:   [[0, 0], [c - 0.1, 1.2], [c, 1.05], [c + 0.25, 0.5], [1, 0]],
  knee:    [[0, 0], [c - 0.1, 1.35], [c, 1.25], [c + 0.25, 0.7], [1, 0]],
  foot:    [[0, 0], [c, 0.35], [1, 0]],
  supKnee: [[0, 0], [c, 0.22], [1, 0]],
  supThigh:[[0, 0], [c, 0.1], [1, 0]],
  lean:    [[0, 0], [c, -0.08], [1, 0]],
  armOutL: [[0, 0], [c, 0.7], [1, 0]],
  armOutR: [[0, 0], [c, 0.55], [1, 0]],
  headUp:  [[0, 0], [c, -0.4], [1, 0]],
});

const TRAP_CHEST = (c) => ({
  lean:    [[0, 0], [c - 0.12, -0.2], [c, -0.38], [c + 0.25, -0.12], [1, 0]],
  armOutL: [[0, 0], [c, 0.95], [1, 0]],
  armOutR: [[0, 0], [c, 0.95], [1, 0]],
  armFwdL: [[0, 0], [c, -0.35], [1, 0]],
  armFwdR: [[0, 0], [c, -0.35], [1, 0]],
  supKnee: [[0, 0], [c, 0.28], [1, 0]],
  supThigh:[[0, 0], [c, 0.12], [1, 0]],
  knee:    [[0, 0], [c, 0.28], [1, 0]],
  thigh:   [[0, 0], [c, 0.12], [1, 0]],
  drop:    [[0, 0], [c, -0.07], [1, 0]],
  headUp:  [[0, 0], [c, -0.35], [1, 0]],
});

const HEADER = (c) => ({
  hop:     [[0, 0], [c - 0.18, 0.04], [c, 0.2], [c + 0.25, 0], [1, 0]],
  lean:    [[0, 0], [c - 0.18, -0.3], [c, 0.32], [c + 0.2, 0.15], [1, 0]],
  headUp:  [[0, 0], [c - 0.18, 0.35], [c, -0.25], [1, 0]],
  armOutL: [[0, 0], [c - 0.1, 0.8], [c, 0.7], [1, 0]],
  armOutR: [[0, 0], [c - 0.1, 0.8], [c, 0.7], [1, 0]],
  knee:    [[0, 0], [c, 0.55], [1, 0]],
  supKnee: [[0, 0], [c - 0.18, 0.45], [c, 0.25], [1, 0]],
  thigh:   [[0, 0], [c, 0.25], [1, 0]],
});

// jumping header: crouch, spring up with the knees tucked, snap the forehead through the ball
const HEADER_JUMP = (c) => ({
  drop:    [[0, 0], [c - 0.3, -0.16], [c - 0.15, 0], [1, 0]],
  hop:     [[0, 0], [c - 0.22, 0.14], [c, 0.85], [c + 0.18, 0.6], [0.86, 0.04], [1, 0]],
  lean:    [[0, 0], [c - 0.22, -0.28], [c, 0.36], [c + 0.2, 0.15], [1, 0]],
  headUp:  [[0, 0], [c - 0.2, 0.42], [c, -0.32], [1, 0]],
  knee:    [[0, 0], [c - 0.25, 0.6], [c, 0.95], [c + 0.25, 0.4], [1, 0]],
  supKnee: [[0, 0], [c - 0.25, 0.6], [c, 0.85], [c + 0.25, 0.35], [1, 0]],
  thigh:   [[0, 0], [c, 0.45], [1, 0]],
  supThigh:[[0, 0], [c, 0.35], [1, 0]],
  armOutL: [[0, 0], [c - 0.15, 1.15], [c, 0.9], [1, 0]],
  armOutR: [[0, 0], [c - 0.15, 1.15], [c, 0.9], [1, 0]],
});

// diving header: launch forward, body flat out, arms winged, land on the chest and get up
const DIVE_HEADER = (c) => ({
  hop:     [[0, 0], [c - 0.15, 0.18], [c, 0.12], [c + 0.25, 0], [1, 0]],
  body:    [[0, 0], [c - 0.18, -0.7], [c, -1.35], [c + 0.35, -1.4], [0.8, -0.6], [1, 0]],
  drop:    [[0, 0], [c, -0.35], [c + 0.3, -0.62], [0.8, -0.3], [1, 0]],
  headUp:  [[0, 0], [c, 0.55], [c + 0.3, 0.4], [1, 0]],
  thigh:   [[0, 0], [c, -0.45], [c + 0.35, -0.3], [1, 0]],
  supThigh:[[0, 0], [c, -0.35], [c + 0.35, -0.25], [1, 0]],
  knee:    [[0, 0], [c, 0.5], [1, 0]],
  supKnee: [[0, 0], [c - 0.2, 0.6], [c, 0.3], [1, 0]],
  armOutL: [[0, 0], [c, 1.3], [c + 0.3, 1.1], [1, 0]],
  armOutR: [[0, 0], [c, 1.3], [c + 0.3, 1.1], [1, 0]],
});

// bicycle kick (倒钩): spring up, fall back flat in the air, the kicking leg whips over the head
const BICYCLE = (c) => ({
  hop:     [[0, 0], [c - 0.2, 0.35], [c, 0.85], [c + 0.18, 0.55], [c + 0.35, 0.05], [1, 0]],
  body:    [[0, 0], [c - 0.2, 0.9], [c, 1.95], [c + 0.2, 1.75], [c + 0.4, 1.45], [0.85, 0.6], [1, 0]],
  drop:    [[0, 0], [c - 0.25, -0.15], [c - 0.12, 0], [c + 0.35, -0.6], [0.85, -0.35], [1, 0]],
  thigh:   [[0, 0], [c - 0.2, 0.6], [c - 0.05, 1.3], [c, 2.1], [c + 0.15, 1.6], [c + 0.4, 0.5], [1, 0]],
  knee:    [[0, 0], [c - 0.2, 1.4], [c - 0.05, 0.8], [c, 0.15], [c + 0.2, 0.3], [1, 0]],
  supThigh:[[0, 0], [c - 0.2, 1.1], [c, 0.9], [c + 0.3, 0.4], [1, 0]],
  supKnee: [[0, 0], [c - 0.25, 0.7], [c - 0.1, 0.2], [c + 0.2, 0.6], [1, 0]],
  armOutL: [[0, 0], [c - 0.1, 1.5], [c + 0.3, 1.2], [1, 0]],
  armOutR: [[0, 0], [c - 0.1, 1.5], [c + 0.3, 1.2], [1, 0]],
  headUp:  [[0, 0], [c, 0.5], [1, 0]],
});

// 闪身步: a springy hop sideways, body leaning into it, the ball taken along with the sole
const SIDESTEP = {
  drop:    [[0, 0], [0.15, -0.08], [0.5, 0], [1, 0]],
  hop:     [[0, 0], [0.3, 0.12], [0.65, 0.03], [1, 0]],
  roll:    [[0, 0], [0.3, -0.22], [0.7, -0.08], [1, 0]],
  legOut:  [[0, 0], [0.25, 0.45], [0.6, 0.2], [1, 0]],
  thigh:   [[0, 0], [0.3, 0.3], [1, 0]],
  knee:    [[0, 0], [0.3, 0.5], [1, 0]],
  foot:    [[0, 0], [0.3, -0.3], [1, 0]],
  supKnee: [[0, 0], [0.2, 0.42], [0.6, 0.25], [1, 0]],
  twist:   [[0, 0], [0.3, 0.25], [1, 0]],
  armOutL: [[0, 0], [0.3, 0.85], [1, 0]],
  armOutR: [[0, 0], [0.3, 0.5], [1, 0]],
};

// falling over (tackled, flattened by a shot) and getting back up: face down / on the back
const FALL_F = {
  body:    [[0, 0], [0.12, -0.6], [0.26, -1.42], [0.56, -1.45], [0.72, -0.9], [0.88, -0.25], [1, 0]],
  drop:    [[0, 0], [0.12, -0.2], [0.26, -0.66], [0.56, -0.68], [0.72, -0.5], [0.88, -0.16], [1, 0]],
  armFwdL: [[0, 0], [0.18, 1.3], [0.3, 1.0], [0.6, 1.1], [0.75, 0.5], [1, 0]],
  armFwdR: [[0, 0], [0.18, 1.3], [0.3, 1.0], [0.6, 1.1], [0.75, 0.5], [1, 0]],
  elbowL:  [[0, 0], [0.3, 0.4], [0.62, 1.2], [0.75, 0.3], [1, 0]],
  elbowR:  [[0, 0], [0.3, 0.4], [0.62, 1.2], [0.75, 0.3], [1, 0]],
  headUp:  [[0, 0], [0.26, 0.6], [0.56, 0.5], [0.8, 0.2], [1, 0]],
  thigh:   [[0, 0], [0.26, -0.25], [0.6, -0.2], [0.75, 0.6], [0.9, 0.3], [1, 0]],
  knee:    [[0, 0], [0.26, 0.5], [0.6, 0.6], [0.75, 1.4], [0.9, 0.6], [1, 0]],
  supThigh:[[0, 0], [0.26, -0.15], [0.62, -0.1], [0.78, 0.9], [0.92, 0.3], [1, 0]],
  supKnee: [[0, 0], [0.26, 0.3], [0.62, 0.4], [0.78, 1.5], [0.92, 0.6], [1, 0]],
};
const FALL_B = {
  body:    [[0, 0], [0.12, 0.55], [0.26, 1.35], [0.56, 1.4], [0.72, 0.8], [0.88, 0.22], [1, 0]],
  drop:    [[0, 0], [0.12, -0.25], [0.26, -0.7], [0.56, -0.72], [0.72, -0.5], [0.88, -0.15], [1, 0]],
  thigh:   [[0, 0], [0.2, 0.9], [0.32, 0.6], [0.56, 0.5], [0.72, 1.2], [0.9, 0.4], [1, 0]],
  knee:    [[0, 0], [0.2, 0.4], [0.56, 0.7], [0.72, 1.6], [0.9, 0.6], [1, 0]],
  supThigh:[[0, 0], [0.22, 0.6], [0.56, 0.4], [0.75, 1.3], [0.92, 0.3], [1, 0]],
  supKnee: [[0, 0], [0.22, 0.3], [0.56, 0.9], [0.75, 1.6], [0.92, 0.5], [1, 0]],
  armOutL: [[0, 0], [0.18, 1.6], [0.3, 0.9], [0.6, 0.6], [1, 0]],
  armOutR: [[0, 0], [0.18, 1.6], [0.3, 0.9], [0.6, 0.6], [1, 0]],
  armFwdL: [[0, 0], [0.56, -0.5], [0.72, -0.9], [0.88, -0.2], [1, 0]],
  armFwdR: [[0, 0], [0.56, -0.5], [0.72, -0.9], [0.88, -0.2], [1, 0]],
  headUp:  [[0, 0], [0.26, 0.5], [0.56, 0.6], [1, 0]],
};

// goalkeeper: set on the toes, knees bent, hands ready; and cradling a caught ball
const GK_READY = {
  drop:    [[0, -0.18], [0.5, -0.21], [1, -0.18]],
  lean:    [[0, 0.32], [1, 0.32]],
  knee:    [[0, 0.8], [0.5, 0.88], [1, 0.8]],
  supKnee: [[0, 0.8], [0.5, 0.88], [1, 0.8]],
  thigh:   [[0, 0.42], [1, 0.42]],
  supThigh:[[0, 0.42], [1, 0.42]],
  armFwdL: [[0, 0.55], [1, 0.55]],
  armFwdR: [[0, 0.55], [1, 0.55]],
  armOutL: [[0, 0.15], [0.5, 0.22], [1, 0.15]],
  armOutR: [[0, 0.15], [0.5, 0.22], [1, 0.15]],
  elbowL:  [[0, 0.5], [1, 0.5]],
  elbowR:  [[0, 0.5], [1, 0.5]],
  headUp:  [[0, -0.15], [1, -0.15]],
};
const GK_HOLD = {
  armFwdL: [[0, 0.8], [1, 0.8]],
  armFwdR: [[0, 0.8], [1, 0.8]],
  armOutL: [[0, -0.9], [1, -0.9]],
  armOutR: [[0, -0.9], [1, -0.9]],
  lean:    [[0, 0.1], [1, 0.1]],
  headUp:  [[0, -0.25], [1, -0.25]],
};
// overarm throw out to a team-mate (release at 0.45)
const GK_THROW = {
  armFwdR: [[0, 0.8], [0.3, -0.6], [0.45, 1.6], [0.7, 0.9], [1, 0]],
  armOutR: [[0, -0.9], [0.3, 1.5], [0.45, 0.6], [1, 0]],
  armFwdL: [[0, 0.8], [0.3, 0.6], [0.45, 0.2], [1, 0]],
  armOutL: [[0, -0.9], [0.3, 0.8], [1, 0]],
  lean:    [[0, 0.1], [0.3, -0.25], [0.5, 0.35], [0.8, 0.1], [1, 0]],
  twist:   [[0, 0], [0.3, -0.5], [0.5, 0.4], [1, 0]],
  thigh:   [[0, 0], [0.3, 0.3], [0.5, 0.1], [1, 0]],
  supKnee: [[0, 0], [0.3, 0.3], [0.5, 0.45], [1, 0]],
};

// goal celebrations
const CELEB_KNEE = {    // on the knees, leaning back, arms flung wide
  drop:    [[0, -0.55], [1, -0.55]],
  body:    [[0, 0.35], [0.5, 0.42], [1, 0.35]],
  thigh:   [[0, -0.15], [1, -0.15]],
  knee:    [[0, 1.75], [1, 1.75]],
  supThigh:[[0, -0.15], [1, -0.15]],
  supKnee: [[0, 1.75], [1, 1.75]],
  armOutL: [[0, 1.9], [0.5, 2.1], [1, 1.9]],
  armOutR: [[0, 1.9], [0.5, 2.1], [1, 1.9]],
  headUp:  [[0, 0.55], [1, 0.55]],
};
const CELEB_PLANE = {   // arms out like wings, banking from side to side
  armOutL: [[0, 1.55], [1, 1.55]],
  armOutR: [[0, 1.55], [1, 1.55]],
  roll:    [[0, -0.28], [0.5, 0.28], [1, -0.28]],
  lean:    [[0, 0.18], [1, 0.18]],
  hop:     [[0, 0], [0.25, 0.08], [0.5, 0], [0.75, 0.08], [1, 0]],
  headUp:  [[0, 0.2], [1, 0.2]],
};
const CELEB_FIST = {    // leap with a punch at the sky
  hop:     [[0, 0], [0.15, -0.05], [0.35, 0.42], [0.55, 0.05], [0.7, 0], [1, 0]],
  drop:    [[0, 0], [0.15, -0.14], [0.3, 0], [0.6, -0.1], [0.8, 0], [1, 0]],
  armOutR: [[0, 0.6], [0.3, 2.9], [0.6, 2.7], [1, 0.6]],
  elbowR:  [[0, 1.4], [0.3, 0.3], [0.6, 0.6], [1, 1.4]],
  armOutL: [[0, 0.3], [0.3, 0.6], [1, 0.3]],
  elbowL:  [[0, 1.2], [1, 1.2]],
  knee:    [[0, 0], [0.35, 1.2], [0.6, 0.2], [1, 0]],
  supKnee: [[0, 0.2], [0.35, 0.7], [0.6, 0.3], [1, 0.2]],
  headUp:  [[0, 0.3], [0.35, 0.6], [1, 0.3]],
  lean:    [[0, 0], [0.35, -0.2], [1, 0]],
};

// character moves: a low sprinter's dash, a tucked spinning leap, a chest-out roar
const DASH = {
  lean:    [[0, 0], [0.15, 0.5], [0.8, 0.5], [1, 0]],
  drop:    [[0, 0], [0.15, -0.12], [0.8, -0.12], [1, 0]],
  armFwdL: [[0, 0], [0.15, -0.9], [0.8, -0.9], [1, 0]],
  armFwdR: [[0, 0], [0.15, -0.9], [0.8, -0.9], [1, 0]],
  armOutL: [[0, 0], [0.15, 0.3], [1, 0]],
  armOutR: [[0, 0], [0.15, 0.3], [1, 0]],
  headUp:  [[0, 0], [0.15, 0.35], [0.8, 0.35], [1, 0]],
};
const GALE_LEAP = {
  hop:     [[0, 0], [0.08, -0.06], [0.5, 2.3], [0.92, 0.05], [1, 0]],
  drop:    [[0, 0], [0.1, -0.14], [0.22, 0], [0.88, -0.12], [1, 0]],
  thigh:   [[0, 0], [0.2, 0.9], [0.5, 1.1], [0.85, 0.3], [1, 0]],
  knee:    [[0, 0], [0.2, 1.6], [0.5, 1.8], [0.85, 0.5], [1, 0]],
  supThigh:[[0, 0], [0.2, 0.7], [0.5, 1.0], [0.85, 0.3], [1, 0]],
  supKnee: [[0, 0], [0.2, 1.4], [0.5, 1.7], [0.85, 0.6], [1, 0]],
  armOutL: [[0, 0], [0.2, 1.5], [0.5, 1.6], [0.85, 0.8], [1, 0]],
  armOutR: [[0, 0], [0.2, 1.5], [0.5, 1.6], [0.85, 0.8], [1, 0]],
  lean:    [[0, 0], [0.5, 0.3], [1, 0]],
};
// a mid-air strike (the gale's flying volley): one leg whips through, the body leans back over it
const AIR_KICK = {
  thigh:   [[0, 0], [0.3, -0.7], [0.55, 1.7], [1, 0]],
  knee:    [[0, 0], [0.3, 1.3], [0.55, 0.1], [1, 0]],
  lean:    [[0, 0], [0.5, -0.35], [1, 0]],
  armOutL: [[0, 0], [0.45, 1.2], [1, 0]],
};
const ROAR = {
  lean:    [[0, 0], [0.3, 0.25], [0.5, -0.35], [0.85, -0.25], [1, 0]],
  drop:    [[0, 0], [0.3, -0.18], [0.5, -0.06], [1, 0]],
  knee:    [[0, 0], [0.3, 0.55], [0.5, 0.25], [1, 0]],
  supKnee: [[0, 0], [0.3, 0.55], [0.5, 0.25], [1, 0]],
  armOutL: [[0, 0], [0.3, 0.3], [0.5, 1.9], [0.85, 1.8], [1, 0]],
  armOutR: [[0, 0], [0.3, 0.3], [0.5, 1.9], [0.85, 1.8], [1, 0]],
  elbowL:  [[0, 0], [0.3, 1.2], [0.5, 0.3], [1, 0]],
  elbowR:  [[0, 0], [0.3, 1.2], [0.5, 0.3], [1, 0]],
  headUp:  [[0, 0], [0.3, -0.3], [0.5, 0.55], [0.85, 0.5], [1, 0]],
};

// roll: + tips the whole body over sideways towards the dive side.
const DIVE = {
  roll:    [[0, 0], [0.07, 0.6], [0.2, 1.42], [0.58, 1.48], [0.8, 0.75], [1, 0]],
  drop:    [[0, 0], [0.07, -0.12], [0.2, -0.66], [0.58, -0.72], [0.8, -0.3], [1, 0]],
  armOutL: [[0, 0], [0.07, 1.8], [0.18, 2.8], [0.58, 2.75], [0.84, 1.0], [1, 0]],
  armOutR: [[0, 0], [0.07, 1.8], [0.18, 2.8], [0.58, 2.75], [0.84, 1.0], [1, 0]],
  supKnee: [[0, 0], [0.07, 0.6], [0.2, 0.15], [0.58, 0.2], [1, 0]],
  supThigh:[[0, 0], [0.07, 0.35], [0.2, 0.08], [1, 0]],
  knee:    [[0, 0], [0.2, 0.3], [0.58, 0.35], [1, 0]],
  legOut:  [[0, 0], [0.2, 0.3], [0.58, 0.25], [1, 0]],
  headUp:  [[0, 0], [0.2, 0.2], [0.58, 0.15], [1, 0]],
  lean:    [[0, 0], [0.07, 0.15], [0.2, 0.05], [1, 0]],
};

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3();

export class Character {
  /**
   * @param {AvatarTemplate} template shared model + retargeted animation
   * @param {object} kit team colours for the shirt / shorts / hair
   */
  constructor(template, kit) {
    this._baseTemplate = template;
    this._kit = { ...kit };
    template = template.variants?.get(kit.characterId) || template;
    this._modelTemplate = template;
    this.authoredElement = template.authoredElement || (template.authoredThunder ? 'thunder' : null);
    this.authoredThunder = this.authoredElement === 'thunder';
    this.group = new THREE.Group();
    const av = template.instantiate(kit);
    this.root = av.root;
    this.group.add(this.root);
    this.bones = av.bones;
    this.springs = av.springs;
    this.constraints = av.constraints;
    this.expr = av.expressions;

    // animation
    this.mixer = new THREE.AnimationMixer(this.root);
    const C = template.clips;
    this.clips = { idle: C.idle, walk: C.walk, run: C.run };
    this.actions = {};
    for (const [k, c] of Object.entries(this.clips)) {
      const a = this.mixer.clipAction(c); a.play(); a.setEffectiveWeight(k === 'idle' ? 1 : 0); a.timeScale = k === 'idle' ? 1 : 0;
      this.actions[k] = a;
    }
    for (const n of ['sad_pose', 'headShake', 'agree']) {
      if (!C[n]) continue;
      const add = THREE.AnimationUtils.makeClipAdditive(C[n].clone());
      const a = this.mixer.clipAction(add); a.blendMode = THREE.AdditiveAnimationBlendMode;
      a.setEffectiveWeight(0); a.play();
      this.actions[n] = a;
    }

    this.allClips = C;
    this.mocap = null; this.mocapW = 0;    // a motion-capture one-shot (assets/anim) playing over everything
    this._i2on = false; this._i2w = 0;

    this.phase = 0; this.speed = 0;
    this.windup = 0; this._wu = 0;      // charging a shot / pass: 0..1
    this.accel = 0; this._prevSpeed = 0; this._lean = 0;
    this.gestures = [];
    this.look = { yaw: 0, pitch: 0 };
    this.lookTarget = null;
    this.turnVel = 0;
    this.emoteWeights = { sad_pose: 0, headShake: 0, agree: 0 };
    this.emoteTargets = { sad_pose: 0, headShake: 0, agree: 0 };
    // two-bone leg IK requests, filled by gameplay each frame
    this.ik = { R: { target: new THREE.Vector3(), w: 0 }, L: { target: new THREE.Vector3(), w: 0 } };
    this.armIK = { R: { target: new THREE.Vector3(), w: 0 }, L: { target: new THREE.Vector3(), w: 0 } };   // hands reach for a point (a keeper's gloves to the ball)

    this._qa = new THREE.Quaternion(); this._qp = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._ax = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, 1); this.right = new THREE.Vector3(-1, 0, 0);
    this.setFacing(0);
    // rest orientation of the head and neck relative to the body: accessories are fitted in this frame
    this.group.updateMatrixWorld(true);
    const gq = this.group.getWorldQuaternion(new THREE.Quaternion()).invert();
    this._restQ = new Map();
    for (const bn of ['head', 'neck', 'spine2', 'spine1', 'armL', 'armR', 'foreL', 'foreR', 'handL', 'handR', 'footL', 'footR'].map((k) => this.bones[k]).filter(Boolean)) this._restQ.set(bn, gq.clone().multiply(bn.getWorldQuaternion(new THREE.Quaternion())));
    // eyes and fingers aren't animated by the clips: keep their rest pose and pose them by hand each frame
    // the limbs' bind pose: a sprint pushes the running clip's swing further from it
    this._bindQ = ['upLegL', 'upLegR', 'legL', 'legR', 'armL', 'armR', 'foreL', 'foreR'].map((k) => this.bones[k]).filter(Boolean).map((bn) => ({ bn, q: bn.quaternion.clone() }));
    this._sprintW = 0;
    this._eyes = ['eyeL', 'eyeR'].map((k) => this.bones[k]).filter(Boolean).map((bn) => ({ bn, rest: bn.quaternion.clone() }));
    this._fingers = [];
    const fwdW = new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.getWorldQuaternion(new THREE.Quaternion()));
    for (const s of ['L', 'R']) for (const chain of this.bones.fingers?.[s] || []) chain.forEach((bn, j) => {
      // curl axis = the body's forward axis at rest (T-pose), expressed in this joint's own frame
      const axis = fwdW.clone().applyQuaternion(bn.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
      this._fingers.push({ bn, rest: bn.quaternion.clone(), axis, sign: s === 'L' ? -1 : 1, k: [1, 1.15, 0.8][j] });
    });
    this.curl = 0.25; this.breath = 0; this.fatigue = 0; this.tired = 0;

    // measure the clips on *this* skeleton (legs differ between models)
    // the element variants share one skeleton: measure the clips once for all of them
    const mt = this._baseTemplate || template, cache = mt._measure || (mt._measure = {});
    if (!cache.natural) {
      cache.phaseOffset = { walk: this._contactPhase(this.clips.walk), run: this._contactPhase(this.clips.run) };
      cache.natural = { walk: this._stanceSpeed(this.clips.walk), run: this._stanceSpeed(this.clips.run) };
    }
    this.phaseOffset = cache.phaseOffset;
    this.natural = cache.natural;
    this._buildLoco(cache);
    if (!cache.kick) cache.kick = this._calibrateKick();
    this.kickCalib = cache.kick;
  }

  /**
   * The locomotion set: forward gaits by speed (walk → run → fast run → sprint) and the eight-way football
   * jog (backpedal, side-shuffle, diagonals) by the direction of travel relative to the body. Every cycle is
   * measured on this skeleton — how fast the planted foot carries the body, and where the left foot lands —
   * so they all play in step with each other and with the ground.
   */
  _buildLoco(cache) {
    const C = this.allClips, has = (n) => C[n] && C[n].tracks.length;
    if (!cache.loco) {
      const m = (n) => ({ n, po: this._contactPhase(C[n]), v: this._stanceVel(C[n]), cy: this._cycles(C[n]) });
      cache.loco = {
        fwd: has('run_std') ? ['walk', 'run_std', 'run_fast', 'sprint_std'].filter(has).map(m) : [m('walk'), m('run')],
        dir: {},
      };
      for (const k of ['FL', 'FR', 'L', 'R', 'BL', 'BR', 'B']) if (has('jog_' + k)) cache.loco.dir[k] = m('jog_' + k);
      if (has('dribble_jog')) cache.loco.drib = m('dribble_jog');
      if (has('and_dribble_run')) cache.loco.fastDrib = m('and_dribble_run');
      if (has('and_dribble_control')) cache.loco.closeDrib = m('and_dribble_control');
      // the keeper's side-shuffle: one clip each way (the mirror is the other way)
      if (has('goalkeeper_sidestep')) {
        const a = m('goalkeeper_sidestep'), b = { ...m('goalkeeper_sidestep@M'), n: 'goalkeeper_sidestep@M' };
        cache.loco.gk = a.v.r > 0 ? { R: a, L: b } : { R: b, L: a };
      }
      let ymin = Infinity; const p = new THREE.Vector3();
      this._sampleClip(C[cache.loco.fwd[1].n], () => { ymin = Math.min(ymin, this.bones.footL.getWorldPosition(p).y); }, 40);
      cache.loco.ankle = ymin;
    }
    const L = cache.loco;
    const act = (n) => { const a = this.mixer.clipAction(C[n]); a.play(); a.setEffectiveWeight(0); a.timeScale = 0; return a; };
    // anchors: the speed where each forward gait is fully in (a little above the clip's own pace for the runs)
    const anchor = { walk: 1.6, run: 3.6, run_std: 3.6, run_fast: 4.9, sprint_std: 6.0 };
    this.loco = {
      fwd: L.fwd.map((e) => ({ ...e, a: e.n === 'walk' || e.n === 'run' ? this.actions[e.n] : act(e.n), d: C[e.n].duration, s: anchor[e.n], len: Math.max(0.6, Math.hypot(e.v.f, e.v.r)) * C[e.n].duration })),
      dir: Object.fromEntries(Object.entries(L.dir).map(([k, e]) => [k, { ...e, a: act(e.n), d: C[e.n].duration, len: Math.max(0.5, Math.hypot(e.v.f, e.v.r)) * C[e.n].duration / e.cy }])),
    };
    for (const e of this.loco.fwd) e.len /= e.cy;
    const ent = (e) => e && { ...e, a: act(e.n), d: C[e.n].duration, len: Math.max(0.4, Math.hypot(e.v.f, e.v.r)) * C[e.n].duration / e.cy };
    this.loco.drib = ent(L.drib);
    this.loco.closeDrib = ent(L.closeDrib); this._closeW = 0;
    this.loco.fastDrib = ent(L.fastDrib); this._fastDribW = 0;
    this.loco.gk = L.gk && { L: ent(L.gk.L), R: ent(L.gk.R) };
    this._locoEntries = [...this.loco.fwd, ...Object.values(this.loco.dir), this.loco.drib, this.loco.closeDrib, this.loco.fastDrib, this.loco.gk?.L, this.loco.gk?.R].filter(Boolean);
    this._locoBlendW = {};
    this.cycN = 0; this.dribbling = false; this.keeper = false; this._dribW = 0; this._gkW = 0;
    if (!L.fwd.some((e) => e.n === 'run')) this.actions.run.setEffectiveWeight(0);
    this.locoW = {};
    this.ankle0 = L.ankle;
    this._lock = { L: { on: false, p: new THREE.Vector3(), w: 0 }, R: { on: false, p: new THREE.Vector3(), w: 0 } };
  }

  _footLock(dt, MW) {
    const b = this.bones, sc = this.group.scale.y || 1, floor = (this.ankle0 ?? 0.08) * sc;
    const active = this.speed > 0.25 && MW < 0.4 && !this.tumble && !(this.airY > 0.02) && this.gestures.length === 0;
    for (const s of ['L', 'R']) {
      const lk = this._lock[s], foot = s === 'L' ? b.footL : b.footR, up = s === 'L' ? b.upLegL : b.upLegR, low = s === 'L' ? b.legL : b.legR;
      const p = foot.getWorldPosition(this._v);
      const planted = active && p.y < floor + 0.035 * sc && this.ik[s].w < 0.05;
      if (planted && !lk.on) { lk.on = true; lk.p.copy(p); }
      if (lk.on && (!planted || Math.hypot(p.x - lk.p.x, p.z - lk.p.z) > 0.22 * sc)) lk.on = false;
      lk.w += ((lk.on ? 1 : 0) - lk.w) * (1 - Math.exp(-dt * (lk.on ? 25 : 18)));
      if (lk.w > 0.01) {
        if (!lk.on) lk.p.lerp(p, (1 - Math.exp(-dt * 18)));               // let go smoothly as the heel comes up
        this._lt = (this._lt || new THREE.Vector3()).set(lk.p.x, p.y, lk.p.z);
        this._legIK(up, low, foot, this._lt, lk.w);
      }
    }
  }

  /** how many strides (left-foot plants) a looping clip holds */
  _cycles(clip) {
    const N = 120, ys = [], p = new THREE.Vector3();
    this._sampleClip(clip, () => { ys.push(this.bones.footL.getWorldPosition(p).y); }, N);
    const lo = Math.min(...ys), hi = Math.max(...ys), th = lo + Math.max(0.02, (hi - lo) * 0.25);
    let n = 0; for (let i = 0; i < N; i++) if (ys[i] < th && ys[(i + N - 1) % N] >= th) n++;
    return Math.max(1, Math.min(4, n));
  }

  /** the stretch of a turn clip where the body actually comes round (from its yaw curve), with a lead-in and a settle */
  turnWin(name, lead = 0.15, settle = 0.2) {
    const c = this.allClips[name], y = c?.userData?.yaw; if (!y) return { from: 0, to: c ? c.duration : 0, turn: 0 };
    const v0 = y.v[0], tot = y.v[y.v.length - 1] - v0; let t1 = 0, t2 = c.duration;
    for (let i = 0; i < y.v.length; i++) { const f = Math.abs(y.v[i] - v0) / (Math.abs(tot) || 1); if (f > 0.08 && !t1) t1 = y.t[i]; if (f > 0.92) { t2 = y.t[i]; break; } }
    return { from: Math.max(0, t1 - lead), to: Math.min(c.duration, t2 + settle), turn: tot };
  }

  /** the body's velocity while a foot is planted (forward f, right r), from the planted foot sliding back */
  _stanceVel(clip) {
    const N = 120, ys = [], xs = [], zs = [], p = new THREE.Vector3();
    this._sampleClip(clip, () => { this.bones.footL.getWorldPosition(p); ys.push(p.y); xs.push(p.x); zs.push(p.z); }, N);
    const ymin = Math.min(...ys), dt = clip.duration / N; let f = 0, r = 0, n = 0;
    for (let i = 1; i < N; i++) if (ys[i] < ymin + 0.03 && ys[i - 1] < ymin + 0.03) { f += (zs[i - 1] - zs[i]) / dt; r += -(xs[i - 1] - xs[i]) / dt; n++; }
    return n ? { f: f / n, r: r / n } : { f: 1.5, r: 0 };
  }

  /** see-through (the phantom's sprint) */
  setGhost(on) {
    if (!!this._ghost === on) return;
    this._ghost = on;
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) {
        if (m.userData.g0 === undefined) m.userData.g0 = { t: m.transparent, o: m.opacity, d: m.depthWrite };
        const g0 = m.userData.g0;
        if (on) { m.transparent = true; m.opacity = 0.38 * g0.o; m.depthWrite = false; }
        else { m.transparent = g0.t; m.opacity = g0.o; m.depthWrite = g0.d; }
        m.needsUpdate = true;
      }
    });
  }

  /** frozen by an ice shot or the ice blast: the whole body turns to pale blue ice */
  setIce(on) {
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) {
        if (!m.isMeshToonMaterial) continue;
        if (!m.userData.ice0) m.userData.ice0 = { c: m.color.clone(), e: m.emissive.clone(), ei: m.emissiveIntensity, map: m.map, em: m.emissiveMap };
        const o0 = m.userData.ice0;
        if (on) { m.map = null; m.emissiveMap = null; m.color.setRGB(0.55, 0.82, 1.0); m.emissive.setRGB(0.22, 0.52, 0.95); m.emissiveIntensity = 0.6; }
        else { m.map = m.userData.dyeMap || o0.map; m.emissiveMap = m.userData.dyeMap || o0.em; m.color.copy(o0.c); m.emissive.copy(o0.e); m.emissiveIntensity = o0.ei; }
        m.needsUpdate = true;
      }
    });
  }

  /**
   * Each character's own look: hair ornaments, headwear and a couple of little element orbs
   * circling them. Built in world space against the current pose and attached to the bones.
   */
  setStyle(id) {
    const wanted = this._baseTemplate.variants?.get(id) || this._baseTemplate;
    if (this._modelTemplate !== wanted) {
      // Keep the Character and its world group stable: network wrappers,
      // gameplay references, position, visibility and squad scale stay valid.
      this.elementAura?.dispose();
      const group = this.group, oldRoot = this.root;
      this.mixer.stopAllAction(); this.mixer.uncacheRoot(oldRoot);
      for (const o of this._acc || []) o.parent?.remove(o);
      group.remove(oldRoot);
      const materials = new Set();
      oldRoot.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) materials.add(m); });
      materials.forEach((m) => m.dispose());
      const next = new Character(this._baseTemplate, { ...this._kit, characterId: id });
      const wrapped = {};
      for (const name of ['play', 'face', 'emote', 'stopEmotes', 'receiveImpact']) if (Object.hasOwn(this, name)) wrapped[name] = this[name];
      for (const key of Object.keys(this)) delete this[key];
      Object.assign(this, next, wrapped);
      this.group = group;
      group.add(this.root);
    }
    if (this._style === id) return;
    this._style = id;
    this.elementAura?.dispose();
    this.elementAura = new ElementAura(this, id);
    for (const o of this._acc || []) o.parent?.remove(o);
    this._acc = []; this._orbit = []; this._sway = []; this._flick = [];
    if (this.authoredElement) return; // ornaments and outfit are fitted in each VRM
    const b = this.bones;
    // fit in the body frame (+x left, +z forward, +y up) and convert into the bone's rest frame,
    // so the head's current turn (looking at the ball) doesn't skew anything
    const put = (obj, bone, r, u, f) => {
      const inv = (this._restQ.get(bone) || new THREE.Quaternion()).clone().invert();
      const off = new THREE.Vector3(-r, u, f + (bone === b.head ? Fz : 0)).applyQuaternion(inv);
      obj.position.copy(off); obj.quaternion.premultiply(inv);
      bone.add(obj); this._acc.push(obj); return obj;
    };
    const glow = (c, e = 0.8) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: e, roughness: 0.4 });
    const solid = (c) => new THREE.MeshToonMaterial({ color: c, gradientMap: null });
    const Y = 0.04;  // head centre: a little above the head bone
    const Fz = 0.07;  // and well in front of it
    switch (id) {
      case 'thunder': {
        if (this.authoredThunder) break; // jewellery is already fitted in the VRM
        // a golden headband and a pair of lightning-bolt hairpins
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.016, 8, 32), glow(0xffd23f, 0.5)); band.rotation.x = Math.PI / 2 + 0.35;
        put(band, b.head, 0, Y + 0.1, -0.01);
        const bolt = new THREE.Shape([[-0.02, 0.07], [0.03, 0.07], [0.0, 0.015], [0.035, 0.015], [-0.03, -0.075], [-0.005, -0.005], [-0.04, -0.005]].map(([x, y]) => new THREE.Vector2(x, y)));
        const bg = new THREE.ExtrudeGeometry(bolt, { depth: 0.012, bevelEnabled: false }); bg.scale(1.45, 1.45, 1);
        for (const s of [-1, 1]) { const m = new THREE.Mesh(bg, glow(0xffe14a, 1.0)); m.rotation.y = s * Math.PI / 2; m.rotation.z = s * 0.3; put(m, b.head, s * 0.13, Y + 0.06, 0.0); this._flick.push(m); }
        break;
      }
      case 'blaze': {
        // a tiara of flames and a red scarf whose tails stream behind
        for (const [r, h, x] of [[0.055, 0.2, 0], [0.042, 0.14, -0.075], [0.042, 0.14, 0.075]]) {
          const fl = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), glow(x ? 0xff5a1a : 0xffa11a, 1.1));
          put(fl, b.head, x, Y + 0.18 + h / 2 - 0.04, 0.05); this._flick.push(fl);
        }
        const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.03, 8, 20), solid(0xe8322a)); scarf.rotation.x = Math.PI / 2;
        put(scarf, b.neck || b.head, 0, -0.02, 0.0);
        for (const s of [-1, 1]) {
          const tail = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.36).translate(0, -0.18, 0), new THREE.MeshToonMaterial({ color: 0xe8322a, side: THREE.DoubleSide }));
          put(tail, b.neck || b.head, s * 0.035, -0.03, -0.08); this._sway.push({ m: tail, ph: s, base: tail.quaternion.clone() });
        }
        break;
      }
      case 'frost': {
        // an ice crown and a snowflake pin
        const iceMat = new THREE.MeshStandardMaterial({ color: 0xc8f0ff, emissive: 0x6fd0ff, emissiveIntensity: 0.6, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.9 });
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2, h = k === 0 ? 0.17 : 0.09 + (k % 2) * 0.04;
          const c = new THREE.Mesh(new THREE.ConeGeometry(0.026, h, 5), iceMat);
          put(c, b.head, Math.sin(a) * 0.105, Y + 0.095 + h / 2, Math.cos(a) * 0.105);
        }
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.108, 0.012, 6, 28), iceMat); ring.rotation.x = Math.PI / 2;
        put(ring, b.head, 0, Y + 0.095, 0);
        const flake = new THREE.Group();
        for (let k = 0; k < 3; k++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.012, 0.01), glow(0xdff8ff, 0.9)); bar.rotation.z = (k / 3) * Math.PI; flake.add(bar); }
        flake.rotation.y = Math.PI / 2; flake.scale.setScalar(1.6); put(flake, b.head, 0.15, Y + 0.05, 0.0);
        break;
      }
      case 'gale': {
        // feathered wing ornaments either side of the head and a green scarf
        const feather = (s) => {
          const g = new THREE.Group();
          for (let k = 0; k < 3; k++) {
            const f = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshStandardMaterial({ color: k === 1 ? 0xffffff : 0xd8fff0, emissive: 0x8fffc0, emissiveIntensity: 0.35 }));
            f.scale.set(0.014, 0.1 - k * 0.015, 0.04);              // a flat leaf/feather, pointing up
            f.position.set(0, 0.05 - k * 0.005, -k * 0.03); f.rotation.x = -0.35 - k * 0.3; g.add(f);
          }
          g.rotation.z = -s * 0.55; return g;
        };
        for (const s of [-1, 1]) put(feather(s), b.head, s * 0.13, Y + 0.07, -0.02);
        const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.028, 8, 20), solid(0x3fcf7a)); scarf.rotation.x = Math.PI / 2;
        put(scarf, b.neck || b.head, 0, -0.02, 0);
        const tail = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.42).translate(0, -0.21, 0), new THREE.MeshToonMaterial({ color: 0x3fcf7a, side: THREE.DoubleSide }));
        put(tail, b.neck || b.head, 0.03, -0.03, -0.08); this._sway.push({ m: tail, ph: 0, base: tail.quaternion.clone() });
        break;
      }
      case 'phantom': {
        // a crooked pointed hat with a star, and two little ghosts that follow her round
        const hat = new THREE.Group();
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.015, 24), solid(0x4b2a8a)); hat.add(brim);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 20), solid(0x5b34a8)); cone.position.y = 0.16; cone.rotation.z = -0.25; cone.position.x = 0.03; hat.add(cone);
        const bandH = new THREE.Mesh(new THREE.CylinderGeometry(0.128, 0.13, 0.04, 20), solid(0xb58cff)); bandH.position.y = 0.025; hat.add(bandH);
        const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.03), glow(0xffe14a, 1)); star.position.set(0.0, 0.07, 0.125); hat.add(star);
        hat.rotation.z = 0.12;
        put(hat, b.head, 0, Y + 0.14, -0.01);
        for (let k = 0; k < 2; k++) {
          const ghost = new THREE.Group();
          const body = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), new THREE.MeshStandardMaterial({ color: 0xf2eaff, emissive: 0xb58cff, emissiveIntensity: 0.5, transparent: true, opacity: 0.85 }));
          body.scale.set(1, 1.25, 1); ghost.add(body);
          const tailG = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 10), body.material); tailG.rotation.x = Math.PI; tailG.position.y = -0.1; ghost.add(tailG);
          for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), new THREE.MeshBasicMaterial({ color: 0x2a1a40 })); e.position.set(s * 0.025, 0.015, 0.062); ghost.add(e); }
          this.group.add(ghost); this._acc.push(ghost); this._orbit.push({ m: ghost, r: 0.55, h: 1.25 + k * 0.25, sp: 1.6, ph: k * Math.PI });
        }
        break;
      }
      case 'cannon': {
        // big headphones and goggles pushed up on the forehead
        const dark = solid(0x2a2a36), yel = glow(0xffd23f, 0.4);
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.02, 8, 24, Math.PI), dark);
        put(band, b.head, 0, Y + 0.02, 0);
        for (const s of [-1, 1]) {
          const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.055, 18), dark); cup.rotation.z = Math.PI / 2; put(cup, b.head, s * 0.16, Y + 0.0, 0);
          const rim = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.013, 6, 18), yel); rim.rotation.y = Math.PI / 2; put(rim, b.head, s * 0.19, Y + 0.0, 0);
        }
        for (const s of [-1, 1]) {
          const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16), new THREE.MeshStandardMaterial({ color: 0xff8a2a, emissive: 0xff6a00, emissiveIntensity: 0.5, roughness: 0.1, metalness: 0.4 }));
          lens.rotation.x = Math.PI / 2 - 0.4; put(lens, b.head, s * 0.05, Y + 0.12, 0.11);
        }
        const strap = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.012, 6, 28), dark); strap.rotation.x = Math.PI / 2 - 0.35; put(strap, b.head, 0, Y + 0.11, 0.0);
        break;
      }
    }
    if (!this.authoredThunder) this._outfit(id, put, glow, solid);
    // everyone: two little element orbs circling at waist height
    const col = { thunder: 0x5fe1ff, blaze: 0xff6a2b, frost: 0x9fe6ff, gale: 0x6dff9a, phantom: 0xb58cff, cannon: 0xffd23f }[id] || 0xffffff;
    if (id !== 'phantom' && !this.authoredThunder) for (let k = 0; k < 2; k++) {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); orb.add(halo);
      this.group.add(orb); this._acc.push(orb); this._orbit.push({ m: orb, r: 0.48, h: 0.95, sp: 2.4, ph: k * Math.PI });
    }
  }

  /**
   * Below-the-head outfit pieces: element wristbands for everyone, plus one signature piece each
   * (bolt anklets, flame cuffs, ice pauldrons, heel wings, a cape, armoured shoulders).
   */
  _outfit(id, put, glow, solid) {
    const b = this.bones;
    const col = { thunder: 0xffd23f, blaze: 0xff5a1a, frost: 0x8fe0ff, gale: 0x5fe89a, phantom: 0xa77bff, cannon: 0xffb21f }[id] || 0xffffff;
    // wristbands: a fat ring round each wrist, a thin glowing stripe on top
    for (const [hand, s] of [[b.handL, -1], [b.handR, 1]]) {
      if (!hand) continue;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.055, 16, 1, true), new THREE.MeshToonMaterial({ color: id === 'cannon' ? 0x2a2a36 : 0xffffff, side: THREE.DoubleSide }));
      band.rotation.z = Math.PI / 2; put(band, hand, s * 0.035, 0, 0);
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.043, 0.008, 6, 20), glow(col, 0.9)); stripe.rotation.y = Math.PI / 2; put(stripe, hand, s * 0.035, 0, 0);
    }
    const ankles = [[b.footL, -1], [b.footR, 1]].filter(([f]) => f);
    switch (id) {
      case 'thunder': {
        // glowing anklets with a little bolt on the outside of each
        const bolt = new THREE.Shape([[-0.02, 0.07], [0.03, 0.07], [0.0, 0.015], [0.035, 0.015], [-0.03, -0.075], [-0.005, -0.005], [-0.04, -0.005]].map(([x, y]) => new THREE.Vector2(x, y)));
        const bg = new THREE.ExtrudeGeometry(bolt, { depth: 0.01, bevelEnabled: false }); bg.scale(0.75, 0.75, 1);
        for (const [f, s] of ankles) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 6, 22), glow(0x5fe1ff, 1.0)); ring.rotation.x = Math.PI / 2; put(ring, f, 0, 0.03, 0);
          const m = new THREE.Mesh(bg, glow(0xffe14a, 1.1)); m.rotation.y = s * Math.PI / 2; put(m, f, s * 0.06, 0.05, 0); this._flick.push(m);
        }
        break;
      }
      case 'blaze': {
        // little flames licking up from each wristband
        for (const [hand, s] of [[b.handL, -1], [b.handR, 1]]) {
          if (!hand) continue;
          for (let k = 0; k < 3; k++) {
            const fl = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.075, 6), glow(k === 1 ? 0xffc21a : 0xff5a1a, 1.2));
            put(fl, hand, s * (0.02 + k * 0.022), 0.055, (k - 1) * 0.012); fl.id2 = k; this._flick.push(fl);
          }
        }
        break;
      }
      case 'frost': {
        // clusters of ice crystals on both shoulders
        const iceMat = new THREE.MeshStandardMaterial({ color: 0xd8f6ff, emissive: 0x6fd0ff, emissiveIntensity: 0.55, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.92 });
        for (const [arm, s] of [[b.armL, -1], [b.armR, 1]]) {
          if (!arm) continue;
          for (const [h, ox, oz, tilt] of [[0.13, 0.02, 0, 0.35], [0.09, 0.06, 0.035, 0.75], [0.09, 0.06, -0.035, 0.75], [0.07, -0.02, 0.03, 0.15]]) {
            const c = new THREE.Mesh(new THREE.ConeGeometry(0.022, h, 5), iceMat); c.rotation.z = -s * tilt;
            put(c, arm, s * ox, 0.06 + h * 0.4, oz);
          }
        }
        break;
      }
      case 'gale': {
        // small wings on the heels
        for (const [f, s] of ankles) {
          const g = new THREE.Group();
          for (let k = 0; k < 3; k++) {
            const fe = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), new THREE.MeshStandardMaterial({ color: k === 0 ? 0xffffff : 0xd8fff0, emissive: 0x8fffc0, emissiveIntensity: 0.4 }));
            fe.scale.set(0.01, 0.075 - k * 0.014, 0.03); fe.position.set(0, 0.03, -k * 0.022); fe.rotation.x = -0.9 - k * 0.3; g.add(fe);
          }
          g.rotation.z = -s * 0.5; put(g, f, s * 0.055, 0.04, -0.04); this._sway.push({ m: g, ph: s * 2, base: g.quaternion.clone(), amp: 0.25 });
        }
        break;
      }
      case 'phantom': {
        // a short night-purple cape with a lighter lining, hanging from the shoulders
        const spine = b.spine2 || b.spine1;
        if (spine) {
          const cape = new THREE.Group();
          const shape = new THREE.PlaneGeometry(0.36, 0.6, 8, 6).translate(0, -0.3, 0);
          const pos = shape.attributes.position;
          for (let i = 0; i < pos.count; i++) { const y = pos.getY(i), x = pos.getX(i); const xs = x * (1 + (-y) * 0.35); pos.setX(i, xs); pos.setZ(i, -xs * xs * 3.2); }
          shape.computeVertexNormals();
          const outer = new THREE.Mesh(shape, new THREE.MeshToonMaterial({ color: 0x3a2470, side: THREE.FrontSide }));
          const inner = new THREE.Mesh(shape, new THREE.MeshToonMaterial({ color: 0x8a5ae0, side: THREE.BackSide }));
          cape.add(outer, inner);
          const clasp = new THREE.Mesh(new THREE.OctahedronGeometry(0.028), glow(0xffe14a, 1)); clasp.position.set(0, 0.0, 0.02); cape.add(clasp);
          cape.rotation.y = Math.PI;
          put(cape, spine, 0, 0.17, -0.1); this._sway.push({ m: cape, ph: 0.5, base: cape.quaternion.clone(), amp: 0.5, sign: -1 });
        }
        break;
      }
      case 'cannon': {
        // armoured shoulder pads with a yellow rim and a rivet
        for (const [arm, s] of [[b.armL, -1], [b.armR, 1]]) {
          if (!arm) continue;
          const pad = new THREE.Group();
          const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshToonMaterial({ color: 0x56566c }));
          shell.scale.set(0.1, 0.07, 0.105); pad.add(shell);
          const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 6, 24), glow(0xffd23f, 0.45)); rim.scale.set(0.1, 0.105, 0.1); rim.rotation.x = Math.PI / 2; pad.add(rim);
          const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), glow(0xffd23f, 0.6)); rivet.position.y = 0.07; pad.add(rivet);
          pad.rotation.z = -s * 0.35;
          put(pad, arm, s * 0.06, 0.05, 0);
        }
        break;
      }
    }
  }

  _styleTick(dt) {
    this._st = (this._st || 0) + dt;
    const t = this._st;
    for (const o of this._orbit || []) { const a = t * o.sp + o.ph; o.m.position.set(Math.cos(a) * o.r, o.h + Math.sin(t * 2.3 + o.ph) * 0.08 + this.root.position.y, Math.sin(a) * o.r); }
    for (const f of this._flick || []) { const k = 1 + Math.sin(t * 17 + f.id) * 0.12; f.scale.set(k, 1 + Math.sin(t * 13 + f.id * 2) * 0.18, k); }
    for (const s of this._sway || []) { s.m.quaternion.copy(s.base); s.m.rotateX((s.sign || 1) * ((s.amp ? 0.05 : 0.15) + Math.sin(t * 6 + s.ph) * (s.amp ? s.amp * 0.25 : 0.12) + Math.min(0.6, this.speed * (s.amp ? s.amp * 0.18 : 0.1)))); }
  }

  /** characters each have their own hair colour */
  setHair(color) { if (!this.authoredElement) dyeHair(this.root, color); }

  _sampleClip(clip, fn, N = 60) {
    const m = new THREE.AnimationMixer(this.root);
    const a = m.clipAction(clip); a.play();
    for (let i = 0; i < N; i++) { m.setTime((i / N) * clip.duration); this.group.updateMatrixWorld(true); fn(i, i / N); }
    a.stop(); m.uncacheRoot(this.root);
  }

  _contactPhase(clip) {
    let best = 0, bestY = Infinity; const p = new THREE.Vector3();
    this._sampleClip(clip, (i, u) => { this.bones.footL.getWorldPosition(p); if (p.y < bestY) { bestY = p.y; best = u; } });
    return best;
  }

  /** speed the body would travel at so that the planted foot doesn't slide */
  _stanceSpeed(clip) {
    const N = 120, ys = [], zs = [], p = new THREE.Vector3();
    this._sampleClip(clip, () => { this.bones.footL.getWorldPosition(p); ys.push(p.y); zs.push(p.z); }, N);
    const ymin = Math.min(...ys), dt = clip.duration / N; let s = 0, n = 0;
    for (let i = 1; i < N; i++) if (ys[i] < ymin + 0.03) { s += (zs[i - 1] - zs[i]) / dt; n++; }
    return n ? Math.max(0.5, s / n) : 1.5;
  }

  /** where the kicking boot is at the moment of contact, in the player's frame */
  _calibrateKick() {
    this.group.position.set(0, 0, 0); this.setFacing(0);
    const g = this.play('kick', { duration: ANIM.kickDuration });
    const contactT = ANIM.kickDuration * ANIM.kickContact;
    let t = 0; const dt = 1 / 240;
    while (t + dt <= contactT) { this.update(dt, { speed: 0 }); t += dt; }
    const toe = this.bones.toeR.getWorldPosition(new THREE.Vector3());
    const ankle = this.bones.footR.getWorldPosition(new THREE.Vector3());
    this.gestures = []; void g;
    this.mixer.setTime(0); this.update(0, { speed: 0 });
    this.springs?.reset?.();
    // facing 0 → forward +z, right -x
    return { forward: toe.z, side: -toe.x, toeHeight: toe.y, ankleForward: ankle.z, ankleHeight: ankle.y };
  }

  setFacing(angle) {
    this.group.rotation.y = angle;
    this.forward.set(Math.sin(angle), 0, Math.cos(angle));
    this.right.crossVectors(this.forward, UP); // character's right hand side
  }

  play(name, opts = {}) {
    const c = opts.contact ?? ANIM.kickContact;
    let g;
    switch (name) {
      case 'kick': g = new Gesture('kick', opts.duration ?? ANIM.kickDuration, KICK(c), { ...opts, events: [{ name: 'contact', at: c }] }); break;
      case 'jumpHeader': g = new Gesture('jumpHeader', opts.duration ?? 0.7, HEADER_JUMP(opts.contact ?? 0.42), { fadeIn: 0.05, fadeOut: 0.14, ...opts }); break;
      case 'diveHeader': g = new Gesture('diveHeader', opts.duration ?? 0.95, DIVE_HEADER(opts.contact ?? 0.3), { fadeIn: 0.04, fadeOut: 0.18, ...opts }); break;
      case 'bicycle': g = new Gesture('bicycle', opts.duration ?? 1.25, BICYCLE(opts.contact ?? 0.3), { fadeIn: 0.04, fadeOut: 0.2, ...opts }); break;
      case 'sidestep': g = new Gesture('sidestep', opts.duration ?? 0.4, SIDESTEP, { fadeIn: 0.04, fadeOut: 0.1, ...opts }); break;
      case 'poke': g = new Gesture('poke', opts.duration ?? 0.5, POKE, { fadeIn: 0.04, fadeOut: 0.12, ...opts }); break;
      case 'stepover': g = new Gesture('stepover', opts.duration ?? 0.5, STEPOVER, { fadeIn: 0.05, fadeOut: 0.1, ...opts }); break;
      case 'drag': g = new Gesture('drag', opts.duration ?? 0.34, DRAG, { fadeIn: 0.04, fadeOut: 0.1, ...opts }); break;
      case 'dragback': g = new Gesture('dragback', opts.duration ?? 0.5, DRAGBACK, { fadeIn: 0.04, fadeOut: 0.12, ...opts }); break;
      case 'pass': g = new Gesture('pass', opts.duration ?? ANIM.kickDuration, PASS(c), { ...opts, events: [{ name: 'contact', at: c }] }); break;
      case 'chip': g = new Gesture('chip', opts.duration ?? ANIM.kickDuration, CHIP(c), { ...opts, events: [{ name: 'contact', at: c }] }); break;
      case 'touch': g = new Gesture('touch', opts.duration ?? ANIM.touchDuration, TOUCH, { fadeIn: 0.04, fadeOut: 0.08, ...opts }); break;
      case 'trap': g = new Gesture('trap', 0.42, TRAP, { fadeIn: 0.05, fadeOut: 0.15, ...opts }); break;
      case 'celebrate': g = new Gesture('celebrate', 0.9, CELEBRATE, { loop: true, fadeIn: 0.2, fadeOut: 0.3, ...opts }); break;
      case 'deject': g = new Gesture('deject', 3, DEJECT, { loop: true, fadeIn: 0.6, fadeOut: 0.4, ...opts }); break;
      case 'slide': g = new Gesture('slide', opts.duration ?? 0.85, SLIDE, { fadeIn: 0.05, fadeOut: 0.1, ...opts }); break;
      case 'stagger': g = new Gesture('stagger', opts.duration ?? 0.6, STAGGER, { fadeIn: 0.04, fadeOut: 0.12, ...opts }); break;
      case 'trapFoot': g = new Gesture('trapFoot', opts.duration ?? 0.5, TRAP_FOOT(c), { fadeIn: 0.05, fadeOut: 0.14, ...opts }); break;
      case 'trapThigh': g = new Gesture('trapThigh', opts.duration ?? 0.55, TRAP_THIGH(c), { fadeIn: 0.06, fadeOut: 0.14, ...opts }); break;
      case 'trapChest': g = new Gesture('trapChest', opts.duration ?? 0.55, TRAP_CHEST(c), { fadeIn: 0.06, fadeOut: 0.14, ...opts }); break;
      case 'header': g = new Gesture('header', opts.duration ?? 0.55, HEADER(c), { fadeIn: 0.05, fadeOut: 0.12, ...opts }); break;
      case 'fallF': g = new Gesture('fallF', opts.duration ?? 1.5, FALL_F, { fadeIn: 0.04, fadeOut: 0.15, ...opts }); break;
      case 'fallB': g = new Gesture('fallB', opts.duration ?? 1.5, FALL_B, { fadeIn: 0.04, fadeOut: 0.15, ...opts }); break;
      case 'gkReady': g = new Gesture('gkReady', 1.4, GK_READY, { loop: true, fadeIn: 0.25, fadeOut: 0.2, ...opts }); break;
      case 'gkHold': g = new Gesture('gkHold', 1, GK_HOLD, { loop: true, fadeIn: 0.1, fadeOut: 0.15, ...opts }); break;
      case 'gkThrow': g = new Gesture('gkThrow', opts.duration ?? 0.7, GK_THROW, { fadeIn: 0.05, fadeOut: 0.15, ...opts }); break;
      case 'kneeSlide': g = new Gesture('kneeSlide', 1.2, CELEB_KNEE, { loop: true, fadeIn: 0.25, fadeOut: 0.3, ...opts }); break;
      case 'airplane': g = new Gesture('airplane', 1.3, CELEB_PLANE, { loop: true, fadeIn: 0.2, fadeOut: 0.3, ...opts }); break;
      case 'fistPump': g = new Gesture('fistPump', 1.0, CELEB_FIST, { loop: true, fadeIn: 0.1, fadeOut: 0.3, ...opts }); break;
      case 'dash': g = new Gesture('dash', opts.duration ?? 0.5, DASH, { fadeIn: 0.05, fadeOut: 0.12, ...opts }); break;
      case 'galeLeap': g = new Gesture('galeLeap', opts.duration ?? 0.8, GALE_LEAP, { fadeIn: 0.04, fadeOut: 0.1, ...opts }); break;
      case 'airKick': g = new Gesture('airKick', opts.duration ?? 0.42, AIR_KICK, { fadeIn: 0.03, fadeOut: 0.12, ...opts }); break;
      case 'roar': g = new Gesture('roar', opts.duration ?? 0.6, ROAR, { fadeIn: 0.04, fadeOut: 0.15, ...opts }); break;
      case 'dive': g = new Gesture('dive', opts.duration ?? 1.15, DIVE, { fadeIn: 0.03, fadeOut: 0.15, ...opts }); break;
      case 'gkReach': g = new Gesture('gkReach', opts.duration ?? 0.7, {}, { fadeIn: 0.04, fadeOut: 0.15, ...opts }); break;
    }
    if (g && !opts.noMocap && this._autoMocap(name, opts, g)) g.mocap = true;
    const LEG = ['kick', 'chip', 'pass', 'poke', 'stepover', 'drag', 'dragback', 'sidestep', 'jumpHeader', 'diveHeader', 'bicycle', 'touch', 'trap', 'slide', 'stagger', 'trapFoot', 'trapThigh', 'trapChest', 'header', 'dive', 'fallF', 'fallB', 'gkThrow', 'dash', 'galeLeap', 'roar'];
    if (LEG.includes(name)) this.gestures = this.gestures.filter((x) => !LEG.includes(x.name));
    else this.gestures = this.gestures.filter((x) => x.name !== name);
    this.gestures.push(g);
    if (name === 'celebrate' || name === 'kneeSlide' || name === 'airplane' || name === 'fistPump') { this.face('happy', 1); }
    if (name === 'deject') { this.face('sad', 0.9); }
    return g;
  }

  /**
   * Play a motion-capture clip once, over the locomotion and the procedural layers.
   * The window [from, to] of the clip (seconds) is squeezed or stretched to last `dur`; with `align`
   * (a clip time) and `at` (seconds from now) the clip is timed so that moment lands exactly then —
   * a boot meets the ball on the frame the ball is struck. `mirror` plays the left/right swapped copy.
   * `over` (0..1) is how much it overrides the hand-made layers; `keepIK` leaves the feet/hands IK alone.
   */
  playMocap(name, { dur, from = 0, to, align, at, fadeIn = 0.08, fadeOut = 0.18, mirror = false, over = 1, hold = 0, next = null } = {}) {
    const clip = this.allClips[mirror ? name + '@M' : name];
    if (!clip) return null;
    to = Math.min(to ?? clip.duration, clip.duration);
    let ts = 1;
    if (align != null && at != null) {
      // time it so that `align` happens `at` seconds from now; the window then runs at that pace
      ts = dur ? (to - from) / dur : 1;
      if (at > 0) ts = Math.max(0.45, Math.min(2.4, (align - from) / at));
      if (dur == null) dur = (to - from) / ts;
    } else if (dur) ts = (to - from) / dur;
    else dur = to - from;
    if (this._mprev) { this._mprev.a.stop(); this._mprev = null; }
    if (this.mocap && this.mocap.a.getClip() !== clip && this.mocapW > 0.02) this._mprev = { a: this.mocap.a, w: this.mocapW };
    else if (this.mocap && this.mocap.a.getClip() !== clip) this.mocap.a.stop();
    const a = this.mixer.clipAction(clip);
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = 0; a.time = from; a.setEffectiveWeight(0); a.play();
    this.mocap = { name, a, t: 0, from, to, ts, dur: dur + hold, run: dur, fi: fadeIn, fo: next ? 1e-3 : fadeOut, over, next };
    const yc = clip.userData?.yaw;
    if (yc) Object.assign(this.mocap, { yaw: yc, f0: this.group.rotation.y + (this._rootYaw || 0), y0: yawAt(yc, from) });
    return this.mocap;
  }
  /**
   * The motion-capture take for a gesture, timed to it: the boot meets the ball at the gesture's contact
   * moment, the keeper leaves the ground when the dive's push starts, and so on. The gesture still runs
   * underneath (it carries the gameplay timing and the events) but its hand-made pose gives way.
   */
  _autoMocap(name, o, g) {
    const C = this.allClips; if (!C.strike_foward_jog) return false;
    const R = (o.side || 'Right') !== 'Left', d = g.duration, c = o.contact ?? ANIM.kickContact, sp = this.speed || 0;
    const P = (n, x) => !!C[n] && !!this.playMocap(n, x);
    // Crop the preparation to the game's wind-up while retaining the captured
    // tempo around the measured contact frame and the complete follow-through.
    const captured = (id, mirror = false) => {
      const clip = C[id], contact = clip?.userData?.contact;
      if (contact === undefined) return false;
      const at = o.arrive ?? d * c, from = Math.max(0, contact - at);
      return P(id, { mirror, from, to: Math.min(clip.duration, contact + (name === 'pass' ? 0.48 : 0.7)), align: contact, at, fadeIn: 0.045, fadeOut: 0.2 });
    };
    switch (name) {
      case 'kick':
        if (o.volley) return false;
        if (sp < 0.7 && captured(o.power > 0.84 ? 'and_penalty_2' : 'and_penalty_1', !R)) return true;
        if (sp >= 0.7 && sp < 2.5 && captured('and_power', R)) return true;
        if (sp < 0.7 && captured('rokoko_penalty')) return true;
        if (sp < 0.7 && C.soccer_penalty_kick) return P('soccer_penalty_kick', { from: 0.4, to: 1.4, align: 0.73, at: d * c, fadeIn: 0.06, fadeOut: 0.25 });
        if (sp > 3.6 && C.jog_kick && Math.random() < 0.5) return P('jog_kick', { from: 0.12, to: 1.05, align: 0.43, at: d * c, fadeIn: 0.06, fadeOut: 0.22 });
        return P('strike_foward_jog', { from: 0.12, to: 1.15, align: 0.42, at: d * c, fadeIn: 0.06, fadeOut: 0.22 });
      case 'pass':
        if (sp < 2.4 && captured('and_pass', !R)) return true;
        if (sp < 2.4 && captured('rokoko_pass', !R)) return true;
        if (sp > 3.6 && C.jog_kick) return P('jog_kick', { from: 0.15, to: 0.95, align: 0.43, at: d * c, fadeIn: 0.05, fadeOut: 0.2 });
        return P('kick_soccerball_2', { from: 0, to: 0.47, align: 0.2, at: d * c, fadeIn: 0.05, fadeOut: 0.16 });
      case 'chip':
        if (sp > 2.4 && C.chip_jog) return P('chip_jog', { from: 0.2, to: 1.25, align: 0.48, at: d * c, fadeIn: 0.05, fadeOut: 0.22 });
        return P('kick_soccerball', { mirror: true, from: 0, to: 0.53, align: 0.24, at: d * c, fadeIn: 0.05, fadeOut: 0.18 });
      case 'bicycle': return P('scissor_kick', { from: 0.4, to: 2.3, align: 0.8, at: d * (o.contact ?? 0.3), fadeIn: 0.05, fadeOut: 0.3 });
      case 'header': return P('header_soccerball', { from: 0.4, to: 1.45, align: 0.92, at: d * (o.contact ?? 0.42), fadeIn: 0.06, fadeOut: 0.18 });
      case 'jumpHeader':
        if (sp < 1.6) return P('header_inplace', { from: 0.55, to: 1.85, align: 1.13, at: d * (o.contact ?? 0.42), fadeIn: 0.05, fadeOut: 0.2 });
        return false;
      case 'trapChest': return P('chest_receive', { from: 0.1, to: 1.3, align: 0.45, at: d * c, fadeIn: 0.06, fadeOut: 0.2 });
      case 'trapFoot':
        if (sp < 1.2) return P('receive_soccerball', { mirror: !R, from: 0, to: 1.0, align: 0.3, at: d * c, fadeIn: 0.06, fadeOut: 0.2 });
        return false;
      case 'slide':
        if (o.kind === 'thunder' || o.kind === 'gale') return P('soccer_tackle_2', { mirror: !R, from: 0.08, to: 1.25, dur: d + 0.15, fadeIn: 0.05, fadeOut: 0.22 });
        return P('soccer_tackle', { mirror: !R, from: 0.8, to: 2.15, dur: d + 0.15, fadeIn: 0.05, fadeOut: 0.22 });
      case 'sidestep':
        // the 闪身步: a Marseille-turn spin round the man when asked for, else the quick hop
        if (o.spin && C.spin360) return P('spin360', { mirror: !R, from: 0.08, to: 1.12, dur: d + 0.12, fadeIn: 0.04, fadeOut: 0.16, over: 0.95 });
        return false;
      case 'dive':
        // the clips dive to the keeper's left (diving_save, body_block) or right (diving_save_2)
        if (o.low) return P('goalkeeper_body_block', { mirror: R, from: 0.35, to: 1.95, dur: d + 0.1, fadeIn: 0.04, fadeOut: 0.25 });
        return P(R ? 'goalkeeper_diving_save_2' : 'goalkeeper_diving_save', { from: R ? 0.85 : 0.88, to: 2.6, dur: d + 0.1, fadeIn: 0.04, fadeOut: 0.25 });
      case 'fallF': case 'fallB':
        if (!o.trip) return false;
        return P('soccer_trip', { mirror: !!o.mirror, from: 0.15, to: 1.05, dur: d * 0.42, fadeIn: 0.05,
          next: { name: 'standing_up', mirror: !!o.mirror, from: 0.3, to: 1.63, dur: d * 0.58, fadeOut: 0.2 } });
      case 'gkThrow':
        if (o.punt) return P('goalkeeper_drop_kick', { from: 1.55, to: 2.85, align: 2.08, at: 0.3, fadeIn: 0.08, fadeOut: 0.25 });
        if (o.roll && C.goalkeeper_pass) return P('goalkeeper_pass', { from: 0.55, to: 2.0, align: 1.1, at: 0.3, fadeIn: 0.08, fadeOut: 0.3 });
        return P('goalkeeper_overhand_throw', { from: 0.95, to: 2.1, align: 1.45, at: 0.3, fadeIn: 0.08, fadeOut: 0.25 });
      case 'deject':
        if (o.keeper && C.goalkeeper_miss) return P('goalkeeper_miss', { from: 0.3, to: 2.8, fadeIn: 0.1, fadeOut: 0.5 });
        return false;
      case 'gkReady': if (this.setIdlePose('goalkeeper_idle')) g.silent = true; return false;
      case 'gkReach': {
        const high = o.height > 1.55;
        // The high capture reaches left; the middle and low takes reach right.
        return captured(high ? 'and_gk_high' : o.height < 0.65 ? 'and_gk_low' : 'and_gk_mid', high ? R : !R);
      }
    }
    return false;
  }

  /** a turn on the spot (or out of a run) from motion capture, timed by its own yaw curve; `right` picks the way round */
  playTurn(name, right, opts = {}) {
    const w = this.turnWin(name, opts.lead, opts.settle);
    if (!w.to) return null;
    return this.playMocap(name, { mirror: (w.turn < 0) !== right, from: w.from, to: w.to, dur: opts.dur ?? (w.to - w.from) / (opts.speed ?? 1.4), fadeIn: 0.06, fadeOut: 0.18, over: opts.over ?? 0.9 });
  }

  /** swap the standing loop for another clip (null → back to the normal idle) */
  setIdlePose(name) {
    const clip = name && this.allClips[name];
    if (!clip) { this._i2on = false; return false; }
    if (!this.actions.idle2 || this.actions.idle2.getClip() !== clip) {
      this._idlePrevious?.a.stop();
      this._idlePrevious = this.actions.idle2 ? { a: this.actions.idle2, w: this._i2w } : null;
      const a = this.mixer.clipAction(clip); a.reset(); a.setLoop(THREE.LoopRepeat); a.setEffectiveWeight(0); a.play();
      a.timeScale = /idle/.test(name) ? 0.72 : 1;
      this.actions.idle2 = a; this._i2w = 0;
    }
    this._i2on = true; return true;
  }
  stopMocap(fade = 0.15) { if (this.mocap) { const m = this.mocap; m.dur = Math.min(m.dur, m.t + fade); m.fo = fade; } }
  mocapPlaying(name) { return !!this.mocap && (!name || this.mocap.name === name); }

  face(name, w) {
    const duration = name === 'happy' || name === 'sad' ? 1.8 : name === 'angry' ? 0.55 : 0.65;
    this.expr?.pulse(name, w, duration);
    if (name === 'aa') this._faceBusyT = w > 0 ? duration : 0;
  }

  /** A damped response to actual contact, layered over the captured pose. */
  receiveImpact(normal, speed, part = 'chest') {
    if (speed < 2 || (this._recoil && this._recoil.t < 0.06)) return;
    this._recoil = { n: new THREE.Vector3().fromArray(normal), t: 0, amp: clamp(speed / 100, 0.02, 0.2) * (part === 'hand' ? 0.65 : 1) };
  }

  stopEmotes() {
    this._i2on = false;
    for (const g of this.gestures) if (g.loop) g.stop();
    for (const k in this.emoteTargets) this.emoteTargets[k] = 0;
    this.expr?.clear();
  }

  emote(name, w = 1) { if (name in this.emoteTargets) this.emoteTargets[name] = w; }

  get busyLeg() { return this.gestures.some((g) => (g.name === 'kick' || g.name === 'chip' || g.name === 'pass') && !g.done); }

  footPos(side = 'R', out = new THREE.Vector3()) {
    return (side === 'R' ? this.bones.toeR : this.bones.toeL).getWorldPosition(out);
  }
  anklePos(side = 'R', out = new THREE.Vector3()) {
    return (side === 'R' ? this.bones.footR : this.bones.footL).getWorldPosition(out);
  }

  /**
   * Collision spheres that follow the skeleton: the ball bounces off whatever
   * part of the body it actually meets. Returns [{ part, side, r, pos }].
   */
  bodySpheres(out = []) {
    const b = this.bones;
    if (!this._sph) {
      const mk = (part, side, r) => ({ part, side, r, pos: new THREE.Vector3(), b: null });
      this._sph = [mk('head', 0, 0.12), mk('chest', 0, 0.15), mk('hips', 0, 0.15),
        mk('thigh', 'R', 0.085), mk('thigh', 'L', 0.085), mk('shin', 'R', 0.065), mk('shin', 'L', 0.065),
        mk('foot', 'R', 0.065), mk('foot', 'L', 0.065), mk('hand', 'R', 0.11), mk('hand', 'L', 0.11)];
      // limbs are capsules: pos = one end, b = the other end
      for (const i of [3, 4, 5, 6, 7, 8]) this._sph[i].b = new THREE.Vector3();
      this._sph[3].r = this._sph[4].r = 0.08; this._sph[5].r = this._sph[6].r = 0.06; this._sph[7].r = this._sph[8].r = 0.055;
    }
    const s = this._sph, t = _a, u = _b;
    b.head.getWorldPosition(s[0].pos); s[0].pos.y += 0.08;
    (b.spine2 || b.spine1).getWorldPosition(s[1].pos);
    b.hips.getWorldPosition(s[2].pos);
    // segment between two bones, pulled in a little at the joints so neighbours overlap cleanly
    const seg = (A, B, x, k0 = 0.08, k1 = 0.92) => { A.getWorldPosition(t); B.getWorldPosition(u); x.pos.copy(t).lerp(u, k0); x.b.copy(t).lerp(u, k1); };
    seg(b.upLegR, b.legR, s[3], 0.12, 1); seg(b.upLegL, b.legL, s[4], 0.12, 1);
    seg(b.legR, b.footR, s[5], 0, 0.9); seg(b.legL, b.footL, s[6], 0, 0.9);
    seg(b.footR, b.toeR, s[7], 0, 1.15); seg(b.footL, b.toeL, s[8], 0, 1.15);
    for (const i of [7, 8]) { s[i].pos.y = Math.max(s[i].pos.y, 0.05); s[i].b.y = Math.max(s[i].b.y, 0.045); }
    b.handR.getWorldPosition(s[9].pos); b.handL.getWorldPosition(s[10].pos);
    for (const x of s) out.push(x);
    return out;
  }

  teleported() {
    this.springs && (this.springs.needsReset = true);
    for (const lock of Object.values(this._lock || {})) { lock.on = false; lock.w = 0; }
  }

  /** A calm, planted presentation pose, independent of the gameplay ready loop. */
  setPresentation(personality = 0) {
    this.presentation = { t: personality * 2.73, personality, ack: 10 };
    this.actions.idle.timeScale = 0;
    this.actions.idle.time = Math.min(0.6, this.clips.idle.duration * 0.3);
  }

  acknowledge() { if (this.presentation) this.presentation.ack = 0; }

  /** Keep silhouette-defining geometry; retire only subpixel decorative detail. */
  updateVisualDetails(camera, viewportHeight) {
    this.elementAura?.setView(camera, viewportHeight);
    if (!this._visualDetails) {
      this._visualDetails = [];
      this.root.traverse(object => { if (object.userData.detailRadius || object.userData.detailDistance) this._visualDetails.push(object); });
    }
    const distance = Math.max(0.1, this.group.position.distanceTo(camera.position));
    const pixels = viewportHeight / (2 * Math.tan(camera.fov * Math.PI / 360) * distance) * this.group.scale.x;
    for (const object of this._visualDetails) {
      const data = object.userData;
      if (data.detailDistance) object.visible = distance < data.detailDistance + (object.visible ? 2 : -1);
      else object.visible = data.detailRadius * pixels > (object.visible ? 1.25 : 1.8);
    }
  }

  _presentationTick(dt) {
    const p = this.presentation; if (!p) return;
    p.t += dt; p.ack += dt;
    const b = this.bones, r = this.right, f = this.forward;
    // Long rests between small actions; minimum-jerk pulses have zero velocity
    // at both ends. Six offset personalities never move in mechanical unison.
    const period = 12 + p.personality * 0.9, u = (p.t % period) / period;
    const pulse = (a, z) => u < a || u > z ? 0 : Math.pow(Math.sin(Math.PI * (u - a) / (z - a)), 4);
    const shift = Math.sin(p.t * 0.33) * 0.014;
    const glance = pulse(0.34, 0.62) * (p.personality % 2 ? -1 : 1);
    const loosen = pulse(0.72, 0.94);
    const nod = p.ack < 1.3 ? Math.pow(Math.sin(Math.PI * p.ack / 1.3), 4) : 0;
    this._rot(b.spine, f, shift);
    this._rot(b.spine1, f, -shift * 0.6);
    this._rot(b.neck, UP, glance * 0.08);
    this._rot(b.head, UP, glance * 0.13);
    this._rot(b.head, r, nod * 0.12);
    // Small, distinct upper-body beats, separated by many seconds of rest.
    // Feet and lower body keep the same support pose throughout each action.
    switch (p.personality) {
      case 0: // thunder: a compact readying of the right arm
        this._rot(b.armR, r, loosen * 0.12); this._rot(b.foreR, r, loosen * 0.38); break;
      case 1: // blaze: a confident hand towards the hip
        this._rot(b.armR, f, -loosen * 0.22); this._rot(b.foreR, f, -loosen * 0.5); break;
      case 2: // frost: a composed downward glance, hands easing back
        this._rot(b.head, r, loosen * 0.08); this._rot(b.armL, r, -loosen * 0.09); this._rot(b.armR, r, -loosen * 0.09); break;
      case 3: // gale: loosen one shoulder
        this._rot(b.armL, f, loosen * 0.18); this._rot(b.armL, r, loosen * 0.2); this._rot(b.foreL, r, loosen * 0.25); break;
      case 4: // phantom: a quiet, thoughtful hand to the chest
        this._rot(b.armR, r, loosen * 0.3); this._rot(b.foreR, r, loosen * 0.7); this._rot(b.head, f, loosen * 0.04); break;
      case 5: // cannon: settle both elbows into a compact athletic pose
        for (const s of ['L', 'R']) { this._rot(b['arm' + s], r, loosen * 0.1); this._rot(b['fore' + s], r, loosen * 0.35); } break;
    }
  }

  // rotate a bone by `angle` around a world-space axis, keeping its hierarchy
  _rot(bone, axis, angle) {
    if (!bone || Math.abs(angle) < 1e-5) return;
    bone.parent.getWorldQuaternion(this._qp);
    this._ax.copy(axis).applyQuaternion(this._qp.invert()).normalize();
    this._qa.setFromAxisAngle(this._ax, angle);
    bone.quaternion.premultiply(this._qa);
  }

  /**
   * Small things that make a body feel alive:
   *  - breathing in the chest, quick and deep when tired; hands on knees, mouth open, when spent and standing
   *  - eyes that lead the head towards the ball (the head only follows part of the way)
   *  - relaxed hands at rest that close into fists when running hard or celebrating
   *  - feet that never sink into the grass: a crouch bends the knees instead
   */
  _details(dt, speed, fatigue, ch, yaw, pitch) {
    const b = this.bones, r = this.right, f = this.forward;
    // -- breathing and fatigue
    this.fatigue += (fatigue - this.fatigue) * (1 - Math.exp(-dt * 2));
    const fat = this.fatigue;
    this.breath += dt * (1.6 + fat * 4.2 + Math.min(speed, 7) * 0.25);
    const still = clamp(1 - speed / 1.4, 0, 1), busy = this.gestures.length > 0 || this._wu > 0.05;
    const tiredW = clamp((fat - 0.55) / 0.35, 0, 1) * still * (busy ? 0 : 1);
    this.tired += (tiredW - this.tired) * (1 - Math.exp(-dt * 3));
    const amp = 0.012 + fat * 0.035 + this.tired * 0.03;
    const inhale = Math.sin(this.breath);
    this._rot(b.spine2 || b.spine1, r, -amp * inhale);
    this._rot(b.armL, f, amp * 0.6 * inhale); this._rot(b.armR, f, -amp * 0.6 * inhale);   // shoulders rise with it
    const tw = this.tired;
    if (tw > 0.01) {
      this._rot(b.spine1, r, -0.5 * tw); this._rot(b.spine, r, -0.3 * tw);                  // bent over…
      this._rot(b.armL, r, 0.3 * tw); this._rot(b.armR, r, 0.3 * tw);                       // …hands down on the knees
      this._rot(b.foreL, f, 0.2 * tw); this._rot(b.foreR, f, -0.2 * tw);
      this._rot(b.head, r, 0.45 * tw);                                                      // head up, looking at the play
      this.root.position.y -= 0.12 * tw;                                                    // knees give (the feet stay planted)
    }
    // -- shielding the ball: shoulder and arm into the marker (shield > 0: he's on my right), knees bent, low
    const sw = this.shieldW || 0;
    if (Math.abs(sw) > 0.01) {
      this._rot(b.spine1, f, 0.16 * sw); this._rot(b.spine, f, 0.08 * sw);
      this._rot(sw > 0 ? b.armR : b.armL, f, (sw > 0 ? -1 : 1) * 0.55 * Math.abs(sw));
      this._rot(b.spine1, r, -0.12 * Math.abs(sw));
      this.root.position.y -= 0.05 * Math.abs(sw);
    }
    this._faceBusyT = Math.max(0, (this._faceBusyT || 0) - dt);
    if (!(this._faceBusyT > 0) && this.expr) this.expr.set('aa', Math.max(0, fat - 0.4) * (0.35 + 0.35 * (inhale * 0.5 + 0.5)));
    if (this.expr && !this.expr.emoting) {
      const nearBall = this.lookTarget && this.lookTarget.distanceToSquared(this.group.position) < 12;
      this.expr.set('relaxed', this.presentation ? 0.12 : speed < 0.5 && !nearBall ? 0.035 : 0);
      this.expr.set('angry', !this.presentation && nearBall && (this.dribbling || this.windup > 0.05) ? 0.12 : 0);
    }
    // -- eyes: they get there first and go further than the head
    if (this._eyes.length) {
      const ey = clamp(yaw - this.look.yaw * 0.9, -0.35, 0.35) * 0.7 + Math.sin(this.breath * 0.37) * 0.02;
      const ep = clamp(pitch - this.look.pitch * 0.8, -0.25, 0.25) * 0.6;
      this._eyeY = (this._eyeY || 0) + (ey - (this._eyeY || 0)) * (1 - Math.exp(-dt * 18));
      this._eyeP = (this._eyeP || 0) + (ep - (this._eyeP || 0)) * (1 - Math.exp(-dt * 18));
      for (const e of this._eyes) { e.bn.quaternion.copy(e.rest); this._rot(e.bn, UP, this._eyeY * (this.expr?.lookWeight ?? 1)); this._rot(e.bn, r, -this._eyeP * (this.expr?.lookWeight ?? 1)); }
    }
    // -- hands: loose at rest, fists when sprinting or celebrating
    const celebrating = this.gestures.some((g) => (g.name === 'celebrate' || g.name === 'fistPump' || g.name === 'roar') && !g.stopping);
    const want = celebrating ? 1.05 : 0.22 + clamp((speed - 2.5) / 3.5, 0, 1) * 0.7;
    this.curl += (want - this.curl) * (1 - Math.exp(-dt * 8));
    for (const fg of this._fingers) { fg.bn.quaternion.copy(fg.rest); this._qa.setFromAxisAngle(fg.axis, fg.sign * this.curl * fg.k * 1.1); fg.bn.quaternion.multiply(this._qa); }
    // -- feet stay on the grass
    const kc = this.kickCalib, airborne = (ch.hop || 0) > 0.02 || this.airY > 0.02 || this.tumble;
    if (kc && !airborne) {
      this.group.updateMatrixWorld(true);
      for (const [up, leg, foot, s] of [[b.upLegR, b.legR, b.footR, 'R'], [b.upLegL, b.legL, b.footL, 'L']]) {
        if (!foot || this.ik[s].w > 0.3) continue;
        foot.getWorldPosition(_f);
        const floor = kc.ankleHeight * 0.9 * this.group.scale.y;
        if (_f.y < floor - 0.005) { _f.y = floor; this._legIK(up, leg, foot, _f, 1); }
      }
    }
  }

  /** analytic two-bone IK: move the ankle towards `target` with weight w */
  _legIK(up, low, foot, target, w) {
    if (w <= 0.001) return;
    up.updateWorldMatrix(true, true);
    const H = up.getWorldPosition(_a), K = low.getWorldPosition(_b), A = foot.getWorldPosition(_c);
    const T = _d.copy(A).lerp(target, clamp(w, 0, 1));
    const l1 = H.distanceTo(K), l2 = K.distanceTo(A);
    const dT = clamp(H.distanceTo(T), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
    // 1) knee: set the interior angle for the required hip-to-ankle distance
    const kh = _e.copy(H).sub(K), ka = A.clone().sub(K);
    const cur = kh.angleTo(ka);
    const want = Math.acos(clamp((l1 * l1 + l2 * l2 - dT * dT) / (2 * l1 * l2), -1, 1));
    let n = new THREE.Vector3().crossVectors(ka, kh);
    if (n.lengthSq() < 1e-8) n.copy(this.right); else n.normalize();
    const delta = want - cur;
    // pick the rotation direction that opens/closes the knee the right way
    const test = ka.clone().applyAxisAngle(n, delta);
    const sgn = Math.abs(kh.angleTo(test) - want) < Math.abs(kh.angleTo(ka.clone().applyAxisAngle(n, -delta)) - want) ? 1 : -1;
    this._rot(low, n, sgn * delta);
    low.updateMatrixWorld(true);
    // 2) hip: swing the whole leg so the ankle points at the target
    const A2 = foot.getWorldPosition(new THREE.Vector3());
    const from = A2.sub(H).normalize(), to = T.clone().sub(H).normalize();
    const axis = new THREE.Vector3().crossVectors(from, to);
    const s = axis.length();
    if (s > 1e-6) { this._rot(up, axis.divideScalar(s), Math.atan2(s, from.dot(to))); up.updateMatrixWorld(true); }
  }

  update(dt, { speed = 0, turnRate = 0, fatigue = 0, shield = 0, vf = null, vr = 0 } = {}) {
    this.shieldW = (this.shieldW || 0) + (shield - (this.shieldW || 0)) * (1 - Math.exp(-dt * 6));
    this._styleTick?.(dt);
    this.speed = speed;
    // --- locomotion blend with phase sync -----------------------------------
    const nat = this.natural || { walk: 1.5, run: 3.4 };
    void nat;
    const idleTarget = clamp(1 - speed / 0.55, 0, 1);
    this._idleW = (this._idleW ?? idleTarget) + (idleTarget - (this._idleW ?? idleTarget)) * (1 - Math.exp(-dt * 14));
    const wIdle = this._idleW;
    // direction of travel relative to the body: 0 ahead, +π/2 to the right, π straight back
    if (vf === null) vf = speed;
    let th = speed > 0.05 ? Math.atan2(vr, vf) : 0;
    if (speed > 3.8) th *= clamp(1 - (speed - 3.8) / 2.5, 0.35, 1);       // flat out, the legs run where the body points
    this._th = wrapAngle((this._th ?? th) + wrapAngle(th - (this._th ?? th)) * (1 - Math.exp(-dt * 14)));
    th = this._th;
    const LW = this.locoW, LO = this.loco;
    for (const k in LW) LW[k] = 0;
    // eight-way: the two sectors either side of the heading, 45° apart
    const side = th >= 0 ? ['F', 'FR', 'R', 'BR', 'B'] : ['F', 'FL', 'L', 'BL', 'B'];
    const u = Math.min(4, Math.abs(th) / (Math.PI / 4)), i0 = Math.floor(u), fr = u - i0;
    const secW = { [side[i0]]: 1 - fr }; if (fr > 0) secW[side[Math.min(4, i0 + 1)]] = (secW[side[Math.min(4, i0 + 1)]] || 0) + fr;
    let fwdShare = secW.F || 0;
    for (const k in secW) if (k !== 'F' && !LO.dir[k]) fwdShare += secW[k];   // a missing direction falls back on the forward gaits
    const move = 1 - wIdle;
    let stride = 0;
    // forward gaits by speed
    const F = LO.fwd;
    let j = 0; while (j < F.length - 1 && speed > F[j + 1].s) j++;
    const lo = F[j], hi = F[Math.min(F.length - 1, j + 1)];
    const t = hi === lo ? 0 : clamp((speed - lo.s) / (hi.s - lo.s), 0, 1);
    for (const e of F) {
      const w = e === lo ? (speed <= lo.s && j === 0 ? 1 : 1 - t) : e === hi ? t : 0;
      LW[e.n] = w * fwdShare * move;
      stride += w * fwdShare * e.len * (e === F[F.length - 1] ? 1 + 0.18 * clamp((speed - e.s) / 2, 0, 1) : 1);
    }
    for (const k in LO.dir) { const w = (secW[k] || 0); LW[LO.dir[k].n] = w * move; stride += w * LO.dir[k].len; }
    // carrying the ball at a jog: the dribbling jog takes over the forward gaits
    const DR = LO.drib;
    if (DR) {
      const want = this.dribbling ? clamp((speed - 1.1) / 0.8, 0, 1) * clamp((4.3 - speed) / 0.8, 0, 1) : 0;
      this._dribW += (want - this._dribW) * (1 - Math.exp(-dt * 6));
      const w = this._dribW * fwdShare;
      if (w > 0.001) {
        for (const e of F) { stride -= (LW[e.n] / Math.max(move, 1e-4)) * (this._dribW) * e.len; LW[e.n] *= 1 - this._dribW; }
        LW[DR.n] = w * move; stride += w * DR.len;
      } else LW[DR.n] = 0;
    }
    // Close-control capture blends into the faster dribbling jog by speed.
    const close = LO.closeDrib;
    if (close) {
      const want = this.dribbling ? clamp((2.7 - speed) / 1.0, 0, 1) * clamp(speed / 0.7, 0, 1) : 0;
      this._closeW += (want - this._closeW) * (1 - Math.exp(-dt * 7));
      for (const e of [...F, ...(DR ? [DR] : [])]) LW[e.n] *= 1 - this._closeW;
      LW[close.n] = this._closeW * fwdShare * move;
      stride = stride * (1 - this._closeW * fwdShare) + close.len * this._closeW * fwdShare;
    }
    // The authored faster control take gives sprint dribbling its own posture,
    // with the measured foot-contact phase shared by the lower-speed takes.
    const fast = LO.fastDrib;
    if (fast) {
      const want = this.dribbling ? smooth(clamp((speed - 3.0) / 2.0, 0, 1)) : 0;
      this._fastDribW += (want - this._fastDribW) * (1 - Math.exp(-dt * 8));
      for (const e of [...F, DR, close]) if (e) LW[e.n] *= 1 - this._fastDribW;
      const w = this._fastDribW * fwdShare;
      LW[fast.n] = w * move; stride = stride * (1 - w) + fast.len * w;
    }
    // a keeper shuffles sideways in his crouch instead of jogging
    const GK = LO.gk;
    if (GK) {
      this._gkW += ((this.keeper ? 1 : 0) - this._gkW) * (1 - Math.exp(-dt * 5));
      for (const k of ['L', 'R']) {
        const d = LO.dir[k], e = GK[k], w = (secW[k] || 0) * this._gkW;
        if (!e) continue;
        if (d) { LW[d.n] *= 1 - this._gkW; stride -= w * d.len; }
        LW[e.n] = w * move; stride += w * e.len * clamp(speed / 2.2, 0.6, 1.6);
      }
    }
    // the jog clips are a jog: run them quicker (more steps), not longer, when the player goes faster sideways
    stride = Math.max(0.35, stride);
    this._stride = (this._stride ?? stride) + (stride - (this._stride ?? stride)) * (1 - Math.exp(-dt * 10));
    const ph = this.phase + (dt * Math.max(speed, 0)) / this._stride;
    if (ph >= 1) this.cycN += Math.floor(ph);
    this.phase = ph % 1;
    // motion capture one-shot: its envelope weight takes over from the locomotion clips
    let MW = 0, rootYaw = 0;
    if (this.mocap) {
      let m = this.mocap;
      m.t += dt;
      if (m.t >= m.dur) {
        if (m.next) { this.playMocap(m.next.name, { fadeIn: 0.15, ...m.next }); m = this.mocap; m.t = dt; }
        else { m.a.stop(); this.mocap = null; m = null; }
      }
      if (m) {
        const fin = Math.min(1, m.t / Math.max(1e-3, m.fi)), out = clamp((m.dur - m.t) / Math.max(1e-3, m.fo), 0, 1);
        const wn = smooth(fin) * smooth(out);
        m.a.time = Math.min(m.to, m.from + Math.min(m.t, m.run) * m.ts);
        m.a.setEffectiveWeight(wn);
        MW = wn;
        // a turn: the body comes round with the clip's own timing, from where it was facing when it started
        if (m.yaw) rootYaw = wrapAngle(m.f0 + yawAt(m.yaw, m.a.time) - m.y0 - this.group.rotation.y) * wn;
        // the clip it cut in on fades out underneath it (frozen on its last pose) instead of popping
        const pv = this._mprev;
        if (pv) {
          const wp = pv.w * (1 - smooth(fin));
          if (wp <= 0.001) { if (pv.a !== m.a) pv.a.stop(); this._mprev = null; }
          else { pv.a.setEffectiveWeight(wp); MW += wp; }
        }
      }
    }
    if (!this.mocap && this._mprev) { this._mprev.a.stop(); this._mprev = null; }
    this.mocapW = MW;
    this._rootYaw = rootYaw; this.root.rotation.y = rootYaw;
    const MO = MW * (this.mocap?.over ?? 1), keep = 1 - MO;   // how much of the hand-made layers survive
    // a different standing pose (a keeper set on his toes) shares the idle slot
    const i2 = this.actions.idle2;
    if (i2) {
      this._i2w += ((this._i2on ? 1 : 0) - this._i2w) * (1 - Math.exp(-dt * 5));
      i2.setEffectiveWeight(wIdle * this._i2w * (1 - MW));
      if (this._i2w < 0.002 && !this._i2on) { i2.stop(); this.actions.idle2 = null; }
    }
    let previousIdleWeight = 0;
    if (this._idlePrevious) {
      const previous = this._idlePrevious;
      previous.w *= Math.exp(-dt * 5);
      previousIdleWeight = Math.min(previous.w, 1 - (i2 ? this._i2w : 0));
      previous.a.setEffectiveWeight(wIdle * previousIdleWeight * (1 - MW));
      if (previous.w < 0.002) { previous.a.stop(); this._idlePrevious = null; }
    }
    const iw = Math.max(0, (i2 ? 1 - this._i2w : 1) - previousIdleWeight);
    this.actions.idle.setEffectiveWeight(wIdle * iw * (1 - MW));
    let movingWeight = 0;
    for (const e of this._locoEntries) {
      const old = this._locoBlendW[e.n] || 0;
      this._locoBlendW[e.n] = old + ((LW[e.n] || 0) - old) * (1 - Math.exp(-dt * 14));
      movingWeight += this._locoBlendW[e.n];
    }
    for (const e of this._locoEntries) {
      e.a.setEffectiveWeight(movingWeight > 1e-6 ? this._locoBlendW[e.n] / movingWeight * move * (1 - MW) : 0);
      e.a.time = (((((this.cycN % e.cy) + this.phase) / e.cy) + e.po) % 1) * e.d;
    }
    for (const k in this.emoteWeights) {
      this.emoteWeights[k] += (this.emoteTargets[k] - this.emoteWeights[k]) * (1 - Math.exp(-dt * 4));
      this.actions[k]?.setEffectiveWeight(this.emoteWeights[k]);
    }
    // PropertyMixer skips writes for unchanged keyframes. Restore last frame's
    // *unlayered* pose first, otherwise breathing/IK/head rotations accumulate
    // on static channels until a changing keyframe suddenly snaps them back.
    (this._animationPose ||= new AnimationPose()).sample(this.root, this.mixer, dt);
    this.root.position.y = 0;
    // sprinting is not just running faster: higher knees, a longer stride, arms pumping hard, body further over
    // the ball — the run clip's limb swing is exaggerated away from the bind pose by up to ~35%
    this._sprintW += (clamp((speed - 4.4) / 1.3, 0, 1) - this._sprintW) * (1 - Math.exp(-dt * 6));
    if (this._sprintW * keep > 0.01) {
      const k = 1 + (this.loco.fwd.length > 2 ? 0.12 : 0.35) * this._sprintW * keep, qi = this._qp, qr = this._qa;
      for (const { bn, q } of this._bindQ) {
        qi.copy(q).invert(); qr.copy(qi).multiply(bn.quaternion);          // the clip's rotation relative to bind
        const w = clamp(qr.w, -1, 1), ang = 2 * Math.acos(Math.abs(w)), sgn = w < 0 ? -1 : 1;
        if (ang < 1e-4) continue;
        const sn = Math.sin(ang / 2), na = Math.min(ang * k, 2.6);
        const ns = Math.sin(na / 2) / sn;
        qr.set(qr.x * sgn * ns, qr.y * sgn * ns, qr.z * sgn * ns, Math.cos(na / 2));
        bn.quaternion.copy(q).multiply(qr);
      }
    }
    this.group.updateMatrixWorld(true);

    // --- procedural layers ----------------------------------------------------
    const f = this.forward, r = this.right, b = this.bones;
    this.turnVel += (turnRate - this.turnVel) * (1 - Math.exp(-dt * 8));
    // lean with speed, plus into acceleration (forward) and against braking (back)
    if (dt > 0) {
      const acc = (speed - this._prevSpeed) / dt;
      this.accel += (clamp(acc, -30, 30) - this.accel) * (1 - Math.exp(-dt * 10));
    }
    this._prevSpeed = speed;
    const lean = clamp(speed / 7, 0, 1) * 0.16 + clamp(this.accel * 0.012, -0.16, 0.12) + 0.1 * (this._sprintW || 0);
    this._lean += (lean - this._lean) * (1 - Math.exp(-dt * 12));
    this._rot(b.spine, r, -this._lean * keep);
    this._rot(b.hips, f, clamp(-this.turnVel * speed * 0.012, -0.18, 0.18) * keep);
    // a looser run: shoulders counter-rotate against the hips, the pelvis drops side to side, the body
    // bobs on each stride and banks into turns, while the head stays steady on the play
    {
      const rw = clamp((speed - 1) / 4, 0, 1) * keep * (this.loco.fwd.length > 2 ? 0.35 : 1), ph = this.phase * Math.PI * 2;
      if (rw > 0.01) {
        this._rot(b.spine2 || b.spine1, UP, Math.sin(ph) * 0.09 * rw);
        this._rot(b.hips, UP, -Math.sin(ph) * 0.06 * rw);
        this._rot(b.hips, f, Math.cos(ph) * 0.035 * rw);
        this._rot(b.head, UP, -Math.sin(ph) * 0.05 * rw);
        this.root.position.y += (Math.abs(Math.cos(ph)) - 0.6) * 0.03 * rw;
      }
      this._bank = (this._bank || 0) + (clamp(this.turnVel * speed * 0.014, -0.2, 0.2) - (this._bank || 0)) * (1 - Math.exp(-dt * 8));
      this._rot(b.spine1, f, -this._bank * keep);
    }

    const ch = {};
    for (const g of this.gestures) {
      g.advance(dt);
      const w = g.weight * (g.silent ? 0 : g.mocap ? keep : 1);
      for (const key in g.keys) ch[key] = (ch[key] || 0) + g.sample(key) * w;
      ch._side = g.side || ch._side;
    }
    this.gestures = this.gestures.filter((g) => !g.done);
    const R = ch._side !== 'Left';
    const kick = R ? { up: b.upLegR, leg: b.legR, foot: b.footR } : { up: b.upLegL, leg: b.legL, foot: b.footL };
    const sup = R ? { up: b.upLegL, leg: b.legL, foot: b.footL } : { up: b.upLegR, leg: b.legR, foot: b.footR };
    const mir = R ? 1 : -1;
    if (ch.drop) this.root.position.y = ch.drop;
    if (ch.hop) this.root.position.y += ch.hop;
    // flying through the air after a big hit: lifted and tumbling round the waist
    const tb = this.tumble || 0;
    this.root.rotation.x = tb;
    this.root.position.z = tb ? -0.9 * Math.sin(tb) : 0;
    if (tb) this.root.position.y += 0.9 - 0.9 * Math.cos(tb);
    this.root.position.y += this.airY || 0;
    this._rot(b.hips, r, ch.body || 0);
    this._rot(b.hips, f, -(ch.roll || 0) * (ch._side === 'Left' ? -1 : 1));
    this._rot(b.spine1, r, -(ch.lean || 0));
    this._rot(b.spine, UP, (ch.twist || 0) * mir * 0.5);
    this._rot(b.spine2 || b.spine1, UP, (ch.twist || 0) * mir * 0.5);
    this._rot(kick.up, r, ch.thigh || 0);
    this._rot(kick.leg, r, -(ch.knee || 0));
    this._rot(kick.foot, r, -(ch.foot || 0));
    this._rot(kick.up, f, -(ch.legOut || 0) * mir);
    this._rot(kick.foot, UP, -(ch.footTurn || 0) * mir);
    this._rot(sup.up, r, ch.supThigh || 0);
    this._rot(sup.leg, r, -(ch.supKnee || 0));
    this._rot(sup.foot, r, (ch.supKnee || 0) - (ch.supThigh || 0));
    const armL = R ? 'armOutL' : 'armOutR', armR = R ? 'armOutR' : 'armOutL';
    this._rot(b.armL, f, ch[armL] || 0);
    this._rot(b.armR, f, -(ch[armR] || 0));
    this._rot(b.armL, r, ch[R ? 'armFwdL' : 'armFwdR'] || 0);
    this._rot(b.armR, r, ch[R ? 'armFwdR' : 'armFwdL'] || 0);
    this._rot(b.foreL, f, ch.elbowL || 0);
    this._rot(b.foreR, f, -(ch.elbowR || 0));
    // wind-up while charging: torso turns away and leans back a touch, arms open, and
    // (when not running) the striking leg cocks back; it fades as the strike takes over
    this._wu += ((ch.thigh === undefined ? this.windup : 0) - this._wu) * (1 - Math.exp(-dt * 12));
    const wu = this._wu * keep;
    if (wu > 0.01) {
      const still = clamp(1 - speed / 3.2, 0, 1);
      this._rot(b.spine1, r, 0.07 * wu);
      this._rot(b.spine, UP, -0.22 * wu);
      this._rot(b.armL, f, 0.55 * wu);
      this._rot(b.armR, f, -0.25 * wu);
      this._rot(b.upLegR, r, -0.38 * wu * still);
      this._rot(b.legR, r, -0.7 * wu * still);
      this._rot(b.upLegL, r, 0.1 * wu * still);
      this._rot(b.legL, r, -0.22 * wu * still);
      this.root.position.y += -0.03 * wu * still;
    }
    this.group.updateMatrixWorld(true);

    if (this._recoil) {
      const recoil = this._recoil; recoil.t += dt;
      const response = recoil.amp * (1 - Math.exp(-recoil.t * 80)) * Math.exp(-recoil.t * 10);
      this._rot(b.spine1, r, recoil.n.dot(f) * response);
      this._rot(b.spine1, f, -recoil.n.dot(r) * response);
      this.group.updateMatrixWorld(true);
      if (recoil.t > 0.4) this._recoil = null;
    }
    // planted feet stay planted: a foot that lands is pinned to that spot on the turf until it lifts, so
    // blends between gaits, turns and speed changes never skate it (the ball IK below still wins)
    this._footLock(dt, MW);
    // feet reach for the ball (kick contact, touches, sole traps)
    this._legIK(b.upLegR, b.legR, b.footR, this.ik.R.target, this.ik.R.w);
    this._legIK(b.upLegL, b.legL, b.footL, this.ik.L.target, this.ik.L.w);
    if (this.ik.R.sole) this._rot(b.footR, r, this.ik.R.sole);
    if (this.ik.L.sole) this._rot(b.footL, r, this.ik.L.sole);
    // hands reach for the ball (a goalkeeper's gloves): the same two-bone solve, shoulder → elbow → wrist
    if (this.armIK.R.w > 0.01 && b.foreR && b.handR) this._legIK(b.armR, b.foreR, b.handR, this.armIK.R.target, this.armIK.R.w);
    if (this.armIK.L.w > 0.01 && b.foreL && b.handL) this._legIK(b.armL, b.foreL, b.handL, this.armIK.L.target, this.armIK.L.w);

    // head tracks the ball
    let yaw = 0, pitch = 0;
    const emoting = this.gestures.some((g) => (g.name === 'deject' || g.name === 'celebrate') && !g.stopping);
    if (this.lookTarget && !emoting) {
      b.head.getWorldPosition(this._v);
      const dx = this.lookTarget.x - this._v.x, dz = this.lookTarget.z - this._v.z, dy = this.lookTarget.y - this._v.y;
      const raw = Math.atan2(f.z * dx - f.x * dz, f.x * dx + f.z * dz);
      // past ~70° the head stops following and eases back to the front, so a ball
      // passing behind never makes it flick from one shoulder to the other
      const a = Math.abs(raw);
      yaw = Math.sign(raw) * Math.min(a, 1.2) * clamp((2.7 - a) / 1.3, 0, 1);
      pitch = clamp(Math.atan2(-dy, Math.hypot(dx, dz)), -0.5, 0.75);
    }
    // smooth, speed-limited head turn
    const k = (1 - Math.exp(-dt * 5)), maxStep = 4 * dt;
    this.look.yaw += clamp((yaw - this.look.yaw) * k, -maxStep, maxStep);
    this.look.pitch += clamp((pitch - this.look.pitch) * k, -maxStep, maxStep);
    const lk = 1 - 0.7 * MO;
    this._rot(b.neck, UP, this.look.yaw * 0.45 * lk); this._rot(b.head, UP, this.look.yaw * 0.45 * lk);
    this._rot(b.neck, r, -this.look.pitch * 0.4 * lk); this._rot(b.head, r, -this.look.pitch * 0.4 * lk + (ch.headUp || 0));
    this._details(dt, speed, fatigue, ch, yaw, pitch);
    this._presentationTick(dt);

    this.group.updateMatrixWorld(true);
    this.constraints?.update();
    this.springs?.update(dt);
    this.expr?.update(dt);
    this.elementAura?.update(dt);
  }
}
