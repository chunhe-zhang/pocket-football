import * as THREE from 'three';
import { LightningVFX } from './lightning-vfx.js';

const V = THREE.Vector3;
const UP = new V(0, 0.8, 0);

/** Visual adapter only: reads the real actors/ball; never drives physics. */
export class GameLightningFx {
  constructor(scene, camera) {
    this.fx = new LightningVFX(scene, camera, { quality: 'low', intensity: 0.8 });
    this.fx.auraEnabled = false;
    this.states = new Map(); this.time = 0; this.hitCD = 0; this.shotClock = 0;
    this.prevBall = new V(); this.wasShot = false; this.special = null; this.visible = false;
    this.stats = { shots: 0, hits: 0, trails: 0 };
  }

  hasThunder(ball) {
    return (ball.specialType || '').replaceAll('!', '').split('+').includes('thunder');
  }

  hit(pos, big = false) {
    if (this.hitCD > 0) return false;
    this.hitCD = big ? 0.2 : 0.12; this.stats.hits++;
    if (big) this.fx.impact(pos);
    else {
      this.fx.emit(pos, 40, { speed: 2.5, life: 0.6, size: 0.05 });
      this.fx.makeRing(pos, 0.8, 0.4);
      for (let i = 0; i < 3; i++) this.fx.branch(pos, pos.clone().add(new V((Math.random() - 0.5) * 1.4, Math.random() * 0.7, (Math.random() - 0.5) * 1.4)), { life: 0.18, width: 0.022, jitter: 0.12 });
    }
    return true;
  }

  update(dt, game) {
    this.time += dt; this.hitCD = Math.max(0, this.hitCD - dt);
    const active = !['menu', 'ended'].includes(game.state);
    this.fx.group.visible = active;
    if (!active) {
      if (this.visible) this.fx.clearTransient();
      this.visible = false; this.wasShot = false; this.special = null;
      return;
    }
    this.visible = true;
    const actors = game.athletes.filter(a => !a.out && a.charId === 'thunder' && a.char.group.visible);
    const live = new Set(actors);
    for (const [a, s] of this.states) if (!live.has(a)) {
      this.fx.group.remove(s.ring.mesh); s.ring.m.dispose();
      const i = this.fx.rings.indexOf(s.ring); if (i >= 0) this.fx.rings.splice(i, 1);
      this.states.delete(a);
    }
    let charging = null;
    for (const a of actors) {
      let s = this.states.get(a);
      if (!s) {
        const ring = this.fx.makeRing(a.pos, 1.9, 9999); ring.permanent = true;
        s = { ring, last: a.pos.clone(), clock: 0, aura: 0 }; this.states.set(a, s);
      }
      const skill = a.power?.type === 'thunder' || a.tm?.type === 'thunder';
      const moving = a.sprinting || skill || a.slide;
      s.ring.mesh.position.set(a.pos.x, 0.025, a.pos.z);
      s.ring.mesh.visible = game.state === 'play' || a.charging;
      s.ring.m.uniforms.opacity.value = a.charging ? 0.35 + a.charge * 0.35 : moving ? 0.4 : 0.12;
      if (a.charging && (!charging || a.charge > charging.charge)) charging = a;
      s.clock -= dt; s.aura -= dt;
      const d = s.last.distanceTo(a.pos);
      if (moving && s.clock <= 0 && d > 0.04 && d < 6) {
        this.fx.branch(s.last.clone().add(UP), a.pos.clone().add(UP), { life: 0.22, width: skill ? 0.055 : 0.025, jitter: skill ? 0.17 : 0.08 });
        this.fx.emit(a.pos.clone().add(new V(0, 0.25, 0)), skill ? 12 : 5, { speed: 1.3, life: 0.45, size: 0.035 });
        s.clock = skill ? 0.045 : 0.09; this.stats.trails++;
      }
      if (s.aura <= 0) {
        const t = Math.random() * Math.PI * 2, p = a.pos.clone().add(new V(Math.cos(t) * 0.4, 0.2, Math.sin(t) * 0.4));
        this.fx.branch(p, p.clone().add(new V(0.1, 0.45 + Math.random() * 0.3, -0.1)), { life: 0.14, width: 0.013, jitter: 0.07 });
        s.aura = moving || a.charging ? 0.13 : 0.65;
      }
      s.last.copy(a.pos);
    }
    const ball = game.ball;
    this.fx.setOrigin(charging?.pos || actors[0]?.pos || ball.pos);
    this.fx.setCharge(charging ? charging.charge : 0, ball.pos);
    const shot = this.hasThunder(ball) && !ball.hidden && !ball.heldBy;
    if (shot) {
      if (!this.wasShot || (ball.special && ball.special !== this.special)) {
        this.stats.shots++; this.fx.emit(ball.pos, 65, { speed: 3, life: 0.65, size: 0.06 });
        this.fx.makeRing(ball.pos, 1.0, 0.5); this.prevBall.copy(ball.pos); this.shotClock = 0;
      }
      this.shotClock -= dt;
      if (this.shotClock <= 0) {
        // The path is sampled from actual ball motion, including curves,
        // bounces and network interpolation. No demonstration projectile.
        if (this.prevBall.distanceTo(ball.pos) < 12) this.fx.branch(this.prevBall, ball.pos, { life: 0.21, width: 0.05, jitter: 0.1 });
        this.fx.emit(ball.pos, 8, { speed: 0.9, life: 0.4, size: 0.04 });
        this.prevBall.copy(ball.pos); this.shotClock = 0.035;
      }
    }
    this.wasShot = shot; this.special = ball.special;
    this.fx.update(dt, this.time);
  }

  dispose() { this.states.clear(); this.fx.dispose(); }
}
