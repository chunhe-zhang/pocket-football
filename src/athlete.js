import * as THREE from 'three';
import { FIELD, PLAYER, ANIM, BALL, GOALS, CHAR, clampToArena, pushOutOfObstacles, inOwnBox, padAt, route } from './config.js';

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
    this.gi = team;          // the goal I defend (5v5: my side's goal)
    this.role = null;        // 5v5: 'gk' | 'defL' | 'defR' | 'attL' | 'attR'
    this.charId = 'thunder'; // character: decides the special shot
    this.energy = 0;         // special-shot meter, 0..1
    this.iceT = 0;           // frozen solid by an ice shot
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
    this.poke = null;        // standing tackle in progress
    this.trick = null;       // sidestep (闪身步) in progress
    this.header = null;      // going for a header
    this.skillCD = 0; this.burstT = 0;
    this.stats.tackles = 0; this.stats.skills = 0;
    this.dive = null;
    this.stunT = 0;          // knocked off balance by a tackle or a hard bump
    this.receive = null;     // anticipated first touch: { type, side, t, ta }
    this.ignoreBall = 0;     // own legs don't collide with the ball right after striking it
    this.colliders = null;
    this._fa = new THREE.Vector3(); this._fb = new THREE.Vector3();
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._f = new THREE.Vector3(); this._r = new THREE.Vector3();
  }

  get home() { return GOALS[this.gi] || GOALS[0]; }             // the goal I defend
  get charDef() { return CHAR[this.charId] || CHAR.thunder; }
  /** the goal mouth centres I can score in */
  get targets() { return GOALS.filter((g) => !this.game.friendlyGoal(this, g.team) && this.game.activeGoal(g.team)); }
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
    this.poke = null; this.trick = null; this.burstT = 0; this.header = null;
    this.char.gestures = this.char.gestures.filter((g) => g.loop);
    this.char.teleported();
    this._sync(0);
  }

  /** most attractive goal to shoot at: close, and its owner away from it */
  goalTarget() {
    let best = null, bestCost = Infinity;
    for (const g of this.targets) {
      // on the track the distance that matters is the way round the flower beds
      const d = FIELD.islands.length ? route(this.pos.x, this.pos.z, g.centre.x + g.inward.x * 0.8, g.centre.z + g.inward.z * 0.8).dist : Math.hypot(g.centre.x - this.pos.x, g.centre.z - this.pos.z);
      const owner = this.game.keeperOf(g.team);
      const guard = owner ? Math.hypot(owner.pos.x - g.centre.x, owner.pos.z - g.centre.z) : 10;
      const cost = d - Math.min(guard, 8) * 0.6;
      if (cost < bestCost) { bestCost = cost; best = g; }
    }
    best = best || GOALS[(this.gi + 1) % GOALS.length];
    return new THREE.Vector3(best.centre.x, 0, best.centre.z);
  }

  /** Direction the player wants to play the ball in. */
  aimDir(out = new THREE.Vector3()) {
    // no auto-aim: while charging, the aim is the angle the player has dialled in
    if ((this.charging || this.armed) && this.aimAng !== undefined) return out.set(Math.sin(this.aimAng), 0, Math.cos(this.aimAng));
    const m = this.intent.move;
    if (m.lengthSq() > 0.09) out.set(m.x, 0, m.y).normalize();
    else out.copy(this.forward);
    return out;
  }

  /**
   * Fine aim while charging. The first frame takes the stick direction (or where I face);
   * after that a digital stick (keyboard) turns the aim gradually towards where it points,
   * so a tap nudges it a few degrees, while an analog stick (pad / touch / CPU) sets it directly.
   */
  _steerAim(dt, first) {
    const m = this.intent.move, has = m.lengthSq() > 0.09;
    const want = has ? Math.atan2(m.x, m.y) : null;
    if (first) { this.aimAng = want ?? this.facing; return; }
    if (want === null) return;
    if (this.intent.analog) { this.aimAng = want; return; }
    const d = wrapAngle(want - this.aimAng);
    const rate = 1.9;                                    // rad/s: about 110°/s, ~2° per frame
    this.aimAng = wrapAngle(this.aimAng + clamp(d, -rate * dt, rate * dt));
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
    const q = this._pl || (this._pl = new THREE.Vector3());
    q.set(tx, 0, tz); clampToArena(q, 0.8); pushOutOfObstacles(q, 0.6);
    return { x: q.x, z: q.z, speed: sp };
  }

  update(dt) {
    const it = this.intent, g = this.game;
    if (!this.charging) this.char.windup = 0;
    this.touchCD = Math.max(0, this.touchCD - dt);
    this.slideCD = Math.max(0, this.slideCD - dt);
    this.skillCD = Math.max(0, this.skillCD - dt);
    this.burstT = Math.max(0, this.burstT - dt);
    this.knockFree = Math.max(0, (this.knockFree || 0) - dt);
    this._skillTick(dt);
    this.stunT = Math.max(0, this.stunT - dt);
    this.ignoreBall = Math.max(0, this.ignoreBall - dt);
    if (this.receive) { this.receive.t += dt; if (this.receive.t > this.receive.ta + 0.3) this.receive = null; }

    // ---- slide tackle ------------------------------------------------------------
    const tacklePressed = it.tackle && !this._prevTackle;
    this._prevTackle = it.tackle;
    if (tacklePressed && !this.frozen && !this.slide && !this.dive && !this.kick && !this.poke && !this.trick && this.stunT <= 0 && g.state === 'play') {
      const b = g.ball, bd = Math.hypot(b.pos.x - this.pos.x, b.pos.z - this.pos.z);
      const holder = g.possessor;
      const mine = holder === this || (this.dribbling && b.lastTouch === this);
      if (mine) {
        // with the ball, the tackle button is a skill move
        if (this.skillCD <= 0 && !this.charging) this._startSkill();
      } else if (this.slideCD <= 0) {
        const sp = Math.hypot(this.vel.x, this.vel.z);
        const mateHas = holder && g.sameSide(holder.team, this.team);
        // in my own penalty box the tackle button is a goalkeeper dive
        if (inOwnBox(this.gi, this.pos.x, this.pos.z) && (!this.role || this.role === 'gk')) this._startDive();
        else if (mateHas && bd < 2.5) { /* never tackle my own team-mate */ }
        else if (bd < 1.75 && b.pos.y < 0.8 && !(it.sprint && sp > 5.6)) this._startPoke();
        else this._startSlide();
      }
    }

    // ---- charging / release: 爆射 (kick) or 挑射 (chip); a ball in the air gets headed ------
    const wantShot = it.kick || it.lob;
    const pressedKick = it.kick && !this._prevKick, pressedLob = it.lob && !this._prevLob;
    this._prevKick = it.kick; this._prevLob = it.lob;
    if (this.header) this._headerMotionTick(dt);
    if (this.frozen || this.slide || this.dive || this.poke || this.stunT > 0) { this.charging = false; this.charge = 0; }
    else if (!this.kick && !this.header) {
      if ((pressedKick || pressedLob) && !this.charging && g.state === 'play' && (this._headerChance() || (pressedLob && this._headerChance(true)))) {
        this._startHeader(pressedLob);
      } else if (wantShot && !this.charging && g.state !== 'menu') {
        this.charging = true; this.charge = 0; this.chargeHold = 0; this.armed = null;
        this.chargeType = it.lob ? 'chip' : 'kick';
        this._steerAim(dt, true);
      }
      if (this.charging) {
        if (it.lob && this.chargeType === 'kick') this.chargeType = 'chip';
        this._steerAim(dt, false);
        const held = wantShot;
        this.charge = Math.min(1, this.charge + dt / PLAYER.chargeTime);
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
    else if (this.poke) this._pokeMotion(dt);
    else if (this.header && this.header.jumped && (this.header.kind === 'dive' || this.header.kind === 'bicycle')) this._headerBodyMotion(dt);
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
      if (this.burstT > 0) target *= 1.3;                 // after a knock-on / feint: explode away
      target *= this.speedMul;
      // speed strips: faster running with the arrows, heavy going against them
      if (FIELD.pads.length && mag > 0.05) {
        const pad = padAt(this.pos.x, this.pos.z);
        if (pad) {
          const along = (it.move.x * pad.dx + it.move.y * pad.dz) / mag;
          target *= along > 0.3 ? 1.38 : along < -0.3 ? 0.78 : 1;
        }
      }
      const desired = this._v.set(it.move.x, 0, it.move.y);
      if (mag > 0.05) desired.normalize().multiplyScalar(target * (mag < 0.25 ? mag / 0.25 : 1)); else desired.set(0, 0, 0);
      if (this.trick) this._skillMove(desired, target);
      if (this.header && !this.header.hit && !this.frozen && this.header.spot) {
        const sp = (it.sprint && !this.exhausted ? PLAYER.sprintSpeed : PLAYER.runSpeed) * this.speedMul;
        desired.set(this.header.spot.x - this.pos.x, 0, this.header.spot.z - this.pos.z);
        const dl = desired.length();
        if (dl > 0.03) desired.multiplyScalar(Math.min(sp, dl * 7) / dl); else desired.set(0, 0, 0);
      }
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
      this.stamina = clamp(this.stamina + (sprinting ? -PLAYER.staminaDrain * (this.burstT > 0 ? 1.6 : 1) : PLAYER.staminaRegen) * dt, 0, 1);
      if (this.stamina <= 0.01) this.exhausted = true; else if (this.stamina > 0.3) this.exhausted = false;

      // facing
      let want = null;
      if (this.trick) want = this._skillFacing();
      else if (this.header && !this.header.hit) { const d = this.header.aim; want = this.header.bike ? Math.atan2(-d.x, -d.z) : Math.atan2(d.x, d.z); }
      else if (this.charging) { const d = this.aimDir(this._w); want = Math.atan2(d.x, d.z); }
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
      this._turnTo(want, dt, this.trick ? 16 : this.charging ? 9 : PLAYER.turnRate);
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
      c.active = !(leg && (controlling || this.ignoreBall > 0 || (this.kick && !this.kick.resolved) || this.touch || this.holdW > 0.05 || this.poke)) && !(lower && this.dribbling);
      if (this.slide && leg && c.side === 'R') c.active = false;
      if (this.header && (!this.header.hit || this.header.t < this.header.hitT + 0.3) && (c.part === 'head' || c.part === 'chest' || (this.header.jumped && (lower || c.part === 'hand')))) c.active = false;
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
        // a skill move in progress: the ball is lifted / rolled over the sliding boot
        const carrier = g.possessor;
        if (carrier && carrier !== this && carrier.dodging && Math.random() < 0.6) { ball.vel.y = Math.max(ball.vel.y, 2.2); g.sfx.touch(); return; }
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
    this.kick = null; this.armed = null; this.charging = false; this.charge = 0; this.touch = null; this.receive = null; this.slide = null; this.dive = null; this.poke = null; this.trick = null; this.header = null;
    this.char.play('stagger', { duration: this.stunT + 0.15 });
    this.char.face('surprised', 0.8); this.faceT = 0.6;
    this.game.rumble(this, 0.8, 140);
  }

  /** hit by a special shot: lightning paralyses, fire bowls you over, ice freezes you solid, the cannon flattens you */
  zap(kind, dir) {
    if (this.frozen) return;
    if (kind === 'frost') {
      this.knock(dir, 0); this.vel.set(0, 0, 0);
      this.stunT = 1.8; this.iceT = 1.8;
      this.char.face('surprised', 1); this.faceT = 1.8;
    } else if (kind === 'thunder') {
      this.knock(dir, 1); this.vel.multiplyScalar(0.3);
      this.stunT = 1.3;
      this.char.play('stagger', { duration: 1.4 }); this.char.face('surprised', 1); this.faceT = 1.3;
    } else {
      const s = kind === 'cannon' ? 11 : 8;
      this.knock(dir, s); this.vel.copy(dir).multiplyScalar(s * 0.75);
      this.stunT = kind === 'cannon' ? 1.2 : 1.0;
      this.char.play('stagger', { duration: this.stunT + 0.2 });
    }
    this.game.rumble(this, 1, 260);
  }

  // ---- standing tackle -----------------------------------------------------------------
  _startPoke() {
    const g = this.game, b = g.ball;
    const p = b.predict(0.15, this._v);
    const dir = new THREE.Vector3(p.x - this.pos.x, 0, p.z - this.pos.z);
    if (dir.lengthSq() < 1e-4) dir.copy(this.forward); dir.normalize();
    const lat = (b.pos.x - this.pos.x) * this.rightDir.x + (b.pos.z - this.pos.z) * this.rightDir.z;
    this.poke = { t: 0, dur: 0.5, dir, done: false, ok: null };
    this.facing = Math.atan2(dir.x, dir.z);
    this.charging = false; this.charge = 0; this.receive = null; this.touch = null; this.armed = null;
    this.slideCD = 0.75;
    this.char.play('poke', { side: lat >= 0 ? 'Right' : 'Left', duration: 0.5 });
    this.char.face('angry', 0.5); this.faceT = 0.4;
  }

  _pokeMotion(dt) {
    const pk = this.poke, g = this.game, ball = g.ball;
    pk.t += dt;
    // the lunge follows the ball until the boot goes in
    if (pk.t < 0.24 && !pk.done) {
      const q = ball.predict(0.08, this._r);
      const hx = q.x - this.pos.x, hz = q.z - this.pos.z, hl = Math.hypot(hx, hz);
      if (hl > 0.05) { pk.dir.x += (hx / hl - pk.dir.x) * Math.min(1, dt * 10); pk.dir.z += (hz / hl - pk.dir.z) * Math.min(1, dt * 10); pk.dir.normalize(); }
    }
    // a quick lunge at the ball, then recover (slowly if I missed)
    const lunge = pk.t < 0.2 ? 5.2 : pk.ok === false ? 0.6 : Math.max(0, 5.2 * (1 - (pk.t - 0.2) / 0.15));
    const want = this._w.copy(pk.dir).multiplyScalar(lunge);
    this.vel.lerp(want, Math.min(1, dt * 14));
    this.pos.addScaledVector(this.vel, dt);
    this._turnTo(Math.atan2(pk.dir.x, pk.dir.z), dt, 14);
    if (!pk.done && pk.t > 0.1 && pk.t < 0.34) {
      const fx = this.pos.x + pk.dir.x * 0.62, fz = this.pos.z + pk.dir.z * 0.62;
      if (Math.hypot(ball.pos.x - fx, ball.pos.z - fz) < 0.42 + R && ball.pos.y < 0.7) { pk.done = true; this._resolvePoke(); }
    }
    if (!pk.done && pk.t >= 0.34) { pk.done = true; pk.ok = false; }
    if (pk.t >= pk.dur + (pk.ok === false ? 0.22 : 0)) this.poke = null;
  }

  /** did the standing tackle win the ball? depends on angle, shielding and timing */
  _resolvePoke() {
    const g = this.game, ball = g.ball, pk = this.poke;
    const carrier = g.possessor && g.possessor !== this ? g.possessor : (ball.lastTouch && ball.lastTouch !== this && ball.lastTouch.dribbling ? ball.lastTouch : null);
    let chance = 1;
    if (carrier) {
      chance = 0.74;
      // the carrier's body between me and the ball: shielded
      const bx = ball.pos.x - carrier.pos.x, bz = ball.pos.z - carrier.pos.z, mx = this.pos.x - carrier.pos.x, mz = this.pos.z - carrier.pos.z;
      const cos = (bx * mx + bz * mz) / ((Math.hypot(bx, bz) * Math.hypot(mx, mz)) || 1);
      if (cos < -0.2) chance *= 0.38;
      else if (cos > 0.5) chance *= 1.15;                  // ball on my side of them: easy pickings
      // from behind is harder (and clumsy)
      const f = carrier.forward;
      if ((mx * f.x + mz * f.z) / (Math.hypot(mx, mz) || 1) < -0.35) chance *= 0.7;
      if (carrier.dodging) chance *= 0.08;                 // caught out by a skill move
      if (carrier.charging || carrier.kick) chance *= 1.2;  // busy setting up a shot
      if (carrier.stunT > 0) chance = 1;
    }
    const c = this.game.controllers[this.team];
    if (c && c.type === 'ai') chance *= 0.55 + 0.45 * this.skill;
    if (Math.random() < Math.min(0.97, chance)) {
      pk.ok = true;
      // the ball is prised away from the carrier, out to my side where I can collect it
      const d = this._w.copy(pk.dir);
      if (carrier) {
        const ax = this.pos.x - carrier.pos.x, az = this.pos.z - carrier.pos.z, al = Math.hypot(ax, az) || 1;
        d.set(pk.dir.x * 0.35 + (ax / al) * 0.65, 0, pk.dir.z * 0.35 + (az / al) * 0.65).normalize();
      }
      const lat = (Math.random() - 0.5) * 1.2;
      const sp = carrier ? 2.6 + Math.random() * 1.2 : 3.6 + Math.random() * 1.8;
      ball.vel.set(d.x * sp - d.z * lat, 0.3, d.z * sp + d.x * lat);
      ball.spin.set(0, (Math.random() - 0.5) * 10, 0);
      ball.lastTouch = this; this.lastTouchTime = g.time; this.stats.touches++; this.stats.tackles++;
      if (carrier) {
        carrier.touchCD = 0.6; carrier.dribbling = false; carrier.touch = null; carrier.trick = null; carrier.armed = null;
        carrier.charging = false; carrier.charge = 0;
        carrier.stunT = Math.max(carrier.stunT, 0.28); carrier.vel.multiplyScalar(0.45);
        carrier.char.play('stagger', { duration: 0.4, amp: 0.5 });
      }
      this.touchCD = 0;
      g.sfx.kick(0.3); g.squashBall(pk.dir, 0.1); g.fx('grass', ball.pos, pk.dir, 8, 2);
      g.rumble(this, 0.5, 80);
      g.onTackle?.(this, carrier, true);
    } else {
      pk.ok = false;
      this.char.play('stagger', { duration: 0.45, amp: 0.45 });
      g.sfx.touch();
      g.onTackle?.(this, carrier, false);
    }
  }

  // ---- skill moves (过人) ----------------------------------------------------------------
  /** am I mid-move, with the ball where a tackler doesn't expect it? */
  get dodging() { const s = this.trick; return !!s && s.t > 0.04 && s.t < s.dur * 0.85; }

  _startSkill() {
    const g = this.game, it = this.intent, f = this.forward.clone(), r = this.rightDir.clone();
    const m = it.move, mag = Math.hypot(m.x, m.y);
    const fwd = mag > 0.3 ? (m.x * f.x + m.y * f.z) / mag : 0, lat = mag > 0.3 ? (m.x * r.x + m.y * r.z) / mag : 0;
    // 闪身步: one move — a quick hop sideways taking the ball with you. Which side: where the
    // stick leans, else away from the nearest opponent
    void fwd;
    const type = 'drag';
    let side = Math.abs(lat) > 0.25 ? (lat > 0 ? 1 : -1) : 0;
    if (!side) {
      let near = null, nd = 5;
      for (const o of g.live) { if (o === this || g.sameSide(o.team, this.team)) continue; const d = Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z); if (d < nd) { nd = d; near = o; } }
      side = near ? (((near.pos.x - this.pos.x) * r.x + (near.pos.z - this.pos.z) * r.z) > 0 ? -1 : 1) : (Math.random() < 0.5 ? 1 : -1);
    }
    const dur = 0.32;
    this.trick = { type, t: 0, dur, side, f, r, done: false };
    this.skillCD = 0.7;
    this.stamina = Math.max(0, this.stamina - 0.05);
    this.touch = null; this.stats.skills++;
    const foot = type === 'drag' ? (side > 0 ? 'Left' : 'Right') : side > 0 ? 'Right' : 'Left';
    this.trick.foot = foot;
    if (type === 'knock') {
      // push the ball well ahead and chase it
      const d = mag > 0.3 ? new THREE.Vector3(m.x, 0, m.y).normalize() : f;
      const sp = Math.hypot(this.vel.x, this.vel.z);
      const ball = g.ball;
      const ks = Math.max(sp, 5) + 5.4;
      ball.vel.set(d.x * ks, 0.5, d.z * ks);
      ball.lastTouch = this; this.lastTouchTime = g.time; this.touchCD = 0.3; this.ignoreBall = 0.2;
      this.burstT = 1.4; this.knockFree = 0.6;          // the ball runs free; I have to win the race to it
      this.char.play('touch', { side: foot, amp: 1.25, duration: 0.3 });
      g.sfx.kick(0.25);
    } else {
      this.char.play('sidestep', { side: side > 0 ? 'Right' : 'Left', duration: dur + 0.08 });
      g.sfx.touch();
    }
    if (type === 'feint') {
      // anyone close enough to see it bites
      for (const o of g.live) {
        if (o === this || g.sameSide(o.team, this.team)) continue;
        if (Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z) > 3.8) continue;
        const ai = g.controllers[o.team]?.ai;
        if (ai) ai.fool(this, side);
      }
    }
    g.onSkill?.(this, type);
  }

  /** skill moves steer the body (velocity) while _dribble steers the ball */
  _skillMove(desired, target) {
    const s = this.trick;
    if (s.type === 'feint') desired.copy(s.f).multiplyScalar(Math.min(target, 1.6));
    else if (s.type === 'drag') desired.copy(s.r).multiplyScalar(s.side * 5.6).addScaledVector(s.f, Math.min(target, 2.2));
    else if (s.type === 'dragback') desired.copy(s.f).multiplyScalar(s.t < 0.2 ? 0 : -2.6);
  }
  _skillFacing() {
    const s = this.trick;
    if (s.type === 'dragback' && s.t > 0.18) return Math.atan2(-s.f.x, -s.f.z);
    return Math.atan2(s.f.x, s.f.z);
  }
  _skillTick(dt) {
    const s = this.trick; if (!s) return;
    s.t += dt;
    if (s.t >= s.dur) {
      if (s.type === 'feint' || s.type === 'drag') this.burstT = Math.max(this.burstT, 0.5);
      this.trick = null;
    }
  }

  // ---- headers / bicycle kicks -------------------------------------------------------------
  /** is there a ball in the air I could get to with my head (or, bike = true, an overhead kick)? */
  _headerChance(bike = false) {
    const b = this.game.ball;
    if (b.pos.y < 0.45 && b.vel.y < 1.5) return false;          // on the ground: that's a kick
    return !!this._headerSpot(PLAYER.runSpeed * this.speedMul, bike);
  }
  /**
   * The first moment in the next 0.85 s the ball is somewhere I can meet it:
   * low and moving → diving header, chest-to-head height → standing, high → jumping header.
   * For a bicycle kick the ball has to drop in above head height, close by.
   */
  _headerSpot(speed, bike = false) {
    const b = this.game.ball, q = this._r;
    for (let t = 0; t <= 0.85; t += 0.033) {
      b.predict(t, q);
      const lo = bike ? 1.2 : 0.5, hi = bike ? 2.45 : 2.85;
      if (q.y < lo || q.y > hi) continue;
      const low = !bike && q.y < 1.05;
      if (low && (b.speed < 3.5 || t > 0.6)) continue;            // only dive at a ball that's coming
      const d = Math.hypot(q.x - this.pos.x, q.z - this.pos.z);
      const reach = bike ? 0.4 + speed * t * 0.6 : low ? 1.3 + speed * t : 0.45 + speed * t;
      if (d <= reach) return { x: q.x, z: q.z, y: q.y, t, kind: bike ? 'bicycle' : low ? 'dive' : q.y > 1.7 ? 'jump' : 'stand' };
    }
    return null;
  }
  _startHeader(lob) {
    const aim = this.aimDir(new THREE.Vector3());
    const bike = lob && !!this._headerSpot(PLAYER.runSpeed * this.speedMul, true);
    this.header = { t: 0, soft: lob && !bike, bike, hit: false, jumped: false, spot: null, aim, kind: null };
    this.charging = false; this.charge = 0; this.receive = null; this.touch = null; this.armed = null;
  }
  _headerMotionTick(dt) {
    const h = this.header, g = this.game, ball = g.ball;
    h.t += dt;
    if (h.hit) { if (h.t > h.hitT + (h.kind === 'bicycle' ? 0.9 : h.kind === 'dive' ? 0.6 : 0.35)) this.header = null; return; }
    // keep the aim live from the stick until contact
    const m = this.intent.move; if (m.lengthSq() > 0.09) h.aim.set(m.x, 0, m.y).normalize();
    const spot = h.jumped ? null : this._headerSpot((this.intent.sprint ? PLAYER.sprintSpeed : PLAYER.runSpeed) * this.speedMul, h.bike);
    if (spot) {
      h.kind = spot.kind;
      // stand just behind where the ball will be, relative to where it's going
      const back = spot.kind === 'bicycle' ? -0.25 : 0.12;
      h.spot = { x: spot.x - h.aim.x * back, z: spot.z - h.aim.z * back };
      const go = { dive: 0.3, jump: 0.34, stand: 0.2, bicycle: 0.3 }[spot.kind];
      if (spot.t < go) {
        h.jumped = true;
        if (spot.kind === 'dive') {
          const dx = spot.x - this.pos.x, dz = spot.z - this.pos.z, dl = Math.hypot(dx, dz) || 1;
          h.lunge = { x: dx / dl, z: dz / dl, sp: clamp(dl / Math.max(spot.t, 0.12), 4, 8.5) };
          this.char.play('diveHeader', { duration: 0.95, contact: 0.3 });
        } else if (spot.kind === 'bicycle') this.char.play('bicycle', { duration: 1.25, contact: 0.3 });
        else this.char.play(spot.kind === 'jump' ? 'jumpHeader' : 'header', { duration: spot.kind === 'jump' ? 0.8 : 0.5, contact: 0.42 });
      }
    }
    // contact: the forehead (or, overhead kick, the boot coming over the top)
    let touching = false;
    if (h.kind === 'bicycle' && h.jumped) {
      touching = Math.hypot(ball.pos.x - (this.pos.x + this.forward.x * 0.1), ball.pos.y - 2.0, ball.pos.z - (this.pos.z + this.forward.z * 0.1)) < 0.78;
    } else {
      const head = this.colliders?.find((c) => c.part === 'head');
      touching = !!head && head.pos.distanceTo(ball.pos) < R + (h.kind === 'dive' ? 0.3 : h.kind === 'jump' ? 0.32 : 0.26);
    }
    if (touching) {
      h.hit = true; h.hitT = h.t;
      const rel = Math.hypot(ball.vel.x - this.vel.x, ball.vel.y, ball.vel.z - this.vel.z), run = Math.hypot(this.vel.x, this.vel.z);
      let sp, el;
      if (h.soft) { sp = 5.5 + rel * 0.1; el = 0.85; }
      else if (h.kind === 'bicycle') { sp = clamp(18 + rel * 0.35, 19, 29); el = 0.02; }
      else if (h.kind === 'dive') { sp = clamp(12 + rel * 0.4 + run * 0.5, 13, 25); el = 0.04; }
      else if (h.kind === 'jump') { sp = clamp(12 + rel * 0.5 + run * 0.5, 13, 26); el = ball.pos.y > 1.9 ? -0.15 : -0.05; }
      else { sp = clamp(10.5 + rel * 0.45 + run * 0.55, 11, 24); el = 0.03; }
      ball.vel.set(h.aim.x * sp * Math.cos(el), Math.sin(el) * sp, h.aim.z * sp * Math.cos(el));
      ball.spin.multiplyScalar(0.2);
      ball.lastTouch = this; this.lastTouchTime = g.time; this.touchCD = 0.3; this.ignoreBall = 0.25; this.stats.touches++;
      const big = h.kind !== 'stand' && !h.soft;
      g.sfx.head(rel + 10); if (h.kind === 'bicycle') g.sfx.kick(0.8);
      g.squashBall(h.aim, big ? 0.2 : 0.12);
      g.fx('spark', ball.pos, { x: h.aim.x, z: h.aim.z }, big ? 16 : 9, big ? 4 : 2.5);
      if (big) { g.hitstop = Math.max(g.hitstop, 0.06); g.shake = Math.max(g.shake, 0.12); }
      g.rumble(this, big ? 0.8 : 0.5, 90);
      if (!h.jumped) this.char.play('header', { duration: 0.45, contact: 0.3 });
      g.onKick(this, { type: 'header', power: sp / 22 }, ball.vel);
      return;
    }
    if (!h.jumped && (h.t > 1.2 || (!spot && h.t > 0.7))) this.header = null;   // never got there
    if (h.jumped && h.t > (h.kind === 'bicycle' ? 1.25 : h.kind === 'dive' ? 0.95 : 0.8)) this.header = null;
  }

  /** the body itself flies during a diving header or a bicycle kick */
  _headerBodyMotion(dt) {
    const h = this.header;
    if (h.lunge && h.t < (h.hitT ?? 9) + 0.15) {
      const k = Math.max(0, 1 - (h.t - (h.lungeT0 ?? (h.lungeT0 = h.t))) / 0.45);
      this.vel.set(h.lunge.x * h.lunge.sp * k, 0, h.lunge.z * h.lunge.sp * k);
    } else this.vel.multiplyScalar(Math.max(0, 1 - dt * 7));
    this.pos.addScaledVector(this.vel, dt);
    const want = h.kind === 'bicycle' ? Math.atan2(-h.aim.x, -h.aim.z) : Math.atan2(h.lunge ? h.lunge.x : h.aim.x, h.lunge ? h.lunge.z : h.aim.z);
    this._turnTo(want, dt, 12);
  }

  // ---- receiving -------------------------------------------------------------------
  /** see a ball coming and get the right body part ready for it */
  _anticipate() {
    if (this.receive || this.kick || this.armed || this.charging || this.slide || this.poke || this.trick || this.header || this.stunT > 0 || this.frozen) return;
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
    const sk = this.trick;
    if (sk && (sk.type === 'drag' || sk.type === 'dragback') && sk.t < sk.dur * 0.8) {
      const s = sk.foot === 'Left' ? 'L' : 'R', w = Math.sin(Math.PI * clamp(sk.t / (sk.dur * 0.8), 0, 1)) * 0.95;
      ik[s].target.copy(ball.pos); ik[s].target.y = ball.pos.y + R * 0.75 + ankleH * 0.4;
      ik[s].w = Math.max(ik[s].w, w); ik[s].sole = 0.32 * w;
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
    if (this.iceT > 0) { this.iceT = Math.max(0, this.iceT - dt); dt = 0; }   // frozen: the pose holds
    this.char.group.position.copy(this.pos);
    this.char.setFacing(this.facing);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.char.update(dt, { speed: hs, turnRate: this.turnRate });
  }

  // ---------------------------------------------------------------------------
  /** the charge window that gives a pin-point strike */
  static SWEET = [0.62, 0.86];

  /**
   * Where a shot of this power will go: the goal it's aimed at, the spot on that goal's
   * line, and the corrected aim. Released inside the sweet window it goes exactly there;
   * otherwise the aim is only partly pulled onto the spot (and errors are added at contact).
   * `aim` = the raw aim direction (stick, or towards the goal); not modified.
   */
  shotPlan(type, power, aim) {
    const out = this._plan || (this._plan = { aim: new THREE.Vector3(), target: new THREE.Vector3(), goal: null, perfect: false });
    out.aim.copy(aim); out.goal = null;
    out.perfect = power >= Athlete.SWEET[0] && power <= Athlete.SWEET[1];
    // which goal line does this aim cross first? (for the preview only: the aim is never changed)
    let best = Infinity;
    for (const gg of GOALS) {
      if (gg.team === this.gi) continue;
      const A = gg.axis, line = gg.sign * gg.line;
      if (Math.abs(aim[A]) < 0.05) continue;
      const t = (line - this.pos[A]) / aim[A];
      if (t <= 0 || t > 40 || t >= best) continue;
      best = t; out.goal = gg;
      out.target.set(this.pos.x + aim.x * t, 0, this.pos.z + aim.z * t);
    }
    return out;
  }

  /** launch speed and elevation a clean strike of this power would have (before contact quality) */
  strikeSpeed(type, power, aim) {
    const p = power;
    let speed, elev;
    if (type === 'chip') { speed = PLAYER.chipSpeed[0] + PLAYER.chipSpeed[1] * p; elev = 0.6 + 0.14 * p; }
    else { speed = PLAYER.shotSpeed[0] + PLAYER.shotSpeed[1] * Math.pow(p, 1.15); elev = 0.02 + 0.15 * Math.pow(p, 1.4); }
    speed += Math.max(0, this.vel.x * aim.x + this.vel.z * aim.z) * 0.55;
    return { speed, elev };
  }

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
    // no auto-targeting: the ball goes exactly where I aimed. If that's at a team-mate
    // (or the player a CPU meant to feed), they know it's coming for them.
    this.passTarget = this.intendTo && !this.intendTo.out ? this.intendTo : null;
    this.intendTo = null; this.passTo = null;
    if (!this.passTarget) {
      let best = 0.975;
      for (const o of g.live) {
        if (o === this || !(g.sameSide(o.team, this.team))) continue;
        const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z, d = Math.hypot(dx, dz);
        const c = (dx * aim.x + dz * aim.z) / (d || 1);
        if (d < 26 && c > best) { best = c; this.passTarget = o; }
      }
    }
    const perfect = power >= Athlete.SWEET[0] && power <= Athlete.SWEET[1];
    if (perfect) { this.lastPerfectT = g.time; g.onPerfect?.(this); }

    const dur = ANIM.kickDuration * (type === 'kick' ? 1.08 - 0.16 * power : type === 'pass' ? 0.86 - 0.08 * power : 1.0);
    const contactT = dur * ANIM.kickContact;
    this.kick = { type, power, aim, t: 0, dur, contactT, hit: false, resolved: false, passSpeed, perfect, over: power > 0.95 && type !== 'pass' };
    this.receive = null; this.touch = null;
    this.kick.approach = this._approachTarget(contactT, aim);
    // a soft 爆射 (a pass, really) is side-footed; anything firmer is a full swing
    if (type === 'kick' && power < 0.3) this.char.play('pass', { duration: dur, side: 'Right', amp: 0.8 + 0.6 * power });
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
    else { speed = PLAYER.shotSpeed[0] + PLAYER.shotSpeed[1] * Math.pow(p, 1.15); elev = 0.02 + 0.15 * Math.pow(p, 1.4) + (volley ? 0.06 : 0); }
    if (k.type !== 'pass') {
      speed *= 0.82 + 0.18 * quality;
      // running into the shot adds pace
      speed += Math.max(0, this.vel.x * k.aim.x + this.vel.z * k.aim.z) * 0.55;
    }
    // every proper 爆射 (anything firmer than a side-footed pass) is the character's special shot
    const special = k.type === 'kick' && p >= 0.3 && g.state === 'play' ? this.charDef : null;
    if (special) {
      speed = clamp(speed * special.speed, 20, 42);
      if (special.id !== 'gale' && special.id !== 'phantom') elev = Math.min(elev, 0.07);   // driven at body height: it goes through people
      k.perfect = true; k.over = false;
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
    // small errors only: the aim is the player's, so the ball should go (almost) exactly there
    let err = ((1 - quality) * 0.035 + Math.pow(p, 3) * 0.05 * (1.3 - this.skill) + gd * 0.0012) * (Math.random() * 2 - 1);
    if (k.type === 'pass') { err *= 0.15 + 0.35 * p * p; slice = 0; }  // side-foot: accurate, a driven pass a little less so
    if (k.perfect && footTouched) { err *= 0.15; slice *= 0.3; }       // pin-point: released in the sweet window
    if (k.over) { err *= 1.6; elev += Math.random() * 0.05; }          // leathered: power over control
    const dir = k.aim.clone().applyAxisAngle(UP, err - slice * 0.025);
    elev += (1 - quality) * 0.05 * (Math.random() - 0.3);
    const vel = dir.multiplyScalar(Math.cos(elev) * speed); vel.y = Math.sin(elev) * speed;
    // spin: lateral input at contact = curl; chips get backspin, drives get topspin
    const m = this.intent.move;
    const r2 = new THREE.Vector3().crossVectors(k.aim, UP);
    let lateral = 0;
    void m;                                                         // the stick aims; curl comes from where the boot met the ball
    const spin = new THREE.Vector3();
    if (k.type === 'pass') { lateral = 0; spin.addScaledVector(r2, -speed / R * 0.5); }   // rolls true along the grass
    else if (k.type === 'chip') spin.addScaledVector(r2, 28 * p);
    else spin.addScaledVector(r2, -8 * p);
    spin.y = lateral * 16 * p * (k.type === 'chip' ? 0.6 : 1) + slice * 9 * p;
    ball.strike(vel, spin, this);
    if (special) { ball.startSpecial(special.id, this, dir, p); g.onSpecial?.(this, special); }
    this.ignoreBall = 0.15;
    g.squashBall(dir, k.type === 'pass' ? 0.06 + 0.08 * p : 0.1 + 0.16 * p);
    if (p > 0.4 && footTouched) g.fx('spark', ball.pos, { x: dir.x, z: dir.z }, Math.round(4 + 10 * p), 2 + 4 * p);
    if (p > 0.55 && k.type !== 'pass') g.fx('grass', this.char.anklePos('L', this._fb), { x: -k.aim.x, z: -k.aim.z }, Math.round(6 + 10 * p), 1.5 + p * 2);
    g.rumble(this, k.type === 'pass' ? 0.2 + 0.3 * p : 0.3 + 0.7 * p, 60 + 80 * p);
    this.char.face('aa', 0.6 + 0.4 * p); this.faceT = 0.35;
    this.lastTouchTime = g.time;
    this.passT = this.passTarget ? g.time : -1;
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

    if (this.stunT > 0 || this.slide || this.dive || this.poke || (this.header && !this.header.hit)) { this.dribbling = false; return false; }
    // a special shot in flight can't be trapped (it goes through people, or is too wild to control)
    if (ball.special && ball.special.owner !== this) { this.dribbling = false; this.receive = null; return false; }
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
    if (!mine || dist > 1.7 || by > 0.55 || relSp > 7.5 || ball.goalTeam >= 0 || this.knockFree > 0) { this.dribbling = false; return false; }
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
    // skill moves place the ball themselves
    const sk = this.trick && this.trick.type !== 'knock' ? this.trick : null;
    if (sk) {
      const u = sk.t / sk.dur;
      if (sk.type === 'feint') tgt.set(this.pos.x + sk.f.x * (0.3 + R), 0, this.pos.z + sk.f.z * (0.3 + R));
      else if (sk.type === 'drag') {
        // rolled across under the sole, from one side of the body to the other
        const lat = sk.side * (-0.2 + 1.15 * smoothstep(u * 1.1));
        tgt.set(this.pos.x + sk.f.x * 0.36 + sk.r.x * lat, 0, this.pos.z + sk.f.z * 0.36 + sk.r.z * lat);
      } else {
        // pulled back under the sole, then taken away the other way
        const k = sk.t < 0.2 ? 0.25 - sk.t * 1.5 : -0.5;
        tgt.set(this.pos.x + sk.f.x * k, 0, this.pos.z + sk.f.z * k);
      }
    }
    clampToArena(tgt, R + 0.04);              // never steer the ball into the boards
    pushOutOfObstacles(tgt, R + 0.05);        // or into a planter
    const tx = tgt.x, tz = tgt.z;

    // is the ball behind / beside me relative to where I'm going? then it needs a turn touch
    const bx = ball.pos.x - this.pos.x, bz = ball.pos.z - this.pos.z;
    const bl = Math.hypot(bx, bz) || 1;
    const cosA = (bx * d.x + bz * d.z) / bl;
    const turning = wants && cosA < 0.5 && bl > 0.25;

    // desired relative velocity towards the target, capped so it reads as rolling
    const kp = sk ? 11 : turning ? 7 : 5.5;
    let dvx = (tx - ball.pos.x) * kp, dvz = (tz - ball.pos.z) * kp;
    const cap = sk ? 7.5 : turning ? 6.5 : 4.5, m = Math.hypot(dvx, dvz);
    if (m > cap) { dvx *= cap / m; dvz *= cap / m; }
    // swing round the body rather than through it when turning
    if (turning && !sk) {
      const cross = bx * d.z - bz * d.x; // which way round is shorter
      const s2 = cross > 0 ? 1 : -1, px = -bz / bl * s2, pz = bx / bl * s2;
      dvx += px * 1.8; dvz += pz * 1.8;
    }
    const kv = 1 - Math.exp(-dt * (sk ? 16 : this.knockT > 0 ? 6 : 11));
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
    if (!this.touch && !this.charging && !this.kick && !this.trick) {
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
