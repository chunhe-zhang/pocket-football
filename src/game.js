import * as THREE from 'three';
import { FIELD, TEAMS, MATCH, BALL } from './config.js';
import { Pitch } from './pitch.js';
import { Ball } from './ball.js';
import { Character } from './character.js';
import { Athlete } from './athlete.js';
import { AIController } from './ai.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const CAM_MODES = ['broadcast', 'close', 'high'];

export class Game {
  constructor({ scene, camera, gltf, sfx, input, ui }) {
    Object.assign(this, { scene, camera, sfx, input, ui });
    this.pitch = new Pitch(scene);
    this.ball = new Ball(scene, sfx);
    this.athletes = TEAMS.map((t, i) => {
      const ch = new Character(gltf, { color: t.color, accent: t.accent });
      scene.add(ch.group);
      return new Athlete(this, i, ch, i === 0 ? 'P1' : 'CPU');
    });
    this.controllers = [];
    this.state = 'menu';
    this.score = [0, 0];
    this.clock = MATCH.defaultDuration;
    this.time = 0;
    this.timer = 0;
    this.timeScale = 1; this.slowmo = 0; this.hitstop = 0; this.shake = 0;
    this.camMode = 0;
    this.camLook = new THREE.Vector3(0, 0, 0);
    this.camPos = new THREE.Vector3(0, 10, 16);
    this.possessor = null;
    this.possession = [0, 0];
    this.shotPending = null;
    this.crowdT = 0;
    this.settings = { mode: 'solo', level: 'normal', duration: MATCH.defaultDuration };
    this._v = new THREE.Vector3();
    this.athletes[0].place(-2.6, 0, Math.PI / 2);
    this.athletes[1].place(2.6, 0, -Math.PI / 2);
  }

  // ------------------------------------------------------------------ flow --
  start(settings) {
    Object.assign(this.settings, settings);
    const { mode, level, duration } = this.settings;
    this.score = [0, 0]; this.clock = duration; this.possession = [0, 0];
    for (const a of this.athletes) { a.stats = { shots: 0, onTarget: 0, touches: 0 }; a.stamina = 1; a.char.stopEmotes(); a.skill = 1; a.speedMul = 1; }
    this.athletes[0].label = mode === 'duo' ? 'P1' : 'YOU';
    this.athletes[1].label = mode === 'duo' ? 'P2' : 'CPU';
    this.controllers = [
      { type: 'human', scheme: mode === 'duo' ? 'p1' : 'solo' },
      mode === 'duo' ? { type: 'human', scheme: 'p2' } : { type: 'ai', ai: new AIController(this.athletes[1], this, level) },
    ];
    this.endShown = false;
    this.ui.onScore(this.score);
    this.kickoff(Math.random() < 0.5 ? 0 : 1);
  }

  kickoff(team) {
    this.state = 'kickoff';
    this.timer = MATCH.kickoffDelay;
    this.ball.reset(0, 0);
    this.possessor = null;
    const [a, b] = this.athletes;
    a.place(team === 0 ? -0.75 : -3.2, team === 0 ? -0.15 : 0, Math.PI / 2);
    b.place(team === 1 ? 0.75 : 3.2, team === 1 ? 0.15 : 0, -Math.PI / 2);
    for (const x of this.athletes) { x.frozen = true; x.char.stopEmotes(); }
    this.ui.banner('', '');
  }

