import * as THREE from 'three';
import { FIELD, OBSTACLES, inOwnBox } from './config.js';

const LEVELS = {
  easy:   { react: 0.38, speed: 0.8,  sprint: false, skill: 0.35, shootRange: 7.5, charge: [0.35, 0.7], aimNoise: 0.5, guard: 0.35 },
  normal: { react: 0.22, speed: 0.92, sprint: true,  skill: 0.65, shootRange: 9.5, charge: [0.45, 0.85], aimNoise: 0.3, guard: 0.65 },
  hard:   { react: 0.1,  speed: 1.0,  sprint: true,  skill: 0.95, shootRange: 11.5, charge: [0.55, 1.0], aimNoise: 0.12, guard: 0.9 },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const H = FIELD.half;

/**
 * Free-for-all CPU: everyone defends their own goal and may score in any other.
 * Priorities: win the ball if I'm the nearest, block shots heading for my goal,
 * otherwise hold a sweeper position between the ball and my goal.
 */
export class AIController {
  constructor(me, game, level = 'normal') {
    this.me = me; this.game = game;
    this.setLevel(level);
    this.think = Math.random() * 0.2;
    this.plan = { move: new THREE.Vector2(), sprint: false, tackle: false };
    this.shooting = null;
    this.dodge = 0; this.dodgeSide = 1;
  }

  setLevel(level) {
    this.cfg = LEVELS[level] || LEVELS.normal;
    this.me.skill = this.cfg.skill;
    this.me.speedMul = this.cfg.speed;
  }

  update(dt) {
    const me = this.me, g = this.game, ball = g.ball, it = me.intent;
    if (this.shooting) {
      const s = this.shooting;
      s.hold -= dt;
      const bd = Math.hypot(ball.pos.x - me.pos.x, ball.pos.z - me.pos.z);
      if (me.charging && (bd > 1.6 || ball.pos.y > 0.8)) { me.charging = false; me.charge = 0; this.shooting = null; it.kick = it.lob = false; return; }
      it.move.copy(s.aim);
      it.kick = !s.lob && s.hold > 0; it.lob = s.lob && s.hold > 0; it.sprint = false;
      if (s.hold <= 0 && !me.charging) this.shooting = null;
      return;
    }
    it.kick = false; it.lob = false;
    if (g.state !== 'play') { it.move.set(0, 0); it.sprint = false; return; }
    // goalkeeper reflex, checked every frame: dive at a shot I can't reach on foot
    if (this._keeper()) return;
    this.think -= dt;
    if (this.think <= 0) { this.think = this.cfg.react * (0.7 + Math.random() * 0.6); this._decide(); }
    this._avoidObstacles();
    it.move.lerp(this.plan.move, Math.min(1, dt * 10));
    it.sprint = this.plan.sprint && this.cfg.sprint;
    it.tackle = this.plan.tackle; this.plan.tackle = false;
  }

  _keeper() {
    const me = this.me, g = this.game, ball = g.ball, it = me.intent;
    if (me.dive || me.slide || me.slideCD > 0 || !inOwnBox(me.team, me.pos.x, me.pos.z)) return false;
    const home = me.home, v = ball.vel, sp = Math.hypot(v.x, v.z);
    // decide once per shot whether I react at all (easier CPUs sometimes freeze)
    const shotKey = `${ball.lastTouch?.team}:${ball.lastTouch?.lastTouchTime}`;
    if (this._shotKey !== shotKey) { this._shotKey = shotKey; this._willDive = Math.random() < this.cfg.guard; }
    if (!this._willDive) return false;
    if (sp < 7 || ball.pos.y > 1.6) return false;
    // time until the ball reaches my position along the goal's inward axis
    const toward = -(v.x * home.inward.x + v.z * home.inward.z);
    if (toward < 4) return false;
    const myDepth = (me.pos.x - home.centre.x) * home.inward.x + (me.pos.z - home.centre.z) * home.inward.z;
    const ballDepth = (ball.pos.x - home.centre.x) * home.inward.x + (ball.pos.z - home.centre.z) * home.inward.z;
    const t = (ballDepth - myDepth) / toward;
    if (t <= 0 || t > 0.45 + 0.1 * this.cfg.skill) return false;
    const cx = ball.pos.x + v.x * t, cz = ball.pos.z + v.z * t;
    // only if it's heading for the goal mouth
    const along = home.axis === 'x' ? 'z' : 'x';
    const atLine = ball.pos[along] + v[along] * ((ballDepth) / toward);
    if (Math.abs(atLine) > FIELD.goalHalfW + 0.4) return false;
    const off = Math.hypot(cx - me.pos.x, cz - me.pos.z);
    if (off < 0.45 || off > 2.4) return false;
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
    plan.move.set(x - me.pos.x, z - me.pos.z);
    const d = plan.move.length();
    if (d < 0.05) plan.move.set(0, 0); else plan.move.normalize().multiplyScalar(Math.min(1, d / arriveR));
    plan.sprint = d > sprintBeyond;
  }

  _decide() {
    const me = this.me, g = this.game, ball = g.ball, plan = this.plan;
    const home = me.home, bp = ball.pos;
    const myDist = Math.hypot(bp.x - me.pos.x, bp.z - me.pos.z);
    const others = g.athletes.filter((a) => a !== me);
    const nearestOther = Math.min(...others.map((a) => Math.hypot(bp.x - a.pos.x, bp.z - a.pos.z)));
    const iHave = g.possessor === me;
    plan.sprint = false;

    if (iHave) {
      const tgt = me.goalTarget();
      const to = new THREE.Vector2(tgt.x - me.pos.x, tgt.z - me.pos.z);
      const gd = to.length();
      const blocker = others.find((a) => {
        const rx = a.pos.x - me.pos.x, rz = a.pos.z - me.pos.z, d = Math.hypot(rx, rz);
        return d < 2.6 && (rx * to.x + rz * to.y) / (d * gd || 1) > 0.5;
      });
      if (gd < this.cfg.shootRange && (Math.random() < 0.55 || gd < 6)) { this._shoot(tgt, gd, false); return; }
      if (blocker && gd < 13 && Math.random() < 0.1 * this.cfg.skill) { this._shoot(tgt, gd, true); return; }
      const dir = to.clone().normalize();
      if (blocker) {
        if (this.dodge <= 0) {
          const side = (blocker.pos.x - me.pos.x) * -dir.y + (blocker.pos.z - me.pos.z) * dir.x > 0 ? -1 : 1;
          this.dodgeSide = side * (Math.random() < 0.8 ? 1 : -1); this.dodge = 0.8;
        }
        dir.rotateAround(new THREE.Vector2(), 0.9 * this.dodgeSide);
        plan.sprint = true;
      }
      this.dodge -= this.cfg.react;
      if (Math.abs(me.pos.z) > H - 1.2) dir.y -= Math.sign(me.pos.z) * 0.6;
      if (Math.abs(me.pos.x) > H - 1.2) dir.x -= Math.sign(me.pos.x) * 0.6;
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
            const px = clamp(bp.x + v.x * t, -H + 0.5, H - 0.5), pz = clamp(bp.z + v.z * t, -H + 0.5, H - 0.5);
            this._goTo(px, pz, 0.3, 0.5); plan.sprint = true; return;
          }
        }
      }
    }

    // nearest to a loose / contested ball: go and win it
    const holder = g.possessor;
    // slide in on whoever has the ball if they are close and coming my way
    if (holder && holder !== me && me.slideCD <= 0 && myDist < 2.1 && myDist > 0.6 && Math.random() < 0.3 * this.cfg.skill + 0.08) {
      const tx = bp.x - me.pos.x, tz = bp.z - me.pos.z;
      plan.move.set(tx, tz).normalize();
      plan.tackle = true;
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
    this._goTo(clamp(gx, -H + 0.6, H - 0.6), clamp(gz, -H + 0.6, H - 0.6), 0.8, 3.5);
  }

  _shoot(tgt, gd, lob) {
    const me = this.me, g = this.game;
    // aim at the post furthest from that goal's owner
    const goal = g.goals.find((x) => Math.abs(x.centre.x - tgt.x) < 0.1 && Math.abs(x.centre.z - tgt.z) < 0.1);
    const owner = goal ? g.athletes[goal.team] : null;
    const along = goal?.axis === 'x' ? 'z' : 'x';
    let off = (Math.random() < 0.5 ? -1 : 1);
    if (owner) off = owner.pos[along] > tgt[along] ? -1 : 1;
    const p = tgt.clone();
    p[along] += off * (FIELD.goalHalfW - 0.4) + (Math.random() - 0.5) * this.cfg.aimNoise * 2;
    const aim = new THREE.Vector2(p.x - me.pos.x, p.z - me.pos.z).normalize();
    const [a, b] = this.cfg.charge;
    let power = a + Math.random() * (b - a);
    if (gd < 5) power *= 0.75;
    this.shooting = { hold: 0.05 + power * 0.8, aim, lob };
  }
}
