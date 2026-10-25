import * as THREE from 'three';
import { FIELD, TEAMS, MATCH, BALL, GOALS, SIDES } from './config.js';
import { Pitch } from './pitch.js';
import { Ball } from './ball.js';
import { Character } from './character.js';
import { Athlete } from './athlete.js';
import { AIController } from './ai.js';
import { ChargeFx } from './chargefx.js';
import { Particles } from './fx.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const CAM_MODES = ['broadcast', 'high'];
const H = FIELD.half;
const SFX_EVENTS = new Set(['kick', 'touch', 'bounce', 'board', 'post', 'net', 'whistle', 'cheer', 'ooh', 'crowd']);
const SNAP_INTERVAL = 0.05; // host sends 20 snapshots a second
const INTERP_DELAY = 0.12;  // guests render this far behind the newest snapshot

/**
 * Match orchestration. Runs in one of three roles:
 *  - local: everything simulated here
 *  - host:  simulated here, inputs of remote players arrive over the network and
 *           snapshots + events are broadcast
 *  - guest: no simulation; snapshots from the host are interpolated and the
 *           characters are driven as puppets
 */
export class Game {
  constructor({ scene, camera, template, sfx, input, ui }) {
    Object.assign(this, { scene, camera, input, ui });
    this.realSfx = sfx;
    this.sfx = this._recordingSfx(sfx);
    this.goals = GOALS;
    this.pitch = new Pitch(scene);
    this.ball = new Ball(scene, this.sfx);
    this.chargeFx = new ChargeFx(scene);
    this.particles = new Particles(scene);
    this.athletes = TEAMS.map((t, i) => {
      const ch = new Character(template, t.kit);
      scene.add(ch.group);
      const a = new Athlete(this, i, ch, t.cpuName);
      this._recordCharacter(a, i);
      return a;
    });
    this.controllers = [];
    this.state = 'menu';
    this.conceded = TEAMS.map(() => 0);
    this.scored = TEAMS.map(() => 0);
    this.alive = TEAMS.map(() => true);
    this.outOrder = [];        // teams in the order they were knocked out
    this.knockedBy = TEAMS.map(() => null);
    this.clock = MATCH.defaultDuration;
    this.time = 0; this.timer = 0;
    this.slowmo = 0; this.hitstop = 0; this.shake = 0;
    this.camMode = 0;
    this.camLook = new THREE.Vector3(0, 0, 0);
    this.camPos = new THREE.Vector3(0, 14, 18);
    this.possessor = null;
    this.possession = TEAMS.map(() => 0);
    this.crowdT = 0;
    this.settings = { humans: 1, level: 'gf', mode: 'ffa', pairing: 'humans', duration: MATCH.defaultDuration };
    this.side = null;          // 2v2: side (0 / 1) of each player, null in free-for-all
    this.role = 'local';
    this.net = null;
    this.events = []; this.snapT = 0;
    this.snaps = []; this.pendingEvents = [];
    this._v = new THREE.Vector3();
    this.placeAll();
  }

  get lives() { return MATCH.lives; }
  activeGoal(team) { return this.alive[team]; }
  get live() { return this.athletes.filter((a) => !a.out); }
  get teamMode() { return !!this.side; }
  sameSide(a, b) { return !!this.side && a !== b && this.side[a] === this.side[b]; }
  mateOf(team) { if (!this.side) return null; const m = this.athletes.find((a) => a.team !== team && !a.out && this.side[a.team] === this.side[team]); return m || null; }
  /** sides (2v2) or players (free-for-all) still in the game */
  _standing() { return this.side ? new Set(this.alive.map((v, i) => (v ? this.side[i] : -1)).filter((s) => s >= 0)).size : this.alive.filter(Boolean).length; }
  sideLeft(s) { return this.alive.filter((v, i) => v && this.side[i] === s).length; }

  /**
   * 2v2: random goals and random pairs. Participants come in order (humans first);
   * 'humans' puts P1 + P2 on the same side, 'vs' puts them on opposite sides.
   */
  _assignTeams(participants, pairing) {
    const perm = shuffle([0, 1, 2, 3]);           // perm[0], perm[1] = side 0; perm[2], perm[3] = side 1
    const order = pairing === 'vs' ? [perm[0], perm[2], perm[1], perm[3]] : perm;
    const side = []; perm.forEach((a, k) => { side[a] = k < 2 ? 0 : 1; });
    const slots = [];
    participants.forEach((p, k) => { const a = order[k]; slots[a] = !p || p.kind === 'cpu' ? { kind: 'cpu', name: TEAMS[a].cpuName } : p; });
    return { slots, side };
  }