  goal(side) {
    const scorerTeam = side > 0 ? 0 : 1;
    const toucher = this.ball.lastTouch;
    const own = toucher && toucher.team !== scorerTeam;
    this.score[scorerTeam]++;
    this.ui.onScore(this.score);
    this.state = 'goal'; this.timer = MATCH.goalPause;
    this.slowmo = 1.1;
    this.sfx.cheer(); this.sfx.net();
    this.pitch.cheer(scorerTeam, 1);
    this.focus = own ? this.athletes[1 - scorerTeam] : this.athletes[scorerTeam];
    for (const a of this.athletes) { a.frozen = true; a.charging = false; }
    const winner = this.athletes[scorerTeam], loser = this.athletes[1 - scorerTeam];
    if (!own) { winner.char.play('celebrate'); }
    loser.char.play('deject'); loser.char.emote('sad_pose', 0.6);
    if (own) loser.char.emote('headShake', 1);
    const name = TEAMS[scorerTeam].name;
    this.ui.banner(own ? 'OWN GOAL' : 'GOAL!', own ? `乌龙球 · ${name} 得分` : `${winner.label} · ${name}`);
    if (toucher && !own) toucher.stats.onTarget = Math.max(toucher.stats.onTarget, 0);
  }

  end() {
    this.state = 'ended'; this.timer = 1.8;
    this.sfx.whistle([0.3, 0.3, 0.75]);
    const [s0, s1] = this.score;
    if (s0 !== s1) {
      const w = s0 > s1 ? 0 : 1;
      this.athletes[w].char.play('celebrate'); this.athletes[1 - w].char.play('deject');
      this.pitch.cheer(w, 1); this.sfx.cheer();
    }
    for (const a of this.athletes) a.frozen = true;
    this.focus = null;
  }

  // ------------------------------------------------------------ callbacks --
  onKick(ath, k, vel) {
    const p = k.power;
    this.sfx.kick(p);
    if (p > 0.55 && k.type === 'kick') { this.hitstop = 0.035 + 0.04 * p; this.shake = Math.max(this.shake, 0.08 + 0.18 * p); }
    // shot on goal?
    const gx = ath.attackSign * FIELD.halfL;
    const t = (gx - this.ball.pos.x) / (vel.x || 1e-6);
    if (t > 0 && t < 3) {
      const z = this.ball.pos.z + vel.z * t;
      if (Math.abs(z) < FIELD.goalHalfW + 1.2) {
        ath.stats.shots++;
        if (Math.abs(z) < FIELD.goalHalfW + 0.05) ath.stats.onTarget++;
        this.shotPending = { team: ath.team, t: this.time };
        this.sfx.crowd(0.12, 0.4);
      }
    }
  }

  onWhiff() { /* the swing animation already sells it */ }

  // ---------------------------------------------------------------- update --
  update(rawDt) {
    const input = this.input;
    if (input.wasPressed('KeyC')) this.cycleCamera();
    if (input.wasPressed('KeyM')) this.ui.toggleMute();
    if ((input.wasPressed('Escape') || input.wasPressed('KeyP')) && ['play', 'kickoff', 'goal', 'paused'].includes(this.state)) this.ui.togglePause();
    if (this.state === 'paused') { this._updateCamera(rawDt); return; }

    // time effects
    let dt = rawDt;
    if (this.hitstop > 0) { this.hitstop -= rawDt; dt = rawDt * 0.08; }
    if (this.slowmo > 0) { this.slowmo -= rawDt; dt *= 0.3 + 0.7 * clamp(1 - this.slowmo / 1.1, 0, 1) ** 2; }
    this.time += dt;

    // intents
    this.controllers.forEach((c, i) => {
      const a = this.athletes[i];
      if (c.type === 'human') input.intent(c.scheme, a.intent);
      else c.ai.update(dt);
    });
    if (this.state === 'menu' || this.state === 'ended') for (const a of this.athletes) { a.intent.move.set(0, 0); a.intent.kick = a.intent.lob = a.intent.sprint = false; }

    // state machine
    if (this.state === 'kickoff') {
      this.timer -= rawDt;
      if (this.timer <= 0) { this.state = 'play'; for (const a of this.athletes) a.frozen = false; this.sfx.whistle([0.45]); }
    } else if (this.state === 'play') {
      this.clock -= dt;
      if (this.clock <= 0) { this.clock = 0; this.end(); }
    } else if (this.state === 'goal') {
      this.timer -= rawDt;
      if (this.timer <= 0) {
        const conceded = this.ball.goalSide > 0 ? 1 : 0;
        this.kickoff(conceded);
      }
    } else if (this.state === 'ended') {
      this.timer -= rawDt;
      if (this.timer <= 0 && !this.endShown) { this.endShown = true; this.ui.showEnd(this); }
    }

    // players
    for (const a of this.athletes) a.update(dt);
    this._separatePlayers();

    // ball
    if (this.state !== 'kickoff') {
      const order = [...this.athletes].sort((p, q) => this._distBall(q) - this._distBall(p));
      for (const a of order) a.handleBall(dt);
      this._prevBall = (this._prevBall || new THREE.Vector3()).copy(this.ball.pos);
      const events = this.ball.update(dt);
      this._sweptBlocks();
      for (const e of events) this._ballEvent(e);
    } else this.ball.sync(dt);

    this._updatePossession(dt);
    this.pitch.update(dt, this.time);
    this._updateCrowd(rawDt);
    this._updateCamera(rawDt);
    this.ui.updateHud(this);
  }

