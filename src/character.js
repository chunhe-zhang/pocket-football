import * as THREE from 'three';
import { clone as cloneSkinned } from '../vendor/three/addons/utils/SkeletonUtils.js';
import { ANIM } from './config.js';

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
  drop:    [[0, 0], [c - 0.3, -0.12], [c - 0.15, 0], [1, 0]],
  hop:     [[0, 0], [c - 0.22, 0.06], [c, 0.42], [c + 0.2, 0.26], [0.86, 0.02], [1, 0]],
  lean:    [[0, 0], [c - 0.22, -0.28], [c, 0.36], [c + 0.2, 0.15], [1, 0]],
  headUp:  [[0, 0], [c - 0.2, 0.42], [c, -0.32], [1, 0]],
  knee:    [[0, 0], [c - 0.25, 0.6], [c, 0.95], [c + 0.25, 0.4], [1, 0]],
  supKnee: [[0, 0], [c - 0.25, 0.6], [c, 0.85], [c + 0.25, 0.35], [1, 0]],
  thigh:   [[0, 0], [c, 0.45], [1, 0]],
  supThigh:[[0, 0], [c, 0.35], [1, 0]],
  armOutL: [[0, 0], [c - 0.15, 1.15], [c, 0.9], [1, 0]],
  armOutR: [[0, 0], [c - 0.15, 1.15], [c, 0.9], [1, 0]],
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

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();

export class Character {
  /**
   * @param {AvatarTemplate} template shared model + retargeted animation
   * @param {object} kit team colours for the shirt / shorts / hair
   */
  constructor(template, kit) {
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

    this._qa = new THREE.Quaternion(); this._qp = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._ax = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, 1); this.right = new THREE.Vector3(-1, 0, 0);
    this.setFacing(0);

    // measure the clips on *this* skeleton (legs differ between models)
    const cache = template._measure || (template._measure = {});
    if (!cache.natural) {
      cache.phaseOffset = { walk: this._contactPhase(this.clips.walk), run: this._contactPhase(this.clips.run) };
      cache.natural = { walk: this._stanceSpeed(this.clips.walk), run: this._stanceSpeed(this.clips.run) };
      cache.kick = this._calibrateKick();
    }
    this.phaseOffset = cache.phaseOffset;
    this.natural = cache.natural;
    this.kickCalib = cache.kick;
  }

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
      case 'dive': g = new Gesture('dive', opts.duration ?? 1.15, DIVE, { fadeIn: 0.03, fadeOut: 0.15, ...opts }); break;
    }
    const LEG = ['kick', 'chip', 'pass', 'poke', 'stepover', 'drag', 'dragback', 'sidestep', 'jumpHeader', 'touch', 'trap', 'slide', 'stagger', 'trapFoot', 'trapThigh', 'trapChest', 'header', 'dive'];
    if (LEG.includes(name)) this.gestures = this.gestures.filter((x) => !LEG.includes(x.name));
    else this.gestures = this.gestures.filter((x) => x.name !== name);
    this.gestures.push(g);
    if (name === 'celebrate') { this.face('happy', 1); }
    if (name === 'deject') { this.face('sad', 0.9); }
    return g;
  }

  face(name, w) { this.expr?.set(name, w); }

  stopEmotes() {
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

  teleported() { this.springs && (this.springs.needsReset = true); }

  // rotate a bone by `angle` around a world-space axis, keeping its hierarchy
  _rot(bone, axis, angle) {
    if (!bone || Math.abs(angle) < 1e-5) return;
    bone.parent.getWorldQuaternion(this._qp);
    this._ax.copy(axis).applyQuaternion(this._qp.invert()).normalize();
    this._qa.setFromAxisAngle(this._ax, angle);
    bone.quaternion.premultiply(this._qa);
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

  update(dt, { speed = 0, turnRate = 0 } = {}) {
    this.speed = speed;
    // --- locomotion blend with phase sync -----------------------------------
    const nat = this.natural || { walk: 1.5, run: 3.4 };
    const wIdle = clamp(1 - speed / 0.55, 0, 1);
    const wRun = clamp((speed - 1.9) / 1.3, 0, 1);
    const wWalk = (1 - wIdle) * (1 - wRun);
    const runW = (1 - wIdle) * wRun;
    const strideWalk = nat.walk * this.clips.walk.duration;
    const strideRun = nat.run * this.clips.run.duration * (1 + 0.22 * clamp((speed - 4) / 3, 0, 1));
    const stride = strideWalk + (strideRun - strideWalk) * wRun;
    this.phase = (this.phase + (dt * Math.max(speed, 0)) / stride) % 1;
    for (const [k, w] of [['idle', wIdle], ['walk', wWalk], ['run', runW]]) this.actions[k].setEffectiveWeight(w);
    const po = this.phaseOffset || { walk: 0, run: 0 };
    this.actions.walk.time = ((this.phase + po.walk) % 1) * this.clips.walk.duration;
    this.actions.run.time = ((this.phase + po.run) % 1) * this.clips.run.duration;
    for (const k in this.emoteWeights) {
      this.emoteWeights[k] += (this.emoteTargets[k] - this.emoteWeights[k]) * Math.min(1, dt * 4);
      this.actions[k]?.setEffectiveWeight(this.emoteWeights[k]);
    }
    this.mixer.update(dt);
    this.root.position.y = 0;
    this.group.updateMatrixWorld(true);

    // --- procedural layers ----------------------------------------------------
    const f = this.forward, r = this.right, b = this.bones;
    this.turnVel += (turnRate - this.turnVel) * Math.min(1, dt * 8);
    // lean with speed, plus into acceleration (forward) and against braking (back)
    if (dt > 0) {
      const acc = (speed - this._prevSpeed) / dt;
      this.accel += (clamp(acc, -30, 30) - this.accel) * Math.min(1, dt * 10);
    }
    this._prevSpeed = speed;
    const lean = clamp(speed / 7, 0, 1) * 0.16 + clamp(this.accel * 0.012, -0.16, 0.12);
    this._lean += (lean - this._lean) * Math.min(1, dt * 12);
    this._rot(b.spine, r, -this._lean);
    this._rot(b.hips, f, clamp(-this.turnVel * speed * 0.012, -0.18, 0.18));

    const ch = {};
    for (const g of this.gestures) {
      g.advance(dt);
      const w = g.weight;
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
    this._wu += ((ch.thigh === undefined ? this.windup : 0) - this._wu) * Math.min(1, dt * 12);
    const wu = this._wu;
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

    // feet reach for the ball (kick contact, touches, sole traps)
    this._legIK(b.upLegR, b.legR, b.footR, this.ik.R.target, this.ik.R.w);
    this._legIK(b.upLegL, b.legL, b.footL, this.ik.L.target, this.ik.L.w);
    if (this.ik.R.sole) this._rot(b.footR, r, this.ik.R.sole);
    if (this.ik.L.sole) this._rot(b.footL, r, this.ik.L.sole);

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
    const k = Math.min(1, dt * 5), maxStep = 4 * dt;
    this.look.yaw += clamp((yaw - this.look.yaw) * k, -maxStep, maxStep);
    this.look.pitch += clamp((pitch - this.look.pitch) * k, -maxStep, maxStep);
    this._rot(b.neck, UP, this.look.yaw * 0.45); this._rot(b.head, UP, this.look.yaw * 0.45);
    this._rot(b.neck, r, -this.look.pitch * 0.4); this._rot(b.head, r, -this.look.pitch * 0.4 + (ch.headUp || 0));

    this.group.updateMatrixWorld(true);
    this.constraints?.update();
    this.springs?.update(dt);
    this.expr?.update(dt);
  }
}
