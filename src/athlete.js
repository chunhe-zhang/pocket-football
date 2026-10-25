import * as THREE from 'three';
import { FIELD, PLAYER, ANIM, BALL, GOALS } from './config.js';

const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const R = BALL.r;

/**
 * Gameplay body of one footballer: movement, stamina, ball control, kicking.
 * Visuals are delegated to a Character; decisions come from an `intent`
 * filled in by a human Input or an AI controller.
 */
export class Athlete {
  constructor(game, team, character, label) {
    this.game = game; this.team = team; this.char = character; this.label = label;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.facing = 0; this.turnRate = 0;
    this.stamina = 1; this.exhausted = false;
    this.charging = false; this.charge = 0; this.chargeHold = 0; this.chargeType = 'kick';
    this.kick = null; this.touchCD = 0; this.frozen = false;
    this.intent = { move: new THREE.Vector2(), kick: false, lob: false, sprint: false };
    this.skill = 1;          // 0..1, lowers shot error (AI difficulty uses this)
    this.speedMul = 1;
    this.stats = { shots: 0, onTarget: 0, touches: 0 };
    this.lastTouchTime = -10;
    this.touch = null;       // scheduled dribble touch: the push happens when the boot arrives
    this.trapT = 0;          // sole trap in progress
    this.holdT = 0; this.holdW = 0; // standing with the foot on the ball
    this.nextFoot = 'Right';
    this.faceT = 0;
    this._fa = new THREE.Vector3(); this._fb = new THREE.Vector3();
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._f = new THREE.Vector3(); this._r = new THREE.Vector3();
  }

  get home() { return GOALS[this.team]; }                       // the goal I defend
  /** the goal mouth centres I can score in */
  get targets() { return GOALS.filter((g) => g.team !== this.team && this.game.activeGoal(g.team)); }
  get forward() { return this._f.set(Math.sin(this.facing), 0, Math.cos(this.facing)); }
  get rightDir() { return this._r.crossVectors(this.forward, UP); }
  // where the ball centre sits relative to the body when the boot meets it (measured from the rig)
  get reachF() { return this.char.kickCalib.forward + R * 0.85; }
  get reachS() { return this.char.kickCalib.side; }

  place(x, z, facing) {
    this.pos.set(x, 0, z); this.vel.set(0, 0, 0); this.facing = facing;
    this.kick = null; this.charging = false; this.charge = 0; this.touchCD = 0.2;
    this.touch = null; this.trapT = 0; this.holdT = 0; this.holdW = 0;
    this.char.gestures = this.char.gestures.filter((g) => g.loop);
    this.char.teleported();
    this._sync(0);
  }

  /** most attractive goal to shoot at: close, and its owner away from it */
  goalTarget() {
    let best = null, bestCost = Infinity;
    for (const g of this.targets) {
      const d = Math.hypot(g.centre.x - this.pos.x, g.centre.z - this.pos.z);
      const owner = this.game.athletes[g.team];
      const guard = owner ? Math.hypot(owner.pos.x - g.centre.x, owner.pos.z - g.centre.z) : 10;
      const cost = d - Math.min(guard, 8) * 0.6;
      if (cost < bestCost) { bestCost = cost; best = g; }
    }
    best = best || GOALS[(this.team + 1) % GOALS.length];
    return new THREE.Vector3(best.centre.x, 0, best.centre.z);
  }

  /** Direction the player wants to play the ball in. */
  aimDir(out = new THREE.Vector3()) {
    const m = this.intent.move;
    if (m.lengthSq() > 0.09) out.set(m.x, 0, m.y).normalize();
    else out.copy(this.goalTarget()).sub(this.pos).setY(0).normalize();
    return out;
  }