  // fast shots move ~0.4 m per frame, so test the ball's path against each body
  _sweptBlocks() {
    const b = this.ball, p0 = this._prevBall, p1 = b.pos;
    const dx = p1.x - p0.x, dz = p1.z - p0.z, len2 = dx * dx + dz * dz;
    if (len2 < 0.04) return; // slow balls are handled by Athlete.handleBall
    for (const a of this.athletes) {
      if (b.lastTouch === a && this.time - a.lastTouchTime < 0.25) continue;
      const rr = 0.3 + BALL.r;
      const fx = p0.x - a.pos.x, fz = p0.z - a.pos.z;
      const B = fx * dx + fz * dz, C = fx * fx + fz * fz - rr * rr;
      if (C < 0) continue;
      const disc = B * B - len2 * C;
      if (disc < 0) continue;
      const t = (-B - Math.sqrt(disc)) / len2;
      if (t < 0 || t > 1) continue;
      const hy = p0.y + (p1.y - p0.y) * t;
      if (hy > 1.75) continue;
      // hit: put the ball on the body surface and reflect it, absorbing a lot
      const cx = p0.x + dx * t, cz = p0.z + dz * t;
      let nx = cx - a.pos.x, nz = cz - a.pos.z; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      b.pos.set(cx + nx * 0.01, hy, cz + nz * 0.01);
      const vn = b.vel.x * nx + b.vel.z * nz;
      if (vn < 0) { b.vel.x -= 1.45 * vn * nx; b.vel.z -= 1.45 * vn * nz; b.vel.y *= 0.5; }
      b.spin.multiplyScalar(0.3);
      b.lastTouch = a; a.lastTouchTime = this.time;
      this.sfx.kick(Math.min(0.6, -vn / 30));
      if (this.state === 'play' && -vn > 10) { this.shake = Math.max(this.shake, 0.08); this.sfx.ooh(); }
      return;
    }
  }

  _distBall(a) { return Math.hypot(this.ball.pos.x - a.pos.x, this.ball.pos.z - a.pos.z); }

  _ballEvent(e) {
    switch (e.type) {
      case 'bounce': this.sfx.bounce(e.v); break;
      case 'board': this.sfx.board(e.v); if (e.v > 9) this.shake = Math.max(this.shake, 0.05); break;
      case 'post': this.sfx.post(e.v); this.shake = Math.max(this.shake, 0.12); if (this.state === 'play') this.sfx.ooh(); break;
      case 'net': this.sfx.net(); break;
      case 'backnet': this.pitch.bulgeNet(e.side, e.y, e.z, e.v); break;
      case 'goal': if (this.state === 'play') this.goal(e.side); break;
    }
  }

