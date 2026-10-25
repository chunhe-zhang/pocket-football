import * as THREE from 'three';
import { FIELD, PLAYER, ANIM, BALL, GOALS, clampToArena, pushOutOfObstacles, inOwnBox } from './config.js';

const UP = new THREE.Vector3(0, 1, 0);
const smoothstep = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
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
    this.intent = { move: new THREE.Vector2(), kick: false, lob: false, sprint: false, tackle: false, pass: false };
    this.skill = 1;          // 0..1, lowers shot error (AI difficulty uses this)
    this.speedMul = 1;
    this.stats = { shots: 0, onTarget: 0, touches: 0 };
    this.lastTouchTime = -10;
    this.touch = null;       // scheduled dribble touch: the push happens when the boot arrives
    this.trapT = 0;          // sole trap in progress
    this.holdT = 0; this.holdW = 0; // standing with the foot on the ball
    this.nextFoot = 'Right';
    this.faceT = 0;
    this.slide = null; this.slideCD = 0; this._prevTackle = false;
    this.dive = null;
    this.stunT = 0;          // knocked off balance by a tackle or a hard bump
    this.receive = null;     // anticipated first touch: { type, side, t, ta }
    this.ignoreBall = 0;     // own legs don't collide with the ball right after striking it
    this.colliders = null;
    this._fa = new THREE.Vector3(); this._fb = new THREE.Vector3();
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._f = new THREE.Vector3(); this._r = new THREE.Vector3();
  }

  get home() { return GOALS[this.team]; }                       // the goal I defend
  /** the goal mouth centres I can score in */
  get targets() { return GOALS.filter((g) => g.team !== this.team && this.game.activeGoal(g.team) && !this.game.sameSide(this.team, g.team)); }
  /** 2v2: my team-mate still on the pitch (null in free-for-all) */
  get mate() { return this.game.mateOf(this.team); }
  /** my last touch was a pass to this team-mate (null otherwise) */
  get passedTo() { return this.passTarget && this.passT === this.lastTouchTime ? this.passTarget : null; }
  get forward() { return this._f.set(Math.sin(this.facing), 0, Math.cos(this.facing)); }
  get rightDir() { return this._r.crossVectors(this.forward, UP); }
  // where the ball centre sits relative to the body when the boot meets it (measured from the rig)
  get reachF() { return this.char.kickCalib.forward + R * 0.85; }
  get reachS() { return this.char.kickCalib.side; }

  place(x, z, facing) {
    this.pos.set(x, 0, z); this.vel.set(0, 0, 0); this.facing = facing;
    this.kick = null; this.charging = false; this.charge = 0; this.touchCD = 0.2; this.armed = null;
    this.touch = null; this.trapT = 0; this.holdT = 0; this.holdW = 0;
    this.slide = null; this.dive = null; this.stunT = 0; this.receive = null; this.ignoreBall = 0; this._resetColliders = true;
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
    if (this.charging && this.chargeType === 'pass') {
      const r = this.passTo || this.mate;
      if (r) { const t = this.passLead(r, this.charge); out.set(t.x - this.pos.x, 0, t.z - this.pos.z); if (out.lengthSq() > 1e-4) return out.normalize(); }
    }
    const m = this.intent.move;
    if (m.lengthSq() > 0.09) out.set(m.x, 0, m.y).normalize();
    else out.copy(this.goalTarget()).sub(this.pos).setY(0).normalize();
    return out;
  }

  /**
   * Where a pass of this power should go, and how hard: a soft pass is weighted to arrive
   * at the receiver's feet; more power drives it harder and further ahead of them, into
   * the space they're running into (a through ball).
   */
  passLead(rcv, power) {
    const ball = this.game.ball, p = clamp(power, 0, 1);
    const arrive = 4 + 8 * Math.pow(p, 1.4);
    // lead direction: where they're running, else towards the goal they'd attack
    let lx = rcv.vel.x, lz = rcv.vel.z, ls = Math.hypot(lx, lz);
    if (ls < 1.5) { const gt = rcv.goalTarget(); lx = gt.x - rcv.pos.x; lz = gt.z - rcv.pos.z; ls = Math.hypot(lx, lz) || 1; }
    const lead = p > 0.3 ? ((p - 0.3) / 0.7) * 4 : 0;
    let tx = rcv.pos.x, tz = rcv.pos.z, sp = 0;
    for (let k = 0; k < 3; k++) {
      const d = Math.hypot(tx - ball.pos.x, tz - ball.pos.z);
      sp = clamp(Math.sqrt(arrive * arrive + 2 * 0.9 * d) + 0.6, 5.5, 22);
      const t = d / ((sp + arrive) / 2) + 0.2;
      tx = rcv.pos.x + rcv.vel.x * t * 0.8 + (lx / ls) * lead;
      tz = rcv.pos.z + rcv.vel.z * t * 0.8 + (lz / ls) * lead;
    }
    const lim = FIELD.half - 0.8;
    return { x: clamp(tx, -lim, lim), z: clamp(tz, -lim, lim), speed: sp };
  }

  update(dt) {
    const it = this.intent, g = this.game;
    if (!this.charging) this.char.windup = 0;
    this.touchCD = Math.max(0, this.touchCD - dt);
    this.slideCD = Math.max(0, this.slideCD - dt);
    this.stunT = Math.max(0, this.stunT - dt);
    this.ignoreBall = Math.max(0, this.ignoreBall - dt);
    if (this.receive) { this.receive.t += dt; if (this.receive.t > this.receive.ta + 0.3) this.receive = null; }

    // ---- slide tackle ------------------------------------------------------------
    const tacklePressed = it.tackle && !this._prevTackle;
    this._prevTackle = it.tackle;
    if (tacklePressed && !this.frozen && !this.slide && !this.dive && !this.kick && this.stunT <= 0 && this.slideCD <= 0 && g.state === 'play') {
      // in my own penalty box the tackle button is a goalkeeper dive
      if (inOwnBox(this.team, this.pos.x, this.pos.z)) this._startDive(); else this._startSlide();
    }

    // ---- charging / release (shot, chip, or a pass to my team-mate) ---------------
    const canPass = !!(this.passTo || this.mate);
    const wantShot = it.kick || it.lob, wantPass = it.pass && canPass;
    if (this.frozen || this.slide || this.dive || this.stunT > 0) { this.charging = false; this.charge = 0; }
    else if (!this.kick) {
      if ((wantShot || wantPass) && !this.charging && g.state !== 'menu') {
        this.charging = true; this.charge = 0; this.chargeHold = 0; this.armed = null;
        this.chargeType = it.lob ? 'chip' : it.kick ? 'kick' : 'pass';
      }
      if (this.charging) {
        if (it.lob && this.chargeType === 'kick') this.chargeType = 'chip';
        const isPass = this.chargeType === 'pass';
        const held = isPass ? it.pass : wantShot;
        this.charge = Math.min(1, this.charge + dt / (isPass ? PLAYER.passChargeTime : PLAYER.chargeTime));
        if (this.charge >= 1) this.chargeHold += dt;
        this.char.face('angry', 0.15 + 0.35 * this.charge);
        if (!held || this.chargeHold > PLAYER.chargeAutoRelease) { this.char.face('angry', 0); this._release(); }
        else this.char.windup = this.charge;
      }
    }
    // ---- a strike released before the ball arrived: run onto it, hit it when in reach ----
    if (this.armed) {
      const am = this.armed, b = g.ball;
      am.t += dt;
      const bd = Math.hypot(b.pos.x - this.pos.x, b.pos.z - this.pos.z);
      if (this.frozen || this.slide || this.dive || this.stunT > 0 || this.kick || g.state !== 'play' || am.t > 0.8 || bd > 7 || b.goalTeam >= 0) this.armed = null;
      else if (this._inStrikeReach(am.type)) {
        this.armed = null;
        this.chargeType = am.type; this.charge = am.power; this.passTo = am.passTo;
        this._release();
      }
    }
    if (this.faceT > 0) { this.faceT -= dt; if (this.faceT <= 0) this.char.face('aa', 0); }
    this.trapT = Math.max(0, this.trapT - dt);

    // ---- movement ---------------------------------------------------------
    const ballPos = g.ball.pos;
    if (this.dive) this._diveMotion(dt);
    else if (this.slide) this._slideMotion(dt);
    else if (this.stunT > 0) { this.vel.multiplyScalar(Math.max(0, 1 - dt * 5)); this.pos.addScaledVector(this.vel, dt); }
    else if (this.kick) this._kickMotion(dt);
    else {
      const mag = Math.min(1, it.move.length());
      let target = PLAYER.runSpeed;
      const wantsSprint = it.sprint && mag > 0.5 && !this.exhausted;
      if (wantsSprint) target = PLAYER.sprintSpeed;
      if (mag < 0.7) target = PLAYER.walkSpeed + (PLAYER.runSpeed - PLAYER.walkSpeed) * Math.max(0, (mag - 0.25) / 0.45);
      if (this.charging) target *= 0.55;
      if (this.receive && this.receive.type !== 'trapFoot') target *= 0.6; // settle under a dropping ball
      if (this.frozen) target = 0;
      target *= this.speedMul;
      const desired = this._v.set(it.move.x, 0, it.move.y);
      if (mag > 0.05) desired.normalize().multiplyScalar(target * (mag < 0.25 ? mag / 0.25 : 1)); else desired.set(0, 0, 0);
      if (this.armed && !this.frozen) {
        // meet the ball: the earliest point on its path I can get behind in time
        const sp = (it.sprint && !this.exhausted ? PLAYER.sprintSpeed : PLAYER.runSpeed) * this.speedMul;
        const p = this._armedSpot(sp);
        desired.set(p.x - this.pos.x, 0, p.z - this.pos.z);
        const dl = desired.length();
        if (dl > 0.02) desired.multiplyScalar(Math.min(sp, dl * 6) / dl); else desired.set(0, 0, 0);
      }
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
      else if (this.armed && this.vel.length() < 2) { const d = this.armedAim(this._w); want = Math.atan2(d.x, d.z); }
      else if (this.receive && this.vel.length() < 3.5) {
        // open the body to the incoming ball
        const v = g.ball.vel; if (Math.hypot(v.x, v.z) > 0.5) want = Math.atan2(-v.x, -v.z);
      }
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
    if (clampToArena(this.pos, lim)) this.vel.multiplyScalar(0.6);
    if (pushOutOfObstacles(this.pos, PLAYER.radius)) this.vel.multiplyScalar(0.7);

    this.char.lookTarget = ballPos;
    this._feet(dt);
    this._sync(dt);
    this._updateColliders(dt);
  }

  // ---- body colliders ------------------------------------------------------------
  static PART_BOUNCE = { head: 0.55, chest: 0.2, hips: 0.28, thigh: 0.3, shin: 0.5, foot: 0.42, hand: 0.3 };

  /** refresh the body-part spheres the ball collides with (positions + velocities) */
  _updateColliders(dt) {
    const sph = this.char.bodySpheres([]);
    if (!this.colliders) {
      this.colliders = sph.map((x, idx) => ({ owner: this, idx, part: x.part, side: x.side, r: x.r, r0: x.r, e: Athlete.PART_BOUNCE[x.part],
        pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(),
        b: x.b ? new THREE.Vector3() : null, prevB: x.b ? new THREE.Vector3() : null, velB: x.b ? new THREE.Vector3() : null, active: true }));
      this._resetColliders = true;
    }
    const ball = this.game.ball;
    const controlling = ball.lastTouch === this && this.game.time - this.lastTouchTime < 0.6 && Math.hypot(ball.pos.x - this.pos.x, ball.pos.z - this.pos.z) < 1.3;
    sph.forEach((x, i) => {
      const c = this.colliders[i];
      c.prev.copy(this._resetColliders ? x.pos : c.pos);
      c.pos.copy(x.pos);
      if (dt > 0) c.vel.copy(c.pos).sub(c.prev).divideScalar(dt); else c.vel.set(0, 0, 0);
      if (c.vel.length() > 14) c.vel.setLength(14);
      if (c.b) {
        c.prevB.copy(this._resetColliders ? x.b : c.b);
        c.b.copy(x.b);
        if (dt > 0) c.velB.copy(c.b).sub(c.prevB).divideScalar(dt); else c.velB.set(0, 0, 0);
        if (c.velB.length() > 14) c.velB.setLength(14);
      }
      const leg = c.part === 'foot' || c.part === 'shin';
      // the boots of a player who is dribbling, striking or sliding are driven by the
      // touch logic, not by raw collisions (that would make close control jittery)
      const lower = leg || c.part === 'thigh' || c.part === 'hips';
      c.active = !(leg && (controlling || this.ignoreBall > 0 || (this.kick && !this.kick.resolved) || this.touch || this.holdW > 0.05)) && !(lower && this.dribbling);
      if (this.slide && leg && c.side === 'R') c.active = false;
      // hands only count during a dive (no handball otherwise); a diving keeper is all reach
      if (c.part === 'hand') c.active = !!this.dive && this.dive.t < 0.75;
      // a fully stretched keeper covers more than the bare skeleton suggests (gloves, sleeves, body)
      const stretch = this.dive && this.dive.t > 0.05 && this.dive.t < 0.75;
      c.r = stretch && c.part !== 'head' ? c.r0 * 1.15 : c.r0;
    });
    this._resetColliders = false;
  }

  // ---- slide tackle --------------------------------------------------------------
  _startSlide() {
    const it = this.intent;
    const dir = it.move.lengthSq() > 0.09 ? new THREE.Vector3(it.move.x, 0, it.move.y).normalize() : this.forward.clone();
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.slide = { t: 0, dur: 0.6, total: 0.85, dir, speed0: clamp(Math.max(sp, 4) + 2.6, 6.2, 9), poked: false, hit: new Set() };
    this.facing = Math.atan2(dir.x, dir.z);
    this.charging = false; this.charge = 0; this.receive = null; this.touch = null;
    this.stamina = Math.max(0, this.stamina - 0.12);
    this.slideCD = 1.1;
    this.char.play('slide', { duration: 0.85 });
    this.char.face('angry', 0.6); this.faceT = 0.6;
    this.game.sfx.slide();
  }

  _slideMotion(dt) {
    const sl = this.slide, g = this.game, ball = g.ball;
    sl.t += dt;
    const u = sl.t / sl.dur;
    const sp = u < 1 ? sl.speed0 * Math.pow(1 - u, 1.25) : 0;
    this.vel.copy(sl.dir).multiplyScalar(sp);
    this.pos.addScaledVector(this.vel, dt);
    if (u < 1 && Math.random() < dt * 30) g.fx('grass', this.pos, { x: -sl.dir.x, z: -sl.dir.z }, 2, 1.5);
    if (u < 0.8) {
      // the leading boot sweeps through the ball
      const toe = this.char.footPos('R', this._fa), ank = this.char.anklePos('R', this._fb);
      const ab = this._w.copy(toe).sub(ank);
      const t = clamp(this._v.copy(ball.pos).sub(ank).dot(ab) / Math.max(ab.lengthSq(), 1e-6), 0, 1);
      const near = ank.addScaledVector(ab, t);
      const reach = Math.hypot(ball.pos.x - near.x, ball.pos.z - near.z);
      if (!sl.poked && reach < R + 0.2 && ball.pos.y < 0.6) {
        sl.poked = true;
        const lateral = (Math.random() - 0.5) * 2.4;
        ball.vel.set(sl.dir.x * (sp * 0.85 + 3.2) - sl.dir.z * lateral, 0.6 + Math.random() * 1.2, sl.dir.z * (sp * 0.85 + 3.2) + sl.dir.x * lateral);
        ball.spin.set(0, (Math.random() - 0.5) * 20, 0);
        ball.lastTouch = this; this.lastTouchTime = g.time; this.stats.touches++;
        this.ignoreBall = 0.25;
        g.sfx.kick(0.35);
        g.squashBall(sl.dir, 0.16);
        g.fx('grass', ball.pos, sl.dir, 10, 2.5);
        g.rumble(this, 0.6, 90);
      }
      // and through anyone standing in the way
      for (const o of g.athletes) {
        if (o === this || sl.hit.has(o) || o.slide || g.sameSide(this.team, o.team)) continue;
        const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z, d = Math.hypot(dx, dz);
        const ahead = (dx * sl.dir.x + dz * sl.dir.z) / (d || 1);
        if (d < 0.85 && ahead > 0.2) { sl.hit.add(o); o.knock(sl.dir, sp); g.sfx.bump(sp); g.rumble(this, 0.4, 70); }
      }
    }
    if (sl.t >= sl.total) { this.slide = null; this.vel.set(0, 0, 0); }
  }

  // ---- goalkeeper dive ---------------------------------------------------------------
  _startDive() {
    const g = this.game, home = this.home, ball = g.ball;
    // dive along the goal line, facing out of the goal
    const face = Math.atan2(home.inward.x, home.inward.z);
    this.facing = face;
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(Math.sin(face), 0, Math.cos(face)), UP);
    let s = 0;
    const m = this.intent.move;
    if (m.lengthSq() > 0.09) s = m.x * right.x + m.y * right.z;
    if (Math.abs(s) < 0.2) {
      // towards where the ball will cross in front of me
      const v = ball.vel, sp = Math.hypot(v.x, v.z);
      const px = sp > 1 ? ball.pos.x + v.x * 0.35 : ball.pos.x, pz = sp > 1 ? ball.pos.z + v.z * 0.35 : ball.pos.z;
      s = (px - this.pos.x) * right.x + (pz - this.pos.z) * right.z;
      if (Math.abs(s) < 0.05) s = Math.random() - 0.5;
    }
    const side = s >= 0 ? 'Right' : 'Left';
    const dir = right.clone().multiplyScalar(s >= 0 ? 1 : -1);
    this.dive = { t: 0, dur: 1.15, dir, speed0: 5.6, side };
    this.charging = false; this.charge = 0; this.receive = null; this.touch = null; this.dribbling = false;
    this.slideCD = 1.4;
    this.char.play('dive', { side, duration: 1.15 });
    this.char.face('surprised', 0.5); this.faceT = 0.8;
    g.sfx.slide();
  }

  _diveMotion(dt) {
    const dv = this.dive;
    dv.t += dt;
    // explosive push off, slide a little on landing, then get up
    const u = dv.t / 0.36;
    const sp = u < 1 ? dv.speed0 * Math.pow(1 - u, 1.4) : 0;
    this.vel.copy(dv.dir).multiplyScalar(sp);
    this.pos.addScaledVector(this.vel, dt);
    if (dv.t > 0.3 && dv.t < 0.36) this.game.fx('grass', this.pos, dv.dir, 6, 1.2);
    if (dv.t >= dv.dur) { this.dive = null; this.vel.set(0, 0, 0); }
  }

  /** knocked off balance: drop the ball, stumble a step along the hit */
  knock(dir, strength = 5) {
    if (this.frozen) return;
    this.stunT = clamp(0.35 + strength * 0.05, 0.4, 0.75);
    this.vel.copy(dir).multiplyScalar(1 + strength * 0.2);
    this.kick = null; this.armed = null; this.charging = false; this.charge = 0; this.touch = null; this.receive = null; this.slide = null; this.dive = null;
    this.char.play('stagger', { duration: this.stunT + 0.15 });
    this.char.face('surprised', 0.8); this.faceT = 0.6;
    this.game.rumble(this, 0.8, 140);
  }

  // ---- receiving -------------------------------------------------------------------
  /** see a ball coming and get the right body part ready for it */
  _anticipate() {
    if (this.receive || this.kick || this.armed || this.charging || this.slide || this.stunT > 0 || this.frozen) return;
    const ball = this.game.ball;
    const dx = ball.pos.x - this.pos.x, dz = ball.pos.z - this.pos.z;
    const wx = ball.vel.x - this.vel.x, wz = ball.vel.z - this.vel.z;
    const w2 = wx * wx + wz * wz;
    if (w2 < 9) return; // slow balls are just collected
    const ta = -(dx * wx + dz * wz) / w2;
    if (ta <= 0.04 || ta > 0.42) return;
    const mx = dx + wx * ta, mz = dz + wz * ta;
    if (Math.hypot(mx, mz) > 0.6) return;
    if (ball.lastTouch === this && this.game.time - this.lastTouchTime < 0.3) return;
    const h = Math.max(R, ball.pos.y + ball.vel.y * ta - 4.9 * ta * ta);
    const f = this.forward, lat = mx * -f.z + mz * f.x; // + = ball to my left? (right = f x up)
    const side = (mx * this.rightDir.x + mz * this.rightDir.z) >= 0 ? 'Right' : 'Left';
    let type = null;
    if (h < 0.38) type = 'trapFoot';
    else if (h < 0.95) type = 'trapThigh';
    else if (h < 1.5) type = 'trapChest';
    else if (h < 2.05) type = 'header';
    if (!type) return;
    void lat;
    const c = 0.4;
    this.receive = { type, side, t: 0, ta, h };
    this.char.play(type, { side: type === 'trapFoot' ? side : 'Right', contact: c, duration: clamp(ta / c, 0.32, 0.8) });
  }

  /** the ball met my body while I was ready for it: cushion it, or head it on */
  completeReceive(part) {
    const r = this.receive; if (!r) return false;
    const ok = { trapFoot: ['foot', 'shin'], trapThigh: ['thigh', 'hips', 'shin'], trapChest: ['chest', 'hips', 'head'], header: ['head', 'chest'] }[r.type];
    if (!ok.includes(part)) return false;
    const g = this.game, ball = g.ball;
    const rel = Math.hypot(ball.vel.x - this.vel.x, ball.vel.y, ball.vel.z - this.vel.z);
    const m = this.intent.move, hasDir = m.lengthSq() > 0.09;
    const dir = hasDir ? new THREE.Vector3(m.x, 0, m.y).normalize() : this.forward.clone();
    if (r.type === 'header') {
      const aim = hasDir ? dir : this.goalTarget().sub(this.pos).setY(0).normalize();
      const sp = clamp(4 + rel * 0.5, 5, 14), el = hasDir ? 0.05 : 0.12;
      ball.vel.set(aim.x * sp * Math.cos(el), Math.sin(el) * sp, aim.z * sp * Math.cos(el));
      g.sfx.head(rel);
      g.squashBall(aim, 0.08 + rel / 60);
    } else {
      // a soft first touch, steered where I'm holding the stick
      const touch = hasDir ? clamp(1.6 + rel * 0.12, 1.6, 4.2) : 0.3 + rel * 0.03;
      ball.vel.set(this.vel.x * 0.85 + dir.x * touch, 0, this.vel.z * 0.85 + dir.z * touch);
      if (r.type === 'trapFoot') ball.vel.y = 0.1;
      if (r.type === 'trapThigh') ball.vel.y = -0.4;
      if (r.type === 'trapChest') { ball.vel.y = -0.9; ball.vel.x += dir.x * 0.3; ball.vel.z += dir.z * 0.3; }
      ball.spin.multiplyScalar(0.15);
      if (r.type === 'trapFoot') g.sfx.touch(); else g.sfx.body(rel);
      g.squashBall(new THREE.Vector3(ball.pos.x - this.pos.x, 0.2, ball.pos.z - this.pos.z), rel / 70);
    }
    this._took(0.22);
    this.ignoreBall = 0.15;
    this.receive = null;
    return true;
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
      // reach in, meet the ball, then let the leg flow back into the stride
      const u = clamp(t.t / t.dur, 0, 1.4);
      ik[s].w = 0.95 * smoothstep(u / 0.7) * (u > 0.8 ? clamp(1 - (u - 0.8) / 0.5, 0, 1) : 1);
      // the ankle goes to just behind the ball, a touch to the side of the boot that plays it
      const side = (s === 'R' ? 1 : -1) * 0.04;
      ik[s].target.copy(ball.pos).addScaledVector(f, -(R - 0.01)).addScaledVector(this.rightDir, side);
      ik[s].target.y = ankleH + 0.02;
    }
    // reaching for an incoming ground ball with the inside of the foot
    const rc = this.receive;
    if (rc && rc.type === 'trapFoot') {
      const sd = rc.side === 'Left' ? 'L' : 'R';
      const left = Math.max(0, rc.ta - rc.t);
      const u = rc.t / Math.max(rc.ta, 0.05);
      ik[sd].w = Math.exp(-(((u - 1) / 0.45) ** 2)) * 0.75;
      const v = ball.vel, sp = Math.hypot(v.x, v.z) || 1;
      ik[sd].target.set(ball.pos.x + v.x * left + (v.x / sp) * (R + 0.05), ankleH + 0.05, ball.pos.z + v.z * left + (v.z / sp) * (R + 0.05));
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
  /** direction an armed strike will go (the pass target or the shot aim) */
  armedAim(out = new THREE.Vector3()) {
    const am = this.armed;
    if (am && am.type === 'pass') {
      const r = am.passTo && !am.passTo.out ? am.passTo : this.mate;
      if (r) { const t = this.passLead(r, am.power); out.set(t.x - this.pos.x, 0, t.z - this.pos.z); if (out.lengthSq() > 1e-4) return out.normalize(); }
    }
    return this.aimDir(out);
  }

  /** could a strike started now meet the ball at the contact moment? */
  _inStrikeReach(type) {
    const ball = this.game.ball;
    const d = Math.hypot(ball.pos.x - this.pos.x, ball.pos.z - this.pos.z);
    if (ball.pos.y > (type === 'chip' ? 0.55 : 0.9)) return false;
    if (d < 0.75) return true;
    const dur = ANIM.kickDuration * (type === 'pass' ? 0.82 : 1);
    const ct = dur * ANIM.kickContact;
    const t = this._approachTarget(ct, this.armed ? this.armedAim(this._r2 || (this._r2 = new THREE.Vector3())) : this.aimDir(new THREE.Vector3()));
    return !!t && Math.hypot(t.x - this.pos.x, t.z - this.pos.z) < 9 * ct * 0.8;
  }

  _armedSpot(speed) {
    const ball = this.game.ball, aim = this.armedAim(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(aim, UP), q = new THREE.Vector3();
    for (let t = 0; t <= 1.2; t += 0.05) {
      ball.predict(t, q);
      const x = q.x - aim.x * this.reachF - right.x * this.reachS, z = q.z - aim.z * this.reachF - right.z * this.reachS;
      if (Math.hypot(x - this.pos.x, z - this.pos.z) <= speed * t + 0.3) return { x, z };
    }
    return { x: q.x - aim.x * this.reachF, z: q.z - aim.z * this.reachF };
  }

  _release() {
    const power = Math.max(0.12, this.charge);
    let type = this.chargeType;
    this.charging = false; this.charge = 0;
    const g = this.game;
    // the ball isn't there yet: keep the strike ready and go and meet it
    if (!this._inStrikeReach(type)) {
      const b = g.ball, bd = Math.hypot(b.pos.x - this.pos.x, b.pos.z - this.pos.z);
      if (bd < 6 && b.pos.y < 2 && g.state === 'play') {
        this.armed = { type, power, passTo: this.passTo, t: 0 };
        this.char.windup = 0;
        return;
      }
    }
    const aim = this.aimDir(new THREE.Vector3());
    // a pass: aimed at where the team-mate will be, weighted to arrive at a comfortable pace
    let passSpeed = 0;
    this.passTarget = null;
    if (type === 'pass') {
      const rcv = this.passTo && !this.passTo.out ? this.passTo : this.mate;
      if (rcv) {
        const t = this.passLead(rcv, power);
        aim.set(t.x - this.pos.x, 0, t.z - this.pos.z).normalize();
        passSpeed = t.speed; this.passTarget = rcv;
      } else passSpeed = 6 + 10 * power;            // team-mate gone: a plain ground pass where I'm aiming
    }
    this.passTo = null;

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

    const dur = ANIM.kickDuration * (type === 'kick' ? 1.08 - 0.16 * power : type === 'pass' ? 0.86 - 0.08 * power : 1.0);
    const contactT = dur * ANIM.kickContact;
    this.kick = { type, power, aim, t: 0, dur, contactT, hit: false, resolved: false, passSpeed };
    this.receive = null; this.touch = null;
    this.kick.approach = this._approachTarget(contactT, aim);
    // passes are side-footed; a hard driven pass swings more like a strike
    if (type === 'pass') this.char.play(power > 0.75 ? 'kick' : 'pass', { duration: dur, side: 'Right', amp: power > 0.75 ? 0.75 : 0.8 + 0.4 * power });
    else this.char.play(type, { duration: dur, side: 'Right', amp: 0.85 + 0.3 * power });
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
      if (d < R + (k.type === 'pass' ? 0.1 : 0.075)) { k.resolved = true; this._contact(true); }
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
    else if (k.type === 'pass') { speed = k.passSpeed; elev = 0.02; }
    else { speed = PLAYER.shotSpeed[0] + PLAYER.shotSpeed[1] * p; elev = 0.03 + 0.15 * Math.pow(p, 1.4) + (volley ? 0.06 : 0); }
    if (k.type !== 'pass') {
      speed *= 0.82 + 0.18 * quality;
      // running into the shot adds pace
      speed += Math.max(0, this.vel.x * k.aim.x + this.vel.z * k.aim.z) * 0.55;
    }
    // where the boot met the ball: off-centre contact slices, low contact lifts
    let slice = 0;
    if (footTouched) {
      const toe = this.char.footPos('R', this._fa);
      slice = clamp((ball.pos.x - toe.x) * right.x + (ball.pos.z - toe.z) * right.z, -R, R) / R; // -1..1
      elev += clamp((ball.pos.y - toe.y - R * 0.6) * 0.5, -0.04, 0.1);
    }
    // shot error: rushed / mishit / power shots are less accurate
    const gd = this.goalTarget().distanceTo(this.pos);
    let err = ((1 - quality) * 0.1 + Math.pow(p, 3) * 0.06 * (1.3 - this.skill) + gd * 0.004) * (Math.random() * 2 - 1);
    if (k.type === 'pass') { err *= 0.15 + 0.35 * p * p; slice = 0; }  // side-foot: accurate, a driven pass a little less so
    const dir = k.aim.clone().applyAxisAngle(UP, err - slice * 0.06);
    elev += (1 - quality) * 0.05 * (Math.random() - 0.3);
    const vel = dir.multiplyScalar(Math.cos(elev) * speed); vel.y = Math.sin(elev) * speed;
    // spin: lateral input at contact = curl; chips get backspin, drives get topspin
    const m = this.intent.move;
    const r2 = new THREE.Vector3().crossVectors(k.aim, UP);
    let lateral = 0;
    if (m.lengthSq() > 0.09) lateral = -(m.x * r2.x + m.y * r2.z); // + = towards player's left
    const spin = new THREE.Vector3();
    if (k.type === 'pass') { lateral = 0; spin.addScaledVector(r2, -speed / R * 0.5); }   // rolls true along the grass
    else if (k.type === 'chip') spin.addScaledVector(r2, 28 * p);
    else spin.addScaledVector(r2, -8 * p);
    spin.y = lateral * 16 * p * (k.type === 'chip' ? 0.6 : 1) + slice * 9 * p;
    ball.strike(vel, spin, this);
    this.ignoreBall = 0.15;
    g.squashBall(dir, k.type === 'pass' ? 0.06 + 0.08 * p : 0.1 + 0.16 * p);
    if (p > 0.55 && k.type !== 'pass') g.fx('grass', this.char.anklePos('L', this._fb), { x: -k.aim.x, z: -k.aim.z }, Math.round(6 + 10 * p), 1.5 + p * 2);
    g.rumble(this, k.type === 'pass' ? 0.2 + 0.3 * p : 0.3 + 0.7 * p, 60 + 80 * p);
    this.char.face('aa', 0.6 + 0.4 * p); this.faceT = 0.35;
    this.lastTouchTime = g.time;
    this.passT = k.type === 'pass' ? g.time : -1;
    this.touchCD = 0.35;
    this.stats.touches++;
    g.onKick(this, k, vel);
  }

  /** automatic ball control: first touch, dribbling, shielding */
  handleBall(dt) {
    const g = this.game, ball = g.ball;
    if (this.frozen) { this.dribbling = false; return false; }
    if (this.kick && this.kick.t < this.kick.contactT + 0.1) { this.dribbling = false; return false; }
    const f = this.forward, r = this.rightDir;
    const rx = ball.pos.x - this.pos.x, rz = ball.pos.z - this.pos.z;
    const fwd = rx * f.x + rz * f.z, lat = rx * r.x + rz * r.z;
    const dist = Math.hypot(rx, rz);
    const by = ball.pos.y;

    if (this.stunT > 0 || this.slide || this.dive) { this.dribbling = false; return false; }
    this._anticipate();
    // a receive in progress owns the ball's arrival
    if (this.receive) {
      this.dribbling = false; this.touch = null;
      const r = this.receive;
      if (r.t > r.ta + 0.06 && dist < 0.75 + R && by < 2.1) {
        // didn't quite meet the planned body part: take it with whatever is closest
        const part = by > 1.45 ? 'head' : by > 0.9 ? 'chest' : by > 0.36 ? 'thigh' : 'foot';
        if (this.completeReceive(part)) return true;
      }
      return false;
    }

    // ---- dribbling: the ball is under my control ----------------------------------
    if (this._dribble(dt, dist, by)) return true;
    this.touch = null;

    if (this.touchCD > 0) return false;
    const inZone = fwd > -0.15 && fwd < 0.95 + R && Math.abs(lat) < 0.6 && dist < 1.0 + R;
    if (!inZone || by > 1.5) return false;

    const rvx = ball.vel.x - this.vel.x, rvz = ball.vel.z - this.vel.z;
    const rel = Math.hypot(rvx, rvz, ball.vel.y);
    const approaching = rvx * -rx + rvz * -rz > 0;

    // first touch of a fast or bouncing ball that I didn't see coming
    if ((rel > 5.5 && approaching) || (by > 0.45 && approaching)) {
      if (rel > 19 && by < 0.5) return false; // too hot to handle: it just ricochets
      const keep = by > 0.45 ? 0.08 : 0.14;
      ball.vel.x = this.vel.x * 0.9 + rvx * keep; ball.vel.z = this.vel.z * 0.9 + rvz * keep;
      ball.vel.y = by > 0.45 ? -0.6 : 0;
      ball.spin.multiplyScalar(0.2);
      this.char.play('trap', { side: 'Right' });
      if (by < 0.45) this.trapT = 0.32;
      g.sfx.touch();
      this._took(0.12);
      return true;
    }
    if (by > 0.4) return false;
    // a slow ball at my feet: it's mine now
    if (ball.lastTouch !== this) this.stats.touches++;
    ball.lastTouch = this; this.lastTouchTime = g.time;
    this.dribbleT = 0; this.knockT = 0.2;
    const side = lat > 0 ? 'Right' : 'Left';
    this.char.play('touch', { side, amp: 0.8 });
    g.sfx.touch();
    return true;
  }

  /**
   * Close control. While I have the ball, it is kept in front of my feet in the
   * direction I want to go: its velocity relative to me is steered towards a
   * point a stride ahead (a critically damped spring), and every few steps a
   * visible touch knocks it on a little further. Turning takes a touch that
   * swings the ball round to the new direction. The ball is only lost to a shot,
   * a tackle, an opponent's foot or body, or a hard bounce off something.
   */
  _dribble(dt, dist, by) {
    const g = this.game, ball = g.ball;
    const mine = ball.lastTouch === this && g.time - this.lastTouchTime < 0.45;
    const rvx = ball.vel.x - this.vel.x, rvz = ball.vel.z - this.vel.z;
    const relSp = Math.hypot(rvx, rvz);
    if (!mine || dist > 1.7 || by > 0.55 || relSp > 7.5 || ball.goalTeam >= 0) { this.dribbling = false; return false; }
    if (this.kick && this.kick.t >= this.kick.contactT - 0.02) { this.dribbling = false; return false; }

    const sp = Math.hypot(this.vel.x, this.vel.z);
    const it = this.intent;
    const wants = it.move.lengthSq() > 0.04;
    // direction the ball should go: where I'm steering, else where I'm facing
    const d = this._v;
    if (this.charging) this.aimDir(d);
    else if (wants) d.set(it.move.x, 0, it.move.y).normalize();
    else d.copy(this.forward);

    this.dribbling = true;
    this.dribbleT = (this.dribbleT || 0) + dt;
    this.knockT = Math.max(0, (this.knockT || 0) - dt);

    // how far ahead: the ball comes back to within a stride of the boots before each
    // touch, and a touch sends it out ahead again (further when running / sprinting)
    const sprinting = it.sprint && sp > PLAYER.runSpeed * 0.9;
    const near = 0.25 + R + Math.min(sp, PLAYER.runSpeed) * 0.016;   // within a boot's reach
    const push = 0.2 + Math.min(sp, PLAYER.runSpeed) * 0.05 + (sprinting ? 0.45 : 0);
    const kd = this.knockDur || 0.3;
    let ahead = near + push * Math.pow(clamp(this.knockT / kd, 0, 1), 0.7);
    if (!wants && sp < 1) ahead = 0.3 + R;                 // standing: ball at the boot
    if (this.charging) ahead = 0.3 + R + 0.1;              // set it up for the strike
    const tgt = this._w.set(this.pos.x + d.x * ahead, 0, this.pos.z + d.z * ahead);
    clampToArena(tgt, R + 0.04);              // never steer the ball into the boards
    pushOutOfObstacles(tgt, R + 0.05);        // or into a planter
    const tx = tgt.x, tz = tgt.z;

    // is the ball behind / beside me relative to where I'm going? then it needs a turn touch
    const bx = ball.pos.x - this.pos.x, bz = ball.pos.z - this.pos.z;
    const bl = Math.hypot(bx, bz) || 1;
    const cosA = (bx * d.x + bz * d.z) / bl;
    const turning = wants && cosA < 0.5 && bl > 0.25;

    // desired relative velocity towards the target, capped so it reads as rolling
    const kp = turning ? 7 : 5.5;
    let dvx = (tx - ball.pos.x) * kp, dvz = (tz - ball.pos.z) * kp;
    const cap = turning ? 6.5 : 4.5, m = Math.hypot(dvx, dvz);
    if (m > cap) { dvx *= cap / m; dvz *= cap / m; }
    // swing round the body rather than through it when turning
    if (turning) {
      const cross = bx * d.z - bz * d.x; // which way round is shorter
      const s2 = cross > 0 ? 1 : -1, px = -bz / bl * s2, pz = bx / bl * s2;
      dvx += px * 1.8; dvz += pz * 1.8;
    }
    const kv = 1 - Math.exp(-dt * (this.knockT > 0 ? 6 : 11));
    ball.vel.x = this.vel.x + rvx + (dvx - rvx) * kv;
    ball.vel.z = this.vel.z + rvz + (dvz - rvz) * kv;
    if (by < R + 0.05) ball.vel.y = Math.min(ball.vel.y, 0.6);
    ball.spin.y *= 0.9;
    this.lastTouchTime = g.time;

    // visible touches, in step with the run: each boot plays the ball as it swings
    // through (late swing, just before it plants), or a turn touch when changing direction
    const interval = sprinting ? 0.5 : sp > 3 ? 0.42 : 0.55;
    const fwdNow = bx * d.x + bz * d.z;
    const latNow = bx * this.rightDir.x + bz * this.rightDir.z;
    if (!this.touch && !this.charging && !this.kick) {
      const ph = this.char.phase;
      const swing = ph > 0.17 && ph < 0.37 ? 'Right' : ph > 0.67 && ph < 0.87 ? 'Left' : null;
      const back = fwdNow < near + 0.07;                    // ball has come back within reach
      const due = wants && sp > 0.8 && swing && back && this.dribbleT > interval * 0.6;
      const overdue = wants && sp > 0.8 && this.dribbleT > interval * 2.4;   // never let it drift
      if (turning || due || overdue) {
        let side = turning ? (latNow >= 0 ? 'Right' : 'Left') : swing || this.nextFoot;
        if (!turning && Math.abs(latNow) > 0.12) side = latNow > 0 ? 'Right' : 'Left';
        this.nextFoot = side === 'Right' ? 'Left' : 'Right';
        this.touch = { t: 0, dur: clamp(0.18 - sp * 0.01, 0.11, 0.17), side, turn: turning };
        this.char.play('touch', { side, amp: 0.7 + Math.min(0.45, sp / 12), duration: this.touch.dur / 0.62 });
        this.dribbleT = 0;
      }
    }
    if (this.touch) {
      const tt = this.touch; tt.t += dt;
      // the push happens when the boot actually gets to the ball (or as the swing ends)
      let reached = false;
      if (tt.t >= tt.dur * 0.35) {
        const s = tt.side === 'Left' ? 'L' : 'R';
        const toe = this.char.footPos(s, this._fa), ank = this.char.anklePos(s, this._fb);
        const ab = toe.sub(ank), u = clamp(this._r.copy(ball.pos).sub(ank).dot(ab) / Math.max(ab.lengthSq(), 1e-6), 0, 1);
        reached = ank.addScaledVector(ab, u).distanceTo(ball.pos) < R + 0.06;
      }
      if ((reached || tt.t >= tt.dur * 0.9) && !tt.done) {
        tt.done = true;
        this.knockDur = tt.turn ? 0.12 : interval * 0.75;
        this.knockT = this.knockDur;
        ball.vel.y = Math.max(ball.vel.y, 0.25 + Math.random() * 0.2);
        ball.pos.y = Math.max(ball.pos.y, R + 0.005);
        g.sfx.touch();
        this.stats.touches++;
      }
      if (tt.t >= tt.dur * 1.3) this.touch = null;
    }
    return true;
  }

  _took(cd) {
    const g = this.game;
    g.ball.lastTouch = this;
    this.lastTouchTime = g.time;
    this.touchCD = cd;
    this.stats.touches++;
  }
}
