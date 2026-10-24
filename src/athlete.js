import * as THREE from 'three';
import { FIELD, PLAYER, ANIM, BALL } from './config.js';

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
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._f = new THREE.Vector3(); this._r = new THREE.Vector3();
  }

  get attackSign() { return this.team === 0 ? 1 : -1; }      // team 0 attacks +x
  get forward() { return this._f.set(Math.sin(this.facing), 0, Math.cos(this.facing)); }
  get rightDir() { return this._r.crossVectors(this.forward, UP); }

  place(x, z, facing) {
    this.pos.set(x, 0, z); this.vel.set(0, 0, 0); this.facing = facing;
    this.kick = null; this.charging = false; this.charge = 0; this.touchCD = 0.2;
    this.char.gestures = this.char.gestures.filter((g) => g.loop);
    this._sync(0);
  }

  goalTarget() { return new THREE.Vector3(this.attackSign * FIELD.halfL, 0, 0); }

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
        if (!held || this.chargeHold > PLAYER.chargeAutoRelease) this._release();
      }
    }

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
    if (Math.abs(this.pos.x) > FIELD.halfL - lim) { this.pos.x = Math.sign(this.pos.x) * (FIELD.halfL - lim); this.vel.x = 0; }
    if (Math.abs(this.pos.z) > FIELD.halfW - lim) { this.pos.z = Math.sign(this.pos.z) * (FIELD.halfW - lim); this.vel.z = 0; }

    this.char.lookTarget = ballPos;
    this._sync(dt);
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
    const toGoal = this.goalTarget().sub(this.pos).setY(0);
    const goalDist = toGoal.length(); toGoal.normalize();
    if (type === 'kick' && goalDist < 15 && aim.dot(toGoal) > 0.7) {
      const gx = this.attackSign * FIELD.halfL;
      const lim = FIELD.goalHalfW - 0.35;
      let tz;
      if (this.intent.move.lengthSq() > 0.09 && Math.abs(aim.x) > 0.1) tz = this.pos.z + aim.z * ((gx - this.pos.x) / aim.x);
      else tz = -Math.sign(this.pos.z || Math.random() - 0.5) * (lim - 0.1); // far post by default
      tz = clamp(tz, -lim, lim);
      const ideal = new THREE.Vector3(gx - this.pos.x, 0, tz - this.pos.z).normalize();
      // assist fades with distance: long shots rely more on the player's own aim
      const assist = (0.55 * this.skill + 0.2) * clamp(1.25 - goalDist / 14, 0.2, 1);
      aim.lerp(ideal, assist).normalize();
    }

    const dur = ANIM.kickDuration * (type === 'kick' ? 1.08 - 0.16 * power : 1.0);
    const contactT = dur * ANIM.kickContact;
    this.kick = { type, power, aim, t: 0, dur, contactT };
    this.kick.approach = this._approachTarget(contactT, aim);
    const side = 'Right';
    this.char.play(type, {
      duration: dur, side, amp: 0.85 + 0.3 * power,
      onEvent: (e) => { if (e === 'contact') this._contact(); },
    });
  }

  _approachTarget(timeLeft, aim) {
    const ball = this.game.ball;
    const pred = ball.predict(Math.max(0, timeLeft), new THREE.Vector3());
    if (pred.y > 0.9) return null;
    const right = new THREE.Vector3().crossVectors(aim, UP);
    const t = pred.clone().addScaledVector(aim, -PLAYER.reachForward).addScaledVector(right, -PLAYER.reachSide); t.y = 0;
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
    if (k.t >= k.dur) this.kick = null;
  }

  _contact() {
    const k = this.kick; if (!k) return;
    const g = this.game, ball = g.ball;
    const right = new THREE.Vector3().crossVectors(k.aim, UP);
    const ideal = this.pos.clone().addScaledVector(this.forward, PLAYER.reachForward).addScaledVector(right, PLAYER.reachSide);
    const d = Math.hypot(ball.pos.x - ideal.x, ball.pos.z - ideal.z);
    const maxH = k.type === 'chip' ? 0.45 : 0.85;
    const reach = 0.55;
    if (d > reach || ball.pos.y > maxH) { g.onWhiff(this); return; }
    const quality = 1 - d / reach;
    const p = k.power;
    let speed, elev;
    const volley = ball.pos.y > R + 0.15;
    if (k.type === 'chip') { speed = 7.2 + 8.5 * p; elev = 0.6 + 0.14 * p; }
    else { speed = 9 + 20 * p; elev = 0.03 + 0.16 * Math.pow(p, 1.4) + (volley ? 0.06 : 0); }
    speed *= 0.82 + 0.18 * quality;
    // shot error: rushed / mishit / power shots are less accurate
    const gd = Math.abs(this.attackSign * FIELD.halfL - this.pos.x);
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
    if (ball.lastTouch === this && g.time - this.lastTouchTime < 0.9 && sp0 > 1 && by < 0.4 &&
        fwd > -0.2 && fwd < 2.4 && Math.abs(lat) < 1.1 && !(this.kick && this.kick.t >= this.kick.contactT)) {
      const back = -1.2 * Math.min(1, sp0 / 5);
      const tx = f.x * back - r.x * lat * 2.5, tz = f.z * back - r.z * lat * 2.5;
      const k = 1 - Math.exp(-dt / 0.33);
      const rvx0 = ball.vel.x - this.vel.x, rvz0 = ball.vel.z - this.vel.z;
      ball.vel.x = this.vel.x + rvx0 + (tx - rvx0) * k;
      ball.vel.z = this.vel.z + rvz0 + (tz - rvz0) * k;
    }

    if (this.touchCD > 0) return false;
    const inZone = fwd > -0.12 && fwd < 0.9 && Math.abs(lat) < 0.5 && dist < 0.95;
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
      this.char.play('trap', { side: lat >= 0 ? 'Right' : 'Left' });
      g.sfx.touch();
      this._took(0.28);
      return true;
    }
    if (by > 0.4) return false;

    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.7) {
      // dribble: when the ball is about to be run over, knock it ahead
      if (fwd < 0.55) {
        const push = Math.min(10, sp + 2.4);
        ball.vel.set(f.x * push - r.x * lat * 2.5, 0.3 + Math.random() * 0.25, f.z * push - r.z * lat * 2.5);
        ball.pos.y = Math.max(ball.pos.y, R + 0.005);
        this.char.play('touch', { side: lat >= 0 ? 'Right' : 'Left', amp: 0.8 + Math.min(0.5, sp / 12) });
        g.sfx.touch();
        this._took(sp > 4.5 ? 0.24 : 0.3);
        return true;
      }
    } else {
      // standing: cushion and settle the ball just in front of the boot
      const k = Math.exp(-dt * 7);
      ball.vel.x = this.vel.x + rvx * k; ball.vel.z = this.vel.z + rvz * k;
      const tx = this.pos.x + f.x * 0.42, tz = this.pos.z + f.z * 0.42;
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