  // ------------------------------------------------------------- recording --
  _recordingSfx(real) {
    const game = this;
    return new Proxy(real, {
      get(t, p) {
        const v = t[p];
        if (typeof v !== 'function') return v;
        if (!SFX_EVENTS.has(p)) return v.bind(t);
        return (...a) => { if (game.role === 'host') game.emit({ e: 'sfx', n: p, a }); return v.apply(t, a); };
      },
    });
  }

  _recordCharacter(a, i) {
    const c = a.char;
    for (const m of ['play', 'face', 'emote', 'stopEmotes']) {
      const orig = c[m].bind(c);
      c[m] = (...args) => { if (this.role === 'host') this.emit({ e: 'ch', i, m, a: args }); return orig(...args); };
    }
  }

  emit(e) { if (this.role === 'host') { e.t = this.time; this.events.push(e); } }

  /** grass / dust particles, mirrored to guests */
  fx(kind, p, dir, n, speed) {
    this.particles.burst(p, dir || { x: 0, z: 0 }, n, speed, kind);
    this.emit({ e: 'fx', k: kind, p: [p.x, p.y, p.z], d: [dir?.x || 0, dir?.z || 0], n, s: speed });
  }

  squashBall(dir, amount) {
    this.ball.squash(dir, amount);
    this.emit({ e: 'sq', d: [dir.x, dir.y || 0, dir.z], a: amount });
  }

