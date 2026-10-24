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

const TOUCH = {
  thigh: [[0, 0], [0.35, 0.42], [0.6, 0.3], [1, 0]],
  knee:  [[0, 0], [0.25, 0.55], [0.45, 0.3], [1, 0]],
  foot:  [[0, 0], [0.4, -0.25], [1, 0]],
  armOutL:[[0, 0], [0.4, 0.25], [1, 0]],
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
  lean:    [[0, 0.3], [1, 0.3]],
  headUp:  [[0, -0.45], [1, -0.45]],
  armFwdL: [[0, -0.1], [1, -0.1]],
  armFwdR: [[0, -0.1], [1, -0.1]],
};

export class Character {
  /**
   * @param {object} gltf loaded X Bot gltf
   * @param {object} opts { color, accent }
   */
  constructor(gltf, { color = 0x2f7cf6, accent = 0xffffff } = {}) {
    this.group = new THREE.Group();
    this.root = cloneSkinned(gltf.scene);
    this.group.add(this.root);

    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        const src = Array.isArray(o.material) ? o.material : [o.material];
        const mats = src.map((m) => {
          const n = m.clone();
          const isJoint = /joint/i.test(m.name);
          n.color = new THREE.Color(isJoint ? accent : color);
          n.roughness = isJoint ? 0.35 : 0.42; n.metalness = isJoint ? 0.25 : 0.05;
          if (!isJoint) { n.emissive = new THREE.Color(color).multiplyScalar(0.06); }
          return n;
        });
        o.material = Array.isArray(o.material) ? mats : mats[0];
      }
    });

    // bones
    const B = (n) => this.root.getObjectByName('mixamorig' + n);
    this.bones = {
      hips: B('Hips'), spine: B('Spine'), spine1: B('Spine1'), spine2: B('Spine2'), neck: B('Neck'), head: B('Head'),
      upLegR: B('RightUpLeg'), legR: B('RightLeg'), footR: B('RightFoot'), toeR: B('RightToeBase'),
      upLegL: B('LeftUpLeg'), legL: B('LeftLeg'), footL: B('LeftFoot'), toeL: B('LeftToeBase'),
      armL: B('LeftArm'), foreL: B('LeftForeArm'), armR: B('RightArm'), foreR: B('RightForeArm'),
    };

    // animation
    this.mixer = new THREE.AnimationMixer(this.root);
    const clip = (n) => gltf.animations.find((a) => a.name === n);
    const strip = (c) => {
      // remove horizontal root motion: we drive the position from game physics
      const cc = c.clone();
      for (const tr of cc.tracks) {
        if (tr.name.endsWith('Hips.position')) {
          const v = tr.values, x0 = v[0], z0 = v[2];
          for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
        }
      }
      return cc;
    };
    this.clips = { idle: strip(clip('idle')), walk: strip(clip('walk')), run: strip(clip('run')) };
    this.actions = {};
    for (const [k, c] of Object.entries(this.clips)) {
      const a = this.mixer.clipAction(c); a.play(); a.setEffectiveWeight(k === 'idle' ? 1 : 0); a.timeScale = k === 'idle' ? 1 : 0;
      this.actions[k] = a;
    }
    // additive emotes from the same rig
    for (const n of ['sad_pose', 'headShake', 'agree']) {
      const c = clip(n); if (!c) continue;
      const add = THREE.AnimationUtils.makeClipAdditive(c.clone());
      const a = this.mixer.clipAction(add); a.blendMode = THREE.AdditiveAnimationBlendMode;
      a.setEffectiveWeight(0); a.play();
      this.actions[n] = a;
    }

    // measure where in each cycle the left foot plants, so walk and run blend in phase
    this.phaseOffset = { walk: this._contactPhase(this.clips.walk), run: this._contactPhase(this.clips.run) };
    this.phase = 0;
    this.speed = 0;
    this.gestures = [];
    this.look = { yaw: 0, pitch: 0 };
    this.lookTarget = null;
    this.turnVel = 0;
    this.emoteWeights = { sad_pose: 0, headShake: 0, agree: 0 };
    this.emoteTargets = { sad_pose: 0, headShake: 0, agree: 0 };

    this._qa = new THREE.Quaternion(); this._qp = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._ax = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, 1); this.right = new THREE.Vector3(-1, 0, 0);
  }

  _contactPhase(clip) {
    const m = new THREE.AnimationMixer(this.root);
    const a = m.clipAction(clip); a.play();
    const foot = this.bones.footL, N = 60, p = new THREE.Vector3();
    let best = 0, bestY = Infinity;
    for (let i = 0; i < N; i++) {
      m.setTime((i / N) * clip.duration); this.root.updateMatrixWorld(true);
      foot.getWorldPosition(p);
      if (p.y < bestY) { bestY = p.y; best = i / N; }
    }
    a.stop(); m.uncacheRoot(this.root);
    return best;
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
      case 'chip': g = new Gesture('chip', opts.duration ?? ANIM.kickDuration, CHIP(c), { ...opts, events: [{ name: 'contact', at: c }] }); break;
      case 'touch': g = new Gesture('touch', ANIM.touchDuration, TOUCH, { fadeIn: 0.04, fadeOut: 0.08, ...opts }); break;
      case 'trap': g = new Gesture('trap', 0.42, TRAP, { fadeIn: 0.05, fadeOut: 0.15, ...opts }); break;
      case 'celebrate': g = new Gesture('celebrate', 0.9, CELEBRATE, { loop: true, fadeIn: 0.2, fadeOut: 0.3, ...opts }); break;
      case 'deject': g = new Gesture('deject', 1, DEJECT, { loop: true, fadeIn: 0.4, fadeOut: 0.3, ...opts }); break;
    }
    // only one leg gesture at a time
    if (['kick', 'chip', 'touch', 'trap'].includes(name)) this.gestures = this.gestures.filter((x) => !['kick', 'chip', 'touch', 'trap'].includes(x.name));
    else this.gestures = this.gestures.filter((x) => x.name !== name);
    this.gestures.push(g);
    return g;
  }

  stopEmotes() {
    for (const g of this.gestures) if (g.loop) g.stop();
    for (const k in this.emoteTargets) this.emoteTargets[k] = 0;
  }

  emote(name, w = 1) { if (name in this.emoteTargets) this.emoteTargets[name] = w; }

  get busyLeg() { return this.gestures.some((g) => (g.name === 'kick' || g.name === 'chip') && !g.done); }

  /** world position of a foot (toe base gives the striking surface) */
  footPos(side = 'R', out = new THREE.Vector3()) {
    return (side === 'R' ? this.bones.toeR : this.bones.toeL).getWorldPosition(out);
  }

  // rotate a bone by `angle` around a world-space axis, keeping its hierarchy
  _rot(bone, axis, angle) {
    if (!bone || Math.abs(angle) < 1e-5) return;
    bone.parent.getWorldQuaternion(this._qp);
    this._ax.copy(axis).applyQuaternion(this._qp.invert()).normalize();
    this._qa.setFromAxisAngle(this._ax, angle);
    bone.quaternion.premultiply(this._qa);
  }

  update(dt, { speed = 0, turnRate = 0 } = {}) {
    this.speed = speed;
    // --- locomotion blend with phase sync -----------------------------------
    const wIdle = clamp(1 - speed / 0.55, 0, 1);
    const wRun = clamp((speed - 1.9) / 1.3, 0, 1);
    const wWalk = (1 - wIdle) * (1 - wRun);
    const runW = (1 - wIdle) * wRun;
    const strideWalk = ANIM.walkNatural * this.clips.walk.duration;
    const strideRun = ANIM.runNatural * this.clips.run.duration * (1 + 0.22 * clamp((speed - 4) / 3, 0, 1));
    const stride = strideWalk + (strideRun - strideWalk) * wRun;
    this.phase = (this.phase + (dt * Math.max(speed, 0)) / stride) % 1;
    for (const [k, w] of [['idle', wIdle], ['walk', wWalk], ['run', runW]]) this.actions[k].setEffectiveWeight(w);
    this.actions.walk.time = ((this.phase + this.phaseOffset.walk) % 1) * this.clips.walk.duration;
    this.actions.run.time = ((this.phase + this.phaseOffset.run) % 1) * this.clips.run.duration;
    for (const k in this.emoteWeights) {
      this.emoteWeights[k] += (this.emoteTargets[k] - this.emoteWeights[k]) * Math.min(1, dt * 4);
      this.actions[k]?.setEffectiveWeight(this.emoteWeights[k]);
    }
    this.mixer.update(dt);
    this.root.position.y = 0;
    this.group.updateMatrixWorld(true);

    // --- procedural layers ----------------------------------------------------
    const f = this.forward, r = this.right, b = this.bones;
    // speed lean + banking into turns
    this.turnVel += (turnRate - this.turnVel) * Math.min(1, dt * 8);
    const lean = clamp(speed / 7, 0, 1) * 0.16;
    this._rot(b.spine, r, -lean);
    this._rot(b.hips, f, clamp(-this.turnVel * speed * 0.012, -0.18, 0.18));

    // gestures
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
    this._rot(b.spine1, r, -(ch.lean || 0));
    this._rot(b.spine, UP, (ch.twist || 0) * mir * 0.5);
    this._rot(b.spine2, UP, (ch.twist || 0) * mir * 0.5);
    this._rot(kick.up, r, ch.thigh || 0);
    this._rot(kick.leg, r, -(ch.knee || 0));
    this._rot(kick.foot, r, -(ch.foot || 0));
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

    // head tracks the ball
    let yaw = 0, pitch = 0;
    if (this.lookTarget) {
      b.head.getWorldPosition(this._v);
      const dx = this.lookTarget.x - this._v.x, dz = this.lookTarget.z - this._v.z, dy = this.lookTarget.y - this._v.y;
      yaw = Math.atan2(f.z * dx - f.x * dz, f.x * dx + f.z * dz);
      pitch = Math.atan2(-dy, Math.hypot(dx, dz));
      yaw = clamp(yaw, -1.2, 1.2); pitch = clamp(pitch, -0.5, 0.75);
      if (Math.abs(yaw) > 1.15) yaw *= 0.5;
    }
    const k = Math.min(1, dt * 7);
    this.look.yaw += (yaw - this.look.yaw) * k; this.look.pitch += (pitch - this.look.pitch) * k;
    this._rot(b.neck, UP, this.look.yaw * 0.45); this._rot(b.head, UP, this.look.yaw * 0.45);
    this._rot(b.neck, r, -this.look.pitch * 0.4); this._rot(b.head, r, -this.look.pitch * 0.4 + (ch.headUp || 0));
  }
}
