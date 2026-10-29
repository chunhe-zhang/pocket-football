import * as THREE from 'three';
import { FIELD, OBSTACLES, PLAYER, BALL, inOwnBox, clampToArena, pushOutOfObstacles, route, islandBlocks, beats } from './config.js';

const LEVELS = {
  // 女朋友模式: slow, sleepy, never tackles, rarely saves, shoots softly and wide (and feeds the humans)
  gf:   { react: 0.6,  speed: 0.62, sprint: false, skill: 0.1,  shootRange: 5,   charge: [0.2, 0.45], aimNoise: 0.9, guard: 0.1, noTackle: true },
  easy:   { react: 0.45, speed: 0.72, sprint: false, skill: 0.25, shootRange: 6.5, charge: [0.3, 0.6], aimNoise: 0.6, guard: 0.25, tackle: 0.4 },
  normal: { react: 0.22, speed: 0.92, sprint: true,  skill: 0.65, shootRange: 9.5, charge: [0.45, 0.85], aimNoise: 0.3, guard: 0.65, tackle: 1.3 },
  hard:   { react: 0.1,  speed: 1.0,  sprint: true,  skill: 0.95, shootRange: 11.5, charge: [0.55, 1.0], aimNoise: 0.12, guard: 0.9, tackle: 1.4 },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _q = new THREE.Vector3();
/** a reachable spot: inside the boards, off the flower beds and bumpers */
const legal = (x, z, m = 0.6) => { _q.set(x, 0, z); clampToArena(_q, m); pushOutOfObstacles(_q, m); return _q; };

/**
 * Free-for-all CPU: everyone defends their own goal and may score in any other.
 * Priorities: win the ball if I'm the nearest, block shots heading for my goal,
 * otherwise hold a sweeper position between the ball and my goal.
 */
export class AIController {
  constructor(me, game, level = 'normal', assist = false) {
    this.me = me; this.game = game;
    this.assist = assist;   // feed the human players instead of competing with them
    this.setLevel(level);
    this.think = Math.random() * 0.2;
    this.plan = { move: new THREE.Vector2(), sprint: false, tackle: false };
    this.shooting = null;
    this.dodge = 0; this.dodgeSide = 1;
    this.passCD = 0;        // don't ping the ball straight back the moment it arrives
    this.fooledT = 0;       // bit on a feint: stepping the wrong way
  }

  /** a feint worked on me: lurch the wrong way for a moment */
  fool(carrier, side) {
    if (Math.random() < this.cfg.skill * 0.35) return;     // the best defenders sometimes read it
    this.fooledT = 0.42 + 0.4 * (1 - this.cfg.skill);
    this.fooledBy = carrier; this.fooledSide = -side * (Math.random() < 0.8 ? 1 : -1);
  }

  setLevel(level) {
    this.cfg = LEVELS[level] || LEVELS.normal;
    this.me.skill = this.cfg.skill;
    this.me.speedMul = this.cfg.speed;
  }

  update(dt) {
    const me = this.me, g = this.game, ball = g.ball, it = me.intent;
    it.analog = true;                       // a CPU aims exactly where it means to
    if (me.gather) {
      this.shooting = null;
      it.kick = it.lob = it.chipShot = it.pass = false;
      it.move.set(0, 0); it.sprint = false;
      return;
    }
    if (this.shooting) {
      const s = this.shooting;
      s.hold -= dt;
      const bd = Math.hypot(ball.pos.x - me.pos.x, ball.pos.z - me.pos.z);
      if (!s.header && !s.oneTouch && me.charging && (bd > 1.6 || ball.pos.y > 0.8)) { me.charging = false; me.charge = 0; me.intendTo = null; this.shooting = null; it.kick = it.lob = it.chipShot = it.pass = false; return; }
      it.move.copy(s.aim);
      it.chipShot = !!s.chipShot && s.hold > 0; it.kick = !s.lob && !s.chipShot && !s.pass && s.hold > 0; it.lob = !!s.lob && s.hold > 0; it.pass = !!s.pass && s.hold > 0; it.sprint = false;
      if (s.hold <= 0 && !me.charging) this.shooting = null;
      return;
    }
    it.kick = false; it.lob = false; it.chipShot = false; it.pass = false;
    // a penalty to take: a look at the keeper, then a firm one into a corner (now and then down the middle)
    if (g.state === 'penalty' && g.pen && g.pen.taker === me) {
      it.move.set(0, 0); it.sprint = false;
      if (g.pen.t > 0.9 + Math.random() * 0.4 && !me.charging && !me.kick) {
        const tgt = me.goalTarget(), side = Math.random() < 0.15 ? 0 : Math.random() < 0.5 ? -1 : 1;
        const aim = new THREE.Vector2(tgt.x - me.pos.x, tgt.z + side * (FIELD.goalHalfW - 0.45) - me.pos.z).normalize();
        this.shooting = { hold: 0.05 + (0.55 + Math.random() * 0.35) * PLAYER.chargeTime, aim };
      }
      return;
    }
    if (g.state !== 'play') { it.move.set(0, 0); it.sprint = false; return; }
    // the gale leap near goal: volley it from the air at the top of the jump
    if (me.power && me.power.type === 'gale') {
      const P = me.power, tgt = me.goalTarget(), gd = Math.hypot(tgt.x - me.pos.x, tgt.z - me.pos.z);
      if (gd < 18 && P.t > P.dur * 0.4 && Math.random() < 0.5 + 0.4 * this.cfg.skill) { it.move.set(tgt.x - me.pos.x, tgt.z - me.pos.z).normalize(); it.kick = true; }
      return;
    }
    this.headCD = Math.max(0, (this.headCD || 0) - dt);
    // a ball in the air near me: go up for it (at goal if it's on, else away from my own goal)
    if (!ball.lastTouch?.isKeeper && !me.header && this.headCD <= 0 && ball.pos.y > 0.9 && Math.hypot(ball.pos.x - me.pos.x, ball.pos.z - me.pos.z) < 4 && me._headerChance()) {
      const near = g.live.filter((a) => a !== me && Math.hypot(ball.pos.x - a.pos.x, ball.pos.z - a.pos.z) < Math.hypot(ball.pos.x - me.pos.x, ball.pos.z - me.pos.z) - 0.4);
      if (!near.length && Math.random() < 0.35 + 0.6 * this.cfg.skill) {
        const tgt = me.goalTarget(), gd = Math.hypot(tgt.x - me.pos.x, tgt.z - me.pos.z);
        const aim = gd < 13 && !islandBlocks(me.pos.x, me.pos.z, tgt.x, tgt.z, 0.2)
          ? new THREE.Vector2(tgt.x - me.pos.x, tgt.z - me.pos.z)
          : new THREE.Vector2(me.home.inward.x, me.home.inward.z).rotateAround(new THREE.Vector2(), (Math.random() - 0.5) * 1.2);
        aim.normalize().rotateAround(new THREE.Vector2(), (Math.random() - 0.5) * this.cfg.aimNoise * 0.3);
        this.shooting = { hold: 0.03, aim, header: true };
        this.headCD = 1.2;
        it.move.copy(aim); it.kick = true;
        return;
      }
    }
    // goalkeeper reflex, checked every frame: dive at a shot I can't reach on foot
    if (this._keeper()) return;
    // sold a dummy: lurch the wrong way for a moment
    if (this.fooledT > 0) {
      this.fooledT -= dt;
      const c = this.fooledBy;
      if (c) {
        const dx = c.pos.x - me.pos.x, dz = c.pos.z - me.pos.z, l = Math.hypot(dx, dz) || 1;
        it.move.set((-dz / l) * this.fooledSide + (dx / l) * 0.2, (dx / l) * this.fooledSide + (dz / l) * 0.2);
        it.sprint = false; it.tackle = false;
        return;
      }
    }
    this.think -= dt;
    this.passCD = Math.max(0, this.passCD - dt);
    if (g.possessor !== me) this._had = false;
    else if (!this._had) {
      this._had = true;
      // 6v6: the moment the ball arrives, decide and play (shoot / pass / combo), no dwelling on it
      if (g.m5 && me.role !== 'gk') { this.passCD = 0; this.think = Math.min(this.think, 0.04); this._gotT = g.time; }
      else this.passCD = Math.max(this.passCD, 0.5);
    }
    if (this.think <= 0) { this.think = this.cfg.react * (0.7 + Math.random() * 0.6); if (g.m5) this._decide5(); else this._decide(); }
    this._avoidObstacles();
    it.move.lerp(this.plan.move, Math.min(1, dt * 10));
    it.sprint = this.plan.sprint && this.cfg.sprint;
    it.tackle = this.plan.tackle; this.plan.tackle = false;
    // a skill move reads the stick on the frame the button goes down
    if (this.plan.skillMove) { it.move.copy(this.plan.skillMove); it.sprint = !!this.plan.skillSprint; this.plan.skillMove = null; }
  }

  _isHuman(a) {
    const c = this.game.controllers[a.team];
    return !!c && (c.type === 'human' || c.type === 'remote');
  }

  /** the human (still in the game) best placed to receive: closest, not marked */
  _humanToFeed() {
    const me = this.me;
    let best = null, bestD = Infinity;
    for (const a of this.game.live) {
      if (a === me || !this._isHuman(a)) continue;
      if (this.game.teamMode && !this.game.sameSide(a.team, me.team)) continue;   // 2v2: only feed my own team-mate
      const d = Math.hypot(a.pos.x - me.pos.x, a.pos.z - me.pos.z);
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }

  _keeper() {
    const me = this.me, g = this.game, ball = g.ball, it = me.intent;
    if (me.dive || me.slide || me.slideCD > 0 || !inOwnBox(me.end, me.pos.x, me.pos.z)) return false;
    if (me.role && me.role !== 'gk') return false;               // 5v5: only the goalkeeper dives
    const home = me.home, v = ball.vel, sp = Math.hypot(v.x, v.z);
    // decide once per shot whether I react at all (easier CPUs sometimes freeze)
    const shotKey = `${ball.lastTouch?.team}:${ball.lastTouch?.lastTouchTime}`;
    const gk = me.role === 'gk';           // a 5v5 goalkeeper is a specialist: reacts more often and earlier
    // the phantom shot is hard to pick up (an invisible combo even harder); a decoy sends him the wrong way
    const st = ball.specialType || '', ghost = st.includes('phantom') && !(g.m5 && beats(me.charId, 'phantom')), invis = ghost && /blaze|frost|cannon/.test(st), decoy = st.startsWith('gale+phantom');
    if (this._shotKey !== shotKey) { this._shotKey = shotKey; this._willDive = Math.random() < (gk ? 0.9 + 0.1 * this.cfg.guard : this.cfg.guard) * (invis ? 0.6 : ghost ? 0.85 : 1); this._fooled = decoy && Math.random() < 0.75; }
    if (!this._willDive) return false;
    if (sp < 7 || ball.pos.y > (gk ? 2.1 : 1.6)) return false;
    // time until the ball reaches my position along the goal's inward axis
    const toward = -(v.x * home.inward.x + v.z * home.inward.z);
    if (toward < 4) return false;
    const myDepth = (me.pos.x - home.centre.x) * home.inward.x + (me.pos.z - home.centre.z) * home.inward.z;
    const ballDepth = (ball.pos.x - home.centre.x) * home.inward.x + (ball.pos.z - home.centre.z) * home.inward.z;
    const t = (ballDepth - myDepth) / toward;
    if (t <= 0 || t > (gk ? 0.95 : 0.45) + 0.1 * this.cfg.skill) return false;
    let cx = ball.pos.x + v.x * t, cz = ball.pos.z + v.z * t;
    if (this._fooled) { const lx = cx - me.pos.x, lz = cz - me.pos.z, ix = home.inward.x, iz = home.inward.z, dot = lx * ix + lz * iz; cx = me.pos.x - (lx - ix * dot) + ix * dot; cz = me.pos.z - (lz - iz * dot) + iz * dot; }
    // only if it's heading for the goal mouth
    const along = home.axis === 'x' ? 'z' : 'x';
    const atLine = ball.pos[along] + v[along] * ((ballDepth) / toward);
    if (Math.abs(atLine) > FIELD.goalHalfW + 0.4) return false;
    const off = Math.hypot(cx - me.pos.x, cz - me.pos.z);
    if (off < (gk ? 0.6 : 0.45) || off > (gk ? 4.4 : 2.4)) return false;   // straight at him: he stands and the gloves go to it
    if (gk && (t > 0.45 || (off < 1.3 && t > 0.2))) { it.move.set(cx - me.pos.x, cz - me.pos.z).normalize(); return true; }   // early: shuffle across first, dive late
    it.move.set(cx - me.pos.x, cz - me.pos.z).normalize();
    it.tackle = true; it.kick = it.lob = false;
    return true;
  }

  // steer round the flower planters instead of running into them
  _avoidObstacles() {
    const me = this.me, m = this.plan.move;
    if (m.lengthSq() < 0.01) return;
    const dx = m.x, dz = m.y, ml = Math.hypot(dx, dz);
    for (const o of OBSTACLES) {
      const ox = o.x - me.pos.x, oz = o.z - me.pos.z;
      const ahead = (ox * dx + oz * dz) / ml;
      if (ahead < 0 || ahead > 1.8) continue;
      const side = (ox * -dz + oz * dx) / ml; // + = obstacle to the left of my path
      if (Math.abs(side) > o.r + 0.45) continue;
      const push = (o.r + 0.5 - Math.abs(side)) / (o.r + 0.5);
      const s = side >= 0 ? -1 : 1;
      m.x += (-dz / ml) * s * push * 1.2; m.y += (dx / ml) * s * push * 1.2;
      const l = Math.hypot(m.x, m.y); m.x *= ml / l; m.y *= ml / l;
    }
  }

  _goTo(x, z, arriveR = 0.6, sprintBeyond = 3) {
    const me = this.me, plan = this.plan;
    // round the islands rather than into them
    const r = FIELD.islands.length ? route(me.pos.x, me.pos.z, x, z) : null;
    const via = r && (r.x !== x || r.z !== z);
    plan.move.set((via ? r.x : x) - me.pos.x, (via ? r.z : z) - me.pos.z);
    if (via) { const l = plan.move.length() || 1; plan.move.divideScalar(l); plan.sprint = (r.dist > sprintBeyond); return; }
    const d = plan.move.length();
    if (d < 0.05) plan.move.set(0, 0); else plan.move.normalize().multiplyScalar(Math.min(1, d / arriveR));
    plan.sprint = d > sprintBeyond;
  }

  _decide() {
    const me = this.me, g = this.game, ball = g.ball, plan = this.plan;
    const home = me.home, bp = ball.pos;
    const myDist = Math.hypot(bp.x - me.pos.x, bp.z - me.pos.z);
    const others = g.live.filter((a) => a !== me);
    const nearestOther = Math.min(...others.map((a) => Math.hypot(bp.x - a.pos.x, bp.z - a.pos.z)));
    const iHave = g.possessor === me;
    plan.sprint = false;

    if (iHave) {
      // assist mode: give the ball to a human player so they get the shot
      if (this.assist) {
        const rcv = this._humanToFeed();
        if (rcv) {
          const d = Math.hypot(rcv.pos.x - me.pos.x, rcv.pos.z - me.pos.z);
          if (d > 2 && islandBlocks(me.pos.x, me.pos.z, rcv.pos.x, rcv.pos.z, 0.25)) {
            // a flower bed in the way: carry it round first
            const r = route(me.pos.x, me.pos.z, rcv.pos.x, rcv.pos.z);
            plan.move.set(r.x - me.pos.x, r.z - me.pos.z).normalize();
            return;
          }
          if (d > 2) {
            this._kickTo(rcv, 0.08 + Math.random() * 0.15);
            return;
          }
          // too close for a pass: just step away from them with the ball first
          plan.move.set(me.pos.x - rcv.pos.x, me.pos.z - rcv.pos.z).normalize();
          return;
        }
      }
      const tgt = me.goalTarget();
      const to = new THREE.Vector2(tgt.x - me.pos.x, tgt.z - me.pos.z);
      const gd = to.length();
      // 2v2: play it to my team-mate when they're better placed (or I'm under pressure)
      if (g.teamMode && this._teamPass(tgt, gd)) return;
      const blocker = others.find((a) => {
        const rx = a.pos.x - me.pos.x, rz = a.pos.z - me.pos.z, d = Math.hypot(rx, rz);
        return d < 2.6 && (rx * to.x + rz * to.y) / (d * gd || 1) > 0.5;
      });
      const clear = !islandBlocks(me.pos.x, me.pos.z, tgt.x, tgt.z, 0.2);
      if (clear && gd < this.cfg.shootRange && (Math.random() < 0.55 || gd < 6)) { this._shoot(tgt, gd, false); return; }
      if (clear && blocker && gd < 13 && Math.random() < 0.1 * this.cfg.skill) { this._shoot(tgt, gd, true); return; }
      const dir = to.clone().normalize();
      if (!clear) { const r = route(me.pos.x, me.pos.z, tgt.x, tgt.z); dir.set(r.x - me.pos.x, r.z - me.pos.z).normalize(); }
      // a defender closing in: try to beat them with a skill move
      if (blocker && this.cfg.skill >= 0.3 && me.skillCD <= 0 && !me.trick && Math.random() < 0.22 + 0.4 * this.cfg.skill) {
        const bx = blocker.pos.x - me.pos.x, bz = blocker.pos.z - me.pos.z, bd = Math.hypot(bx, bz);
        const f = me.forward, r = me.rightDir;
        const sideOf = (bx * r.x + bz * r.z) > 0 ? -1 : 1;   // go away from the side they're on
        void bd; void f;
        const mv = new THREE.Vector2(r.x * sideOf, r.z * sideOf);   // 闪身步 away from them
        plan.skillMove = mv; plan.skillSprint = false; plan.tackle = true;
        plan.move.copy(mv.lengthSq() ? mv : new THREE.Vector2(f.x, f.z));
        return;
      }
      if (blocker) {
        if (this.dodge <= 0) {
          const side = (blocker.pos.x - me.pos.x) * -dir.y + (blocker.pos.z - me.pos.z) * dir.x > 0 ? -1 : 1;
          this.dodgeSide = side * (Math.random() < 0.8 ? 1 : -1); this.dodge = 0.8;
        }
        dir.rotateAround(new THREE.Vector2(), 0.9 * this.dodgeSide);
        plan.sprint = true;
      }
      this.dodge -= this.cfg.react;
      // keep off the boards and the flower beds while running with it
      const ahead = legal(me.pos.x + dir.x * 1.4, me.pos.z + dir.y * 1.4, 1.0);
      dir.set(ahead.x - me.pos.x, ahead.z - me.pos.z);
      if (dir.lengthSq() < 0.04) dir.set(-me.pos.x, -me.pos.z);
      plan.move.copy(dir.normalize());
      return;
    }

    // ball loose right in front of my own goal: clear it away from the goal
    const toHome = Math.hypot(bp.x - home.centre.x, bp.z - home.centre.z);
    if (toHome < 4.5 && myDist < 1.3 && bp.y < 0.6) {
      const out = new THREE.Vector2(home.inward.x, home.inward.z).rotateAround(new THREE.Vector2(), (Math.random() - 0.5) * 1.4);
      this.shooting = { hold: 0.45, aim: out, lob: Math.random() < 0.35 };
      return;
    }

    // a shot or fast ball heading for my goal: step into its path
    const v = ball.vel, sp = Math.hypot(v.x, v.z);
    if (sp > 4) {
      const toward = (v.x * -home.inward.x + v.z * -home.inward.z) / sp;
      if (toward > 0.5 && toHome < 12 && Math.random() < this.cfg.guard) {
        // where does it cross a line 1 m in front of my goal?
        const lineX = home.centre.x + home.inward.x * 1.0, lineZ = home.centre.z + home.inward.z * 1.0;
        const denom = v.x * home.inward.x + v.z * home.inward.z;
        if (Math.abs(denom) > 0.01) {
          const t = ((lineX - bp.x) * home.inward.x + (lineZ - bp.z) * home.inward.z) / denom;
          if (t > 0 && t < 2) {
            const q = legal(bp.x + v.x * t, bp.z + v.z * t, 0.5);
            this._goTo(q.x, q.z, 0.3, 0.5); plan.sprint = true; return;
          }
        }
      }
    }

    // nearest to a loose / contested ball: go and win it
    const holder = g.possessor;
    // slide in on whoever has the ball if they are close and coming my way
    const humanHas = holder && this._isHuman(holder);
    const mateHas = holder && g.sameSide(holder.team, me.team);
    const lt = ball.lastTouch, fresh = lt && g.time - lt.lastTouchTime < 3 && !holder;
    // 2v2: a pass is on its way to me: go and meet it
    if (fresh && lt !== me && lt.passedTo === me && g.sameSide(lt.team, me.team)) {
      const run = 5.2 * this.cfg.speed;
      let px = bp.x, pz = bp.z;
      const lofted = bp.y > 0.8 || ball.vel.y > 1.5;
      for (let t = 0; t <= 2.6; t += 0.1) {
        const q = ball.predict(t);
        // a cross: be where it comes down through head height
        if (lofted && (q.y > 2.1 || (q.y < 1.2 && t < 1.8))) { if (q.y > 2.1) continue; }
        px = q.x; pz = q.z;
        if (Math.hypot(q.x - me.pos.x, q.z - me.pos.z) <= run * t + 0.4) break;
      }
      this._goTo(px, pz, 0.3, 1.2);
      return;
    }
    // I've just played it to my team-mate: leave it for them and find space
    if (fresh && lt === me && me.passedTo && !me.passedTo.out) { this._support(me.passedTo); return; }
    // 2v2: my team-mate has it: get into space to receive (unless the ball is by my own goal)
    if (mateHas && toHome > 6) { this._support(holder); return; }
    if (!this.cfg.noTackle && (this.cfg.tackle ?? 1) > 0 && !mateHas && !(this.assist && humanHas) && holder && holder !== me && me.slideCD <= 0 && myDist < 2.4 && myDist > 0.5) {
      // is the carrier shielding it? the better defenders step round to the ball's side first
      const bx = bp.x - holder.pos.x, bz = bp.z - holder.pos.z, mx = me.pos.x - holder.pos.x, mz = me.pos.z - holder.pos.z;
      const shielded = (bx * mx + bz * mz) / ((Math.hypot(bx, bz) * Math.hypot(mx, mz)) || 1) < -0.2;
      if (shielded && this.cfg.skill > 0.6 && Math.random() < this.cfg.skill * 0.8) {
        const bl = Math.hypot(bx, bz) || 1;
        const q = legal(bp.x + (bx / bl) * 0.7, bp.z + (bz / bl) * 0.7, 0.4);
        this._goTo(q.x, q.z, 0.3, 1.5); return;
      }
      const poke = myDist < 1.6;
      if (Math.random() < (poke ? 0.45 * this.cfg.skill + 0.12 : 0.12 * this.cfg.skill) * (this.cfg.tackle ?? 1)) {   // a slide that misses is costly now
        const tx = bp.x - me.pos.x, tz = bp.z - me.pos.z;
        plan.move.set(tx, tz).normalize();
        plan.tackle = true;
        return;
      }
    }
    // the ball has been sitting dead for a while: the nearest CPU goes and gets it
    if ((g.idleT || 0) > (g.bigMap ? 2.5 : 4) && !holder) {
      const cpus = g.live.filter((a) => !this._isHuman(a));
      const nearest = cpus.reduce((x, y) => (Math.hypot(bp.x - y.pos.x, bp.z - y.pos.z) < Math.hypot(bp.x - x.pos.x, bp.z - x.pos.z) ? y : x), cpus[0]);
      if (nearest === me) { this._goTo(bp.x, bp.z, 0.3, 2); return; }
    }
    // assist mode: leave the ball alone when a human has it or is going for it
    if (this.assist && (humanHas || g.live.some((a) => { const d = Math.hypot(bp.x - a.pos.x, bp.z - a.pos.z); return this._isHuman(a) && d < 3 && d < myDist; }))) {
      const dist = clamp(toHome * 0.3, 1.2, 3.5);
      const dx = bp.x - home.centre.x, dz = bp.z - home.centre.z, dl = Math.hypot(dx, dz) || 1;
      this._goTo(home.centre.x + (dx / dl) * dist, home.centre.z + (dz / dl) * dist, 0.8, 99);
      return;
    }
    if (myDist <= nearestOther + 0.6 || (holder && myDist < 2.2)) {
      const t = clamp(myDist / 5.5, 0, 1.2);
      const pred = ball.predict(t);
      const tgt = me.goalTarget();
      const dir = new THREE.Vector2(tgt.x - pred.x, tgt.z - pred.z).normalize();
      // arrive from behind the ball relative to where I want to play it
      let bx = pred.x - dir.x * 0.6, bz = pred.z - dir.y * 0.6;
      const inFront = (me.pos.x - pred.x) * dir.x + (me.pos.z - pred.z) * dir.y > 0.1;
      if (inFront && myDist < 3) { bx += -dir.y * 0.9; bz += dir.x * 0.9; }
      this._goTo(bx, bz, 0.4, 2.5);
      return;
    }

    // otherwise: sweeper between the ball and my goal, further out when the ball is far
    const dist = clamp(toHome * 0.35, 1.2, 4.5);
    const dx = bp.x - home.centre.x, dz = bp.z - home.centre.z, dl = Math.hypot(dx, dz) || 1;
    const gx = home.centre.x + (dx / dl) * dist, gz = home.centre.z + (dz / dl) * dist;
    const q = legal(gx, gz, 0.6);
    this._goTo(q.x, q.z, 0.8, 3.5);
  }

  /** an opponent standing close to the line from a to b */
  _laneBlocked(ax, az, bx, bz) {
    const me = this.me, g = this.game;
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    return g.live.some((o) => {
      if (o === me || g.sameSide(o.team, me.team)) return false;
      const t = clamp(((o.pos.x - ax) * dx + (o.pos.z - az) * dz) / L2, 0.06, 1);
      // the further down the lane, the more time they have to step across
      return Math.hypot(ax + dx * t - o.pos.x, az + dz * t - o.pos.z) < 1.0 + 0.07 * Math.sqrt(L2) * t;
    });
  }

  _teamPass(tgt, gd) {
    const me = this.me, g = this.game, mate = me.mate;
    if (!mate || this.passCD > 0 || mate.stunT > 0 || mate.slide || mate.dive) return false;
    const d = Math.hypot(mate.pos.x - me.pos.x, mate.pos.z - me.pos.z);
    if (d < 2.5 || d > 16) return false;
    if (this._laneBlocked(me.pos.x, me.pos.z, mate.pos.x, mate.pos.z) || islandBlocks(me.pos.x, me.pos.z, mate.pos.x, mate.pos.z, 0.2)) return false;
    const mt = mate.goalTarget();
    const mateGd = Math.hypot(mt.x - mate.pos.x, mt.z - mate.pos.z);
    const pressure = g.live.some((o) => o !== mate && o !== me && Math.hypot(o.pos.x - me.pos.x, o.pos.z - me.pos.z) < 1.8);
    const mateFree = !g.live.some((o) => o !== mate && o !== me && Math.hypot(o.pos.x - mate.pos.x, o.pos.z - mate.pos.z) < 1.6);
    const human = this._isHuman(mate);
    let want = 0;
    if (mateFree && mateGd < gd + 2.5) want = 0.3 + 0.2 * this.cfg.skill;   // keep the ball moving between us
    if (mateFree && mateGd < gd - 1) want = 0.6 + 0.3 * this.cfg.skill;     // they're closer to goal and unmarked
    if (pressure && mateFree) want = Math.max(want, 0.6 * this.cfg.skill + 0.2);
    if (human && mateFree && mateGd < gd + 2) want = Math.max(want, 0.6);  // humans love getting the ball
    if (gd < this.cfg.shootRange * 0.6) want *= 0.3;                       // in range myself: just shoot
    if (Math.random() >= want) return false;
    // team-mate up near goal and a fair way off: float a cross onto their head (挑射)
    if (mateGd < 8 && d > 8 && d < 20 && Math.random() < 0.3 + 0.4 * this.cfg.skill) { this._crossTo(mate); this.passCD = 1.4; return true; }
    // a mate running into space towards goal gets the ball played ahead of them
    const mv = Math.hypot(mate.vel.x, mate.vel.z);
    const runIn = mv > 3 && ((mt.x - mate.pos.x) * mate.vel.x + (mt.z - mate.pos.z) * mate.vel.z) / (mv * (mateGd || 1)) > 0.5;
    const power = runIn && Math.random() < 0.3 + 0.5 * this.cfg.skill ? 0.45 + Math.random() * 0.3 : 0.05 + Math.random() * 0.2 + (d > 10 ? 0.1 : 0);
    this._kickTo(mate, power);
    this.passCD = 1.2;
    return true;
  }

  /** team-mate on the ball: find space between them and an open goal */
  _support(holder) {
    const me = this.me;
    const tgt = me.goalTarget();
    const gx = tgt.x - holder.pos.x, gz = tgt.z - holder.pos.z, gl = Math.hypot(gx, gz) || 1;
    // ahead of the ball carrier towards the goal, off to one side
    const side = ((me.pos.x - holder.pos.x) * -gz + (me.pos.z - holder.pos.z) * gx) >= 0 ? 1 : -1;
    const ahead = Math.min(6, gl * 0.6);
    let x = holder.pos.x + (gx / gl) * ahead + (-gz / gl) * side * 3.2;
    let z = holder.pos.z + (gz / gl) * ahead + (gx / gl) * side * 3.2;
    const q = legal(x, z, 1.2);
    this._goTo(q.x, q.z, 0.8, 3);
  }

  /**
   * A pass is just a 爆射 aimed at someone: pick where to put it (feet, or ahead of them for
   * `lead` 0..1) and the charge that gives the right pace, then strike it.
   */
  _kickTo(rcv, lead, oneTouch = false) {
    // a 平传: the release works out the exact weight and lead for the receiver
    const me = this.me;
    const t = me.passLead(rcv, lead);
    const aim = new THREE.Vector2(t.x - me.pos.x, t.z - me.pos.z).normalize();
    me.intendTo = rcv;
    this.shooting = { hold: 0.02 + clamp(lead, 0, 1) * PLAYER.passChargeTime, aim, pass: true, oneTouch };
  }

  /** am I in the opponents' half? */
  _attackingHalf() { const me = this.me, t = me.goalTarget(); return Math.hypot(t.x - me.pos.x, t.z - me.pos.z) < Math.hypot(me.home.centre.x - me.pos.x, me.home.centre.z - me.pos.z); }

  /** 挑射 cross: a chip weighted to drop around a team-mate's head */
  _crossTo(rcv, kind = null) {
    const me = this.me;
    me.loftKind = kind;
    const tx = rcv.pos.x + rcv.vel.x * 0.9, tz = rcv.pos.z + rcv.vel.z * 0.9;
    const d = Math.hypot(tx - me.pos.x, tz - me.pos.z);
    // chip speed 8 + 10p at ~0.65 rad: range ≈ v²·sin(2e)/g, with a bit lost to drag
    let best = 0.3, err = Infinity;
    for (let p = 0.05; p <= 1; p += 0.05) { const v = PLAYER.chipSpeed[0] + PLAYER.chipSpeed[1] * p, e = 0.6 + 0.14 * p; const r = (v * v * Math.sin(2 * e) / BALL.gravity) * 0.82; if (Math.abs(r - d) < err) { err = Math.abs(r - d); best = p; } }
    const aim = new THREE.Vector2(tx - me.pos.x, tz - me.pos.z).normalize();
    me.intendTo = rcv; void best;
    this.shooting = { hold: 0.08 + Math.random() * 0.25, aim, lob: true };
  }

  _shoot(tgt, gd, lob, oneTouch = false) {
    const me = this.me, g = this.game;
    // aim at the post furthest from that goal's owner
    const goal = g.goals.find((x) => Math.abs(x.centre.x - tgt.x) < 0.1 && Math.abs(x.centre.z - tgt.z) < 0.1);
    const owner = goal ? g.keeperOf(goal.team) : null;
    const along = goal?.axis === 'x' ? 'z' : 'x';
    let off = (Math.random() < 0.5 ? -1 : 1);
    if (owner) off = owner.pos[along] > tgt[along] ? -1 : 1;
    const p = tgt.clone();
    p[along] += off * (FIELD.goalHalfW - 0.4) + (Math.random() - 0.5) * this.cfg.aimNoise * 2;
    const aim = new THREE.Vector2(p.x - me.pos.x, p.z - me.pos.z).normalize();
    const [a, b] = this.cfg.charge;
    let power = a + Math.random() * (b - a);
    if (gd < 5) power *= 0.75;
    if (oneTouch) power = Math.max(power, 0.55);
    this.shooting = { hold: 0.05 + power * PLAYER.chargeTime, aim, chipShot: lob, oneTouch };
  }

  // ===================================================================== 5v5 ==
  /**
   * Where a role wants to be (my side's frame: +X = towards the goal I attack), spread over the whole
   * pitch: wingers hug the touchlines, the forward sits on the last defender, the midfielder offers an
   * angle on the far side of the ball, the back holds behind it all. Returns world { x, z }.
   */
  _slotFor(role, attacking) {
    const me = this.me, g = this.game, bp = g.ball.pos, HX = FIELD.hx, HZ = FIELD.hz;
    const d = me.end === 0 ? 1 : -1;
    const bx = bp.x * d, bz = bp.z * d, side = bz >= 0 ? 1 : -1;
    let X, Z;
    if (attacking) {
      switch (role) {
        case 'back': X = clamp(bx - 12, -0.6 * HX, 0.3 * HX); Z = bz * 0.3; break;
        case 'wingL': X = clamp(bx + 2, -0.3 * HX, HX - 4); Z = -0.9 * HZ; break;
        case 'wingR': X = clamp(bx + 2, -0.3 * HX, HX - 4); Z = 0.9 * HZ; break;
        case 'mid': X = clamp(bx - 6, -0.45 * HX, HX - 7); Z = bz * 0.25 - side * 0.5 * HZ; break;   // the far side: an angle to switch play
        default: X = clamp(Math.max(bx + 10, 0.45 * HX), 0, HX - 3); Z = -bz * 0.2;                    // fwd: on the shoulder of the last man
      }
    } else {
      switch (role) {
        case 'back': X = clamp(bx - 7.5, -HX + 3, 0.05 * HX); Z = bz * 0.5; break;
        case 'wingL': X = clamp(bx - 3, -HX + 4, 0.25 * HX); Z = -0.75 * HZ + bz * 0.25; break;
        case 'wingR': X = clamp(bx - 3, -HX + 4, 0.25 * HX); Z = 0.75 * HZ + bz * 0.25; break;
        case 'mid': X = clamp(bx - 4.5, -HX + 4, 0.2 * HX); Z = bz * 0.3 - side * HZ * 0.22; break;                       // between the ball and goal
        default: X = clamp(bx + 1, -0.5 * HX, 0.3 * HX); Z = bz * 0.3 - side * 0.2 * HZ;              // fwd: ready to break
      }
    }
    X = clamp(X, -HX + 3, HX - 1.5); Z = clamp(Z, -HZ + 1.2, HZ - 1.2);
    if (attacking) {           // stay onside: no further up than the ball or the second-last opponent
      let l1 = -Infinity, l2 = -Infinity;
      for (const o of g.live) { if (o.gi === me.gi) continue; const v = o.pos.x * d; if (v > l1) { l2 = l1; l1 = v; } else if (v > l2) l2 = v; }
      X = Math.min(X, Math.max(0, bx, l2) - 0.6);
    }
    return { x: X * d, z: Z * d };
  }

  /**
   * Who plays which position right now. With a human on the team, he takes whichever position he's
   * nearest to (a back who goes on a run is the forward for now) and the CPUs share out the rest, so
   * the spot he left is covered. Without one everybody keeps their own.
   */
  _roleOf(me, attacking) {
    const g = this.game, R = g._roles || (g._roles = {}), key = me.gi;
    let r = R[key];
    if (!r || g.time - r.t > 0.45 || r.att !== attacking || !r.map.has(me)) r = R[key] = { t: g.time, att: attacking, map: this._assignRoles(attacking) };
    return r.map.get(me) || me.role;
  }

  _assignRoles(attacking) {
    const g = this.game, me = this.me, map = new Map();
    const team = g.live.filter((a) => a.gi === me.gi && a.role !== 'gk');
    const humans = team.filter((a) => this._isHuman(a));
    if (!humans.length) { for (const a of team) map.set(a, a.role); return map; }
    const free = ['back', 'wingL', 'mid', 'wingR', 'fwd'].filter((r) => team.some((a) => a.role === r) || true);
    const slot = {}; for (const r of free) slot[r] = this._slotFor(r, attacking);
    const dd = (a, r) => Math.hypot(a.pos.x - slot[r].x, a.pos.z - slot[r].z) - (a.role === r ? 4 : 0);
    const left = new Set(free);
    for (const h of humans) { let best = null; for (const r of left) if (!best || dd(h, r) < dd(h, best)) best = r; if (best) { map.set(h, best); left.delete(best); } }
    const cpus = team.filter((a) => !map.has(a));
    while (cpus.length && left.size) {
      let bi = -1, br = null, bv = Infinity;
      cpus.forEach((a, i) => { for (const r of left) { const v = dd(a, r); if (v < bv) { bv = v; bi = i; br = r; } } });
      map.set(cpus[bi], br); left.delete(br); cpus.splice(bi, 1);
    }
    for (const a of cpus) map.set(a, a.role);
    return map;
  }

  /** the team-mate on the ball (or dribbling it), if it's ours */
  _ourCarrier() {
    const me = this.me, g = this.game, b = g.ball, h = g.possessor;
    if (h && h.gi === me.gi) return h;
    const lt = b.lastTouch;
    if (lt && lt.gi === me.gi && !lt.passedTo && !lt.out && g.time - lt.lastTouchTime < 1.4 && Math.hypot(b.pos.x - lt.pos.x, b.pos.z - lt.pos.z) < 3.2 && b.speed < 9) return lt;
    return null;
  }

  /** my position in the shape, kept apart from the team-mate on the ball and from each other */
  _slot5(attacking) {
    const me = this.me, g = this.game;
    const p = this._slotFor(this._roleOf(me, attacking), attacking);
    const car = attacking ? this._ourCarrier() : null;
    for (const m of g.live) {
      if (m === me || m.gi !== me.gi || m.role === 'gk') continue;
      const keep = m === car ? 6 : 4;                          // give the man on the ball room; don't bunch
      const dx = p.x - m.pos.x, dz = p.z - m.pos.z, dl = Math.hypot(dx, dz);
      if (dl < keep) {
        const k = dl > 0.01 ? (keep - dl) / dl : 0;
        p.x += dl > 0.01 ? dx * k * (m === car ? 1 : 0.6) : 0; p.z += dl > 0.01 ? dz * k * (m === car ? 1 : 0.6) : (me.team % 2 ? 1 : -1) * keep * 0.6;
      }
    }
    return legal(p.x, p.z, 0.8).clone();
  }

  /**
   * Off the ball while we have it: show for a pass when the carrier is closed down, or make a run.
   * Returns true if it set a move.
   */
  _offBall5(car, opps) {
    const me = this.me, g = this.game, plan = this.plan, HX = FIELD.hx, HZ = FIELD.hz;
    const role = this._roleOf(me, true), d = me.end === 0 ? 1 : -1;
    // a run already on: see it through
    if (this._run && g.time < this._run.until) { this._goTo(this._run.x, this._run.z, 0.5, 2); plan.sprint = true; return true; }
    this._run = null;
    const cx = car.pos.x * d, mx = me.pos.x * d;
    const pressed = opps.some((o) => Math.hypot(o.pos.x - car.pos.x, o.pos.z - car.pos.z) < 2.2);
    // the carrier is closed down and I'm the nearest outlet: come to an open angle 7–9 m off him
    if (pressed) {
      const mates = g.live.filter((a) => a.gi === me.gi && a !== car && a.role !== 'gk');
      const nearest = mates.sort((a, b) => Math.hypot(a.pos.x - car.pos.x, a.pos.z - car.pos.z) - Math.hypot(b.pos.x - car.pos.x, b.pos.z - car.pos.z))[0];
      if (nearest === me) {
        let best = null, bs = -Infinity;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2, x = car.pos.x + Math.cos(a) * 11, z = car.pos.z + Math.sin(a) * 11;
          if (Math.abs(x) > HX - 1.5 || Math.abs(z) > HZ - 1.2) continue;
          const free = Math.min(5, ...opps.map((o) => Math.hypot(o.pos.x - x, o.pos.z - z)));
          const sc = free + (x * d - cx) * 0.25 - (this._laneBlocked(car.pos.x, car.pos.z, x, z) ? 4 : 0) - Math.hypot(x - me.pos.x, z - me.pos.z) * 0.15;
          if (sc > bs) { bs = sc; best = { x, z }; }
        }
        if (best) { const q = legal(best.x, best.z, 0.8); this._goTo(q.x, q.z, 0.6, 4); return true; }
      }
    }
    // the forward and the wingers make runs: across the line into a gap, timed to stay onside
    if ((role === 'fwd' || role === 'wingL' || role === 'wingR') && cx > -0.2 * HX && g.time > (this._nextRun || 0) && !pressed) {
      this._nextRun = g.time + 2.5 + Math.random() * 3;
      if (Math.random() < 0.35 + 0.4 * this.cfg.skill) {
        let l1 = -Infinity, l2 = -Infinity;
        for (const o of opps) { const v = o.pos.x * d; if (v > l1) { l2 = l1; l1 = v; } else if (v > l2) l2 = v; }
        const line = Math.max(0, cx, l2) - 0.5;
        const X = Math.min(line, HX - 3);
        // into the widest gap between the defenders on that line
        const zs = opps.filter((o) => o.role !== 'gk').map((o) => o.pos.z * d).concat([-HZ + 1.5, HZ - 1.5]).sort((a, b) => a - b);
        let gz = 0, gw = -1; for (let i = 1; i < zs.length; i++) { const w = zs[i] - zs[i - 1], c = (zs[i] + zs[i - 1]) / 2; const sc = w - Math.abs(c - me.pos.z * d) * 0.3; if (sc > gw) { gw = sc; gz = c; } }
        if (role !== 'fwd') gz = clamp(gz, role === 'wingL' ? -HZ + 1.5 : -2, role === 'wingL' ? 2 : HZ - 1.5);
        if (X - mx > 2 || Math.abs(gz - me.pos.z * d) > 3) { const q = legal(X * d, gz * d, 0.8); this._run = { x: q.x, z: q.z, until: g.time + 1.7 }; this._goTo(q.x, q.z, 0.5, 2); plan.sprint = true; return true; }
      }
    }
    return false;
  }

  _decide5() {
    const me = this.me, g = this.game, ball = g.ball, plan = this.plan, bp = ball.pos;
    plan.sprint = false;
    const dist = (a, p = bp) => Math.hypot(p.x - a.pos.x, p.z - a.pos.z);
    const myDist = dist(me);
    const mates = g.live.filter((a) => a !== me && a.gi === me.gi);
    const opps = g.live.filter((a) => a.gi !== me.gi);
    const holder = g.possessor, iHave = holder === me;
    const lt = ball.lastTouch, fresh = lt && g.time - lt.lastTouchTime < 3 && !holder;
    const home = me.home;
    // a pass on its way to me: go and meet it
    if (fresh && lt !== me && lt.passedTo === me && lt.gi === me.gi) {
      this._lastFrom = lt; this._lastFromT = g.time;
      if (this._firstTime(lt, mates, opps)) return;
      const run = 5.2 * this.cfg.speed;
      let px = bp.x, pz = bp.z;
      const lofted = bp.y > 0.8 || ball.vel.y > 1.5;
      for (let t = 0; t <= 2.6; t += 0.1) {
        const q = ball.predict(t);
        if (lofted && q.y > 2.1) continue;
        px = q.x; pz = q.z;
        if (Math.hypot(q.x - me.pos.x, q.z - me.pos.z) <= run * t + 0.4) break;
      }
      this._goTo(px, pz, 0.3, 1.2);
      return;
    }
    if (iHave || (!ball.heldBy && this._ourCarrier() === me)) { this._carry5(mates, opps); return; }
    // a keeper has it in his hands
    if (ball.heldBy) {
      if (ball.heldBy === me) { this._gkDistribute(mates, opps); return; }
      if (me.role === 'gk') { this._gk5(); return; }
      const s = this._slot5(ball.heldBy.gi === me.gi);
      this._goTo(s.x, s.z, 1, 8);
      return;
    }
    // who on my side goes for the ball: whoever gets there first (the keeper only in the box)
    const pred = ball.predict(clamp(myDist / 6, 0, 0.8));
    const inBox = inOwnBox(me.end, bp.x, bp.z);
    // the one whose element beats the man on the ball goes for him (counter ring) — worth a couple of metres
    const eta = (a) => dist(a, pred) / (a.speedMul || 1) + (a.stunT > 0 ? 3 : 0) + (a.role === 'gk' && !inBox ? 99 : 0) - (holder && holder.gi !== a.gi && beats(a.charId, holder.charId) ? 2.5 : 0);
    const side = [me, ...mates].sort((a, b) => eta(a) - eta(b));
    const chaser = side[0], second = side[1];
    const car = this._ourCarrier();
    const ours = !!car;
    // 一对一: an attacker running at goal through my box — come out, narrow the angle, go down at his feet
    if (me.role === 'gk' && holder && holder.gi !== me.gi && inOwnBox(me.end, holder.pos.x, holder.pos.z)
      && Math.hypot(holder.pos.x - home.centre.x, holder.pos.z - home.centre.z) < 7.5 && !this.cfg.noTackle) {
      // on the line from the ball to the middle of the goal: close the angle, but never so far out
      // that a shot past me is an open goal (right at the ball only when it's really close)
      const gx = home.centre.x - bp.x, gz = home.centre.z - bp.z, gl = Math.hypot(gx, gz) || 1;
      const out = gl < 4 ? gl - 0.7 : Math.min(gl * 0.45, 3);
      const q = legal(home.centre.x - (gx / gl) * out, home.centre.z - (gz / gl) * out, 0.4);
      this._goTo(q.x, q.z, 0.3, 1.5); plan.sprint = true;
      if (myDist < 1.8 && me.slideCD <= 0 && Math.random() < 0.18 + 0.3 * this.cfg.skill) { plan.move.set(bp.x - me.pos.x, bp.z - me.pos.z).normalize(); plan.tackle = true; }
      return;
    }
    if (me.role === 'gk' && chaser !== me) { this._gk5(); return; }
    // the other side has played a pass: only go for it if it's actually coming past me
    const theirPass = fresh && lt && lt.gi !== me.gi && lt.passedTo && !holder;
    if (theirPass && me.role !== 'gk') {
      const v = Math.hypot(ball.vel.x, ball.vel.z) || 1, rx = me.pos.x - bp.x, rz = me.pos.z - bp.z;
      const ahead = (rx * ball.vel.x + rz * ball.vel.z) / v, off = Math.abs(rx * ball.vel.z - rz * ball.vel.x) / v;
      if (!(ahead > 0 && off < 1.6) && myDist > 1.5) { const s = this._slot5(false); this._goTo(s.x, s.z, 1.2, 8); return; }
    }
    if (chaser === me && !ours) { this._chase5(holder, myDist); return; }
    // the opponents have it: the next player in steps up goal-side of it
    if (holder && !ours && second === me && me.role !== 'gk') {
      const gx = home.centre.x - bp.x, gz = home.centre.z - bp.z, gl = Math.hypot(gx, gz) || 1;
      const q = legal(bp.x + (gx / gl) * 4.2, bp.z + (gz / gl) * 4.2, 0.6);   // cover, don't swarm
      this._goTo(q.x, q.z, 0.8, 6);
      return;
    }
    // just played a wall pass to get past my man: burst beyond him for the return (give and go)
    if (ours && car !== me && (me.giveGoT || 0) > g.time) {
      const tgt = me.goalTarget(), gx = tgt.x - me.pos.x, gz = tgt.z - me.pos.z, gl = Math.hypot(gx, gz) || 1;
      const side = ((me.pos.x - car.pos.x) * -gz + (me.pos.z - car.pos.z) * gx) >= 0 ? 1 : -1;
      const q = legal(me.pos.x + (gx / gl) * 6 + (-gz / gl) * side * 1.5, me.pos.z + (gz / gl) * 6 + (gx / gl) * side * 1.5, 1.2);
      this._goTo(q.x, q.z, 0.6, 9); this.plan.sprint = true;
      return;
    }
    if (ours && car !== me && me.role !== 'gk' && this._offBall5(car, opps)) return;
    const s = this._slot5(ours || (lt && lt.gi === me.gi && fresh));
    this._goTo(s.x, s.z, 1.2, 8);
  }

  /**
   * A team-mate's pass is coming to me: decide (once) whether to play it first time —
   * shoot (a volley if it's in the air), lay it straight back to a runner (撞墙), or move it on.
   */
  _firstTime(passer, mates, opps) {
    mates = mates.filter((m) => !this.game.offsidePos?.(m));
    const me = this.me, g = this.game, ball = g.ball;
    const key = passer.lastTouchTime;
    if (this._ftKey === key) return false;
    const eta = Math.hypot(ball.pos.x - me.pos.x, ball.pos.z - me.pos.z) / Math.max(4, Math.hypot(ball.vel.x, ball.vel.z));
    if (eta > 0.9) return false;
    this._ftKey = key;
    if (passer.isKeeper || me.role === 'gk' || this.cfg.skill < 0.3) return false;
    const sk = this.cfg.skill;
    const tgt = me.goalTarget(), gd = Math.hypot(tgt.x - me.pos.x, tgt.z - me.pos.z);
    const angleOK = Math.abs(me.pos.z) < FIELD.goalHalfW + gd * 0.9;
    const pressed = opps.some((o) => Math.hypot(o.pos.x - me.pos.x, o.pos.z - me.pos.z) < 2.6);
    const humanMate = mates.find((m) => this._isHuman(m));
    // in range: hit it first time (the human's team-mates set the human up instead, in assist mode)
    // CPUs love the flashy finish: anything in range is hit first time (a ball in the air all the more:
    // that's a volley or a header)
    const aerial = ball.pos.y > 0.8 || ball.vel.y > 1.5 || ball.loftKind;
    if (gd < this.cfg.shootRange * (aerial ? 1.9 : 1.7) && angleOK && !(this.assist && humanMate) && Math.random() < (aerial ? 0.9 : 0.72) + 0.2 * sk) { this._shoot(tgt, gd, false, true); return true; }
    // the passer has gone on a run: give it straight back into their path
    // (only when it gets him beyond the man he played it round: that's what a wall pass is for)
    { const d = me.end === 0 ? 1 : -1;
      const beyond = (passer.pos.x - me.pos.x) * d > 0.5 || (passer.vel.x * d > 3 && (passer.pos.x - me.pos.x) * d > -1.5);
      if (((passer.giveGoT || 0) > g.time || (this._isHuman(passer) && passer.vel.x * d > 3.5)) && beyond && !passer.stunT && Math.random() < 0.55 + 0.4 * sk && !this._laneBlocked(me.pos.x, me.pos.z, passer.pos.x + passer.vel.x * 0.5, passer.pos.z + passer.vel.z * 0.5)) { this._kickTo(passer, 0.6, true); this.passCD = 1.0; return true; } }
    // under pressure, or going forward as a group: move it on first time to a free team-mate further up
    // (every first-time touch adds an element: this is how the combos are built)
    const attackHalf = this._attackingHalf();
    if ((pressed || attackHalf) && Math.random() < (pressed ? 0.35 + 0.45 * sk : 0.35 + 0.4 * sk)) {
      const d = me.end === 0 ? 1 : -1;
      const fwd = mates.filter((m) => m !== passer && m.role !== 'gk' && (m.pos.x - me.pos.x) * d > (pressed ? 2 : 1.5) && Math.hypot(m.pos.x - me.pos.x, m.pos.z - me.pos.z) > 5 && !this._laneBlocked(me.pos.x, me.pos.z, m.pos.x, m.pos.z)
        && !opps.some((o) => Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z) < 2))
        .sort((a, b) => (this._isHuman(b) ? 6 : 0) + (b.pos.x - a.pos.x) * d * 0.3 - (this._isHuman(a) ? 6 : 0));
      if (fwd.length) { this._kickTo(fwd[0], 0.35, true); this.passCD = 1.0; return true; }
    }
    return false;
  }

  /** ball in my hands: have a look, then punt upfield to a free team-mate */
  _gkDistribute(mates, opps) {
    mates = mates.filter((m) => !this.game.offsidePos?.(m));
    const me = this.me;
    this.plan.move.set(0, 0); this.plan.sprint = false;
    if (!me.holding || me.holding.release || me.holding.t < 0.9 + Math.random() * 0.3) return;
    let best = null, bestS = -Infinity;
    for (const m of mates) {
      const d = Math.hypot(m.pos.x - me.pos.x, m.pos.z - me.pos.z);
      if (m.role === 'gk' || d < 10 || d > 34 || (m.pos.x - me.pos.x) * me.home.inward.x + (m.pos.z - me.pos.z) * me.home.inward.z < 6) continue;
      const free = Math.min(5, Math.min(...opps.map((o) => Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z))));
      if (free < 2.5 || this._laneBlocked(me.pos.x, me.pos.z, m.pos.x, m.pos.z)) continue;
      const sc = free - d * 0.08 + (this._isHuman(m) ? 2 : 0);
      if (sc > bestS) { bestS = sc; best = m; }
    }
    me.distribute(best);
  }

  _gk5() {
    const me = this.me, g = this.game, bp = g.ball.pos, home = me.home;
    const dx = bp.x - home.centre.x, dz = bp.z - home.centre.z, dl = Math.hypot(dx, dz) || 1;
    const out = clamp(dl * 0.16, 0.6, 2.4);
    let x = home.centre.x + (dx / dl) * out, z = home.centre.z + (dz / dl) * out;
    z = clamp(z, -FIELD.goalHalfW - 0.4, FIELD.goalHalfW + 0.4);
    this._goTo(x, z, 0.35, 2);
  }

  _chase5(holder, myDist) {
    const me = this.me, g = this.game, ball = g.ball, bp = ball.pos, plan = this.plan;
    const humanHas = holder && this._isHuman(holder);
    if (!this.cfg.noTackle && (this.cfg.tackle ?? 1) > 0 && !(this.assist && humanHas) && holder && me.slideCD <= 0 && myDist < 2.4 && myDist > 0.5) {
      const bx = bp.x - holder.pos.x, bz = bp.z - holder.pos.z, mx = me.pos.x - holder.pos.x, mz = me.pos.z - holder.pos.z;
      const shielded = (bx * mx + bz * mz) / ((Math.hypot(bx, bz) * Math.hypot(mx, mz)) || 1) < -0.2;
      if (shielded && this.cfg.skill > 0.6 && Math.random() < this.cfg.skill * 0.8) {
        const bl = Math.hypot(bx, bz) || 1;
        const q = legal(bp.x + (bx / bl) * 0.7, bp.z + (bz / bl) * 0.7, 0.4);
        this._goTo(q.x, q.z, 0.3, 1.5); return;
      }
      const poke = myDist < 1.6;
      // fouls cost (6v6): no slides from behind, none in my own box, fewer once I'm on a yellow
      if (!poke && g.m5) {
        const hf = holder.forward, fromBehind = ((holder.pos.x - me.pos.x) * hf.x + (holder.pos.z - me.pos.z) * hf.z) > 0.4 * myDist;
        if (fromBehind || inOwnBox(me.end, me.pos.x, me.pos.z) || ((me.yellows || 0) > 0 && Math.random() < 0.7)) { this._goTo(bp.x, bp.z, 0.4, 3); return; }
      }
      if (Math.random() < (poke ? 0.22 * this.cfg.skill + 0.08 : 0.04 * this.cfg.skill) * (this.cfg.tackle ?? 1)) {   // 5v5: patient, fewer lunges
        plan.move.set(bp.x - me.pos.x, bp.z - me.pos.z).normalize();
        plan.tackle = true;
        return;
      }
    }
    // loose in front of my own goal: just hoof it clear
    const toHome = Math.hypot(bp.x - me.home.centre.x, bp.z - me.home.centre.z);
    if (!holder && toHome < 6 && myDist < 1.3 && bp.y < 0.6) {
      const out = new THREE.Vector2(me.home.inward.x, me.home.inward.z).rotateAround(new THREE.Vector2(), (Math.random() - 0.5) * 1.2);
      this.shooting = { hold: 0.5, aim: out, lob: Math.random() < 0.4 };
      return;
    }
    const t = clamp(myDist / 5.5, 0, 1.2);
    const pred = ball.predict(t);
    const tgt = me.goalTarget();
    const dir = new THREE.Vector2(tgt.x - pred.x, tgt.z - pred.z).normalize();
    let bx = pred.x - dir.x * 0.6, bz = pred.z - dir.y * 0.6;
    const inFront = (me.pos.x - pred.x) * dir.x + (me.pos.z - pred.z) * dir.y > 0.1;
    if (inFront && myDist < 3) { bx += -dir.y * 0.9; bz += dir.x * 0.9; }
    this._goTo(bx, bz, 0.4, 5);
  }

  /** on the ball in 5v5: shoot, pass or run with it */
  _carry5(mates, opps) {
    mates = mates.filter((m) => !this.game.offsidePos?.(m));
    const me = this.me, g = this.game, plan = this.plan;
    const tgt = me.goalTarget();
    const to = new THREE.Vector2(tgt.x - me.pos.x, tgt.z - me.pos.z), gd = to.length();
    const near = (p, r) => opps.some((o) => Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < r);
    const pressure = near(me.pos, 1.9);
    const quick = g.time - (this._gotT ?? -9) < 0.9;           // just got it: play it now
    const range = this.cfg.shootRange * (quick ? 1.4 : 1.15);
    const angleOK = Math.abs(me.pos.z) < FIELD.goalHalfW + gd * 0.9;
    // mid skill move (or just out of it): strike there and then — the instant, sweet-spot 技能射门
    const flashy = me.power || g.time - (me.powerEndT ?? -9) < 0.5;
    if (flashy && me.role !== 'gk' && gd < range * 1.6 && angleOK && Math.random() < 0.55 + 0.35 * this.cfg.skill) { this._shoot(tgt, gd, false, true); return; }
    if (me.role !== 'gk' && gd < range && angleOK && (Math.random() < (quick ? 0.8 : 0.5) || gd < 6.5)) { this._shoot(tgt, gd, gd > 9 && Math.random() < 0.15); return; }
    // out wide near the byline: whip a cross in for someone to attack in the air
    if (this.passCD <= 0 && me.role !== 'gk' && Math.abs(me.pos.z) > FIELD.hz * 0.38 && gd < 15) {
      const box = mates.filter((m) => m.role !== 'gk' && m.stunT <= 0 && (() => { const t = m.goalTarget(); return Math.hypot(t.x - m.pos.x, t.z - m.pos.z) < 11; })() && Math.hypot(m.pos.x - me.pos.x, m.pos.z - me.pos.z) > 5);
      if (box.length && Math.random() < 0.5 + 0.4 * this.cfg.skill) { this._crossTo(box[0], Math.random() < 0.5 ? 'head' : 'volley'); this.passCD = 1.4; return; }
    }
    // look for a team-mate: a pass has to take us somewhere — forward, into space, to a runner, or
    // out of trouble. No aimless square balls, and no ping-pong back to whoever just gave it to me
    const dsgn = me.end === 0 ? 1 : -1;
    const space = !opps.some((o) => { const rx = o.pos.x - me.pos.x, rz = o.pos.z - me.pos.z, dd = Math.hypot(rx, rz); return dd < 4.5 && (rx * to.x + rz * to.y) / (dd * gd || 1) > 0.2; });
    if (this.passCD <= 0) {
      const d = dsgn;
      let best = null, bestS = -Infinity;
      for (const m of mates) {
        if (m.stunT > 0 || m.role === 'gk') continue;
        const dm = Math.hypot(m.pos.x - me.pos.x, m.pos.z - me.pos.z);
        if (dm < (pressure ? 3.5 : 5) || dm > 24) continue;
        if (this._laneBlocked(me.pos.x, me.pos.z, m.pos.x, m.pos.z)) continue;
        const free = Math.min(5, Math.min(...opps.map((o) => Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z))));
        if (free < 1.6 && !pressure) continue;
        const gain = (m.pos.x - me.pos.x) * d, mt = m.goalTarget(), mgd = Math.hypot(mt.x - m.pos.x, mt.z - m.pos.z);
        let sc = gain * 0.5 + free * 0.6 + Math.max(0, 20 - mgd) * 0.12 - dm * 0.04;
        if (gain < -1 && !pressure) sc -= 2.5;                               // backwards for no reason
        if (m === this._lastFrom && g.time - (this._lastFromT ?? -9) < 4 && !(gain > 1.5 && (m.giveGoT || 0) > g.time)) sc -= 4;   // straight back
        if (this._isHuman(m)) sc += this.assist ? 7 : 3;          // the human team-mate gets the ball a lot
        if (Math.hypot(m.vel.x, m.vel.z) > 4 && m.vel.x * d > 2.5) sc += 2;   // a runner: play them in
        if (opps.some((o) => beats(o.charId, m.charId) && Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z) < 3)) sc -= 1.5;   // marked by his counter: not him
        if (sc > bestS) { bestS = sc; best = m; }
      }
      // with room to run, keep it and go (a pass has to be clearly better than carrying it)
      const want = (me.role === 'gk' ? -99 : pressure ? 0.4 : space ? 4.2 : 2.2) + (me.role === 'fwd' ? 0.8 : 0) - (quick ? 0.8 : 0);
      const humanFree = best && this._isHuman(best) && Math.min(...opps.map((o) => Math.hypot(o.pos.x - best.pos.x, o.pos.z - best.pos.z))) > 2.5 && (best.pos.x - me.pos.x) * d > -2;
      if (best && (bestS > want || humanFree || (this.assist && this._isHuman(best)))) {
        const dm = Math.hypot(best.pos.x - me.pos.x, best.pos.z - me.pos.z);
        const bgd = Math.hypot(best.goalTarget().x - best.pos.x, best.goalTarget().z - best.pos.z);
        // to the human in attack: half the time a ball to head, half the time one to volley
        if (this._isHuman(best) && bgd < 22 && dm > 6 && Math.random() < 0.75) { this._crossTo(best, Math.random() < 0.5 ? 'head' : 'volley'); this.passCD = 1.2; return; }
        if (bgd < 14 && dm > 6 && Math.random() < 0.5 + 0.35 * this.cfg.skill) this._crossTo(best, Math.random() < 0.5 ? 'head' : 'volley');   // set up a volley or a header
        else this._kickTo(best, 0.1 + Math.random() * 0.3 + (dm > 12 ? 0.15 : 0));
        this.passCD = 1.3;
        return;
      }
      if (me.role === 'gk') {   // nobody free: launch it up the pitch
        const aim = new THREE.Vector2(me.home.inward.x, me.home.inward.z).rotateAround(new THREE.Vector2(), (Math.random() - 0.5) * 0.9);
        this.shooting = { hold: 0.5, aim, lob: true };
        return;
      }
    }
    // run with it, round anyone in the way
    const dir = to.clone().normalize();
    const blocker = opps.find((a) => {
      const rx = a.pos.x - me.pos.x, rz = a.pos.z - me.pos.z, d = Math.hypot(rx, rz);
      return d < 2.6 && (rx * to.x + rz * to.y) / (d * gd || 1) > 0.5;
    });
    // 撞墙配合: a defender square in front and a team-mate to the side — play it off him and go round
    if (blocker && this.passCD <= 0 && me.role !== 'gk' && Math.random() < 0.25 + 0.35 * this.cfg.skill) {
      const wall = mates.find((m) => { if (m.role === 'gk' || m.stunT > 0) return false; const dm = Math.hypot(m.pos.x - me.pos.x, m.pos.z - me.pos.z); if (dm < 3.5 || dm > 10) return false;
        const fr = Math.min(...opps.map((o) => Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z))); return fr > 2.2 && !this._laneBlocked(me.pos.x, me.pos.z, m.pos.x, m.pos.z); });
      if (wall) { this._kickTo(wall, 0.12); me.giveGoT = g.time + 1.8; this.passCD = 1.6; return; }
    }
    if (blocker && this.cfg.skill >= 0.3 && me.skillCD <= 0 && !me.trick && Math.random() < 0.3 + 0.45 * this.cfg.skill) {   // show-offs: beat the man with a trick
      const r = me.rightDir, bx = blocker.pos.x - me.pos.x, bz = blocker.pos.z - me.pos.z;
      const sideOf = (bx * r.x + bz * r.z) > 0 ? -1 : 1;
      const mv = new THREE.Vector2(r.x * sideOf, r.z * sideOf);
      plan.skillMove = mv; plan.skillSprint = false; plan.tackle = true; plan.move.copy(mv);
      return;
    }
    if (blocker) {
      if (this.dodge <= 0) {
        const side = (blocker.pos.x - me.pos.x) * -dir.y + (blocker.pos.z - me.pos.z) * dir.x > 0 ? -1 : 1;
        this.dodgeSide = side * (Math.random() < 0.8 ? 1 : -1); this.dodge = 0.8;
      }
      dir.rotateAround(new THREE.Vector2(), 0.8 * this.dodgeSide);
      plan.sprint = true;
    }
    this.dodge -= this.cfg.react;
    const ahead = legal(me.pos.x + dir.x * 1.4, me.pos.z + dir.y * 1.4, 1.0);
    dir.set(ahead.x - me.pos.x, ahead.z - me.pos.z);
    if (dir.lengthSq() < 0.04) dir.set(-me.pos.x, -me.pos.z);
    plan.move.copy(dir.normalize());
    void pressure;
  }
}