  /** controller vibration for local gamepad players */
  rumble(ath, strength, ms) {
    const c = this.controllers[ath.team];
    if (!c || c.type !== 'human' || !c.scheme?.startsWith('pad')) return;
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    const pad = pads[+c.scheme.slice(3)];
    try { pad?.vibrationActuator?.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strength), weakMagnitude: Math.min(1, strength * 0.6) }); } catch {}
  }

  banner(big, small) { this.ui.banner(big, small); this.emit({ e: 'banner', big, small }); }

  // ------------------------------------------------------------------ flow --
  /** kickoff spots: in front of each player's own goal, facing the centre */
  placeAll() {
    this.athletes.forEach((a, i) => {
      const g = GOALS[i];
      if (a.out) { a.place(60 + i * 3, 60, 0); return; }   // parked far off the pitch
      a.place(g.centre.x + g.inward.x * 5, g.centre.z + g.inward.z * 5, Math.atan2(g.inward.x, g.inward.z));
    });
  }

  /** take a player off and close their goal with a board */
  eliminate(team) {
    const a = this.athletes[team];
    if (a.out) return;
    a.out = true; this.alive[team] = false;
    a.char.group.visible = false;
    this.ball.closedGoals.add(team);
    this.pitch.sealGoal(team, true);
    a.place(60 + team * 3, 60, 0);
  }

  _resetElimination() {
    this.alive = TEAMS.map(() => true); this.outOrder = []; this.knockedBy = TEAMS.map(() => null);
    this.ball.closedGoals.clear();
    this.athletes.forEach((a, i) => { a.out = false; a.char.group.visible = true; this.pitch.sealGoal(i, false, true); });
  }

  /**
   * @param settings { humans, level, duration, slots? }
   * slots (online): [{ kind: 'local'|'remote'|'cpu', name, id }]
   */
  start(settings) {
    Object.assign(this.settings, settings);
    const { level, duration } = this.settings;
    this.conceded = TEAMS.map(() => 0); this.scored = TEAMS.map(() => 0);
    this.possession = TEAMS.map(() => 0);
    this.clock = 0;
    this._resetElimination();
    for (const a of this.athletes) { a.stats = { shots: 0, onTarget: 0, touches: 0 }; a.stamina = 1; a.char.stopEmotes(); a.skill = 1; a.speedMul = 1; }
    let slots = this.settings.slots || this._localSlots(this.settings.humans);
    this.side = null;
    if (this.settings.mode === 'team') ({ slots, side: this.side } = this._assignTeams(slots, this.settings.pairing));
    this.slots = slots;
    this.controllers = slots.map((s, i) => {
      const a = this.athletes[i];
      a.label = s.name || TEAMS[i].cpuName;
      if (s.kind === 'local') return { type: 'human', scheme: s.scheme };
      if (s.kind === 'remote') return { type: 'remote', id: s.id };
      return { type: 'ai', ai: new AIController(a, this, level, level === 'gf') };
    });
    const mode = this.settings.mode;
    this.endShown = false;
    this.ui.onScore(this);
    this.kickoff();
    if (this.side) this.banner('2v2 组队', SIDES.map((s, k) => `${s.icon} ${s.name}：${this.athletes.filter((a) => this.side[a.team] === k).map((a) => a.label).join(' + ')}`).join('　'));
    if (this.role === 'host') this.net.broadcast({ k: 'start', settings: { level, duration, mode }, side: this.side, slots: slots.map(({ kind, name, id }) => ({ kind: kind === 'local' ? 'host' : kind, name, id })) });
  }

  _localSlots(humans) {
    // keyboard: one player uses the whole keyboard, two split it; players 3-4 need gamepads
    const schemes = humans === 1 ? ['solo'] : humans === 2 ? ['p1', 'p2'] : ['p1', 'p2', 'pad0', 'pad1'];
    return TEAMS.map((t, i) => (i < humans ? { kind: 'local', scheme: schemes[i], name: humans === 1 ? 'YOU' : `P${i + 1}` } : { kind: 'cpu', name: t.cpuName }));
  }

  kickoff() {
    this.state = 'kickoff';
    this.timer = MATCH.kickoffDelay;
    this.ball.reset(0, 0);
    this.possessor = null;
    this.placeAll();
    for (const x of this.athletes) { x.frozen = true; x.char.stopEmotes(); }
    this.banner('', '');
    this.emit({ e: 'kickoff' });
  }

  goal(team) {
    const toucher = this.ball.lastTouch;
    const own = !toucher || toucher.team === team || this.sameSide(toucher.team, team);
    this.conceded[team]++;
    if (!own) this.scored[toucher.team]++;
    this.ui.onScore(this);
    this.state = 'goal'; this.timer = MATCH.goalPause;
    this.sfx.cheer(); this.sfx.net();
    this.pitch.cheer(team, 1); this.emit({ e: 'cheer' });
    const loser = this.athletes[team];
    this.focus = own ? loser : toucher;
    for (const a of this.athletes) { a.frozen = true; a.charging = false; }
    if (!own) toucher.char.play('celebrate');
    loser.char.play('deject');
    const livesLeft = MATCH.lives - this.conceded[team];
    if (livesLeft <= 0) {
      // out of lives: knocked out (the goal is boarded up after the pause)
      this.alive[team] = false;
      this.outOrder.push(team);
      this.knockedBy[team] = own ? null : toucher.team;
      const left = this.alive.filter(Boolean).length;
      const sideNote = this.side ? ` · ${SIDES[this.side[team]].name}还剩 ${this.sideLeft(this.side[team])} 人` : left > 1 ? ` · 还剩 ${left} 人` : '';
      if (own) this.banner('出局！', `${toucher && toucher.team !== team ? `${toucher.label} 误伤队友，` : ''}${loser.label} 被淘汰${sideNote}`);
      else this.banner('出局！', `${toucher.label} 淘汰了 ${loser.label}${sideNote}`);
    } else {
      if (own) this.banner(toucher && toucher.team !== team ? '误伤队友' : '乌龙球', `${loser.label} 还剩 ${livesLeft} 条命`);
      else this.banner('进球！', `${toucher.label} 攻破 ${loser.label} 的球门 · ${loser.label} 还剩 ${livesLeft} 条命`);
    }
    this.ui.onScore(this);
    this.emit({ e: 'focus', i: this.focus ? this.focus.team : -1 });
  }

  /** the last player standing wins */
  end() {
    this.state = 'ended'; this.timer = 2.2;
    this.sfx.whistle([0.3, 0.3, 0.75]);
    const w = this.alive.indexOf(true);
    const winner = this.athletes[w];
    if (winner && this.side) {
      const s = this.side[w];
      for (const a of this.athletes) if (this.side[a.team] === s) a.char.play('celebrate');
      this.focus = winner;
      this.banner(`${SIDES[s].icon} ${SIDES[s].name}获胜！`, this.athletes.filter((a) => this.side[a.team] === s).map((a) => a.label).join(' + '));
    } else if (winner) { winner.char.play('celebrate'); this.focus = winner; this.banner('冠军！', `${winner.label} 是最后留下的人`); }
    this.emit({ e: 'focus', i: winner ? w : -1 });
    this.sfx.cheer();
    for (const a of this.athletes) a.frozen = true;
  }

  results() {
    const tot = this.possession.reduce((s, x) => s + x, 0) || 1;
    // placing: the winner first, then reverse order of elimination
    let order = [...this.alive.map((v, i) => (v ? i : -1)).filter((i) => i >= 0), ...[...this.outOrder].reverse()];
    const side = this.side, win = side ? side[order[0]] : null;
    if (side) order = [...order.filter((i) => side[i] === win), ...order.filter((i) => side[i] !== win)];
    return order.map((i, k) => {
      const a = this.athletes[i], by = this.knockedBy[i];
      return {
        i, place: side ? (side[i] === win ? 1 : 2) : k + 1, side: side ? side[i] : null, name: a.label, kos: this.scored[i], shots: a.stats.shots,
        possession: Math.round((this.possession[i] / tot) * 100),
        out: !this.alive[i], by: this.alive[i] ? '' : by === null ? '乌龙球' : this.athletes[by].label,
      };
    });
  }

  // ------------------------------------------------------------ callbacks --
  onKick(ath, k, vel) {
    if (k.type === 'pass') { this.sfx.kick(0.2 + 0.35 * k.power); return; }
    const p = k.power;
    this.sfx.kick(p);
    if (p > 0.55 && k.type === 'kick') {
      this.hitstop = 0.035 + 0.04 * p; this.shake = Math.max(this.shake, 0.08 + 0.18 * p);
      this.emit({ e: 'shake', v: this.shake });
    }
    // a shot if the ball is heading for an opponent's goal mouth
    for (const g of GOALS) {
      if (g.team === ath.team || this.sameSide(g.team, ath.team)) continue;
      const A = g.axis, B = A === 'x' ? 'z' : 'x', line = g.sign * H;
      if (Math.abs(vel[A]) < 0.1) continue;
      const t = (line - this.ball.pos[A]) / vel[A];
      if (t <= 0 || t > 3) continue;
      const b = this.ball.pos[B] + vel[B] * t;
      if (Math.abs(b) < FIELD.goalHalfW + 1.2) {
        ath.stats.shots++;
        if (Math.abs(b) < FIELD.goalHalfW + 0.05) ath.stats.onTarget++;
        this.sfx.crowd(0.12, 0.4);
        break;
      }
    }
  }

  onWhiff() {}

  // ---------------------------------------------------------------- update --
  update(rawDt) {
    const input = this.input;
    if (input.wasPressed('KeyC')) this.cycleCamera();
    if (input.wasPressed('KeyM')) this.ui.toggleMute();
    if (this.role === 'local' && (input.wasPressed('Escape') || input.wasPressed('KeyP')) && ['play', 'kickoff', 'goal', 'paused'].includes(this.state)) this.ui.togglePause();
    if (this.role === 'guest') { this._guestUpdate(rawDt); return; }
    if (this.state === 'paused') { this._updateCamera(rawDt); return; }

    let dt = rawDt;
    if (this.hitstop > 0) { this.hitstop -= rawDt; dt = rawDt * 0.08; }
    if (this.slowmo > 0) { this.slowmo -= rawDt; dt *= 0.3 + 0.7 * clamp(1 - this.slowmo / 1.1, 0, 1) ** 2; }
    this.time += dt;

    this.controllers.forEach((c, i) => {
      const a = this.athletes[i];
      if (a.out) return;
      if (c.type === 'human') input.intent(c.scheme, a.intent);
      else if (c.type === 'ai') c.ai.update(dt);
      // remote intents are written by the network handler
    });
    if (this.state === 'menu' || this.state === 'ended') for (const a of this.athletes) { a.intent.move.set(0, 0); a.intent.kick = a.intent.lob = a.intent.sprint = a.intent.pass = false; }

    if (this.state === 'kickoff') {
      this.timer -= rawDt;
      if (this.timer <= 0) { this.state = 'play'; for (const a of this.athletes) a.frozen = false; this.sfx.whistle([0.45]); }
    } else if (this.state === 'play') {
      this.clock += dt;
      // how long the ball has been sitting dead (used by the CPUs to unstick play)
      this.idleT = this.ball.speed < 0.15 && !this.possessor ? (this.idleT || 0) + dt : 0;
    } else if (this.state === 'goal') {
      this.timer -= rawDt;
      if (this.timer <= 0) {
        // the knocked-out player leaves and their goal is boarded up
        for (let i = 0; i < this.alive.length; i++) if (!this.alive[i] && !this.athletes[i].out) this.eliminate(i);
        if (this._standing() <= 1) this.end(); else this.kickoff();
      }
    } else if (this.state === 'ended') {
      this.timer -= rawDt;
      if (this.timer <= 0 && !this.endShown) {
        this.endShown = true;
        const res = this.results();
        this.ui.showEnd(this, res);
        if (this.role === 'host') this.net.broadcast({ k: 'end', res });
      }
    }

    const live = this.live;
    for (const a of live) a.update(dt);
    this._separatePlayers();

    if (this.state !== 'kickoff') {
      const order = [...live].sort((p, q) => this._distBall(q) - this._distBall(p));
      for (const a of order) a.handleBall(dt);
      this.ball.colliders = live.flatMap((a) => (a.colliders || []).filter((c) => c.active));
      const events = this.ball.update(dt);
      for (const e of events) this._ballEvent(e);
    } else this.ball.sync(dt);

    this._updatePossession(dt);
    this.pitch.update(dt, this.time);
    this.particles.update(dt);
    this.chargeFx.update(rawDt, this.athletes, this.time);
    this._updateCrowd(rawDt);
    this._updateCamera(rawDt);
    this.ui.updateHud(this);

    if (this.role === 'host') {
      this.snapT -= rawDt;
      if (this.snapT <= 0) { this.snapT = SNAP_INTERVAL; this._sendSnapshot(); }
    }
  }

  _distBall(a) { return Math.hypot(this.ball.pos.x - a.pos.x, this.ball.pos.z - a.pos.z); }

  _ballEvent(e) {
    switch (e.type) {
      case 'bounce': this.sfx.bounce(e.v); break;
      case 'board': this.sfx.board(e.v); if (e.v > 9) this.shake = Math.max(this.shake, 0.05); break;
      case 'post': this.sfx.post(e.v); this.shake = Math.max(this.shake, 0.12); if (this.state === 'play') this.sfx.ooh(); break;
      case 'net': this.sfx.net(); break;
      case 'backnet': {
        const p = this.ball.pos.toArray();
        this.pitch.bulgeNet(e.team, this.ball.pos, e.v); this.emit({ e: 'bulge', team: e.team, p, v: e.v });
        break;
      }
      case 'goal': if (this.state === 'play') this.goal(e.team); break;
      case 'squash': this.squashBall({ x: e.n[0], y: e.n[1], z: e.n[2] }, e.a); break;
      case 'body': {
        const a = e.who;
        if (a.completeReceive(e.part)) break;
        // an unplanned contact: the ball simply bounced off this player
        this.ball.lastTouch = a; a.lastTouchTime = this.time;
        if (e.v > 1.2) {
          if (e.part === 'head') this.sfx.head(e.v);
          else if (e.part === 'chest' || e.part === 'hips' || e.part === 'thigh') this.sfx.body(e.v);
          else this.sfx.touch();
        }
        if (e.v > 6) this.squashBall({ x: e.n[0], y: e.n[1], z: e.n[2] }, e.v / 55);
        if (e.v > 14 && this.state === 'play') this.sfx.ooh();
        if (e.v > 18 && e.part !== 'foot' && e.part !== 'hand' && !a.dive) a.knock(new THREE.Vector3(-e.n[0], 0, -e.n[2]).normalize(), 3); // a rocket to the body knocks you back
        break;
      }
    }
  }

  _separatePlayers() {
    const A = this.live, min = 0.62;
    for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) {
      const a = A[i], b = A[j];
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d < min && d > 1e-4) {
        const push = (min - d) / 2, nx = dx / d, nz = dz / d;
        a.pos.x -= nx * push; a.pos.z -= nz * push; b.pos.x += nx * push; b.pos.z += nz * push;
        // closing speed along the line between them
        const closing = (a.vel.x - b.vel.x) * nx + (a.vel.z - b.vel.z) * nz;
        if (closing > 6 && !a.slide && !b.slide && this.state === 'play') {
          // a hard shoulder-to-shoulder: the slower runner is pushed off balance
          const sa = a.vel.length(), sb = b.vel.length();
          const loser = sa < sb ? a : b, sgn = loser === a ? -1 : 1;
          loser.knock(new THREE.Vector3(nx * sgn, 0, nz * sgn), closing * 0.6);
          this.sfx.bump(closing);
        }
        // inelastic contact: whatever closing speed is left is shared out, so players lean
        // into and slide round each other instead of overlapping and jittering apart
        else if (closing > 0 && !a.slide && !b.slide && !a.dive && !b.dive) {
          const j = closing * 0.5;
          a.vel.x -= nx * j; a.vel.z -= nz * j; b.vel.x += nx * j; b.vel.z += nz * j;
        }
        a.vel.multiplyScalar(0.985); b.vel.multiplyScalar(0.985);
      }
    }
  }

  _updatePossession(dt) {
    const lt = this.ball.lastTouch;
    let p = null;
    // a pass on its way belongs to nobody, even while it's still near the passer
    const passing = lt && lt.passedTo && this.time - lt.lastTouchTime < 1.5 && this.ball.speed > 1.5;
    if (lt && !passing && this.ball.pos.y < 0.9 && this._distBall(lt) < 1.5 && this.time - lt.lastTouchTime < 1.2) p = lt;
    this.possessor = p;
    if (p && this.state === 'play') this.possession[p.team] += dt;
  }

  _updateCrowd(dt) {
    this.crowdT -= dt;
    if (this.crowdT > 0 || this.state !== 'play') return;
    this.crowdT = 0.5;
    const edge = Math.max(Math.abs(this.ball.pos.x), Math.abs(this.ball.pos.z));
    const near = 1 - clamp((H - edge) / 6, 0, 1);
    this.sfx.crowd(0.04 + near * 0.05, 1.2);
  }

  cycleCamera() { this.camMode = (this.camMode + 1) % CAM_MODES.length; this.ui.toast?.(`视角：${['斜视全景', '正上方俯视'][this.camMode]}`); }

  /**
   * The camera stays still during play so nobody gets dizzy: a fixed view that
   * frames the whole square pitch. `C` switches between a raised side view and
   * a straight-down view; both are fixed.
   */
  _updateCamera(dt) {
    dt = clamp(dt, 0, 0.1);
    const cam = this.camera;
    const aspect = cam.aspect;
    const pos = this._v, look = new THREE.Vector3();
    if (this.state === 'menu') {
      const t = this.time * 0.05;
      const S = H / 9;
      pos.set(Math.sin(t) * 19 * S, 8.5 * S, Math.cos(t) * 19 * S);
      look.set(0, 0.8, 0);
      const k = 1 - Math.exp(-dt * 2);
      this.camPos.lerp(pos, k); this.camLook.lerp(look, k);
    } else {
      // distance chosen so the pitch plus its goals fit the screen at this aspect
      const fit = Math.max(1, 1.62 / aspect) * (H / 9);
      if (CAM_MODES[this.camMode] === 'high') { pos.set(0, 27 * fit, 3.5 * fit); look.set(0, 0, 0.4); }
      else { pos.set(0, 17 * fit, 17.5 * fit); look.set(0, 0, 1.3); }
      // ease into the fixed spot when leaving the menu, then hold perfectly still
      const k = 1 - Math.exp(-dt * 4);
      this.camPos.lerp(pos, k); this.camLook.lerp(look, k);
    }
    if (window.__cam) { this.camPos.fromArray(window.__cam[0]); this.camLook.fromArray(window.__cam[1]); }
    cam.position.copy(this.camPos);
    this.shake = 0;
    cam.lookAt(this.camLook);
    cam.updateMatrixWorld();
  }

  // ================================================================ network ==
  /** host: apply a remote player's input */
  remoteInput(id, d) {
    const i = this.controllers.findIndex((c) => c.type === 'remote' && c.id === id);
    if (i < 0) return;
    const it = this.athletes[i].intent;
    it.move.set(d.m[0], d.m[1]); it.kick = !!d.kk; it.lob = !!d.l; it.sprint = !!d.s; it.tackle = !!d.t; it.pass = !!d.p;
  }

  /** host: a remote player left mid-game — a CPU takes over their goal */
  remoteLeft(id) {
    const i = this.controllers.findIndex((c) => c.type === 'remote' && c.id === id);
    if (i < 0) return;
    this.controllers[i] = { type: 'ai', ai: new AIController(this.athletes[i], this, this.settings.level, this.settings.level === 'gf') };
    this.athletes[i].label = TEAMS[i].cpuName;
    if (this.slots?.[i]) this.slots[i] = { kind: 'cpu', name: TEAMS[i].cpuName };
  }

  _sendSnapshot() {
    const r = (v, k = 100) => Math.round(v * k) / k;
    const b = this.ball, q = b.spinQ;
    const snap = {
      k: 's', t: r(this.time, 1000), st: this.state, al: this.alive.map((v, i) => (this.athletes[i].out ? 0 : v ? 1 : 2)), clk: r(this.clock, 10),
      c: this.conceded, sc: this.scored, lb: this.athletes.map((a) => a.label),
      b: [r(b.pos.x, 1000), r(b.pos.y, 1000), r(b.pos.z, 1000), r(b.vel.x), r(b.vel.y), r(b.vel.z), r(q.x, 1000), r(q.y, 1000), r(q.z, 1000), r(q.w, 1000)],
      a: this.athletes.map((a) => [
        r(a.pos.x, 1000), r(a.pos.z, 1000), r(a.vel.x), r(a.vel.z), r(a.facing, 1000),
        a.charging ? r(a.charge) : a.armed ? r(a.armed.power) : -1, r(a.stamina), a.exhausted ? 1 : 0,
        a.kick ? [r(a.kick.t, 1000), r(a.kick.dur, 1000), r(a.kick.aim.x, 1000), r(a.kick.aim.z, 1000), a.kick.hit ? 1 : 0, a.kick.approach ? 1 : 0, a.kick.type === 'chip' ? 1 : a.kick.type === 'pass' ? 2 : 0] : 0,
        a.touch ? [r(a.touch.t, 1000), r(a.touch.dur, 1000), a.touch.side === 'Left' ? 1 : 0] : 0,
        r(a.trapT, 1000), r(a.holdW), r(a.turnRate),
        (a.armed ? a.armed.type : a.chargeType) === 'pass' ? 2 : (a.armed ? a.armed.type : a.chargeType) === 'chip' ? 1 : 0,
      ]),
      ev: this.events,
    };
    this.events = [];
    this.net.broadcast(snap);
  }

  /** guest: receive data from the host */
  onHostData(d) {
    if (d.k === 's') {
      d.recv = performance.now() / 1000;
      this.snaps.push(d);
      if (this.snaps.length > 30) this.snaps.shift();
      for (const e of d.ev) this.pendingEvents.push(e);
      this.lb = d.lb;
    } else if (d.k === 'end') {
      this.ui.showEnd(this, d.res);
    }
  }

  /** guest: set up from the host's 'start' message */
  startGuest(msg, myId) {
    this.role = 'guest';
    this.settings = { ...this.settings, ...msg.settings };
    this.slots = msg.slots;
    this.side = msg.side || null;
    this.mySlot = msg.slots.findIndex((s) => s.id === myId);
    this.controllers = msg.slots.map((s, i) => (i === this.mySlot ? { type: 'self', scheme: 'solo' } : { type: 'net' }));
    this.athletes.forEach((a, i) => { a.label = msg.slots[i].name || TEAMS[i].cpuName; a.puppet = true; a.stats = { shots: 0, onTarget: 0, touches: 0 }; a.char.stopEmotes(); });
    this.snaps = []; this.pendingEvents = []; this.state = 'kickoff';
    this._resetElimination();
    this.conceded = TEAMS.map(() => 0); this.scored = TEAMS.map(() => 0);
    this.ui.onScore(this);
    this.inputT = 0;
  }

  _guestUpdate(dt) {
    // send my input
    const me = this.athletes[this.mySlot];
    if (me) {
      this.input.intent('solo', me.intent);
      this.inputT -= dt;
      const it = me.intent, sig = `${it.move.x.toFixed(2)},${it.move.y.toFixed(2)},${it.kick},${it.lob},${it.sprint},${it.tackle},${it.pass}`;
      if (this.inputT <= 0 || sig !== this._lastSig) {
        this.inputT = 0.05; this._lastSig = sig;
        this.net.toHost({ k: 'in', m: [+it.move.x.toFixed(2), +it.move.y.toFixed(2)], kk: it.kick ? 1 : 0, l: it.lob ? 1 : 0, s: it.sprint ? 1 : 0, t: it.tackle ? 1 : 0, p: it.pass ? 1 : 0 });
      }
    }
    const S = this.snaps;
    if (!S.length) { this._updateCamera(dt); return; }
    const newest = S[S.length - 1];
    const now = performance.now() / 1000;
    const renderT = newest.t + (now - newest.recv) - INTERP_DELAY;
    let s0 = S[0], s1 = S[0];
    for (let i = 0; i < S.length - 1; i++) if (S[i].t <= renderT && S[i + 1].t >= renderT) { s0 = S[i]; s1 = S[i + 1]; break; }
    if (renderT > newest.t) { s0 = s1 = newest; }
    const u = s1.t > s0.t ? clamp((renderT - s0.t) / (s1.t - s0.t), 0, 1) : 1;
    const L = (a, b) => a + (b - a) * u;
    const prevState = this.state;
    this.state = s1.st; this.clock = s1.clk;
    if (prevState === 'paused') this.state = 'paused';
    if (s1.c.join() !== this.conceded.join()) { this.conceded = s1.c.slice(); this.scored = s1.sc.slice(); this.ui.onScore(this); }
    if (s1.al) {
      let changed = false;
      s1.al.forEach((v, i) => {
        const alive = v === 1, out = v === 0;
        if (this.alive[i] !== alive) { this.alive[i] = alive; changed = true; }
        if (out && !this.athletes[i].out) this.eliminate(i);
      });
      if (changed) this.ui.onScore(this);
    }
    if (s1.lb) s1.lb.forEach((n, i) => { this.athletes[i].label = n; });
    // events whose time has come
    const due = [];
    this.pendingEvents = this.pendingEvents.filter((e) => (e.t <= renderT ? (due.push(e), false) : true));
    for (const e of due) this._applyEvent(e);
    // ball
    const b = this.ball, B0 = s0.b, B1 = s1.b;
    b.pos.set(L(B0[0], B1[0]), L(B0[1], B1[1]), L(B0[2], B1[2]));
    b.vel.set(B1[3], B1[4], B1[5]);
    const q0 = new THREE.Quaternion(B0[6], B0[7], B0[8], B0[9]), q1 = new THREE.Quaternion(B1[6], B1[7], B1[8], B1[9]);
    b.spinQ.slerpQuaternions(q0, q1, u);
    b.spin.set(0, 0, 0);
    b.sync(dt);
    // players
    this.athletes.forEach((a, i) => {
      const A0 = s0.a[i], A1 = s1.a[i];
      a.pos.set(L(A0[0], A1[0]), 0, L(A0[1], A1[1]));
      a.vel.set(A1[2], 0, A1[3]);
      let df = A1[4] - A0[4]; while (df > Math.PI) df -= Math.PI * 2; while (df < -Math.PI) df += Math.PI * 2;
      a.facing = A0[4] + df * u;
      a.charging = A1[5] >= 0; a.charge = Math.max(0, A1[5]);
      a.chargeType = A1[13] === 2 ? 'pass' : A1[13] === 1 ? 'chip' : 'kick';
      a.char.windup = a.charging ? a.charge : 0;
      a.stamina = A1[6]; a.exhausted = !!A1[7];
      const K = A1[8];
      if (K) {
        if (!a.kick) a.kick = { aim: new THREE.Vector3(), resolved: true };
        Object.assign(a.kick, { t: K[0], dur: K[1], contactT: K[1] * 0.33, hit: !!K[4], approach: K[5] ? true : null, type: K[6] === 1 ? 'chip' : K[6] === 2 ? 'pass' : 'kick' });
        a.kick.aim.set(K[2], 0, K[3]);
      } else a.kick = null;
      const T = A1[9];
      a.touch = T ? { t: T[0], dur: T[1], side: T[2] ? 'Left' : 'Right' } : null;
      a.trapT = A1[10]; a.holdW = A1[11]; a.turnRate = A1[12];
      a.char.lookTarget = b.pos;
      a._feet(dt);
      a._sync(dt);
    });
    this.pitch.update(dt, (this.time += dt));
    this.particles.update(dt);
    this.chargeFx.update(dt, this.athletes, this.time);
    this._updateCamera(dt);
    this.ui.updateHud(this);
  }

  _applyEvent(e) {
    switch (e.e) {
      case 'sfx': this.realSfx[e.n]?.(...(e.a || [])); break;
      case 'ch': { const c = this.athletes[e.i]?.char; if (c) c[e.m](...(e.a || [])); break; }
      case 'banner': this.ui.banner(e.big, e.small); break;
      case 'bulge': this.pitch.bulgeNet(e.team, new THREE.Vector3().fromArray(e.p), e.v); break;
      case 'cheer': this.pitch.cheer(0, 1); break;
      case 'shake': break;
      case 'fx': this.particles.burst({ x: e.p[0], y: e.p[1], z: e.p[2] }, { x: e.d[0], z: e.d[1] }, e.n, e.s, e.k); break;
      case 'sq': this.ball.squash({ x: e.d[0], y: e.d[1], z: e.d[2] }, e.a); break;
      case 'focus': this.focus = e.i >= 0 ? this.athletes[e.i] : null; break;
      case 'kickoff': for (const a of this.athletes) a.char.teleported(); this.focus = null; break;
    }
  }
}