  update(dt) {
    const it = this.intent, g = this.game;
    this.touchCD = Math.max(0, this.touchCD - dt);

    // ---- charging / release ------------------------------------------------
    const held = it.kick || it.lob;
    if (this.frozen) { this.charging = false; this.charge = 0; }
    else if (!this.kick) {
      if (held && !this.charging) { this.charging = true; this.charge = 0; this.chargeHold = 0; this.chargeType = it.lob ? 'chip' : 'kick'; }
      if (this.charging) {
        if (it.lob) this.chargeType = 'chip';
        this.charge = Math.min(1, this.charge + dt / PLAYER.chargeTime);
        if (this.charge >= 1) this.chargeHold += dt;
        this.char.face('angry', 0.15 + 0.35 * this.charge);
        if (!held || this.chargeHold > PLAYER.chargeAutoRelease) { this.char.face('angry', 0); this._release(); }
      }
    }
    if (this.faceT > 0) { this.faceT -= dt; if (this.faceT <= 0) this.char.face('aa', 0); }
    this.trapT = Math.max(0, this.trapT - dt);

    // ---- movement ---------------------------------------------------------
    const ballPos = g.ball.pos;
    if (this.kick) this._kickMotion(dt);
    else {
      const mag = Math.min(1, it.move.length());
      let target = PLAYER.runSpeed;
      const wantsSprint = it.sprint && mag > 0.5 && !this.exhausted;
      if (wantsSprint) target = PLAYER.sprintSpeed;
      if (mag < 0.7) target = PLAYER.walkSpeed + (PLAYER.runSpeed - PLAYER.walkSpeed) * Math.max(0, (mag - 0.25) / 0.45);
      if (this.charging) target *= 0.55;
      if (this.frozen) target = 0;
      target *= this.speedMul;
      const desired = this._v.set(it.move.x, 0, it.move.y);
      if (mag > 0.05) desired.normalize().multiplyScalar(target * (mag < 0.25 ? mag / 0.25 : 1)); else desired.set(0, 0, 0);
      const dv = this._w.copy(desired).sub(this.vel);
      const a = (desired.lengthSq() > this.vel.lengthSq() ? PLAYER.accel : PLAYER.decel) * dt;
      if (dv.length() > a) dv.setLength(a);
      this.vel.add(dv);

      // stamina
      const sprinting = wantsSprint && this.vel.length() > PLAYER.runSpeed * 0.95;
      this.stamina = clamp(this.stamina + (sprinting ? -PLAYER.staminaDrain : PLAYER.staminaRegen) * dt, 0, 1);
      if (this.stamina <= 0.01) this.exhausted = true; else if (this.stamina > 0.3) this.exhausted = false;

      // facing
      let want = null;
      if (this.charging) { const d = this.aimDir(this._w); want = Math.atan2(d.x, d.z); }
      else if (this.vel.length() > 0.35) want = Math.atan2(this.vel.x, this.vel.z);
      else if (g.state === 'play' || g.state === 'kickoff') {
        // idle: face the ball
        const dx = ballPos.x - this.pos.x, dz = ballPos.z - this.pos.z;
        if (dx * dx + dz * dz > 0.3) want = Math.atan2(dx, dz);
      }
      this._turnTo(want, dt, this.charging ? 9 : PLAYER.turnRate);
      this.pos.addScaledVector(this.vel, dt);
    }

    // field bounds (players stay on the pitch, out of the goals)
    const lim = 0.28;
    if (Math.abs(this.pos.x) > FIELD.half - lim) { this.pos.x = Math.sign(this.pos.x) * (FIELD.half - lim); this.vel.x = 0; }
    if (Math.abs(this.pos.z) > FIELD.half - lim) { this.pos.z = Math.sign(this.pos.z) * (FIELD.half - lim); this.vel.z = 0; }

    this.char.lookTarget = ballPos;
    this._feet(dt);
    this._sync(dt);
  }

