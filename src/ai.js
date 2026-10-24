import * as THREE from 'three';
import { FIELD } from './config.js';

const LEVELS = {
  easy:   { react: 0.38, speed: 0.8,  sprint: false, skill: 0.35, shootRange: 7.5, charge: [0.35, 0.7], aimNoise: 0.5 },
  normal: { react: 0.22, speed: 0.92, sprint: true,  skill: 0.65, shootRange: 9.5, charge: [0.45, 0.85], aimNoise: 0.3 },
  hard:   { react: 0.1,  speed: 1.0,  sprint: true,  skill: 0.95, shootRange: 11.5, charge: [0.55, 1.0], aimNoise: 0.12 },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class AIController {
  constructor(me, game, level = 'normal') {
    this.me = me; this.game = game;
    this.setLevel(level);
    this.think = 0;
    this.plan = { move: new THREE.Vector2(), sprint: false };
    this.shooting = null; // { hold, aim: Vector2, lob }
    this.dodge = 0; this.dodgeSide = 1;
  }

  setLevel(level) {
    this.cfg = LEVELS[level] || LEVELS.normal;
    this.me.skill = this.cfg.skill;
    this.me.speedMul = this.cfg.speed;
  }

  update(dt) {
    const me = this.me, g = this.game, ball = g.ball, it = me.intent;
    const opp = g.athletes.find((a) => a !== me);

    // executing a shot: keep the button held for the planned charge, steering to aim
    if (this.shooting) {
      const s = this.shooting;
      s.hold -= dt;
      // lost the ball while winding up: abort instead of swinging at air
      const bd = Math.hypot(ball.pos.x - me.pos.x, ball.pos.z - me.pos.z);
      if (me.charging && (bd > 1.5 || ball.pos.y > 0.8)) { me.charging = false; me.charge = 0; this.shooting = null; it.kick = it.lob = false; return; }
      it.move.copy(s.aim);
      it.kick = !s.lob && s.hold > 0; it.lob = s.lob && s.hold > 0; it.sprint = false;
      if (s.hold <= 0 && !me.charging) this.shooting = null;
      return;
    }
    it.kick = false; it.lob = false;

    if (g.state !== 'play') { it.move.set(0, 0); it.sprint = false; return; }

    this.think -= dt;
    if (this.think <= 0) {
      this.think = this.cfg.react * (0.7 + Math.random() * 0.6);
      this._decide(opp);
    }
    // smooth steering towards the plan
    it.move.lerp(this.plan.move, Math.min(1, dt * 10));
    it.sprint = this.plan.sprint && this.cfg.sprint;
  }

  _decide(opp) {
    const me = this.me, g = this.game, ball = g.ball;
    const dirX = me.attackSign;
    const myGoal = new THREE.Vector3(-dirX * FIELD.halfL, 0, 0);
    const oppGoal = new THREE.Vector3(dirX * FIELD.halfL, 0, 0);
    const bp = ball.pos;
    const myDist = Math.hypot(bp.x - me.pos.x, bp.z - me.pos.z);
    const oppDist = Math.hypot(bp.x - opp.pos.x, bp.z - opp.pos.z);
    const iHave = g.possessor === me;
    const theyHave = g.possessor === opp;
    const plan = this.plan;
    plan.sprint = false;

    if (iHave) {
      const toGoal = oppGoal.clone().sub(me.pos); const gd = toGoal.length();
      const oppAhead = (opp.pos.x - me.pos.x) * dirX > -0.3 && Math.hypot(opp.pos.x - me.pos.x, opp.pos.z - me.pos.z) < 2.6;
      // shoot?
      const angleOK = Math.abs(me.pos.z) < FIELD.halfW - 1 || gd < 6;
      if (gd < this.cfg.shootRange && angleOK && (Math.random() < 0.55 || gd < 6)) {
        this._shoot(oppGoal, opp, gd);
        return;
      }
      // chip over a charging opponent sometimes
      if (oppAhead && gd < 14 && Math.random() < 0.08 * this.cfg.skill) {
        this._shoot(oppGoal, opp, gd, true); return;
      }
      // dribble to goal, dodging the opponent
      let dir = new THREE.Vector2(toGoal.x, toGoal.z).normalize();
      if (oppAhead) {
        if (this.dodge <= 0) { this.dodgeSide = (opp.pos.z > me.pos.z ? -1 : 1) * (Math.random() < 0.8 ? 1 : -1); this.dodge = 0.8; }
        const ang = 0.9 * this.dodgeSide * -dirX;
        dir.rotateAround(new THREE.Vector2(), ang);
        plan.sprint = true;
      }
      this.dodge -= this.cfg.react;
      // keep away from the side boards
      if (Math.abs(me.pos.z) > FIELD.halfW - 1.2) dir.y -= Math.sign(me.pos.z) * 0.6;
      plan.move.copy(dir.normalize());
      return;
    }

    // panic clearance when the ball is loose near my own goal
    const nearOwnGoal = Math.abs(bp.x - myGoal.x) < 5 && myDist < 1.2 && bp.y < 0.6;
    if (nearOwnGoal && !theyHave) {
      const out = new THREE.Vector2(dirX, (Math.random() - 0.5) * 1.2).normalize();
      this.shooting = { hold: 0.45, aim: out, lob: Math.random() < 0.4 };
      return;
    }

    if (theyHave || (oppDist + 0.8 < myDist && oppDist < 2)) {
      // defend: get goal-side of the ball, then press
      const toMyGoal = myGoal.clone().sub(bp).setY(0).normalize();
      const guard = bp.clone().addScaledVector(toMyGoal, myDist < 2.2 ? 0.2 : 1.4);
      plan.move.set(guard.x - me.pos.x, guard.z - me.pos.z);
      const d = plan.move.length();
      plan.move.normalize().multiplyScalar(Math.min(1, d / 0.6));
      plan.sprint = d > 3;
      return;
    }

    // loose ball: chase where it is going, arriving from behind relative to the attack
    const t = clamp(myDist / 5.5, 0, 1.2);
    const pred = ball.predict(t);
    const behind = pred.clone(); behind.x -= dirX * 0.55;
    const imInFront = (me.pos.x - pred.x) * dirX > 0.1;
    if (imInFront && myDist < 3) {
      // circle round the ball instead of running through it
      behind.z += (me.pos.z > pred.z ? 1 : -1) * 0.9;
    }
    plan.move.set(behind.x - me.pos.x, behind.z - me.pos.z);
    const d = plan.move.length();
    plan.move.normalize().multiplyScalar(Math.min(1, d / 0.5 + 0.3));
    plan.sprint = d > 2.5;
  }

  _shoot(oppGoal, opp, gd, lob = false) {
    const me = this.me;
    // aim at the corner furthest from the opponent
    const side = opp.pos.z > 0 ? -1 : 1;
    const tz = side * (FIELD.goalHalfW - 0.4) + (Math.random() - 0.5) * this.cfg.aimNoise * 2;
    const aim = new THREE.Vector2(oppGoal.x - me.pos.x, tz - me.pos.z).normalize();
    const [a, b] = this.cfg.charge;
    let power = a + Math.random() * (b - a);
    if (gd < 5) power *= 0.75;
    this.shooting = { hold: 0.05 + power * 0.8, aim, lob };
  }
}