  _separatePlayers() {
    const [a, b] = this.athletes;
    const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz), min = 0.62;
    if (d < min && d > 1e-4) {
      const push = (min - d) / 2, nx = dx / d, nz = dz / d;
      a.pos.x -= nx * push; a.pos.z -= nz * push; b.pos.x += nx * push; b.pos.z += nz * push;
      // shoulder-to-shoulder: bleed a little speed
      a.vel.multiplyScalar(0.96); b.vel.multiplyScalar(0.96);
    }
  }

  _updatePossession(dt) {
    const lt = this.ball.lastTouch;
    let p = null;
    if (lt && this.ball.pos.y < 0.9 && this._distBall(lt) < 1.5 && this.time - lt.lastTouchTime < 1.2) p = lt;
    this.possessor = p;
    if (p && this.state === 'play') this.possession[p.team] += dt;
  }

  _updateCrowd(dt) {
    this.crowdT -= dt;
    if (this.crowdT > 0 || this.state !== 'play') return;
    this.crowdT = 0.5;
    const near = 1 - clamp((FIELD.halfL - Math.abs(this.ball.pos.x)) / 8, 0, 1);
    this.sfx.crowd(0.045 + near * 0.06, 1.2);
    if (near > 0.5) this.pitch.cheer(this.ball.pos.x > 0 ? 0 : 1, 0.25 * near);
  }

  cycleCamera() { this.camMode = (this.camMode + 1) % CAM_MODES.length; this.ui.toast?.(`视角：${['转播', '近景', '高空'][this.camMode]}`); }

  _updateCamera(dt) {
    const cam = this.camera, ball = this.ball.pos;
    const aspect = cam.aspect;
    // narrow screens: zoom in a bit less than the aspect would suggest and follow the ball fully
    const tall = aspect < 1.2;
    const portrait = tall ? 1.3 : clamp(1.6 / aspect, 1, 1.5);
    let pos = this._v, look = new THREE.Vector3();
    const k = 1 - Math.exp(-dt * 3.2);

    if (this.state === 'menu') {
      const t = this.time * 0.08;
      pos.set(Math.sin(t) * 18, 7.5, Math.cos(t) * 18);
      look.set(0, 0.8, 0);
      this.camPos.lerp(pos, 1 - Math.exp(-dt * 2)); this.camLook.lerp(look, 1 - Math.exp(-dt * 2));
    } else if ((this.state === 'goal' || this.state === 'ended') && this.focus) {
      const f = this.focus.pos;
      const toCam = new THREE.Vector3(0, 0, 1);
      pos.set(f.x * 0.9 + toCam.x * 4.5, 2.4, f.z + 5.6 * Math.min(portrait, 1.6));
      look.set(f.x, 1.1, f.z);
      const kk = 1 - Math.exp(-dt * 1.8);
      this.camPos.lerp(pos, kk); this.camLook.lerp(look, kk);
    } else {
      const mode = CAM_MODES[this.camMode];
      const lim = tall ? 9.5 : mode === 'close' ? 7.5 : 6;
      const lx = clamp(ball.x * (tall ? 1 : 0.85), -lim, lim);
      if (mode === 'broadcast') { pos.set(lx * 0.92, 7.4 * portrait, 12.2 * portrait); look.set(lx, 0, 0.5 + ball.z * 0.2); }
      else if (mode === 'close') { pos.set(lx, 4.6 * portrait, 9.5 * portrait + ball.z * 0.5); look.set(clamp(ball.x, -9, 9), 0.6, ball.z * 0.55); }
      else { pos.set(lx * 0.6, 19 * portrait, 9 * portrait); look.set(lx * 0.6, 0, 0.3); }
      this.camPos.lerp(pos, k); this.camLook.lerp(look, k);
    }
    cam.position.copy(this.camPos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 0.9);
      const s = this.shake * this.shake * 2;
      cam.position.x += (Math.random() - 0.5) * s; cam.position.y += (Math.random() - 0.5) * s;
    }
    cam.lookAt(this.camLook);
    cam.updateMatrixWorld();
  }
}