  /** leg IK requests: the boot actually goes to the ball */
  _feet(dt) {
    const ik = this.char.ik, ball = this.game.ball, f = this.forward, ankleH = this.char.kickCalib.ankleHeight;
    for (const s of ['R', 'L']) { ik[s].w = 0; ik[s].sole = 0; }
    const k = this.kick;
    if (k && !k.hit && k.approach) {
      const u = k.t / k.dur, c = ANIM.kickContact;
      if (u < c + 0.03) {
        ik.R.w = Math.exp(-(((u - c) / 0.085) ** 2)) * 0.85;
        ik.R.target.copy(ball.pos).addScaledVector(k.aim, -(R + 0.06));
        ik.R.target.y = clamp(ball.pos.y - R * 0.3, ankleH, 0.75);
      }
    }
    const t = this.touch;
    if (t) {
      const s = t.side === 'Left' ? 'L' : 'R';
      ik[s].w = Math.sin(Math.PI * clamp(t.t / t.dur, 0, 1)) * 0.85;
      ik[s].target.copy(ball.pos).addScaledVector(f, -(R + 0.04));
      ik[s].target.y = ankleH + 0.03;
    }
    // foot on top of the ball: sole traps and holding the ball while standing
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const bd = Math.hypot(ball.pos.x - this.pos.x, ball.pos.z - this.pos.z);
    const holding = ball.lastTouch === this && sp < 0.35 && bd < 0.85 && ball.groundSpeed < 0.8 && !this.kick && !this.charging && this.game.state === 'play';
    if (!this.puppet) {
      this.holdT = holding ? this.holdT + dt : 0;
      this.holdW = holding && this.holdT > 0.45 ? Math.min(1, this.holdW + dt * 4) : Math.max(0, this.holdW - dt * 9);
    }
    const sole = Math.max(this.trapT > 0 ? Math.sin(Math.PI * clamp(1 - this.trapT / 0.32, 0, 1)) : 0, this.holdW * 0.8);
    if (sole > 0.01) {
      ik.R.target.copy(ball.pos).addScaledVector(f, -0.04);
      ik.R.target.y = ball.pos.y + R + ankleH * 0.45;
      ik.R.w = Math.max(ik.R.w, sole); ik.R.sole = 0.28 * sole;
    }
  }

  _turnTo(want, dt, rate) {
    if (want === null) { this.turnRate *= 0.8; return; }
    const d = wrapAngle(want - this.facing);
    const step = clamp(d, -rate * dt, rate * dt);
    this.facing = wrapAngle(this.facing + step);
    this.turnRate = dt > 0 ? step / dt : 0;
  }

  _sync(dt) {
    this.char.group.position.copy(this.pos);
    this.char.setFacing(this.facing);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.char.update(dt, { speed: hs, turnRate: this.turnRate });
  }

  // ---------------------------------------------------------------------------
  _release() {
    const power = Math.max(0.12, this.charge);
    const type = this.chargeType;
    this.charging = false; this.charge = 0;
    const g = this.game;
    const aim = this.aimDir(new THREE.Vector3());

    // aim assist: shots heading roughly at goal are pulled towards the frame
    // the opponent goal the aim points at best
    let goal = null, bestDot = 0.7, goalDist = 0;
    for (const gg of this.targets) {
      const dx = gg.centre.x - this.pos.x, dz = gg.centre.z - this.pos.z, d = Math.hypot(dx, dz);
      const dot = (aim.x * dx + aim.z * dz) / (d || 1);
      if (d < 15 && dot > bestDot) { bestDot = dot; goal = gg; goalDist = d; }
    }
    if (type === 'kick' && goal) {
      const A = goal.axis, B = A === 'x' ? 'z' : 'x', line = goal.sign * FIELD.half;
      const lim = FIELD.goalHalfW - 0.35;
      let tb;
      if (this.intent.move.lengthSq() > 0.09 && Math.abs(aim[A]) > 0.1) tb = this.pos[B] + aim[B] * ((line - this.pos[A]) / aim[A]);
      else tb = -Math.sign(this.pos[B] || Math.random() - 0.5) * (lim - 0.1); // far post by default
      tb = clamp(tb, -lim, lim);
      const tgt = A === 'x' ? new THREE.Vector3(line, 0, tb) : new THREE.Vector3(tb, 0, line);
      const ideal = tgt.sub(this.pos).setY(0).normalize();
      // assist fades with distance: long shots rely more on the player's own aim
      const assist = (0.55 * this.skill + 0.2) * clamp(1.25 - goalDist / 14, 0.2, 1);
      aim.lerp(ideal, assist).normalize();
    }

    const dur = ANIM.kickDuration * (type === 'kick' ? 1.08 - 0.16 * power : 1.0);
    const contactT = dur * ANIM.kickContact;
    this.kick = { type, power, aim, t: 0, dur, contactT, hit: false, resolved: false };
    this.kick.approach = this._approachTarget(contactT, aim);
    this.char.play(type, { duration: dur, side: 'Right', amp: 0.85 + 0.3 * power });
  }

