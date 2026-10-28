import * as THREE from 'three';
import { FIELD, PLAYER, ANIM, BALL, GOALS, CHAR, clampToArena, pushOutOfObstacles, inOwnBox, padAt, route, comboOf, shotZone } from './config.js';

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
    this.role = null;        // 6v6: 'gk' | 'back' (always home) | 'wingL' 'mid' 'wingR' (the trio: up and back together) | 'fwd' (always up front)
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
    this._fa = new THREE.Vector3(); this._fb = new THREE.Vector3(); this._r2b = new THREE.Vector3();
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._f = new THREE.Vector3(); this._r = new THREE.Vector3();
  }

  /** which goal I defend (6v6 sides change ends at half time) */
  get end() { return this.game.m5 ? this.gi ^ (this.game.ends | 0) : this.gi; }
  get home() { return GOALS[this.end] || GOALS[0]; }             // the goal I defend
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
  get reachF() { return this.char.kickCalib.forward * this.char.group.scale.x + R * 0.85; }
  get reachS() { return this.char.kickCalib.side * this.char.group.scale.x; }

  place(x, z, facing) {
    this.pos.set(x, 0, z); this.vel.set(0, 0, 0); this.facing = facing;
    this.kick = null; this.charging = false; this.charge = 0; this.touchCD = 0.2; this.armed = null;
    this.touch = null; this.trapT = 0; this.holdT = 0; this.holdW = 0;
    this.slide = null; this.dive = null; this.stunT = 0; this.receive = null; this.ignoreBall = 0; this._resetColliders = true;
    this.poke = null; this.trick = null; this.burstT = 0; this.header = null; this.iceT = 0; this.holding = null; this._ready = false; this.air = null; this.slipT = 0; if (this.power) { this.power = null; this.char.group.visible = !this.out; }
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
    best = best || GOALS[(this.end + 1) % GOALS.length];
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
    if (first) { this.aimAng = want ?? this.facing; this._aimSet = has; return; }
    if (has) this._aimSet = true;
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
    const arrive = 5.2 + 8 * Math.pow(p, 1.4);
    // lead direction: where they're running, else towards the goal they'd attack
    let lx = rcv.vel.x, lz = rcv.vel.z, ls = Math.hypot(lx, lz);
    if (ls < 1.5) { const gt = rcv.goalTarget(); lx = gt.x - rcv.pos.x; lz = gt.z - rcv.pos.z; ls = Math.hypot(lx, lz) || 1; }
    const ct = this.game.controllers[rcv.team]?.type, human = ct === 'human' || ct === 'remote';
    const lead = (p > 0.3 ? ((p - 0.3) / 0.7) * 4 : 0) * (human ? 0.45 : 1), vk = human ? 0.55 : 0.8;
    let tx = rcv.pos.x, tz = rcv.pos.z, sp = 0;
    for (let k = 0; k < 3; k++) {
      const d = Math.hypot(tx - ball.pos.x, tz - ball.pos.z);
      sp = clamp(Math.sqrt(arrive * arrive + 2 * 0.9 * d) + 0.8, 7, 23);
      const t = d / ((sp + arrive) / 2) + 0.2;
      tx = rcv.pos.x + rcv.vel.x * t * vk + (lx / ls) * lead;
      tz = rcv.pos.z + rcv.vel.z * t * vk + (lz / ls) * lead;
    }
    const q = this._pl || (this._pl = new THREE.Vector3());
    q.set(tx, 0, tz); clampToArena(q, 0.8); pushOutOfObstacles(q, 0.6);
    return { x: q.x, z: q.z, speed: sp };
  }

  update(dt) {
    const it = this.intent, g = this.game;
    if (!this.charging) this.char.windup = 0;
    this.touchCD = Math.max(0, this.touchCD - dt);
    this.noChargeT = Math.max(0, (this.noChargeT || 0) - dt);
    this.slideCD = Math.max(0, this.slideCD - dt);
    this.skillCD = Math.max(0, this.skillCD - dt);
    this.powerCD = Math.max(0, (this.powerCD || 0) - dt);
    if (this.power) this._powerTick(dt);
    this.burstT = Math.max(0, this.burstT - dt);
    this.knockFree = Math.max(0, (this.knockFree || 0) - dt);
    this._skillTick(dt);
    this.stunT = Math.max(0, this.stunT - dt);
    this.slipT = Math.max(0, (this.slipT || 0) - dt); this.burnCD = Math.max(0, (this.burnCD || 0) - dt);
    if (this.stunT > 0 || this.frozen || g.state !== 'play') this.sprinting = false;
    this.ghost = this.charId === 'phantom' && this.sprinting;
    if (this.sprinting) this._elementSprint();
    this.ignoreBall = Math.max(0, this.ignoreBall - dt);
    if (this.receive) { this.receive.t += dt; if (this.receive.t > this.receive.ta + 0.3) this.receive = null; }

    // ---- slide tackle ------------------------------------------------------------
    const tacklePressed = it.tackle && !this._prevTackle;
    this._prevTackle = it.tackle;
    if (tacklePressed && !this.frozen && !this.slide && !this.dive && !this.kick && !this.poke && !this.trick && this.stunT <= 0 && g.state === 'play') {
      const b = g.ball, bd = Math.hypot(b.pos.x - this.pos.x, b.pos.z - this.pos.z);
      const holder = g.possessor;
      const mine = holder === this || (this.dribbling && b.lastTouch === this) || (!holder && b.lastTouch === this && bd < 1.4 && b.pos.y < 0.8 && g.time - this.lastTouchTime < 1);
      if (mine) {
        // with the ball, the tackle button is a skill move
        // the character's own move when it's ready, the quick 闪身步 in between
        if (!this.charging && !this.power) { if (this.powerCD <= 0) this._startPower(); else if (this.skillCD <= 0) this._startSkill(); }
      } else if (this.slideCD <= 0) {
        const sp = Math.hypot(this.vel.x, this.vel.z);
        const mateHas = holder && g.sameSide(holder.team, this.team);
        // in my own penalty box the tackle button is a goalkeeper dive
        if (inOwnBox(this.end, this.pos.x, this.pos.z) && (!this.role || this.role === 'gk')) {
          // a keeper at the feet of a dribbler (a slow ball close by) goes down on it; anything else is a dive
          if (this.isKeeper && bd < 1.9 && Math.hypot(b.vel.x, b.vel.z) < 8 && b.pos.y < 0.8) this._startPoke(); else this._startDive();
        }
        else if (mateHas && bd < 2.5) { /* never tackle my own team-mate */ }
        else if (bd < 1.75 && b.pos.y < 0.8 && !(it.sprint && sp > 5.6)) this._startPoke();
        else this._startSlide();
      }
    }

    // ---- charging / release: 射门 (kick), 平传 (pass) or 挑传/挑射 (chip); a ball in the air gets headed
    const wantShot = it.kick || it.lob || it.pass;
    if (!wantShot) this._needRelease = false;
    const pressedKick = it.kick && !this._prevKick, pressedLob = it.lob && !this._prevLob, pressedPass = it.pass && !this._prevPass;
    this._prevKick = it.kick; this._prevLob = it.lob; this._prevPass = it.pass;
    if (this.header) this._headerMotionTick(dt);
    // the gale leap: a strike in mid-air is a flying volley
    const pressedAny = pressedKick || pressedLob || pressedPass;
    if (this._queued && !this.power && !this.trick && g.time - (this.powerEndT ?? -9) > 0.9) this._queued = null;
    if (this.power) {
      const P = this.power;
      // mid-move: strike it there and then, at the sweet power (the move sets the shot up)
      const want = pressedAny ? (pressedPass ? 'pass' : pressedLob ? 'chip' : 'kick') : this._queued;
      if (P.type === 'gale' && want && P.t > P.dur * 0.15 && P.t < P.dur * 0.85) { this._queued = null; if (want === 'pass') this._galePass(); else this._galeVolley(); }
      else if (want && P.type !== 'gale' && (P.type === 'phantom' ? P.jumped : P.type === 'blaze' || P.type === 'frost' ? P.blasted : P.t > P.dur * 0.2)) { this._queued = null; this._skillStrike(want); }
      else if (pressedAny) this._queued = want;            // pressed a touch early: it goes the moment it can
      if (this.power) { this.charging = false; this.charge = 0; }
    }
    else if (this.frozen || this.slide || this.dive || this.poke || this.stunT > 0 || this.holding) { this.charging = false; this.charge = 0; }
    else if (!this.kick && !this.header) {
      if ((pressedKick || pressedLob || pressedPass) && !this.charging && g.state === 'play' && (this._headerChance() || (pressedLob && this._headerChance(true)))) {
        this._startHeader(pressedLob ? 'lob' : pressedPass ? 'pass' : 'shot');
      } else if ((pressedAny || this._queued) && !this.charging && g.state === 'play' && !this.stunT
        && (g.time - (this.powerEndT ?? -9) < 0.9 || this.trick || g.time - (this.trickEndT ?? -9) < 0.9)) {
        // in or just out of a skill move (the character's move or the 闪身步): no wind-up, the
        // strike / pass comes instantly at the sweet power
        const t = pressedAny ? (pressedPass ? 'pass' : pressedLob ? 'chip' : 'kick') : this._queued;
        this._queued = null; this.trick = null; this.trickEndT = -9;
        this._skillStrike(t);
      } else if (wantShot && !this.charging && g.state !== 'menu' && !(this.noChargeT > 0) && !this._needRelease) {
        this.charging = true; this.charge = 0; this.chargeHold = 0; this.armed = null;
        this.chargeType = it.pass ? 'pass' : it.lob ? 'chip' : 'kick';
        this._steerAim(dt, true);
      }
      if (this.charging) {
        if (it.lob && this.chargeType === 'kick') this.chargeType = 'chip';
        this._steerAim(dt, false);
        const held = wantShot;
        this.charge = Math.min(1, this.charge + dt / (this.chargeType === 'pass' ? PLAYER.passChargeTime : PLAYER.chargeTime));
        if (this.charge >= 1) this.chargeHold += dt;
        this.char.face('angry', 0.15 + 0.35 * this.charge);
        // a team-mate's ball arriving while I'm still winding up: hit it first time, right now
        const coming = held && this.charge > (this.chargeType === 'pass' ? 0.12 : 0.25) && this._incoming();
        this._chargeComing = coming;
        const hs = coming && g.ball.pos.y > 1.15 ? this._headerSpot(PLAYER.runSpeed * this.speedMul, this.chargeType === 'chip') : null;
        const headBall = g.ball.loftKind === 'head';
        if (hs && hs.t < 0.45 && hs.y > Athlete.MAXH[this.chargeType] + 0.1 && (headBall || !this._volleyLater(this.chargeType))) { this.char.face('angry', 0); this.charging = false; this.charge = 0; this._needRelease = true; this._startHeader(this.chargeType === 'chip' ? 'lob' : this.chargeType === 'pass' ? 'pass' : 'shot'); }
        else if (coming && this._inStrikeReach(this.chargeType)) { this.char.face('angry', 0); this._needRelease = true; this._fromArmed = this._feederFor() || true; this._release(); this._fromArmed = false; }
        else if (coming && this.chargeHold > PLAYER.chargeAutoRelease) { /* keep it cocked until the ball gets here */ }
        else if (!held || this.chargeHold > PLAYER.chargeAutoRelease) { this.char.face('angry', 0); this._release(); }
        else this.char.windup = this.charge;
      }
    }
    // ---- a strike released before the ball arrived: run onto it, hit it when in reach ----
    if (this.armed) {
      const am = this.armed, b = g.ball;
      am.t += dt;
      const bd = Math.hypot(b.pos.x - this.pos.x, b.pos.z - this.pos.z);
      if (this.frozen || this.slide || this.dive || this.stunT > 0 || this.kick || g.state !== 'play' || am.t > (am.max || 0.8) || bd > (am.far || 7) || b.goalTeam >= 0 || (b.lastTouch && b.lastTouch !== am.from && am.from !== undefined && b.lastTouch !== this)) this.armed = null;
      else if (b.pos.y > 1.15 && (() => { const hs = this._headerSpot(PLAYER.runSpeed * this.speedMul, am.type === 'chip'); return hs && hs.t < 0.5 && hs.y > Athlete.MAXH[am.type] + 0.1 && (b.loftKind === 'head' || !this._volleyLater(am.type)); })()) {
        // it's coming in high: meet it with the head (or an overhead kick on the 挑 button)
        const type = am.type; this.armed = null; this._startHeader(type === 'chip' ? 'lob' : type === 'pass' ? 'pass' : 'shot');
      } else if (this._inStrikeReach(am.type)) {
        this.armed = null;
        this.chargeType = am.type; this.charge = am.power; this.passTo = am.passTo;
        this._fromArmed = am.from || true; this._skillShot = !!am.skill; this._release(); this._fromArmed = false; this._skillShot = false;
      }
    }
    if (this.faceT > 0) { this.faceT -= dt; if (this.faceT <= 0) this.char.face('aa', 0); }
    this.trapT = Math.max(0, this.trapT - dt);

    this._keeperTick(dt);
    // ---- movement ---------------------------------------------------------
    const ballPos = g.ball.pos;
    if (this.power) this._powerMotion(dt);
    else if (this.dive) this._diveMotion(dt);
    else if (this.slide) this._slideMotion(dt);
    else if (this.poke) this._pokeMotion(dt);
    else if (this.header && this.header.jumped && (this.header.kind === 'dive' || this.header.kind === 'bicycle')) this._headerBodyMotion(dt);
    else if (this.air) this._airMotion(dt);
    else if (this.stunT > 0) { this.vel.multiplyScalar(Math.max(0, 1 - dt * (this.slipT > 0 ? 1.2 : 5))); this.pos.addScaledVector(this.vel, dt); }
    else if (this.kick) this._kickMotion(dt);
    else {
      const mag = Math.min(1, it.move.length());
      let target = PLAYER.runSpeed;
      const wantsSprint = it.sprint && mag > 0.5 && !this.exhausted;
      if (wantsSprint) target = PLAYER.sprintSpeed * (this.charId === 'thunder' ? 1.08 : this.charId === 'gale' ? 1.08 : 1);
      if (mag < 0.7) target = PLAYER.walkSpeed + (PLAYER.runSpeed - PLAYER.walkSpeed) * Math.max(0, (mag - 0.25) / 0.45);
      if (this.charging) target *= 0.55;
      if (this.dribbling && this.shieldK) target *= 1 - 0.3 * this.shieldK;   // protecting the ball: a shorter, braced stride
      if (this.receive && this.receive.type !== 'trapFoot') target *= 0.6; // settle under a dropping ball
      if (this.frozen) target = 0;
      if (this.holding) target = this.holding.release ? 0 : Math.min(target, PLAYER.walkSpeed);   // keeper with the ball in his hands
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
      const rc = this.receive;
      if (rc && rc.ix !== undefined && rc.type !== 'header' && !this.frozen) {
        // get across to the ball's line in time (the stick still steers, but the feet go to the ball)
        const left = Math.max(0.06, rc.ta - rc.t);
        const ex = rc.ix - this.pos.x, ez = rc.iz - this.pos.z, el = Math.hypot(ex, ez);
        if (el > 0.08) {
          const need = Math.min(PLAYER.sprintSpeed * this.speedMul, el / left);
          desired.multiplyScalar(0.3).add(this._r2b.set(ex / el * need, 0, ez / el * need));
        }
      }
      if (this.header && !this.header.hit && !this.frozen && this.header.spot) {
        const sp = (it.sprint && !this.exhausted ? PLAYER.sprintSpeed : PLAYER.runSpeed) * this.speedMul;
        desired.set(this.header.spot.x - this.pos.x, 0, this.header.spot.z - this.pos.z);
        const dl = desired.length();
        if (dl > 0.03) desired.multiplyScalar(Math.min(sp, dl * 7) / dl); else desired.set(0, 0, 0);
      }
      if ((this.armed || (this.charging && this._chargeComing)) && !this.frozen) {
        // meet the ball: the earliest point on its path I can get behind in time
        const sp = (it.sprint && !this.exhausted ? PLAYER.sprintSpeed : PLAYER.runSpeed) * this.speedMul;
        const p = this._armedSpot(sp);
        desired.set(p.x - this.pos.x, 0, p.z - this.pos.z);
        const dl = desired.length();
        if (dl > 0.02) desired.multiplyScalar(Math.min(sp, dl * 6) / dl); else desired.set(0, 0, 0);
      }
      const dv = this._w.copy(desired).sub(this.vel);
      // lightning's sprint is fast, so it gets sharper grip too: quick to turn, quick to stop
      const grip = this.charId === 'thunder' && this.sprinting ? 1.8 : 1;
      const a = (desired.lengthSq() > this.vel.lengthSq() ? PLAYER.accel : PLAYER.decel) * grip * dt * (this.slipT > 0 ? 0.18 : 1);
      if (dv.length() > a) dv.setLength(a);
      this.vel.add(dv);

      // stamina
      const sprinting = wantsSprint && this.vel.length() > PLAYER.runSpeed * this.speedMul * 0.95;
      this.sprinting = sprinting;
      const drain = this.charId === 'gale' ? 0.6 : 1;                     // gliding on the wings is easy work
      this.stamina = clamp(this.stamina + (sprinting ? -PLAYER.staminaDrain * drain * (this.burstT > 0 ? 1.6 : 1) : PLAYER.staminaRegen) * dt, 0, 1);
      if (this.stamina <= 0.01) this.exhausted = true; else if (this.stamina > 0.3) this.exhausted = false;

      // facing
      let want = null;
      if (this.holding) want = Math.atan2(this.home.inward.x, this.home.inward.z);   // keeper with the ball: face the pitch
      else if (this.trick) want = this._skillFacing();
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
    const kind = this.charId, g = this.game, ball = g.ball;
    let from = null;
    if (kind === 'phantom') {
      // blink in right next to the ball, then slide through it
      const bd = Math.hypot(ball.pos.x - this.pos.x, ball.pos.z - this.pos.z);
      if (bd > 1.6 && bd < 5 && !ball.heldBy) {
        from = this.pos.clone();
        dir.set(ball.pos.x - this.pos.x, 0, ball.pos.z - this.pos.z).normalize();
        const q = new THREE.Vector3(ball.pos.x - dir.x * 1.0, 0, ball.pos.z - dir.z * 1.0);
        clampToArena(q, 0.5); pushOutOfObstacles(q, PLAYER.radius);
        this.pos.copy(q); this.char.teleported();
      }
    }
    const v0 = clamp(Math.max(sp, 4) + 2.6, 6.2, 9);
    // a slide is a big, committed move: a long reach and the element hits hard, but a miss leaves you on the floor
    this.slide = { t: 0, dur: 0.6, total: 0.85, dir, speed0: v0, poked: false, hit: new Set(), kind, decay: 1.25, reach: Athlete.SLIDE_REACH.def };
    if (kind === 'thunder') { this.slide.speed0 = Math.min(12.5, v0 * 1.4); this.slide.dur = 0.5; }
    if (kind === 'frost') { this.slide.dur = 0.75; this.slide.total = 0.95; this.slide.decay = 0.8; }
    if (kind === 'cannon') { this.slide.reach = Athlete.SLIDE_REACH.cannon; }
    g.onSlide?.(this, kind, from);
    this.facing = Math.atan2(dir.x, dir.z);
    this.charging = false; this.charge = 0; this.receive = null; this.touch = null;
    this.stamina = Math.max(0, this.stamina - 0.15);
    this.slideCD = 1.3;
    this.char.play('slide', { duration: 0.85 });
    this.char.face('angry', 0.6); this.faceT = 0.6;
    this.game.sfx.slide();
  }

  _slideMotion(dt) {
    const sl = this.slide, g = this.game, ball = g.ball;
    sl.t += dt;
    const u = sl.t / sl.dur;
    const sp = u < 1 ? sl.speed0 * Math.pow(1 - u, sl.decay || 1.25) : 0;
    // cyclone: the whirlwind drags a loose ball in towards me
    if (sl.kind === 'gale' && u < 0.85 && !ball.heldBy && ball.pos.y < 1.2) {
      const bx = this.pos.x + sl.dir.x * 0.6 - ball.pos.x, bz = this.pos.z + sl.dir.z * 0.6 - ball.pos.z, bd = Math.hypot(bx, bz);
      if (bd < 2.8 && bd > 0.2) { ball.vel.x += (bx / bd) * 22 * dt; ball.vel.z += (bz / bd) * 22 * dt; }
    }
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
      // the element round the boot reaches further than the boot itself
      const swept = Math.hypot(ball.pos.x - (this.pos.x + sl.dir.x * 0.55), ball.pos.z - (this.pos.z + sl.dir.z * 0.55)) < sl.reach * 0.7;
      if (!sl.poked && (reach < R + 0.35 || swept) && ball.pos.y < 0.75 && !ball.heldBy) {
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
        g.onImpact?.({ pos: ball.pos }, this.charDef.color);
        g.rumble(this, 0.6, 90);
      }
      // and through anyone standing in the way
      for (const o of g.athletes) {
        if (o === this || sl.hit.has(o) || o.slide || o.power || g.sameSide(this.team, o.team)) continue;
        const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z, d = Math.hypot(dx, dz);
        const ahead = (dx * sl.dir.x + dz * sl.dir.z) / (d || 1);
        if (d < (sl.reach || 0.85) && ahead > 0.2) {
          sl.hit.add(o);
          g.onImpact?.(o, this.charDef.color);
          // the character's element hits them too
          if (sl.kind === 'thunder') { o.zap('thunder', sl.dir); g.fx('bolt', { x: o.pos.x, y: 1, z: o.pos.z }, { x: 0, z: 0 }, 16, 3); }
          else if (sl.kind === 'frost') o.freeze(1.4);
          else if (sl.kind === 'cannon') { o.launch(sl.dir, 5.5, 8); g.onImpact?.(o, 0xffd23f); g.shake = Math.max(g.shake, 0.2); }
          else if (sl.kind === 'blaze') { o.launch(sl.dir, 7, 3.2); g.fx('fire', { x: o.pos.x, y: 0.8, z: o.pos.z }, { x: 0, z: 0 }, 20, 3); }
          else { if (sp > 3) o.fall(sl.dir, sp); else o.knock(sl.dir, sp); if (sl.kind === 'blaze') g.fx('fire', { x: o.pos.x, y: 0.8, z: o.pos.z }, { x: 0, z: 0 }, 20, 3); }
          g.sfx.bump(sp); g.rumble(this, 0.4, 70);
        }
      }
    }
    if (sl.t >= sl.total) {
      this.slide = null; this.vel.set(0, 0, 0);
      // missed everything: punished. Lying on the grass, out of breath, and no slide again for a while
      if (!sl.poked && !sl.hit.size) {
        this.stunT = 0.75; this.stamina = Math.max(0, this.stamina - 0.22); this.slideCD = 2.4;
        this.char.play('stagger', { duration: 0.85, amp: 0.7 });
        this.char.face('surprised', 0.7); this.faceT = 0.7;
        this.flair('铲空了…', true);
        g.emit?.({ e: 'slideMiss', i: this.team });
      }
    }
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
    this.dive = { t: 0, dur: 1.15, dir, speed0: this.role === 'gk' ? 9.5 : 5.6, side };
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

  /** sent flying: up into the air, tumbling, then a heavy landing (cannon / fire blasts) */
  /**
   * Sent flying by earth / fire. (h, v) give the distance it would cover on a high arc; the flight is
   * flattened to a low, fast one over the same distance, so you land quickly and get straight back up
   * (only ice holds anyone for long).
   */
  launch(dir, h, v, force = false) {
    if (this.frozen) return;
    if (!force && this._tough()) { this._stagger(dir); return; }     // the keeper stands his ground
    this.knock(dir, 0);
    const dist = h * (2 * v) / 9.81;
    const vy = Math.min(v, 4.2), tAir = (2 * vy) / 9.81;
    const hs = Math.min(16, dist / tAir);
    this.air = { y: 0, vy, rot: 0, spin: (Math.PI * 2) / tAir * (Math.random() < 0.5 ? -1 : 1) };
    this.vel.copy(dir).setY(0).normalize().multiplyScalar(hs);
    this.stunT = tAir + 0.3; this.iceT = 0;
    this.char.play('fallB', { duration: tAir + 0.45 });
    this.char.face('surprised', 1); this.faceT = tAir + 0.3;
    this.game.rumble(this, 1, 300);
  }
  _airMotion(dt) {
    const A = this.air;
    A.vy -= 9.81 * dt; A.y += A.vy * dt; A.rot += A.spin * dt;
    this.pos.addScaledVector(this.vel, dt);
    if (A.y <= 0) {
      this.air = null; this.vel.multiplyScalar(0.3);
      const g = this.game;
      g.fx('dust', { x: this.pos.x, y: 0.1, z: this.pos.z }, { x: 0, z: 0 }, 18, 3);
      g.sfx.bump(12); g.shake = Math.max(g.shake, 0.12);
      g.onImpact?.(this, 0xffffff);
    }
  }

  /** what my sprint does to the people round me */
  _elementSprint() {
    const g = this.game;
    if (this.charId !== 'cannon') return;
    // the cannon barges straight through: anyone in the way is bowled over
    for (const o of g.live) {
      if (!this._isOpp(o) || o.stunT > 0 || o.air || (o.bargeHit || 0) > g.time) continue;
      const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      const f = this.forward, ahead = (dx * f.x + dz * f.z) / (d || 1);
      if (d < 0.85 && ahead > 0.4) {
        o.bargeHit = g.time + 1.5;
        o.fall(new THREE.Vector3(dx / d, 0, dz / d), 10, 6);
        g.onImpact?.(o, 0xffd23f); g.sfx.bump(12); g.shake = Math.max(g.shake, 0.12);
        this.vel.multiplyScalar(0.85);
      }
    }
  }

  /** knocked clean off my feet: hit the deck (face down if shoved from behind, else on my back), then get up */
  fall(dir, strength = 6, maxV = 6, force = false) {
    if (this.frozen) return;
    if (!force && this._tough()) { this._stagger(dir); return; }
    this.knock(dir, strength);
    const f = this.forward, fromBehind = dir.x * f.x + dir.z * f.z > 0;
    this.stunT = 1.35;
    this.vel.copy(dir).multiplyScalar(Math.min(maxV, 1.5 + strength * 0.35));
    this.char.play(fromBehind ? 'fallF' : 'fallB', { duration: 1.5 });
    this.game.fx?.('dust', { x: this.pos.x + dir.x * 0.6, y: 0.05, z: this.pos.z + dir.z * 0.6 }, { x: dir.x, z: dir.z }, 10, 1.5);
  }

  // ---- goalkeeper (5v5): ready stance, catching, throwing it out --------------------------
  get isKeeper() { return this.role === 'gk'; }

  /** the ball arrived at my body: hold on to it if it's catchable */
  tryCatch(part, v) {
    const g = this.game, b = g.ball;
    if (!this.isKeeper || g.state !== 'play' || this.holding || b.heldBy || b.noCatchT > 0 || this.stunT > 0) return false;
    if (!inOwnBox(this.end, this.pos.x, this.pos.z) || part === 'foot' || part === 'shin') return false;
    const limit = this.dive ? 27 : 33;
    if (v > limit || Math.random() < 0.06 + 0.45 * Math.max(0, (v - 17) / 16) ** 2) return false;   // too hot to hold: it's parried
    this.smother(b);
    g.sfx.body(Math.min(10, v)); g.rumble(this, 0.4, 80);
    return true;
  }
  /**
   * Shot-stopping: the ball crossed my line this frame (p0 = where it was before). If it went by
   * within reach — a stride standing, a full stretch mid-dive — I get a glove to it: held if it's
   * catchable, beaten away if not. Fast, wide shots still beat me; combos meant to go through do.
   */
  saveCheck(p0) {
    const g = this.game, b = g.ball;
    const justIced = this.iceT > 1.3;         // frozen by this very shot: the block still counts
    if (!this.isKeeper || b.heldBy || this.holding || ((this.stunT > 0 || this.frozen) && !justIced) || g.state !== 'play' || b.hidden) return;
    if (!inOwnBox(this.end, this.pos.x, this.pos.z)) return;
    const lt = b.lastTouch; if (!lt || !this._isOpp(lt)) return;
    const inw = this.home.inward, c = this.home.centre;
    const dep = (q) => (q.x - c.x) * inw.x + (q.z - c.z) * inw.z;
    const kd = dep(this.pos), d0 = dep(p0), d1 = dep(b.pos);
    if (!(d0 > kd && d1 <= kd) || d0 - d1 < 1e-4) return;
    const sp = b.speed; if (sp < 6) return;
    const u = (d0 - kd) / (d0 - d1);
    const x = p0.x + (b.pos.x - p0.x) * u, y = p0.y + (b.pos.y - p0.y) * u, z = p0.z + (b.pos.z - p0.z) * u;
    const lat = Math.hypot(x - this.pos.x, z - this.pos.z);
    const diving = this.dive && this.dive.t < 0.85;
    const reach = diving ? 2.5 : 1.35;
    if (lat > reach || y > (diving ? 1.7 : 2.35)) return;
    const spc = b.special, cb = spc && spc.combo;
    if (cb && cb.level > 1 && (cb.gk === 'through' || cb.gk === 'blast' || cb.gk === 'teleport')) return;
    let chance = 1.08 - Math.max(0, sp - 18) * 0.011 - (lat / reach) ** 2 * 0.3;
    // from range the keeper sees it all the way; close in there's no time
    const dist = b.shotDist ?? 14;
    const zone = b.shotZone || (dist < 4 ? 'small' : dist < 9 ? 'box' : 'out');
    chance += zone === 'small' ? -0.3 + clamp((dist - 4) * 0.02, 0, 0.06) : zone === 'box' ? -0.08 + clamp((dist - 8) * 0.012, 0, 0.06) : 0.12 + clamp((dist - 13) * 0.02, 0, 0.14);
    if (spc) chance -= spc.has('phantom') ? 0.1 : 0.04;
    if (cb && cb.level > 1) chance -= (cb.level >= 3 ? 0.35 : 0.22) * Math.max(0.1, 1 - (cb.range ?? 0.3));   // a combo is hot close in, readable from range
    chance -= (1 - this._gkLevel()) * 0.6;
    const roll = Math.random();
    if (roll > chance) return;                                 // beaten all the same
    b.pos.set(x, Math.max(BALL.r, y), z);
    const combo = cb && cb.level > 1;
    b.endSpecial(); b.passEls = null; b.chain = null;
    if (!combo && sp < 25 && !justIced) { this.smother(b); g.sfx.body(9); this.flair('稳稳抱住!', true); return; }
    // beaten away: back out of the goal, off to the side
    const vin = b.vel.x * inw.x + b.vel.z * inw.z, side = Math.sign((z - this.pos.z) * inw.x - (x - this.pos.x) * inw.z) || 1;
    b.vel.x += -1.55 * vin * inw.x; b.vel.z += -1.55 * vin * inw.z;
    b.vel.multiplyScalar(0.42); b.vel.x += -inw.z * side * 3; b.vel.z += inw.x * side * 3; b.vel.y = 2.5 + Math.random() * 2;
    b.lastTouch = this; this.lastTouchTime = g.time; b.noCatchT = 0.3;
    g.sfx.body(14); g.sfx.ooh(); g.shake = Math.max(g.shake, 0.12); g.squashBall({ x: inw.x, y: 0, z: inw.z }, 0.2);
    g.fx('spark', b.pos, { x: inw.x, z: inw.z }, 14, 4);
    this.flair('神扑!', true);
  }

  /** how good a keeper I am: a CPU keeper follows the difficulty (女友模式's keeper lets plenty in) */
  _gkLevel() { const ai = this.game.controllers[this.team]?.ai; return ai ? 0.62 + 0.38 * ai.cfg.skill : 0.95; }

  /** the ball into my hands */
  smother(b) {
    b.hold(this);
    this.holding = { t: 0 };
    this.char.play('gkHold');
    this.game.sfx.body(6);
  }

  /** where the ball sits while I'm holding it */
  handPos(out) {
    const f = this.forward;
    return out.set(this.pos.x + f.x * 0.42, this.dive ? 0.45 : 0.98, this.pos.z + f.z * 0.42);
  }

  /** throw it out to a team-mate (or launch it up the pitch when there's nobody) */
  distribute(to) {
    const g = this.game, b = g.ball;
    if (!this.holding || b.heldBy !== this) return;
    this.char.stopEmotes();
    this.char.play('gkThrow', { duration: 0.7 });
    this.holding.release = { t: 0, to };
  }

  _keeperTick(dt) {
    const g = this.game, b = g.ball;
    if (!this.isKeeper) return;
    if (this.holding) {
      const h = this.holding; h.t += dt;
      if (b.heldBy !== this) { this.holding = null; this.char.stopEmotes(); return; }
      if (h.release) {
        h.release.t += dt;
        if (h.release.t >= 0.3) {
          const to = h.release.to;
          let vx, vz, vy, sp;
          if (to) {
            const t = this.passLead(to, 0.25);
            const dx = t.x - this.pos.x, dz = t.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
            sp = clamp(6 + d * 0.75, 8, 18); vx = (dx / d) * sp; vz = (dz / d) * sp; vy = 1.2 + d * 0.06;
            this.passTarget = to; this.intendTo = null;
          } else {
            const f = this.home.inward; sp = 17; vx = f.x * sp; vz = f.z * sp + (Math.random() - 0.5) * 6; vy = 7;
            this.passTarget = null;
          }
          b.release();
          b.strike(new THREE.Vector3(vx, vy, vz), new THREE.Vector3(), this);
          this.lastTouchTime = g.time; this.passT = this.passTarget ? g.time : -1;
          this.ignoreBall = 0.35; this.touchCD = 0.5;
          this.holding = null;
          g.sfx.kick(0.3);
        }
      }
      return;
    }
    // set on the toes when the ball is coming my way
    const near = Math.hypot(b.pos.x - this.home.centre.x, b.pos.z - this.home.centre.z) < 15;
    const want = g.state === 'play' && near && !this.dive && !this.kick && this.stunT <= 0 && this.vel.length() < 2.6;
    if (want && !this._ready) { this._ready = true; this.char.play('gkReady'); }
    else if (!want && this._ready) { this._ready = false; this.char.stopEmotes(); }
  }

  /** a goalkeeper in his own box: hard to knock over (only ice, or a combo meant for him, gets him) */
  _tough() { return this.isKeeper && inOwnBox(this.end, this.pos.x, this.pos.z); }
  /** rocked, but still on my feet */
  _stagger(dir) {
    const dv = this.dive;
    this.stunT = Math.max(this.stunT, dv ? 0.05 : 0.22); this.vel.addScaledVector(dir, 1.2);
    if (!dv && !this.holding) this.char.play('stagger', { duration: 0.35, amp: 0.45 });
    this.char.face('surprised', 0.6); this.faceT = 0.4;
  }

  /** hit by a special shot: lightning paralyses, fire bowls you over, ice freezes you solid, the cannon flattens you */
  zap(kind, dir) { this.elemHit([kind], dir); }
  /**
   * Hit by elements: a special shot (els: every element in it), a combo's aura, an element pass.
   * o: { level (players in the move), mild (aura / pass), force (a combo meant to beat the keeper), blast }
   */
  elemHit(els, dir, o = {}) {
    if (this.frozen) return;
    const has = (id) => els.includes(id), lv = o.level || 1, mild = !!o.mild;
    if (!o.force && this._tough()) {
      if (has('frost')) this.freeze(mild ? 0.9 : 1.5); else this._stagger(dir);
      return;
    }
    if (o.blast) this.launch(dir, 9, 6.5, true);                                   // 土+火: blown clean away
    else if (has('frost')) this.freeze((mild ? 0.9 : 1.8) * (lv > 1 ? 1.2 : 1));
    else if (has('cannon')) mild ? this.fall(dir, 8, 6, o.force) : this.launch(dir, 6.5, 8.5, o.force);
    else if (has('blaze')) mild ? this.fall(dir, 7, 6, o.force) : this.launch(dir, 8.5, 4, o.force);
    else if (has('thunder')) {
      this.knock(dir, 1); this.vel.multiplyScalar(0.3);
      this.stunT = mild ? 0.4 : lv > 1 ? 0.9 : 0.6;                                // a jolt, not a hold: lightning is about speed
      this.char.play('stagger', { duration: this.stunT + 0.1 }); this.char.face('surprised', 1); this.faceT = 0.6;
    } else this.fall(dir, mild ? 5 : 7, 6, o.force);
    this.game.rumble(this, mild ? 0.6 : 1, mild ? 140 : 260);
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
    if (this.game.ball.heldBy) { this.poke && (this.poke.ok = false); return; }   // the keeper has it in his hands
    const g = this.game, ball = g.ball, pk = this.poke;
    const carrier = g.possessor && g.possessor !== this ? g.possessor : (ball.lastTouch && ball.lastTouch !== this && ball.lastTouch.dribbling ? ball.lastTouch : null);
    let chance = 1;
    // can I even reach it?
    if (Math.hypot(ball.pos.x - this.pos.x, ball.pos.z - this.pos.z) > 1.3 || ball.pos.y > 0.7) chance = 0;
    if (carrier) {
      chance *= 0.64;                                      // a carrier on the ball is hard to rob
      // how exposed is the ball: tight at the carrier's boots it's hard to get at; knocked a stride
      // ahead (between touches) it's there for the taking
      const dcb = Math.hypot(ball.pos.x - carrier.pos.x, ball.pos.z - carrier.pos.z);
      chance *= 0.4 + 0.95 * clamp((dcb - 0.32) / 0.5, 0, 1);
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
      if (carrier.stunT > 0) chance = Math.max(chance, 0.95);
    }
    const c = this.game.controllers[this.team];
    if (c && c.type === 'ai') chance *= 0.55 + 0.45 * this.skill;
    const gkBox = this.isKeeper && inOwnBox(this.end, this.pos.x, this.pos.z);
    if (gkBox) chance = Math.max(chance * 1.6, 0.45 * this._gkLevel());   // the keeper spreads himself at the attacker's feet
    if (Math.random() < Math.min(0.97, chance)) {
      pk.ok = true;
      if (gkBox) {
        if (carrier) { carrier.touchCD = 0.6; carrier.dribbling = false; carrier.touch = null; carrier.trick = null; carrier.charging = false; carrier.charge = 0; carrier.stunT = Math.max(carrier.stunT, 0.3); carrier.vel.multiplyScalar(0.4); }
        this.smother(ball); this.flair('扑住了!', true); this.stats.tackles++;
        g.onTackle?.(this, carrier, true);
        return;
      }
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
  get dodging() { if (this.power) return true; const s = this.trick; return !!s && s.t > 0.04 && s.t < s.dur * 0.85; }

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
      this.trick = null; this.trickEndT = this.game.time;
    }
  }

  // ---- character moves (each character beats a defender their own way) -------------------
  static POWER_CD = 4;
  static SLIDE_REACH = { def: 1.15, cannon: 1.5 };

  _nearestOpp(maxD = 6, ahead = -1) {
    const g = this.game, f = this.forward;
    let best = null, bd = maxD;
    for (const o of g.live) {
      if (o === this || g.sameSide(o.team, this.team) || (g.m5 && o.gi === this.gi)) continue;
      const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < bd && (dx * f.x + dz * f.z) / (d || 1) > ahead) { bd = d; best = o; }
    }
    return best;
  }
  _isOpp(o) { const g = this.game; return o !== this && !o.out && !(g.m5 ? o.gi === this.gi : g.sameSide(o.team, this.team)); }

  _startPower() {
    const g = this.game, kind = this.charId, m = this.intent.move;
    const dir = m.lengthSq() > 0.09 ? new THREE.Vector3(m.x, 0, m.y).normalize() : this.forward.clone();
    const P = { type: kind, t: 0, dir, from: this.pos.clone(), hit: new Set() };
    const opp = this._nearestOpp(5, 0);
    // a spot just behind the defender in my way (or a few metres on)
    const behind = (dist) => {
      const q = opp ? opp.pos.clone().addScaledVector(dir, 1.4) : this.pos.clone().addScaledVector(dir, dist);
      clampToArena(q, 0.8); pushOutOfObstacles(q, 0.5); return q;
    };
    switch (kind) {
      case 'thunder': {          // a Z-shaped lightning dash round the defender
        // a tighter, shorter zigzag that goes where the stick points (it can be steered while it runs)
        P.dur = 0.36; const end = behind(3.6), r = new THREE.Vector3(-dir.z, 0, dir.x), a = this.pos;
        const side = opp && ((opp.pos.x - a.x) * r.x + (opp.pos.z - a.z) * r.z) > 0 ? -1 : 1;
        P.path = [a.clone(), a.clone().lerp(end, 0.33).addScaledVector(r, 0.85 * side), a.clone().lerp(end, 0.66).addScaledVector(r, -0.65 * side), end];
        for (const q of P.path) { clampToArena(q, 0.8); pushOutOfObstacles(q, 0.5); }   // never zig out of the pitch
        this.char.play('dash', { duration: P.dur + 0.1 }); break;
      }
      case 'phantom': {          // vanish and reappear behind them
        P.dur = 0.4; P.to = behind(3.8); P.jumped = false;
        this.char.play('dash', { duration: 0.3 }); break;
      }
      case 'gale': {             // spin up into the air and fly over them
        P.dur = 1.15; P.dist = this._room(dir, 4.4);
        this.char.play('galeLeap', { duration: P.dur }); break;
      }
      case 'blaze': {            // a roar that blasts everyone round me away
        P.dur = 0.5;
        this.char.play('roar', { duration: P.dur + 0.15 }); this.char.face('angry', 1); this.faceT = 0.6; break;
      }
      case 'frost': {            // a blast of cold: everyone close is frozen into an ice statue
        P.dur = 0.45;
        this.char.play('roar', { duration: P.dur + 0.1, amp: 0.7 }); break;
      }
      case 'cannon': {           // put the head down and charge, flattening anyone in the way
        P.dur = 0.55; P.dist = this._room(dir, 5.2); P.trav = 0;
        this.char.play('dash', { duration: P.dur + 0.1 }); break;
      }
      default: return this._startSkill();
    }
    this.power = P; this.trick = null; this.touch = null; this.receive = null;
    this.powerCD = Athlete.POWER_CD; this.skillCD = 0.6;
    this.stats.skills++;
    g.ball.passThrough = this;
    g.onPower?.(this, kind);
  }

  _powerTick(dt) {
    const P = this.power, g = this.game;
    P.t += dt;
    if (g.state !== 'play' || this.stunT > 0 || this.frozen) { this._endPower(); return; }
    const u = Math.min(1, P.t / P.dur);
    const fx = (k, n, sp, y = 0.4) => g.fx(k, { x: this.pos.x, y, z: this.pos.z }, { x: -P.dir.x, z: -P.dir.z }, n, sp);
    if (P.type === 'thunder') fx('bolt', 4, 2, 0.8);
    if (P.type === 'gale') fx('wind', 3, 3, 0.3 + this._galeH(u));
    if (P.type === 'cannon') { fx('smoke', 2, 2, 0.3); this._ram(); }
    if (P.type === 'phantom' && !P.jumped && P.t >= 0.16) {
      g.fx('ghost', { x: this.pos.x, y: 0.9, z: this.pos.z }, { x: 0, z: 0 }, 18, 2.5);
      this.pos.copy(P.to); this.vel.copy(P.dir).multiplyScalar(4); P.jumped = true;
      this.facing = Math.atan2(P.dir.x, P.dir.z); this.char.teleported();
      g.fx('ghost', { x: this.pos.x, y: 0.9, z: this.pos.z }, { x: 0, z: 0 }, 18, 2.5);
      g.sfx.post(4);
    }
    if (P.type === 'phantom') this.char.group.visible = !(P.t > 0.06 && P.t < 0.26 && Math.sin(P.t * 90) > -0.3);
    if ((P.type === 'blaze' || P.type === 'frost') && !P.blasted && P.t >= 0.25) { P.blasted = true; this._blast(P.type); }
    if (this.power && g.state === 'play') this._keeperClaim();
    if (this.power && P.t >= P.dur) this._endPower();
  }

  /** how far I can travel this way before the boards (keeping a metre's margin) */
  _room(dir, want) {
    const q = this.pos.clone().addScaledVector(dir, want);
    clampToArena(q, 1.0); pushOutOfObstacles(q, 0.6);
    return Math.max(0, (q.x - this.pos.x) * dir.x + (q.z - this.pos.z) * dir.z);
  }

  _galeH(u) { return 2.3 * Math.sin(Math.PI * u); }

  /** a shot / pass out of (or straight after) a skill move: no wind-up, the comfortable power, struck clean */
  _skillStrike(type) {
    const wasPower = !!this.power || this.game.time - (this.lastSkillT ?? -9) < 0.95;
    this._endPower();
    // the move carried the ball at dash speed: gather it at the boot so the strike meets it now
    const b = this.game.ball;
    if (wasPower && !b.heldBy && b.lastTouch === this && Math.hypot(b.pos.x - this.pos.x, b.pos.z - this.pos.z) < 1.6) {
      const f = this.forward, sp = Math.hypot(this.vel.x, this.vel.z), k = Math.min(1, 5 / Math.max(sp, 1e-3));
      this.vel.multiplyScalar(k);
      b.pos.set(this.pos.x + f.x * this.reachF, BALL.r, this.pos.z + f.z * this.reachF); b.vel.set(this.vel.x, 0, this.vel.z);
    }
    this.powerEndT = -9;
    // the pass weighted for the next move: firm enough to arrive quickly, soft enough to hit first time
    this.chargeType = type; this.charge = type === 'pass' ? 0.36 : type === 'chip' ? 0.5 : 0.74;
    if (type === 'chip' && !this.loftKind) this.loftKind = Math.random() < 0.5 ? 'head' : 'volley';   // onto a head or a boot
    this._needRelease = true; this._skillShot = true;
    this._release();
    this._skillShot = false;
    if (this.kick) { this.kick.perfect = true; this.lastPerfectT = this.game.time; this.game.onPerfect?.(this); }
    else if (this.armed) this.armed.skill = true;
  }

  /** a goalkeeper reads the skill move and smothers the ball (he isn't simply dribbled round any more) */
  _keeperClaim() {
    const P = this.power, g = this.game, b = g.ball;
    for (const k of g.live) {
      if (!k.isKeeper || !this._isOpp(k) || k.stunT > 0 || k.frozen || k.holding || b.heldBy || !inOwnBox(k.end, k.pos.x, k.pos.z)) continue;
      if (P.gkTried && P.gkTried.has(k)) continue;
      const d = Math.hypot(b.pos.x - k.pos.x, b.pos.z - k.pos.z);
      const reach = (k.dive ? 1.6 : 1.2) + (P.type === 'phantom' && P.jumped ? 0.9 : 0);
      if (d > reach || b.pos.y > 2.7) continue;
      (P.gkTried || (P.gkTried = new Set())).add(k);
      const c = { thunder: 0.62, gale: 0.62, phantom: 0.58, cannon: 0.72, blaze: 0.8, frost: 0.8 }[P.type] ?? 0.6;
      if (Math.random() > c * k._gkLevel()) continue;
      this._endPower();
      this.stunT = Math.max(this.stunT, 0.25); this.vel.multiplyScalar(0.3);
      k.smother(b);
      k.flair('扑救!', true);
      return;
    }
  }

  /** strike the ball from the top of the gale leap: a flying volley at goal (her special) */
  _galeVolley() {
    const P = this.power, g = this.game, ball = g.ball;
    let aim = this.aimDir(new THREE.Vector3());
    const goal = this._goalOn(aim, 1.2, 40);
    if (goal) aim = this._assistAim(new THREE.Vector3(goal.x - this.pos.x, 0, goal.z - this.pos.z).normalize().lerp(aim, 0.35).normalize(), 1);
    this._endPower();
    const def = this.charDef, d = goal ? goal.d : 15;
    const speed = clamp(26 * def.speed, 22, 34);
    const drop = -Math.atan2(Math.max(0, ball.pos.y - 0.9), d);            // hit down towards the goal
    const vel = aim.clone().multiplyScalar(Math.cos(drop) * speed); vel.y = Math.sin(drop) * speed;
    ball.strike(vel, new THREE.Vector3(), this);
    const sc = ball.startSpecial([def.id], this, aim, 0.9, this.goalTarget()); ball.chain = { els: [def.id], last: this }; g.onSpecial?.(this, sc);
    this.char.play('airKick', { duration: 0.42 });
    this.lastTouchTime = g.time; this.passT = -1; this.touchCD = 0.35; this.ignoreBall = 0.3; this.stats.touches++;
    this.flair('凌空抽射!'); this.noChargeT = 0.6;   // the button that struck it mustn't start another kick on landing
    g.hitstop = Math.max(g.hitstop, 0.09); g.shake = Math.max(g.shake, 0.18);
    g.fx('wind', ball.pos, { x: aim.x, z: aim.z }, 26, 6); g.fx('spark', ball.pos, { x: aim.x, z: aim.z }, 18, 5);
    g.squashBall(aim, 0.25); g.rumble(this, 0.9, 120);
    g.onKick(this, { type: 'kick', power: 0.9 }, vel);
    // she floats back down: the leap gesture carries on and finishes on its own
    this.vel.multiplyScalar(0.4); void P;
  }

  /** the gale leap's pass: from the top of the jump, a ball driven down onto a team-mate's feet */
  _galePass() {
    const g = this.game, ball = g.ball;
    const aim = this.aimDir(new THREE.Vector3());
    const mate = this._coneMate(aim, 0.3, 32) || this._coneMate(aim, -0.3, 26);
    this._endPower();
    let vel;
    if (mate) {
      const t = this.passLead(mate, 0.35);
      const dx = t.x - ball.pos.x, dz = t.z - ball.pos.z, d = Math.hypot(dx, dz) || 1;
      const sp = clamp(7 + d * 0.45, 9, 18), T = d / sp, h = Math.max(0, ball.pos.y - BALL.r);
      const vy = (0.5 * BALL.gravity * T * T - h) / T;                    // lands right at the feet
      vel = new THREE.Vector3((dx / d) * sp, vy, (dz / d) * sp);
      this.passTarget = mate; this.passT = g.time;
    } else { vel = aim.clone().multiplyScalar(12); vel.y = -1; this.passTarget = null; this.passT = -1; }
    ball.strike(vel, new THREE.Vector3(), this);
    const chain = [this.charId];
    ball.chain = { els: chain, last: this }; this._elemPass(chain);
    if (mate) { ball.passTo = mate; ball.passToT = 1.5; ball.guardT = 0.32; ball.guardBy = this; }
    this.char.play('airKick', { duration: 0.42 });
    this.lastTouchTime = g.time; this.touchCD = 0.35; this.ignoreBall = 0.3; this.stats.touches++;
    this.flair('技能传球!'); this.noChargeT = 0.6; this._needRelease = true;
    g.fx('wind', ball.pos, { x: vel.x, z: vel.z }, 18, 4); g.squashBall(vel, 0.15); g.rumble(this, 0.6, 90);
    g.onKick(this, { type: 'pass', power: 0.4 }, vel);
    this.vel.multiplyScalar(0.4);
  }

  _endPower() {
    const P = this.power; if (!P) return;
    this.power = null; this.powerEndT = this.lastSkillT = this.game.time;
    this.char.group.visible = !this.out;
    const b = this.game.ball;
    if (b.passThrough === this) b.passThrough = null;
    if (P.type === 'gale') this.facing = Math.atan2(P.dir.x, P.dir.z);
    this.burstT = Math.max(this.burstT, P.type === 'thunder' ? 0.3 : 0.6);   // lightning comes out of it under control
    // the ball carries on at my feet
    b.lastTouch = this; this.lastTouchTime = this.game.time; this.touchCD = 0.15;
  }

  /** the body during a character move */
  _powerMotion(dt) {
    const P = this.power, u = Math.min(1, P.t / P.dur);
    const dir = P.dir;
    if (P.type === 'thunder') {
      // along the zigzag at lightning speed; the stick bends what's left of it (about 290°/s)
      const seg = Math.min(2, Math.floor(u * 3)), k = u * 3 - seg;
      const m = this.intent.move;
      if (m.lengthSq() > 0.09) {
        const d = wrapAngle(Math.atan2(m.x, m.y) - Math.atan2(dir.x, dir.z)), step = clamp(d, -5 * dt, 5 * dt);
        if (Math.abs(step) > 1e-4) {
          for (let i = seg + 1; i < P.path.length; i++) { const q = P.path[i].sub(this.pos).applyAxisAngle(UP, step).add(this.pos); clampToArena(q, 0.8); pushOutOfObstacles(q, 0.5); }
          dir.applyAxisAngle(UP, step);
        }
      }
      const a = P.path[seg], b = P.path[seg + 1];
      const nx = a.x + (b.x - a.x) * k, nz = a.z + (b.z - a.z) * k;
      this.vel.set((nx - this.pos.x) / Math.max(dt, 1e-3), 0, (nz - this.pos.z) / Math.max(dt, 1e-3));
      if (this.vel.length() > 30) this.vel.setLength(30);
      this.pos.set(nx, 0, nz);
      const d = this.vel; if (d.lengthSq() > 0.5) this.facing = Math.atan2(d.x, d.z);
    } else if (P.type === 'gale') {
      const sp = P.dist / P.dur;
      this.vel.copy(dir).multiplyScalar(sp); this.pos.addScaledVector(this.vel, dt);
      this.facing += dt * 16;                                // spinning like a top
    } else if (P.type === 'cannon') {
      let sp = 4 + 8 * Math.min(1, P.t / 0.12);
      if (P.trav + sp * dt > P.dist) sp = Math.max(0, (P.dist - P.trav) / Math.max(dt, 1e-3));   // pull up before the boards
      P.trav += sp * dt;
      this.vel.copy(dir).multiplyScalar(sp); this.pos.addScaledVector(this.vel, dt);
      this.facing = Math.atan2(dir.x, dir.z);
    } else if (P.type === 'phantom') {
      this.vel.multiplyScalar(Math.max(0, 1 - dt * 8)); this.pos.addScaledVector(this.vel, dt);
    } else {
      // blaze / frost: plant the feet for the blast
      this.vel.multiplyScalar(Math.max(0, 1 - dt * 10)); this.pos.addScaledVector(this.vel, dt);
    }
    this.ignoreBall = Math.max(this.ignoreBall, 0.05);
  }

  /** the ball during a character move: stuck to my feet (or carried up with me) */
  _powerBall() {
    const P = this.power, b = this.game.ball;
    const dir = P.type === 'gale' || P.type === 'cannon' ? P.dir : this.forward;
    const reach = P.type === 'cannon' ? 0.75 : 0.45;
    const h = P.type === 'gale' ? this._galeH(Math.min(1, P.t / P.dur)) : 0;
    b.pos.set(this.pos.x + dir.x * reach, BALL.r + h + (P.type === 'gale' ? 0.35 * Math.sin(Math.PI * Math.min(1, P.t / P.dur)) : 0), this.pos.z + dir.z * reach);
    const by = b.pos.y; clampToArena(b.pos, BALL.r + 0.05); b.pos.y = by;     // the ball stays on the pitch too
    b.vel.set(this.vel.x, 0, this.vel.z);
    if (P.type === 'gale') b.vel.y = 0.001;
    b.spin.set(this.vel.z / BALL.r, 0, -this.vel.x / BALL.r);
    b.lastTouch = this; this.lastTouchTime = this.game.time;
    b.endSpecial?.();
  }

  /** cannon: anyone in front of the charge goes flying */
  _ram() {
    const P = this.power, g = this.game;
    for (const o of g.live) {
      if (!this._isOpp(o) || P.hit.has(o)) continue;
      const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z;
      const ahead = dx * P.dir.x + dz * P.dir.z, side = Math.abs(-dx * P.dir.z + dz * P.dir.x);
      if (ahead > -0.2 && ahead < 1.1 && side < 0.85) {
        P.hit.add(o);
        const away = new THREE.Vector3(P.dir.x + (dx - P.dir.x * ahead) * 0.8, 0, P.dir.z + (dz - P.dir.z * ahead) * 0.8).normalize();
        o.launch(away, 6.5, 9.5);                       // sent sky-high
        g.onImpact?.(o, 0xffd23f);
        g.sfx.bump(14); g.sfx.element('cannon', 'hit', 0.7); g.shake = Math.max(g.shake, 0.2);
        g.fx('dust', { x: o.pos.x, y: 0.2, z: o.pos.z }, { x: away.x, z: away.z }, 16, 4);
      }
    }
  }

  /** blaze / frost: a ring that knocks back or freezes everyone close */
  _blast(kind) {
    const g = this.game, R0 = 3.4;
    g.fx(kind === 'blaze' ? 'fire' : 'ice', { x: this.pos.x, y: 0.5, z: this.pos.z }, { x: 0, z: 0 }, 40, 7);
    g.fx(kind === 'blaze' ? 'fire' : 'ice', { x: this.pos.x, y: 1.2, z: this.pos.z }, { x: 0, z: 0 }, 24, 5);
    g.sfx.element(kind, 'hit', 1);
    g.shake = Math.max(g.shake, 0.18);
    for (const o of g.live) {
      if (!this._isOpp(o)) continue;
      const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > R0) continue;
      const away = new THREE.Vector3(dx / (d || 1), 0, dz / (d || 1));
      if (kind === 'blaze') { if (d < 3.0) o.launch(away, 11 - d * 1.5, 4.5); else o.knock(away, 7); }   // blown far away
      else { o.freeze(2.2); }
    }
  }

  /** frozen solid into an ice statue for a while */
  freeze(t) {
    if (this.frozen) return;
    this.knock(this.forward, 0); this.vel.set(0, 0, 0);
    this.stunT = Math.max(this.stunT, t); this.iceT = Math.max(this.iceT, t);
    this.char.face('surprised', 1); this.faceT = t;
    this.game.emit?.({ e: 'zap', i: this.team, k: 'frost', t });
  }

  // ---- headers / bicycle kicks -------------------------------------------------------------
  /** is there a ball in the air I could get to with my head (or, bike = true, an overhead kick)? */
  _headerChance(bike = false) {
    if (this.game.ball.heldBy) return false;
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
    const k = this.char.group.scale.y || 1;                         // a bigger player meets it higher
    for (let t = 0; t <= 0.85; t += 0.033) {
      b.predict(t, q);
      const lo = (bike ? 1.2 : 0.5) * k, hi = (bike ? 2.45 : 2.3) * k;   // a jumping header meets it at up to ~2.3 m
      if (q.y < lo || q.y > hi) continue;
      const low = !bike && q.y < 1.05 * k;
      if (low && (b.speed < 3.5 || t > 0.6)) continue;            // only dive at a ball that's coming
      const d = Math.hypot(q.x - this.pos.x, q.z - this.pos.z);
      const reach = bike ? 0.4 + speed * t * 0.6 : low ? 1.3 + speed * t : 0.45 + speed * t;
      if (d <= reach) return { x: q.x, z: q.z, y: q.y, t, kind: bike ? 'bicycle' : low ? 'dive' : q.y > 1.7 * k ? 'jump' : 'stand' };
    }
    return null;
  }
  _startHeader(mode) {
    const lob = mode === true || mode === 'lob';
    const aim = this.aimDir(new THREE.Vector3());
    const bike = lob && !!this._headerSpot(PLAYER.runSpeed * this.speedMul, true);
    this.header = { t: 0, soft: lob && !bike && !this._goalOn(aim), bike, pass: mode === 'pass', hit: false, jumped: false, spot: null, aim, kind: null, stick: this.intent.move.lengthSq() > 0.09 };
    this.charging = false; this.charge = 0; this.receive = null; this.touch = null; this.armed = null;
  }
  _headerMotionTick(dt) {
    const h = this.header, g = this.game, ball = g.ball;
    h.t += dt;
    if (h.hit) { if (h.t > h.hitT + (h.kind === 'bicycle' ? 0.9 : h.kind === 'dive' ? 0.6 : 0.35)) this.header = null; return; }
    // keep the aim live from the stick until contact
    const m = this.intent.move; if (m.lengthSq() > 0.09) { h.aim.set(m.x, 0, m.y).normalize(); h.stick = true; }
    if (!h.stick && !h.pass && !h.soft) { const t = this.goalTarget(); h.aim.set(t.x - this.pos.x, 0, t.z - this.pos.z).normalize(); }   // nothing held: head it at goal
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
      // a team-mate's cross is meant for the head: a little more forgiving to meet
      const fed = ball.loftKind === 'head' || (ball.lastTouch && ball.lastTouch !== this && g.sameSide(ball.lastTouch.team, this.team));
      touching = !!head && head.pos.distanceTo(ball.pos) < R + (h.kind === 'dive' ? 0.3 : h.kind === 'jump' ? 0.32 : 0.26) + (fed ? 0.22 : 0);
    }
    if (touching) {
      h.hit = true; h.hitT = h.t;
      const rel = Math.hypot(ball.vel.x - this.vel.x, ball.vel.y, ball.vel.z - this.vel.z), run = Math.hypot(this.vel.x, this.vel.z);
      let sp, el;
      // nodded on to a team-mate, or steered onto goal
      const mate = h.pass ? this._coneMate(h.aim, 0.6, 22) : null;
      if (mate) h.aim.set(mate.pos.x - this.pos.x, 0, mate.pos.z - this.pos.z).normalize();
      else if (!h.soft) h.aim.copy(this._assistAim(h.aim, 1));
      const prev = ball.lastTouch, oneTouch = prev && prev !== this && g.sameSide(prev.team, this.team) && g.time - prev.lastTouchTime < 2.6;
      if (mate) { const dm = Math.hypot(mate.pos.x - this.pos.x, mate.pos.z - this.pos.z); sp = clamp(6 + dm * 0.45, 7, 15); el = 0.12; this.passTarget = mate; this.passT = g.time; }
      else if (h.soft) { sp = 5.5 + rel * 0.1; el = 0.85; }
      else if (h.kind === 'bicycle') { sp = clamp(18 + rel * 0.35, 19, 29); el = 0.02; }
      else if (h.kind === 'dive') { sp = clamp(12 + rel * 0.4 + run * 0.5, 13, 25); el = 0.04; }
      else if (h.kind === 'jump') { sp = clamp(12 + rel * 0.5 + run * 0.5, 13, 26); el = ball.pos.y > 1.9 ? -0.15 : -0.05; }
      else { sp = clamp(10.5 + rel * 0.45 + run * 0.55, 11, 24); el = 0.03; }
      // a header at goal is an element shot too (the whole move's elements when it's met first time)
      const chain = this._chainFor(prev, oneTouch);
      const special = !mate && !h.soft && g.state === 'play' && this._goalOn(h.aim, 1.4, 30) ? comboOf(chain) : null;
      if (special) sp = this._elemSpeed(sp * 1.06, special, 15);
      if (special && special.level > 1) { h.aim.copy(this._assistAim(h.aim, 1, 1.05, 0.6)); el = Math.min(el, 0.02); }
      ball.vel.set(h.aim.x * sp * Math.cos(el), Math.sin(el) * sp, h.aim.z * sp * Math.cos(el));
      ball.spin.multiplyScalar(0.2);
      ball.lastTouch = this; this.lastTouchTime = g.time; this.touchCD = 0.3; this.ignoreBall = 0.25; this.stats.touches++;
      ball.guardT = 0; ball.loftKind = null; ball.dribbleGuard = 0; ball.endSpecial();
      ball.chain = { els: chain, last: this }; ball.shotDist = this.goalTarget().distanceTo(this.pos); { const t2 = this.goalTarget(); ball.shotZone = shotZone(this.pos.x, this.pos.z, t2.x, t2.z); }
      if (special) { ball.startSpecial(chain, this, h.aim, 0.8, this.goalTarget()); g.onSpecial?.(this, special); }
      else if (mate) { this._elemPass(chain); ball.passTo = mate; ball.passToT = 1.3; }
      if (!mate) this.passT = -1;
      if (special && special.level > 1) this._comboFlair(special);
      else if (oneTouch && !mate && !h.soft) this.flair(h.kind === 'bicycle' ? '倒钩!' : h.kind === 'dive' ? '鱼跃冲顶!' : '头球攻门!');
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
    if (ta <= 0.04 || ta > 0.6) return;
    const mx = dx + wx * ta, mz = dz + wz * ta;
    // a ball going past within a long stride: step across and take it
    const ct = this.game.controllers[this.team]?.type, human = ct === 'human' || ct === 'remote';
    const lt = ball.lastTouch, forMe = lt && lt.passedTo === this, forOther = lt && lt.passedTo && lt.passedTo !== this;
    if (Math.hypot(mx, mz) > (forMe ? (human ? 1.9 : 1.5) : forOther ? (human ? 0.95 : 0.55) : (human ? 1.25 : 0.85))) return;
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
    // where to be: on the ball's line, a boot-length short of where it'll be
    const bv = Math.hypot(ball.vel.x, ball.vel.z) || 1;
    const ix = ball.pos.x + ball.vel.x * ta - (ball.vel.x / bv) * 0.35, iz = ball.pos.z + ball.vel.z * ta - (ball.vel.z / bv) * 0.35;
    this.receive = { type, side, t: 0, ta, h, ix, iz };
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
        ik.R.target.y = clamp(ball.pos.y - R * 0.3, ankleH, 1.05);
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
    this.char.airY = this.air ? this.air.y : (this.netAir ? this.netAir[0] : 0);
    this.char.tumble = this.air ? this.air.rot : (this.netAir ? this.netAir[1] : 0);
    this.char.setGhost?.(!!this.ghost);
    const iced = this.iceT > 0;
    if (iced !== !!this._iced) { this._iced = iced; this.char.setIce(iced); }   // an ice statue
    this.char.group.position.copy(this.pos);
    this.char.setFacing(this.facing);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.char.update(dt, { speed: hs, turnRate: this.turnRate, fatigue: 1 - (this.stamina ?? 1), shield: this.dribbling ? (this.shieldK || 0) * (this.shieldSide || 0) : 0 });
  }

  // ---------------------------------------------------------------------------
  /** the charge window that gives a pin-point strike */
  static SWEET = [0.62, 0.86];
  /** highest ball each strike can meet (a 射门 at waist height is a volley) */
  static MAXH = { kick: 1.2, pass: 0.9, chip: 0.6 };

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

  /** will the ball drop into volley range somewhere I can get to in time (rather than heading it now)? */
  _volleyLater(type) {
    const ball = this.game.ball, q = new THREE.Vector3(), sp = PLAYER.runSpeed * this.speedMul, maxY = Athlete.MAXH[type];
    for (let t = 0.1; t <= 1.4; t += 0.05) {
      ball.predict(t, q);
      if (q.y > maxY || q.y < 0.35) continue;
      if (Math.hypot(q.x - this.pos.x, q.z - this.pos.z) <= sp * t + 0.6) return true;
    }
    return false;
  }

  /** could a strike started now meet the ball at the contact moment? */
  _inStrikeReach(type) {
    const ball = this.game.ball;
    if (ball.heldBy) return false;
    const d = Math.hypot(ball.pos.x - this.pos.x, ball.pos.z - this.pos.z);
    if (ball.pos.y > Athlete.MAXH[type]) return false;
    if (d < 0.75) return true;
    const dur = ANIM.kickDuration * (type === 'pass' ? 0.82 : 1);
    const ct = dur * ANIM.kickContact;
    const t = this._approachTarget(ct, this.armed ? this.armedAim(this._r2 || (this._r2 = new THREE.Vector3())) : this.aimDir(new THREE.Vector3()));
    return !!t && Math.hypot(t.x - this.pos.x, t.z - this.pos.z) < 9 * ct * 0.8;
  }

  _armedSpot(speed) {
    const ball = this.game.ball, aim = this.armedAim(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(aim, UP), q = new THREE.Vector3();
    const maxY = Athlete.MAXH[this.armed?.type || this.chargeType || 'kick'];
    for (let t = 0; t <= 1.6; t += 0.05) {
      ball.predict(t, q);
      if (q.y > maxY) continue;                      // wait for it to drop to volley height
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
    // the ball isn't there yet: keep the strike ready and go and meet it (first time, as it arrives)
    if (!this._inStrikeReach(type)) {
      const b = g.ball, bd = Math.hypot(b.pos.x - this.pos.x, b.pos.z - this.pos.z);
      const coming = this._incoming();
      if (g.state === 'play' && ((bd < 6 && b.pos.y < 2) || (coming && bd < 20 && b.pos.y < 4))) {
        this.armed = { type, power, passTo: this.passTo || this.intendTo, t: 0, max: coming ? 2.4 : 0.8, far: coming ? 22 : 7, from: coming ? this._feederFor() : undefined };
        this.char.windup = 0;
        return;
      }
    }
    let aim = this.aimDir(new THREE.Vector3());
    // no direction held at all: a shot goes at goal, a pass to the best-placed team-mate
    if (!this._aimSet && !this.intendTo && !this.passTo) {
      if (type === 'kick') { const t = this.goalTarget(); if (Math.hypot(t.x - this.pos.x, t.z - this.pos.z) < 32) aim.set(t.x - this.pos.x, 0, t.z - this.pos.z).normalize(); }
      else { const m = this._coneMate(aim, 0.68, 34) || this._coneMate(aim, -0.2, 26); if (m) this.intendTo = m; }
    }
    // a pass: aimed at where the team-mate will be, weighted to arrive at a comfortable pace
    let passSpeed = 0, loft = null;
    const meant = this.intendTo || this.passTo;
    this.passTarget = meant && !meant.out ? meant : null;
    this.intendTo = null; this.passTo = null;
    if (type === 'pass') {
      // 平传: along the ground to the team-mate I'm pointing at (generous cone), led into their run
      const rcv = this.passTarget || this._coneMate(aim, 0.68, 34);
      if (rcv) {
        const t = this.passLead(rcv, power);
        aim.set(t.x - this.pos.x, 0, t.z - this.pos.z).normalize();
        passSpeed = t.speed; this.passTarget = rcv;
      } else passSpeed = 7 + 12 * power;
    } else if (type === 'chip') {
      // 挑传: a lofted ball onto a team-mate (head or volley height); aimed at the goal instead it's a 挑射
      const goal = this._goalOn(aim);
      const rcv = this.passTarget || this._coneMate(aim, 0.8, 36);
      const rcvBetter = rcv && (rcv === meant || !goal || Math.hypot(goal.x - rcv.pos.x, goal.z - rcv.pos.z) < goal.d - 2);
      if (rcv && rcvBetter) { loft = this._loftTo(rcv, power, this.loftKind); aim = loft.aim; this.passTarget = rcv; }
      else if (goal) aim = this._assistAim(aim, 0.7);
      this.loftKind = null;
    } else if (type === 'kick') {
      // shots are steered onto the target: aim anywhere near a goal and it's pulled inside the posts
      aim = this._assistAim(aim, 1);
    }
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
    this.kick = { type, power, aim, t: 0, dur, contactT, hit: false, resolved: false, passSpeed, loft, perfect, over: power > 0.95 && type !== 'pass', armed: !!this._fromArmed, skill: !!this._skillShot, feeder: this._fromArmed && this._fromArmed !== true ? this._fromArmed : null };
    this.receive = null; this.touch = null;
    this.kick.approach = this._approachTarget(contactT, aim);
    // a soft 爆射 (a pass, really) is side-footed; anything firmer is a full swing
    const volley = g.ball.pos.y > 0.5 && type !== 'chip';
    if (type === 'kick' && power < 0.3 && !volley) this.char.play('pass', { duration: dur, side: 'Right', amp: 0.8 + 0.6 * power });
    else this.char.play(volley ? 'kick' : type, { duration: dur, side: 'Right', amp: (0.85 + 0.3 * power) * (volley ? 1.25 : 1) });
  }

  _approachTarget(timeLeft, aim) {
    const ball = this.game.ball;
    const pred = ball.predict(Math.max(0, timeLeft), new THREE.Vector3());
    if (pred.y > Athlete.MAXH.kick) return null;
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
    const maxH = Athlete.MAXH[k.type] + 0.05;
    const reach = k.armed ? 0.95 : 0.55;          // met on the run (first time): the boot finds it
    if (!footTouched && (d > reach || ball.pos.y > maxH)) { g.onWhiff(this); return; }
    k.hit = true;
    let quality = footTouched ? Math.max(0.75, 1 - d / reach) : Math.max(k.armed ? 0.7 : 0, 1 - d / reach);
    const p = k.power;
    let speed, elev;
    const volley = ball.pos.y > R + 0.15;
    // first time off a team-mate's ball: the reward for playing together
    // (a ball that brushed me on the way in still counts as first time off the feeder)
    const prev = k.feeder && (ball.lastTouch === k.feeder || ball.lastTouch === this) ? k.feeder : ball.lastTouch;
    const oneTouch = !!prev && prev !== this && g.sameSide(prev.team, this.team) && g.time - prev.lastTouchTime < 3 && g.state === 'play';
    if (oneTouch) quality = Math.max(quality, 0.92);
    // fresh out of a skill move and playing a team-mate's ball first time: still a 技能 strike
    if (oneTouch && (footTouched || k.armed) && g.time - (this.lastSkillT ?? -9) < 2.5) k.skill = true;
    if (k.skill) quality = Math.max(quality, 0.95);              // out of a skill move: struck clean
    // the move this strike belongs to: everyone who played it first time adds their element
    const chain = this._chainFor(prev, oneTouch && (footTouched || k.armed));
    if (k.type === 'chip') { speed = PLAYER.chipSpeed[0] + PLAYER.chipSpeed[1] * p; elev = 0.6 + 0.14 * p; }
    else if (k.type === 'pass') { speed = k.passSpeed; elev = 0.02; }
    else { speed = PLAYER.shotSpeed[0] + PLAYER.shotSpeed[1] * Math.pow(p, 1.15); elev = 0.02 + 0.15 * Math.pow(p, 1.4) + (volley ? 0.06 : 0); }
    if (k.type !== 'pass') {
      speed *= 0.82 + 0.18 * quality;
      // running into the shot adds pace
      speed += Math.max(0, this.vel.x * k.aim.x + this.vel.z * k.aim.z) * 0.55;
    }
    // every proper 爆射 (anything firmer than a side-footed pass) is an element shot: the striker's own
    // element, or (first time at the end of a passing move) every element in the move
    // (even a light one: every shot carries the elements; a soft one just isn't any faster for it)
    // a 挑射 (chip at goal, nobody it's for) is an element shot too, on its normal lob
    const lobShot = k.type === 'chip' && !k.loft && !this.passTarget;
    const special = (k.type === 'kick' || lobShot) && g.state === 'play' ? comboOf(chain) : null;
    if (special && k.type === 'kick') speed = this._elemSpeed(speed, special, Math.min(20, speed * 1.08));
    if (special && k.type === 'kick') {
      if (!special.ids.includes('gale') && !special.ids.includes('phantom')) elev = Math.min(elev, 0.07);   // driven at body height: it goes through people
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
    // close in, a shot is struck with everything; from range it carries less (a combo loses less of it)
    // where it's struck from: 小禁区 (goal area) full power, the box about normal, outside it a long shot loses a lot
    const gt = this.goalTarget(), zone = shotZone(this.pos.x, this.pos.z, gt.x, gt.z);
    if (k.type === 'kick' && special) {
      const zf = zone === 'small' ? 1.1 : zone === 'box' ? clamp(1.0 - (gd - 7) * 0.012, 0.92, 1.0) : clamp(0.86 - (gd - 13) * 0.012, 0.72, 0.86);
      speed *= special.level > 1 ? 1 - (1 - zf) * 0.6 : zf;               // combos lose less of it
    }
    if (k.type === 'kick' && special && special.level === 1) speed = Math.min(speed, 33);
    if (k.type === 'kick' && special && special.level > 1) speed = Math.min(speed, 46 - clamp((gd - 10) * 1.0, 0, 12));   // from range even a combo is something a keeper can track   // a solo shot never gets past what a keeper can react to
    // small errors only: the aim is the player's, so the ball should go (almost) exactly there
    let err = ((1 - quality) * 0.035 + Math.pow(p, 3) * 0.05 * (1.3 - this.skill) + gd * 0.0012) * (Math.random() * 2 - 1);
    if (k.type === 'pass') { err *= 0.15 + 0.35 * p * p; slice = 0; }  // side-foot: accurate, a driven pass a little less so
    if (this.passTarget && (k.type === 'pass' || k.loft)) { err *= 0.2; slice = 0; }   // a pass to a team-mate goes where it was meant
    if (k.perfect && footTouched) { err *= 0.15; slice *= 0.3; }       // pin-point: released in the sweet window
    if (k.skill) { err *= 0.2; slice *= 0.3; }
    if (oneTouch) { err *= 0.3; slice *= 0.4; if (k.type === 'kick') speed *= 1.06; }
    if (k.over) { err *= 1.6; elev += Math.random() * 0.05; }          // leathered: power over control
    let dir = k.aim.clone().applyAxisAngle(UP, err - slice * 0.025);
    // a combo shot is guided onto the target: pulled well inside the posts from a much wider angle
    if (special && special.level > 1) { dir = this._assistAim(k.aim, 1, 1.05, 0.6); if (!lobShot) elev = Math.min(elev, 0.06); }
    elev += (1 - quality) * 0.05 * (Math.random() - 0.3);
    if (volley && k.type === 'kick') elev = Math.min(elev, 0.04 + (ball.pos.y > 0.8 ? -0.05 : 0));   // a volley is struck through the ball, kept down
    let vel = dir.multiplyScalar(Math.cos(elev) * speed); vel.y = Math.sin(elev) * speed;
    if (k.loft) { vel = k.loft.aim.clone().applyAxisAngle(UP, err * 0.5).multiplyScalar(k.loft.vh); vel.y = k.loft.vy; }
    // spin: lateral input at contact = curl; chips get backspin, drives get topspin
    const m = this.intent.move;
    const r2 = new THREE.Vector3().crossVectors(k.aim, UP);
    let lateral = 0;
    void m;                                                         // the stick aims; curl comes from where the boot met the ball
    const spin = new THREE.Vector3();
    if (k.type === 'pass') { lateral = 0; spin.addScaledVector(r2, -speed / R * 0.5); }   // rolls true along the grass
    else if (k.loft) spin.addScaledVector(r2, 10);
    else if (k.type === 'chip') spin.addScaledVector(r2, 28 * p);
    else spin.addScaledVector(r2, -8 * p);
    spin.y = lateral * 16 * p * (k.type === 'chip' ? 0.6 : 1) + slice * 9 * p;
    ball.strike(vel, spin, this);
    if ((k.type === 'pass' || k.loft) && this.passTarget) { ball.guardT = 0.32; ball.guardBy = this; }
    ball.loftKind = k.loft ? k.loft.kind : null;
    ball.chain = { els: chain, last: this };
    ball.shotDist = gd; ball.shotZone = zone;
    if (this.passTarget && !special) { ball.passTo = this.passTarget; ball.passToT = 1.3; }
    if (special) { ball.startSpecial(chain, this, dir, p, this.goalTarget()); if (lobShot) ball.special.lob = true; g.onSpecial?.(this, special); }
    else this._elemPass(chain);                                    // every pass carries them too, however soft
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
    // a flourish worth a shout: first-time volleys and shots, one-twos
    if (special && special.level > 1) this._comboFlair(special);
    else if (k.skill) { this.flair(k.type === 'kick' ? '技能射门!' : '技能传球!'); g.hitstop = Math.max(g.hitstop, 0.06); }
    else if (oneTouch && (footTouched || k.armed)) {
      if (k.type === 'kick' && volley) { this.flair('凌空抽射!'); g.hitstop = Math.max(g.hitstop, 0.08); g.shake = Math.max(g.shake, 0.16); g.fx('spark', ball.pos, { x: dir.x, z: dir.z }, 22, 6); g.sfx.kick?.(1); }
      else if (k.type === 'kick' && p >= 0.3) { this.flair('一脚射门!'); g.hitstop = Math.max(g.hitstop, 0.05); }
      else if (this.passTarget && this.passTarget === prev) this.flair('撞墙配合!');
      else if (k.type === 'chip' && k.loft) this.flair('一脚传中!');
      else if (k.type === 'pass' || (k.type === 'kick' && p < 0.3)) this.flair('一脚出球!');
    }
    g.onKick(this, k, vel);
  }

  /** a word over my head for a moment (also sent to guests) */
  flair(text, quiet = false) { this.flairText = text; this.flairT = this.game.time; if (!quiet) this.game.sfx.combo?.(/凌空|倒钩|鱼跃|合击/.test(text) ? 2 : 1); this.game.emit?.({ e: 'flair', i: this.team, s: text, q: quiet ? 1 : 0 }); }

  /** the elements of the passing move this strike belongs to (one per player, most recent last) */
  _chainFor(prev, firstTime) {
    const c = this.game.ball.chain;
    const els = firstTime && c && prev && c.last === prev && prev !== this && !this._isOpp(prev) ? c.els.slice(-5) : [];
    els.push(this.charId);
    return els;
  }
  /** how fast an element shot flies: a solo one only a little quicker than a normal shot, a combo much more */
  _elemSpeed(speed, c, lo) {
    const top = Math.max(...c.ids.map((id) => CHAR[id].speed));
    if (c.level === 1) return clamp(speed * top, lo, 36);
    return clamp(speed * top * (c.level >= 3 ? 1.16 : 1.08) * (c.fast || 1), lo + 4, 46);
  }
  /** a pass carries the elements of the move along with it (it only bites opponents who get in its way) */
  _elemPass(chain) {
    const b = this.game.ball;
    b.passEls = [...new Set(chain)].sort().join('+'); b.passBy = this; b.passAt = this.game.time;
  }
  /** the name of the combo, loud */
  _comboFlair(c) {
    const g = this.game;
    this.flair(c.name + '!');
    g.hitstop = Math.max(g.hitstop, c.level >= 3 ? 0.16 : 0.11); g.shake = Math.max(g.shake, c.level >= 3 ? 0.35 : 0.24);
    g.slowmo = Math.max(g.slowmo || 0, c.level >= 3 ? 0.7 : 0.45);
    g.emit?.({ e: 'shake', v: g.shake });
  }

  /** the team-mate who played the ball that's coming to me (remembered even if it brushes me first) */
  _feederFor() {
    const lt = this.game.ball.lastTouch;
    if (lt && lt !== this) return lt;
    return this._feeder && this.game.time - this._feederT < 2.5 ? this._feeder : lt;
  }

  /** is the ball on its way to me (a pass meant for me, or rolling right at me)? */
  _incoming() {
    const b = this.game.ball, lt = b.lastTouch;
    if (b.heldBy) return false;
    if (lt && lt !== this && lt.passedTo === this) { this._feeder = lt; this._feederT = this.game.time; return true; }
    // it brushed me on the way in: still the same pass
    if (lt === this && this._feeder && this.game.time - this._feederT < 2.5 && this.game.time - this.lastTouchTime < 0.6 && !this.dribbling) return true;
    if (this.game.live.some((o) => o !== this && this.game.sameSide(o.team, this.team) && ((o.intendTo === this && (o.charging || o.armed)) || (o.kick && !o.kick.hit && o.passTarget === this) || (o.armed && o.armed.passTo === this)))) return true;   // it's about to be played to me
    const dx = this.pos.x - b.pos.x, dz = this.pos.z - b.pos.z, d = Math.hypot(dx, dz), v = Math.hypot(b.vel.x, b.vel.z);
    if (v < 3 || d < 0.5) return false;
    const along = (dx * b.vel.x + dz * b.vel.z) / v;
    return along > 0 && Math.abs(dx * b.vel.z - dz * b.vel.x) / v < 2.2;
  }

  /** the team-mate nearest the line I'm aiming along (within the cone, closer and straighter wins) */
  _coneMate(aim, minCos, maxD) {
    const g = this.game; let best = null, bestS = -Infinity;
    // a human's pass reads generously: the team-mate he's roughly pointing at (where they're running to)
    const ct = g.controllers[this.team]?.type, human = ct === 'human' || ct === 'remote';
    if (human) minCos = Math.min(minCos, 0.42);
    for (const o of g.live) {
      if (o === this || !g.sameSide(o.team, this.team) || o.role === 'gk') continue;
      const px = o.pos.x + o.vel.x * 0.35, pz = o.pos.z + o.vel.z * 0.35;
      const dx = px - this.pos.x, dz = pz - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 1.5 || d > maxD) continue;
      const c = (dx * aim.x + dz * aim.z) / d;
      if (c < minCos) continue;
      let free = 4; for (const e of g.live) if (this._isOpp(e)) free = Math.min(free, Math.hypot(e.pos.x - o.pos.x, e.pos.z - o.pos.z));
      const s = c * 3 - d * 0.035 + free * 0.12 - (g.offsidePos?.(o) ? 1.6 : 0);   // rather an onside team-mate
      if (s > bestS) { bestS = s; best = o; }
    }
    return best;
  }

  /** the goal I'm (roughly) aiming at, if any: { x, z, d, g } */
  _goalOn(aim, maxAng = 0.45, maxD = 28) {
    let best = null;
    for (const gg of this.targets || []) {
      const dx = gg.centre.x - this.pos.x, dz = gg.centre.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > maxD) continue;
      const ang = Math.acos(clamp((dx * aim.x + dz * aim.z) / (d || 1), -1, 1));
      if (ang < maxAng && (!best || ang < best.ang)) best = { x: gg.centre.x, z: gg.centre.z, d, g: gg, ang };
    }
    return best;
  }

  /**
   * Steer a shot onto the goal: where the aim crosses the goal line is pulled inside the posts.
   * Full strength when aiming near the mouth, fading out by ~35° off it (so you can still aim wide on purpose).
   */
  _assistAim(aim, strength = 1, cone = 0.62, margin = 0.45) {
    const goal = this._goalOn(aim, cone, 40);
    if (!goal) return aim;
    const gg = goal.g, A = gg.axis, L = A === 'x' ? 'z' : 'x', line = gg.sign * gg.line;
    const inset = FIELD.goalHalfW - Math.min(margin, FIELD.goalHalfW * 0.3);
    let cross;
    if (Math.abs(aim[A]) > 0.05) cross = this.pos[L] + aim[L] * ((line - this.pos[A]) / aim[A]); else cross = goal.g.centre[L];
    const lat = clamp(cross - gg.centre[L], -inset, inset);
    const tx = A === 'x' ? line : gg.centre.x + lat, tz = A === 'x' ? gg.centre.z + lat : line;
    const want = new THREE.Vector3(tx - this.pos.x, 0, tz - this.pos.z).normalize();
    const w = clamp((cone - goal.ang) / 0.25, 0, 1) * strength;
    return aim.clone().lerp(want, w).normalize();
  }

  /** a lofted ball dropping onto a team-mate's run: head height near goal, volley height elsewhere */
  _loftTo(rcv, power, kind = null) {
    const ball = this.game.ball;
    const t = this.passLead(rcv, kind ? 0.15 : 0.3 + 0.4 * power);
    const dx = t.x - ball.pos.x, dz = t.z - ball.pos.z, d = Math.max(2, Math.hypot(dx, dz));
    const nearGoal = (() => { const gt = rcv.goalTarget(); return Math.hypot(gt.x - rcv.pos.x, gt.z - rcv.pos.z) < 13; })();
    const T = clamp(0.5 + d * 0.05, 0.75, 1.7);
    const hEnd = kind === 'head' ? 1.65 : kind === 'volley' ? 0.8 : nearGoal ? 1.55 : 0.75;
    const vh = (d / T) * (1.04 + d * 0.003);                       // a little extra for the air drag
    const vy = (hEnd - ball.pos.y + 0.5 * BALL.gravity * T * T) / T;
    return { aim: new THREE.Vector3(dx / d, 0, dz / d), vh, vy, kind: kind || (nearGoal ? 'head' : 'volley') };
  }

  /** automatic ball control: first touch, dribbling, shielding */
  handleBall(dt) {
    const g = this.game, ball = g.ball;
    if (ball.heldBy) { this.dribbling = false; return false; }      // in the keeper's hands
    if (ball.guardT > 0 && ball.guardBy && ball.guardBy.gi !== this.gi && !this.slide && !this.poke) { this.dribbling = false; return false; }
    // a team-mate's pass meant for someone else: let it run through to them
    if (ball.passToT > 0 && ball.passTo && ball.passTo !== this && ball.lastTouch && ball.lastTouch !== this && !this._isOpp(ball.lastTouch) && !ball.passTo.out) { this.dribbling = false; this.receive = null; return false; }
    // a team-mate's ball is his until he passes it: no taking it off his toes by bumping into it
    const lt0 = ball.lastTouch;
    if (lt0 && lt0 !== this && !lt0.out && !this._isOpp(lt0) && lt0.passTarget !== this && ball.passTo !== this
      && g.time - lt0.lastTouchTime < 0.9 && (lt0.dribbling || lt0.kick || Math.hypot(ball.pos.x - lt0.pos.x, ball.pos.z - lt0.pos.z) < 2.2)) { this.dribbling = false; return false; }
    // someone else has it under close control: only a tackle (or the keeper in his box) wins it
    const db = ball.dribbleGuard > 0 ? ball.dribbleBy : null;
    if (db && db !== this && this._isOpp(db) && !db.stunT && !this.slide && !this.poke && !(this.isKeeper && inOwnBox(this.end, this.pos.x, this.pos.z))) { this.dribbling = false; return false; }
    if (this.power) { this._powerBall(); return true; }             // mid character move: the ball goes where I go
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
      if (r.t > r.ta * 0.7 && dist < 1.0 + R && by < 2.1) {
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
    const inZone = fwd > -0.4 && fwd < 1.05 + R && Math.abs(lat) < 0.85 && dist < 1.1 + R;
    if (!inZone || by > 1.5) return false;

    const rvx = ball.vel.x - this.vel.x, rvz = ball.vel.z - this.vel.z;
    const rel = Math.hypot(rvx, rvz, ball.vel.y);
    const approaching = rvx * -rx + rvz * -rz > 0;

    // first touch of a fast or bouncing ball that I didn't see coming
    if ((rel > 5.5 && approaching) || (by > 0.45 && approaching)) {
      if (rel > 24 && by < 0.5) return false; // too hot to handle: it just ricochets
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
    if (!wants) ahead = 0.3 + R + Math.min(sp, 4) * 0.025;   // stick released: the sole stops it at the boot
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
    let tx = tgt.x, tz = tgt.z;

    // is the ball behind / beside me relative to where I'm going? then it needs a turn touch
    const bx = ball.pos.x - this.pos.x, bz = ball.pos.z - this.pos.z;
    const bl = Math.hypot(bx, bz) || 1;
    const cosA = (bx * d.x + bz * d.z) / bl;
    const turning = wants && cosA < 0.5 && bl > 0.25;
    const reverse = turning && !sk && cosA < -0.55;          // a full about-turn: dragged back under the sole
    if (reverse) { tgt.set(this.pos.x + d.x * 0.18, 0, this.pos.z + d.z * 0.18); }
    // shielding: a marker close by and I'm not bursting away — the ball goes to the far foot, tucked in
    if (!sk && !sprinting && !this.charging) {
      let opp = null, od = 1.8;
      for (const o of g.live) { if (!this._isOpp(o) || o.stunT > 0) continue; const dd = Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z); if (dd < od) { od = dd; opp = o; } }
      if (opp) {
        const r = this.rightDir, sideOpp = (opp.pos.x - this.pos.x) * r.x + (opp.pos.z - this.pos.z) * r.z;
        const k = 1 - od / 1.8, away = sideOpp > 0 ? -1 : 1; this.shieldSide = sideOpp > 0 ? 1 : -1;
        tgt.x = this.pos.x + (tgt.x - this.pos.x) * (1 - 0.35 * k) + r.x * away * 0.24 * k;
        tgt.z = this.pos.z + (tgt.z - this.pos.z) * (1 - 0.35 * k) + r.z * away * 0.24 * k;
        this.shieldK = k;
      } else this.shieldK = 0;
    } else this.shieldK = 0;
    if (reverse || this.shieldK) { clampToArena(tgt, R + 0.04); pushOutOfObstacles(tgt, R + 0.05); tx = tgt.x; tz = tgt.z; }

    // desired relative velocity towards the target, capped so it reads as rolling
    const kp = sk ? 11 : reverse ? 9 : turning ? 7 : !wants ? 7 : 5.5;
    let dvx = (tx - ball.pos.x) * kp, dvz = (tz - ball.pos.z) * kp;
    const cap = sk ? 7.5 : turning ? 6.5 : 4.5, m = Math.hypot(dvx, dvz);
    if (m > cap) { dvx *= cap / m; dvz *= cap / m; }
    // swing round the body rather than through it when turning
    if (turning && !sk && !reverse) {
      const cross = bx * d.z - bz * d.x; // which way round is shorter
      const s2 = cross > 0 ? 1 : -1, px = -bz / bl * s2, pz = bx / bl * s2;
      dvx += px * 1.8; dvz += pz * 1.8;
    }
    // a loose, rolling ball between touches (not glued to the boot): the spring only really bites
    // when a touch is played or the ball has drifted out of reach
    const drift = Math.hypot(tx - ball.pos.x, tz - ball.pos.z);
    // between touches the ball rolls on its own (only a light guiding hand, firmer if it drifts away)
    const kv = 1 - Math.exp(-dt * (sk ? 16 : reverse ? 10 : turning ? 7 : !wants ? 8 : this.knockT > 0 ? 0.45 : drift > 0.6 ? 4 : 1.1));
    ball.vel.x = this.vel.x + rvx + (dvx - rvx) * kv;
    ball.vel.z = this.vel.z + rvz + (dvz - rvz) * kv;
    if (by < R + 0.05) ball.vel.y = Math.min(ball.vel.y, 0.6);
    ball.spin.y *= 0.9;
    this.lastTouchTime = g.time;
    // close control: an opponent has to make a tackle to take it off me (no more squeezing it away)
    if (!this.trick || this.trick.type === 'knock') { ball.dribbleBy = this; ball.dribbleGuard = 0.1; }

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
        // the touch itself: the boot pushes the ball out ahead into my path, a little further than I'll run
        if (!tt.turn) {
          const pushV = clamp(0.55 + sp * 0.12 + (sprinting ? 0.9 : 0), 0.55, 2.6);
          ball.vel.x = this.vel.x + d.x * pushV; ball.vel.z = this.vel.z + d.z * pushV;
        }
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