  _approachTarget(timeLeft, aim) {
    const ball = this.game.ball;
    const pred = ball.predict(Math.max(0, timeLeft), new THREE.Vector3());
    if (pred.y > 0.9) return null;
    const right = new THREE.Vector3().crossVectors(aim, UP);
    const t = pred.clone().addScaledVector(aim, -this.reachF).addScaledVector(right, -this.reachS); t.y = 0;
    const d = Math.hypot(t.x - this.pos.x, t.z - this.pos.z);
    return d < 3 ? t : null;
  }

  _kickMotion(dt) {
    const k = this.kick;
    k.t += dt;
    // face the aim quickly
    this._turnTo(Math.atan2(k.aim.x, k.aim.z), dt, 14);
    if (k.t < k.contactT) {
      const left = k.contactT - k.t;
      k.approach = this._approachTarget(left, k.aim) || k.approach;
      if (k.approach) {
        const dx = k.approach.x - this.pos.x, dz = k.approach.z - this.pos.z;
        let vx = dx / Math.max(left, 0.05), vz = dz / Math.max(left, 0.05);
        const s = Math.hypot(vx, vz), max = 9;
        if (s > max) { vx *= max / s; vz *= max / s; }
        this.vel.x += (vx - this.vel.x) * Math.min(1, dt * 18);
        this.vel.z += (vz - this.vel.z) * Math.min(1, dt * 18);
      } else this.vel.multiplyScalar(Math.max(0, 1 - dt * 6));
    } else {
      // follow-through: carry a little momentum along the aim
      const target = this._v.copy(k.aim).multiplyScalar(k.t < k.contactT + 0.18 ? 1.2 : 0);
      this.vel.lerp(target, Math.min(1, dt * 6));
    }
    this.pos.addScaledVector(this.vel, dt);
    // contact happens when the boot really reaches the ball (instep: ankle→toe segment)
    if (!k.resolved && k.t >= k.contactT * 0.55) {
      const ball = this.game.ball;
      const a = this.char.anklePos('R', this._fa), b = this.char.footPos('R', this._fb);
      const ab = b.sub(a), t = clamp(ball.pos.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-6), 0, 1);
      const d = a.addScaledVector(ab, t).distanceTo(ball.pos);
      if (d < R + 0.075) { k.resolved = true; this._contact(true); }
      else if (k.t > k.contactT + 0.07) { k.resolved = true; this._contact(false); }
    }
    if (k.t >= k.dur) this.kick = null;
  }

  _contact(footTouched) {
    const k = this.kick; if (!k) return;
    const g = this.game, ball = g.ball;
    const right = new THREE.Vector3().crossVectors(k.aim, UP);
    const ideal = this.pos.clone().addScaledVector(this.forward, this.reachF).addScaledVector(right, this.reachS);
    const d = Math.hypot(ball.pos.x - ideal.x, ball.pos.z - ideal.z);
    const maxH = k.type === 'chip' ? 0.55 : 0.95;
    const reach = 0.55;
    if (!footTouched && (d > reach || ball.pos.y > maxH)) { g.onWhiff(this); return; }
    k.hit = true;
    const quality = footTouched ? Math.max(0.75, 1 - d / reach) : 1 - d / reach;
    const p = k.power;
    let speed, elev;
    const volley = ball.pos.y > R + 0.15;
    if (k.type === 'chip') { speed = PLAYER.chipSpeed[0] + PLAYER.chipSpeed[1] * p; elev = 0.6 + 0.14 * p; }
    else { speed = PLAYER.shotSpeed[0] + PLAYER.shotSpeed[1] * p; elev = 0.03 + 0.15 * Math.pow(p, 1.4) + (volley ? 0.06 : 0); }
    speed *= 0.82 + 0.18 * quality;
    // shot error: rushed / mishit / power shots are less accurate
    const gd = this.goalTarget().distanceTo(this.pos);
    const err = ((1 - quality) * 0.1 + Math.pow(p, 3) * 0.06 * (1.3 - this.skill) + gd * 0.004) * (Math.random() * 2 - 1);
    const dir = k.aim.clone().applyAxisAngle(UP, err);
    elev += (1 - quality) * 0.05 * (Math.random() - 0.3);
    const vel = dir.multiplyScalar(Math.cos(elev) * speed); vel.y = Math.sin(elev) * speed;
    // spin: lateral input at contact = curl; chips get backspin, drives get topspin
    const m = this.intent.move;
    const r2 = new THREE.Vector3().crossVectors(k.aim, UP);
    let lateral = 0;
    if (m.lengthSq() > 0.09) lateral = -(m.x * r2.x + m.y * r2.z); // + = towards player's left
    const spin = new THREE.Vector3();
    if (k.type === 'chip') spin.addScaledVector(r2, 28 * p);
    else spin.addScaledVector(r2, -8 * p);
    spin.y = lateral * 16 * p * (k.type === 'chip' ? 0.6 : 1);
    ball.strike(vel, spin, this);
    this.char.face('aa', 0.6 + 0.4 * p); this.faceT = 0.35;
    this.lastTouchTime = g.time;
    this.touchCD = 0.35;
    this.stats.touches++;
    g.onKick(this, k, vel);
  }

  /** automatic ball control: first touch, dribbling, shielding */
  handleBall(dt) {
    const g = this.game, ball = g.ball;
    if (this.frozen) return false;
    if (this.kick && this.kick.t < this.kick.contactT + 0.1) return false;
    const f = this.forward, r = this.rightDir;
    const rx = ball.pos.x - this.pos.x, rz = ball.pos.z - this.pos.z;
    const fwd = rx * f.x + rz * f.z, lat = rx * r.x + rz * r.z;
    const dist = Math.hypot(rx, rz);
    const by = ball.pos.y;

    // body block (ball hits shins / body from any direction)
    const bodyR = PLAYER.radius + R;
    if (dist < bodyR && by < 1.7) {
      const nx = rx / (dist || 1), nz = rz / (dist || 1);
      ball.pos.x = this.pos.x + nx * bodyR; ball.pos.z = this.pos.z + nz * bodyR;
      const rvx = ball.vel.x - this.vel.x, rvz = ball.vel.z - this.vel.z;
      const vn = rvx * nx + rvz * nz;
      if (vn < 0) {
        ball.vel.x -= 1.35 * vn * nx; ball.vel.z -= 1.35 * vn * nz;
        if (-vn > 3) { g.sfx.touch(); ball.lastTouch = this; }
      }
    }

    // close control: while I'm dribbling, the ball's motion relative to me relaxes
    // towards "slightly slower than me, drifting back to my centre line", so the
    // ball stays within a stride instead of rolling away (like a skilled dribbler).
    const sp0 = Math.hypot(this.vel.x, this.vel.z);
    const stopping = this.intent.move.lengthSq() < 0.04 && !this.charging;
    if (ball.lastTouch === this && g.time - this.lastTouchTime < 0.9 && (sp0 > 1 || stopping) && by < 0.4 &&
        fwd > -0.2 && fwd < 2.4 && Math.abs(lat) < 1.1 && !(this.kick && this.kick.t >= this.kick.contactT)) {
      const back = -1.5 * Math.min(1, sp0 / 5);
      const tx = f.x * back - r.x * lat * 2.5, tz = f.z * back - r.z * lat * 2.5;
      const k = 1 - Math.exp(-dt / 0.33);
      const rvx0 = ball.vel.x - this.vel.x, rvz0 = ball.vel.z - this.vel.z;
      ball.vel.x = this.vel.x + rvx0 + (tx - rvx0) * k;
      ball.vel.z = this.vel.z + rvz0 + (tz - rvz0) * k;
    }

    // a scheduled dribble touch: the ball is knocked on when the boot arrives
    if (this.touch) {
      const tt = this.touch; tt.t += dt;
      const foot = this.char.anklePos(tt.side === 'Left' ? 'L' : 'R', this._fa);
      const footHit = Math.hypot(foot.x - ball.pos.x, foot.z - ball.pos.z) < R + 0.1 && by < 0.5;
      if (dist > 1.5 || by > 0.6) this.touch = null;
      else if (footHit || tt.t >= tt.dur * 0.75) {
        const sp = Math.hypot(this.vel.x, this.vel.z);
        const push = Math.min(10.5, sp + 1.9);
        ball.vel.set(f.x * push - r.x * lat * 2.5, 0.3 + Math.random() * 0.25, f.z * push - r.z * lat * 2.5);
        ball.pos.y = Math.max(ball.pos.y, R + 0.005);
        g.sfx.touch();
        this._took(sp > 4.5 ? 0.18 : 0.24);
        this.touch = null;
      }
      return true;
    }

    if (this.touchCD > 0) return false;
    const inZone = fwd > -0.12 && fwd < 0.95 + R && Math.abs(lat) < 0.55 && dist < 1.0 + R;
    if (!inZone || by > 1.5) return false;

    const rvx = ball.vel.x - this.vel.x, rvz = ball.vel.z - this.vel.z;
    const rel = Math.hypot(rvx, rvz, ball.vel.y);
    const approaching = rvx * -rx + rvz * -rz > 0;

    // first touch / chest control of fast or bouncing balls
    if ((rel > 5.5 && approaching) || (by > 0.45 && approaching)) {
      if (rel > 19 && by < 0.5) return false; // too hot to handle: it just ricochets
      const keep = by > 0.45 ? 0.08 : 0.14;
      ball.vel.x = this.vel.x * 0.9 + rvx * keep; ball.vel.z = this.vel.z * 0.9 + rvz * keep;
      ball.vel.y = by > 0.45 ? -0.6 : 0;
      ball.spin.multiplyScalar(0.2);
      this.char.play('trap', { side: 'Right' });
      if (by < 0.45) this.trapT = 0.32; // sole stop: the boot comes down on top of the ball
      g.sfx.touch();
      this._took(0.28);
      return true;
    }
    if (by > 0.4) return false;

    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.7) {
      // dribble: when the ball is about to be run over, knock it ahead
      if (fwd < 0.5 + R * 1.4) {
        // start the touch now; the knock happens when the foot gets there
        const side = Math.abs(lat) > 0.12 ? (lat > 0 ? 'Right' : 'Left') : this.nextFoot;
        this.nextFoot = side === 'Right' ? 'Left' : 'Right';
        this.touch = { t: 0, dur: clamp(0.17 - sp * 0.01, 0.1, 0.16), side };
        this.char.play('touch', { side, amp: 0.8 + Math.min(0.5, sp / 12) });
        return true;
      }
    } else {
      // standing: cushion and settle the ball just in front of the boot
      const k = Math.exp(-dt * 7);
      ball.vel.x = this.vel.x + rvx * k; ball.vel.z = this.vel.z + rvz * k;
      const hold = 0.3 + R;
      const tx = this.pos.x + f.x * hold, tz = this.pos.z + f.z * hold;
      ball.vel.x += (tx - ball.pos.x) * 4 * dt; ball.vel.z += (tz - ball.pos.z) * 4 * dt;
      if (ball.lastTouch !== this) { ball.lastTouch = this; this.stats.touches++; }
      this.lastTouchTime = g.time;
      return true;
    }
    return false;
  }

  _took(cd) {
    const g = this.game;
    g.ball.lastTouch = this;
    this.lastTouchTime = g.time;
    this.touchCD = cd;
    this.stats.touches++;
  }
}
