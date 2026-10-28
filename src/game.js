import * as THREE from 'three';
import { FIELD, TEAMS, MATCH, BALL, GOALS, SIDES, MAPS, CHAR, CHARS, setMap, randomChar, inOwnBox } from './config.js';
import { Pitch } from './pitch.js';
import { Ball } from './ball.js';
import { Character } from './character.js';
import { Athlete } from './athlete.js';
import { AIController } from './ai.js';
import { ChargeFx } from './chargefx.js';
import { Particles } from './fx.js';
import { SpecialFx } from './specials.js';
import { PowerFx } from './powerfx.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const CAM_MODES = ['broadcast', 'high', 'fp'];
const SFX_EVENTS = new Set(['kick', 'pass', 'touch', 'head', 'body', 'slide', 'bump', 'bounce', 'board', 'post', 'net', 'whistle', 'cheer', 'ooh', 'crowd', 'element', 'combo', 'device', 'shatter']);
const PART_OF = { thunder: 'bolt', blaze: 'fire', frost: 'ice', gale: 'wind', phantom: 'ghost', cannon: 'smoke' };
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
    this.template = template;
    this.realSfx = sfx;
    this.sfx = this._recordingSfx(sfx);
    this.goals = GOALS;
    this.pitch = new Pitch(scene);
    this._mapBuilt = true;            // the pitch is built for the current (classic) map
    this.ball = new Ball(scene, this.sfx);
    this.chargeFx = new ChargeFx(scene);
    this.particles = new Particles(scene);
    this.specialFx = new SpecialFx(scene, this.particles);
    this.powerFx = new PowerFx(scene);
    this.athletes = TEAMS.map((t, i) => {
      const ch = new Character(template, t.kit);
      scene.add(ch.group);
      const a = new Athlete(this, i, ch, t.cpuName);
      a.css = t.css;
      this._recordCharacter(a, i);
      return a;
    });
    this.roster4 = this.athletes; this.roster10 = null;
    this.m5 = false;              // 5v5 match: two sides of five, one goal each
    this.cursors = [];            // 5v5: which player each human is controlling
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

  get lives() { return FIELD.lives || MATCH.lives; }

  /** switch arena: physics tables, scenery, kickoff spots */
  applyMap(name) {
    if (!MAPS[name]) name = 'classic';
    if (FIELD.map === name && this._mapBuilt) return;
    setMap(name);
    this._mapBuilt = true;
    this.pitch.setMap();
    this.ball.reset(0, 0);
    for (const a of this.athletes) a.place(0, 0, 0);
    this.placeAll();
    this.onMapChange?.();
    this.ui.onMapChange?.(this);
  }
  get bigMap() { return !!FIELD.follow; }    // big arenas: follow camera + minimap
  activeGoal(team) { return this.m5 ? true : this.alive[team]; }
  /** is this goal one I mustn't score in (my own, or my team-mate's)? */
  friendlyGoal(ath, gt) { return this.m5 ? ath.end === gt : gt === ath.team || this.sameSide(ath.team, gt); }
  /** who's guarding this goal */
  keeperOf(gt) { return this.m5 ? this.athletes.find((a) => a.end === gt && a.role === 'gk') || null : this.athletes[gt] || null; }

  // ------------------------------------------------------------- 5v5 roster --
  _makeRoster10() {
    const NAMES = [['阿蓝', '海盐', '蓝鲸', '冰川', '天空', '蓝莓'], ['柿子', '南瓜', '芒果', '胡萝卜', '橙橙', '橘子']];
    const ROLES = ['gk', 'back', 'wingL', 'mid', 'wingR', 'fwd'];
    const NO = [['1', '4', '5', '8', '7', '10'], ['1', '3', '6', '8', '9', '11']];
    const list = [];
    for (let s = 0; s < 2; s++) for (let k = 0; k < ROLES.length; k++) {
      const t = TEAMS[s], gk = k === 0;
      const kit = { ...t.kit, no: NO[s][k], hair: null };
      if (gk) Object.assign(kit, s === 0 ? { shirt: '#2bd17e', number: '#ffffff' } : { shirt: '#ffd23f', number: '#2c2a33' });
      const ch = new Character(this.template, kit);
      this.scene.add(ch.group); ch.group.visible = false;
      const a = new Athlete(this, list.length, ch, NAMES[s][k]);
      a.gi = s; a.role = ROLES[k]; a.css = t.css; a.no = NO[s][k];
      this._recordCharacter(a, list.length);
      list.push(a);
    }
    return list;
  }

  /** swap the set of players on the pitch (4 for the free-for-all, 12 for 6v6) */
  setRoster(m5) {
    const want = m5 ? (this.roster10 || (this.roster10 = this._makeRoster10())) : this.roster4;
    if (this.athletes === want) return;
    for (const a of this.athletes) { a.char.group.visible = false; a.place(80, 80, 0); }
    this.athletes = want;
    for (const a of want) { a.char.group.visible = true; a.out = false; }
    this.ui.onRoster?.(this);
  }

  /** menu preview of a mode: the right map and the right number of players */
  previewMode(mode, map) {
    const m5 = mode === 'match5';
    this.setRoster(m5);
    this.m5 = m5;
    this.applyMap(m5 ? 'pitch5' : map || 'classic');
    this.side = m5 ? this.athletes.map((a) => a.gi) : null;
    this.placeAll();
    this.side = null;
  }
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
    if (this.m5) { this._place5(); return; }
    this.athletes.forEach((a, i) => {
      const g = GOALS[i];
      if (a.out) { a.place(60 + i * 3, 60, 0); return; }   // parked far off the pitch
      const k = FIELD.kickoff || 5;
      a.place(g.centre.x + g.inward.x * k, g.centre.z + g.inward.z * k, Math.atan2(g.inward.x, g.inward.z));
    });
  }

  /** 5v5 kickoff formation; the side kicking off has its striker on the ball */
  _place5() {
    const HX = FIELD.hx, HZ = FIELD.hz, kick = this.kickSide ?? 0;
    for (const a of this.athletes) {
      const s = a.gi, d = a.end === 0 ? 1 : -1;        // the side defending goal 0 attacks +x (ends change at half time)
      let x, z;
      switch (a.role) {
        case 'gk': x = -HX + 1.0; z = 0; break;
        case 'back': x = -HX * 0.6; z = 0; break;
        case 'wingL': x = -HX * 0.3; z = -HZ * 0.4; break;
        case 'wingR': x = -HX * 0.3; z = HZ * 0.4; break;
        case 'mid': x = s === kick ? -2.6 : -HX * 0.36; z = s === kick ? -0.6 : 0; break;
        default: x = s === kick ? -0.45 : -HX * 0.22; z = s === kick ? 0.12 : HZ * 0.22;
      }
      a.place(x * d, z * d, Math.atan2(d, 0));
    }
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
    this.m5 = this.settings.mode === 'match5';
    this.setRoster(this.m5);
    if (this.m5) { this._start5(); return; }
    this.applyMap(this.settings.map || 'classic');
    this.conceded = TEAMS.map(() => 0); this.scored = TEAMS.map(() => 0);
    this.possession = TEAMS.map(() => 0);
    this.clock = 0;
    this._resetElimination();
    for (const a of this.athletes) { a.stats = { shots: 0, onTarget: 0, touches: 0, tackles: 0, skills: 0, specials: 0 }; a.stamina = 1; a.char.stopEmotes(); a.skill = 1; a.speedMul = 1; a.energy = 0.35; a.iceT = 0; }
    let slots = this.settings.slots || this._localSlots(this.settings.humans);
    this.side = null;
    if (this.settings.mode === 'team') ({ slots, side: this.side } = this._assignTeams(slots, this.settings.pairing));
    this.slots = slots;
    this.controllers = slots.map((s, i) => {
      const a = this.athletes[i];
      a.label = s.name || TEAMS[i].cpuName;
      this._setChar(a, s.char || randomChar());
      if (s.kind === 'local') return { type: 'human', scheme: s.scheme };
      if (s.kind === 'remote') return { type: 'remote', id: s.id };
      return { type: 'ai', ai: new AIController(a, this, level, level === 'gf') };
    });
    const mode = this.settings.mode, map = FIELD.map;
    this.endShown = false;
    this.ui.onScore(this);
    this.kickoff();
    if (this.side) this.banner('2v2 组队', SIDES.map((s, k) => `${s.icon} ${s.name}：${this.athletes.filter((a) => this.side[a.team] === k).map((a) => a.label).join(' + ')}`).join('　'));
    if (this.role === 'host') this.net.broadcast({ k: 'start', settings: { level, duration, mode, map }, side: this.side, slots: slots.map(({ kind, name, id }) => ({ kind: kind === 'local' ? 'host' : kind, name, id })), chars: this.athletes.map((a) => a.charId) });
  }

  _setChar(a, id) { a.charId = CHAR[id] ? id : 'thunder'; a.char.setHair(a.charDef.hair); a.char.setStyle(a.charId); }

  /**
   * 5v5: humans each take a cursor on one side ('humans' pairing: all on blue; 'vs': alternate),
   * the rest of both sides are CPUs. A human's chosen character is their side's star striker.
   */
  _start5() {
    const { level } = this.settings;
    this.applyMap('pitch5');
    if (this.pitch.swapped) this.pitch.setMap(false);
    const A = this.athletes;
    this.side = A.map((a) => a.gi);
    this.conceded = [0, 0]; this.scored = A.map(() => 0); this.possession = A.map(() => 0);
    this.alive = A.map(() => true); this.outOrder = []; this.knockedBy = A.map(() => null);
    this.ball.closedGoals.clear();
    this.clock = this.settings.duration || MATCH.defaultDuration; this.golden = false;
    for (const a of A) { a.stats = { shots: 0, onTarget: 0, touches: 0, tackles: 0, skills: 0, specials: 0, goals: 0 }; a.stamina = 1; a.char.stopEmotes(); a.skill = 1; a.speedMul = 1; a.energy = 0.3; a.iceT = 0; a.out = false; }
    const humans = (this.settings.slots || this._localSlots(this.settings.humans)).filter((s) => s.kind === 'local' || s.kind === 'remote' || s.kind === 'host');
    const order = ['fwd', 'mid', 'wingL', 'wingR', 'back'];
    const used = [0, 0];
    this.cursors = humans.map((h, k) => {
      const side = this.settings.pairing === 'vs' ? k % 2 : 0;
      const role = order[used[side]++] || 'back';
      const a = A.find((x) => x.gi === side && x.role === role);
      return { kind: h.kind === 'remote' ? 'remote' : 'local', scheme: h.scheme || 'solo', id: h.id, name: h.name || `P${k + 1}`, side, idx: a.team, lastSwitch: -9, prevSwap: false, char: h.char };
    });
    // characters: every side fields all six elements, one each; the humans' picks go to the player
    // they start on (a second human on the same side picking a taken element gets a free one)
    for (const side of [0, 1]) {
      const pool = shuffle(CHARS.map((c) => c.id)), mine = A.filter((a) => a.gi === side), done = new Set();
      for (const c of this.cursors) {
        if (c.side !== side || !c.char) continue;
        const k = pool.indexOf(c.char); if (k < 0) continue;
        pool.splice(k, 1); this._setChar(A[c.idx], c.char); done.add(A[c.idx]);
      }
      for (const a of mine) if (!done.has(a)) this._setChar(a, pool.shift() || randomChar());
    }
    const humanSide = new Set(this.cursors.map((c) => c.side));
    this.ais = A.map((a) => new AIController(a, this, level, level === 'gf' && humanSide.has(a.gi)));
    // the humans' players aren't CPUs: full skill and speed (the AI made them its level)
    for (const c of this.cursors) { const a = A[c.idx]; a.speedMul = 1; a.skill = 1; }
    // twelve players on one pitch: everyone a bit slower, so it's football rather than a scrum
    for (const a of A) a.speedMul *= 0.84;
    // the big pitch is seen from further away: everyone a touch bigger so they still read
    for (const a of A) a.char.group.scale.setScalar(1.14);
    this.slots = A.map((a) => ({ kind: 'cpu', name: a.label }));
    this._applyCursors();
    this.endShown = false;
    this.ends = 0; this.half = 1;                 // two halves: the sides change ends at half time
    this.kickSide = this.firstKick = Math.random() < 0.5 ? 0 : 1;
    this.ui.onScore(this);
    this.kickoff();
    this.banner('6v6 比赛', `${TEAMS[0].cn}队 vs ${TEAMS[1].cn}队 · ${Math.round(this.clock / 60)} 分钟`);
    if (this.role === 'host') this.net.broadcast({ k: 'start', settings: { level, duration: this.settings.duration, mode: 'match5', map: 'pitch5' }, side: this.side,
      slots: this.slots, chars: A.map((a) => a.charId), cur: this._curSnap() });
  }

  _curSnap() { return this.cursors.map((c) => [c.kind === 'remote' ? c.id : (this.role === 'host' ? this.net?.id : null), c.idx, c.name]); }

  _applyCursors() {
    this.controllers = this.athletes.map((a, i) => {
      const c = this.cursors.find((x) => x.idx === i);
      if (c) return c.kind === 'remote' ? { type: 'remote', id: c.id, cursor: c } : { type: 'human', scheme: c.scheme, cursor: c };
      return { type: 'ai', ai: this.ais[i] };
    });
  }

  /** 5v5: hand each human the team-mate who should have the ball (or the one they asked for) */
  _updateCursors() {
    // like the other modes, each human keeps the same player for the whole match
    if (!this.m5 || !this.cursors.length || !this.allowSwitch) return;
    const A = this.athletes, b = this.ball.pos, holder = this.possessor;
    let changed = false;
    const dist = (a) => Math.hypot(b.x - a.pos.x, b.z - a.pos.z);
    for (const c of this.cursors) {
      const cur = A[c.idx], it = cur.intent;
      const swapPressed = !!it.swap && !c.prevSwap; c.prevSwap = !!it.swap;
      if (this.state !== 'play' && this.state !== 'kickoff' && this.state !== 'freekick') continue;
      if (cur.charging || cur.armed || cur.kick || cur.header || cur.slide || cur.trick || cur.dive) continue;
      // the goalkeeper always stays with the computer
      const mates = A.filter((a) => a.gi === c.side && a !== cur && a.role !== 'gk' && !this.cursors.some((o) => o !== c && o.idx === a.team));
      let to = null;
      if (holder && holder.gi === c.side && holder !== cur && mates.includes(holder)) to = holder;    // my pass arrived
      else if (swapPressed) to = mates.reduce((x, y) => (!x || dist(y) < dist(x) ? y : x), null);
      else if (this.state === 'play' && this.time - c.lastSwitch > 0.8 && !(holder && holder.gi === c.side) && this.time - cur.lastTouchTime > 0.6) {
        const best = mates.reduce((x, y) => (!x || dist(y) < dist(x) ? y : x), null);
        if (best && dist(best) < dist(cur) - 2.2) to = best;
      }
      if (to) {
        c.idx = to.team; c.lastSwitch = this.time; changed = true;
        this.ais[to.team].shooting = null;
        to.intent.kick = to.intent.lob = to.intent.pass = false; to._prevKick = to._prevLob = to._prevPass = true;
        if (swapPressed) this.sfx.touch();
      }
    }
    if (changed) this._applyCursors();
  }

  _localSlots(humans) {
    // keyboard: one player uses the whole keyboard, two split it; players 3-4 need gamepads
    const schemes = humans === 1 ? ['solo'] : humans === 2 ? ['p1', 'p2'] : ['p1', 'p2', 'pad0', 'pad1'];
    const chars = this.settings.chars || [];
    return TEAMS.map((t, i) => (i < humans ? { kind: 'local', scheme: schemes[i], name: humans === 1 ? 'YOU' : `P${i + 1}`, char: chars[i] } : { kind: 'cpu', name: t.cpuName }));
  }

  kickoff() {
    this.state = 'kickoff';
    this.timer = MATCH.kickoffDelay;
    this.ball.reset(0, 0);
    // every kickoff, each goal still in play is shielded again
    this.ball.shields = new Set(FIELD.shields ? GOALS.map((g) => g.team).filter((t) => this.alive[t]) : []);
    this.shieldBroken = {};
    this.pitch.setShields(this.ball.shields);
    this.possessor = null;
    this.placeAll();
    for (const x of this.athletes) { x.frozen = true; x.char.stopEmotes(); }
    this.banner('', '');
    this.emit({ e: 'kickoff' });
  }

  goal(team) {
    if (this.m5) { this._goal5(team); return; }
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
    if (!own) toucher.char.play(this._celebration());
    loser.char.play('deject');
    const livesLeft = this.lives - this.conceded[team];
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

  _goal5(goalIdx) {
    const team = goalIdx ^ (this.ends | 0);        // the side defending that goal (they change ends at half time)
    const toucher = this.ball.lastTouch, side = 1 - team;
    const own = !toucher || toucher.gi === team;
    this.conceded[team]++;
    if (!own) { this.scored[toucher.team]++; toucher.stats.goals = (toucher.stats.goals || 0) + 1; }
    this.state = 'goal'; this.timer = MATCH.goalPause;
    this.sfx.cheer(); this.sfx.net();
    this.pitch.cheer(goalIdx, 1); this.emit({ e: 'cheer' });
    this.focus = toucher || null;
    for (const a of this.athletes) {
      a.frozen = true; a.charging = false;
      if (a.gi === side && (a === toucher || Math.random() < 0.5)) a.char.play(this._celebration()); else if (a.gi === team && a.role === 'gk') a.char.play('deject');
    }
    const sc = `${TEAMS[0].cn} ${this.conceded[1]} : ${this.conceded[0]} ${TEAMS[1].cn}`;
    const who = own ? `${toucher ? toucher.label : ''} 乌龙球` : `${toucher.label} 为${TEAMS[side].cn}队进球`;
    this.banner(own ? '乌龙球！' : this.golden ? '金球绝杀！' : '进球！', `${who} · ${sc}`);
    this.kickSide = team;          // the side that conceded kicks off
    this.ui.onScore(this);
    this.emit({ e: 'focus', i: this.focus ? this.focus.team : -1 });
  }

  /** half time: a whistle, everyone stops, then the sides swap ends */
  _halfTime() {
    this.state = 'halftime'; this.timer = 2.6;
    this.sfx.whistle([0.3, 0.3]); this.sfx.crowd(0.25, 1.5);
    this.ball.vel.multiplyScalar(0.2); this.ball.endSpecial(); this.ball.passEls = null; this.ball.chain = null;
    for (const a of this.athletes) { a.frozen = true; a.charging = false; a.armed = null; }
    this.ui.toast?.('半场结束 · 交换场地');
    this.ui.onScore(this);
  }

  _celebration() { return ['celebrate', 'kneeSlide', 'airplane', 'fistPump'][Math.floor(Math.random() * 4)]; }

  _end5() {
    this.state = 'ended'; this.timer = 2.4;
    this.sfx.whistle([0.3, 0.3, 0.75]);
    const s0 = this.conceded[1], s1 = this.conceded[0];
    const win = s0 === s1 ? -1 : s0 > s1 ? 0 : 1;
    for (const a of this.athletes) { a.frozen = true; if (a.gi === win) a.char.play('celebrate'); else if (win >= 0) a.char.play('deject'); }
    this.banner(win < 0 ? '平局' : `${TEAMS[win].cn}队获胜！`, `全场比分 ${TEAMS[0].cn} ${s0} : ${s1} ${TEAMS[1].cn}`);
    this.sfx.cheer();
  }

  /** the last player standing wins */
  end() {
    if (this.m5) { this._end5(); return; }
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
    if (this.m5) {
      const tot = this.possession.reduce((s, x) => s + x, 0) || 1;
      const s0 = this.conceded[1], s1 = this.conceded[0];
      return { m5: true, score: [s0, s1], win: s0 === s1 ? -1 : s0 > s1 ? 0 : 1,
        players: this.athletes.map((a, i) => ({ i, side: a.gi, name: a.label, no: a.no, char: a.charId, goals: a.stats.goals || 0, shots: a.stats.shots, specials: a.stats.specials || 0,
          human: this.cursors.some((c) => c.side === a.gi), possession: Math.round((this.possession[i] / tot) * 100) }))
          .sort((p, q) => p.side - q.side || q.goals - p.goals || q.shots - p.shots) };
    }
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
    if (k.type === 'pass') { this.sfx.pass(k.power); return; }
    const p = k.power;
    if (k.type !== 'header') this.sfx.kick(p);
    if (p > 0.55 && k.type === 'kick') {
      this.hitstop = 0.035 + 0.04 * p; this.shake = Math.max(this.shake, 0.08 + 0.18 * p);
      this.emit({ e: 'shake', v: this.shake });
    }
    // a shot if the ball is heading for an opponent's goal mouth
    for (const g of GOALS) {
      if (this.friendlyGoal(ath, g.team)) continue;
      const A = g.axis, B = A === 'x' ? 'z' : 'x', line = g.sign * g.line;
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

  /** a character's skill move (过人) starts: its effects, here and on guests' screens */
  onPower(ath, kind) { this.powerFx.start(ath, kind); this.sfx.element(kind, 'move'); this.emit({ e: 'power', i: ath.team, k: kind }); }
  /** a slide tackle with the character's element (from = where a phantom blinked from) */
  onSlide(ath, kind, from) { this.powerFx.start(ath, 'slide:' + kind, { from }); this.sfx.element(kind, 'slide', 0.6); this.emit({ e: 'power', i: ath.team, k: 'slide:' + kind, f: from ? [from.x, from.z] : null }); }
  /** an impact flash at a player (cannon hits) */
  onImpact(ath, color) { this.powerFx.start({ pos: ath.pos.clone() }, 'hit', { color }); this.emit({ e: 'hit', p: [ath.pos.x, ath.pos.z], c: color }); }

  /** an element shot leaves the boot (c: comboOf(the move's elements) — or a character for old callers) */
  onSpecial(ath, c) {
    const ids = c.ids || [c.id], lv = c.level || 1;
    ath.stats.specials = (ath.stats.specials || 0) + 1;
    if (lv > 1) ath.stats.combos = (ath.stats.combos || 0) + 1;
    this.hitstop = Math.max(this.hitstop, 0.05); this.shake = Math.max(this.shake, lv > 1 ? 0.25 : 0.15); this.emit({ e: 'shake', v: 0.15 });
    this.sfx.kick(1); ids.forEach((id, k) => setTimeout(() => this.sfx.element(id, 'shot', k ? 0.75 : 1), k * 70));
    if (lv > 1) this.sfx.combo?.(lv >= 3 ? 3 : 2);
    this.sfx.crowd(lv > 1 ? 0.35 : 0.2, 0.6); this.sfx.ooh();
    for (const id of ids) this.fx(PART_OF[id], this.ball.pos, { x: 0, z: 0 }, Math.round(30 / Math.sqrt(ids.length)) + (lv > 1 ? 10 : 0), lv > 1 ? 7 : 5);
    if (lv > 1) this.onImpact({ pos: this.ball.pos }, CHAR[ids[0]].color);
    this.rumble(ath, 1, 220);
  }

  /**
   * A pass on its way bends gently towards the team-mate it was meant for (more so when that's a
   * human, who may have changed his run since it was played), so passes arrive where you are.
   */
  _passAssist(dt) {
    const b = this.ball, lt = b.lastTouch, r = lt && lt.passTarget;
    if (!r || r.out || b.heldBy || b.special || lt.passT < 0 || this.time - lt.passT > 2.4 || this.state !== 'play') return;
    const v = b.vel, sp = Math.hypot(v.x, v.z); if (sp < 2.5) return;
    const dx = r.pos.x - b.pos.x, dz = r.pos.z - b.pos.z, d = Math.hypot(dx, dz);
    if (d < 1.1) return;
    const t = d / sp, tx = dx + r.vel.x * t * 0.5, tz = dz + r.vel.z * t * 0.5;
    let diff = Math.atan2(tx, tz) - Math.atan2(v.x, v.z);
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    if (Math.abs(diff) > 0.8) return;                                   // gone past him / never his
    const isH = (a) => { const t = this.controllers[a.team]?.type; return t === 'human' || t === 'remote'; };
    const human = isH(r) || isH(lt);                                   // a human's pass, or a pass to a human
    const rate = (human ? 1.2 : 0.5) * dt, step = Math.max(-rate, Math.min(rate, diff));
    const c = Math.cos(step), s = Math.sin(step), vx = v.x * c + v.z * s, vz = -v.x * s + v.z * c;
    v.x = vx; v.z = vz;
  }

  /**
   * A pass carries the move's elements: an opponent who cuts it out feels them (a mild version) and
   * the ball spills off him; a team-mate just takes it.
   */
  _elemPassTick() {
    const b = this.ball; if (!b.passEls) return;
    const by = b.passBy, lt = b.lastTouch;
    if (!by || by.out || this.time - b.passAt > 2.5 || b.special || b.heldBy || this.state !== 'play') { b.passEls = null; return; }
    if (lt === by) { if (this.time - by.lastTouchTime > 0.05 && b.speed < 2) b.passEls = null; return; }
    if (lt && by._isOpp(lt)) {
      const els = b.passEls.split('+'), dir = new THREE.Vector3(lt.pos.x - by.pos.x, 0, lt.pos.z - by.pos.z).normalize();
      lt.elemHit(els, dir, { mild: true });
      lt.touchCD = Math.max(lt.touchCD, 0.4); lt.dribbling = false;
      for (const k of els) this.fx(PART_OF[k], { x: lt.pos.x, y: 0.9, z: lt.pos.z }, { x: dir.x, z: dir.z }, 12, 3);
      this.sfx.element(els[0], 'hit', 0.5);
      this.emit({ e: 'zap', i: lt.team, k: els.includes('frost') ? 'frost' : els[0], d: [dir.x, dir.z] });
    }
    b.passEls = null;
  }


  /**
   * 越位 (6v6): standing in the opponents' half, ahead of the ball and of the second-last opponent
   * (level counts as onside, with a little leeway). Goalkeepers are never offside.
   */
  offsidePos(a) {
    if (!this.m5 || !a || a.isKeeper || a.out) return false;
    const s = -GOALS[a.end].sign, f = a.pos.x * s, tol = 0.35;     // s: the way this side attacks along x
    if (f <= tol || f <= this.ball.pos.x * s + tol) return false;
    let l1 = -Infinity, l2 = -Infinity;
    for (const o of this.live) { if (o.gi === a.gi) continue; const v = o.pos.x * s; if (v > l1) { l2 = l1; l1 = v; } else if (v > l2) l2 = v; }
    return f > l2 + tol;
  }

  /**
   * Every time the ball is played, note which of the player's team-mates are offside at that moment;
   * if the next touch is one of them, it's offside and the defending side gets an indirect free kick.
   */
  _offsideTick() {
    if (!this.m5 || this.state !== 'play') { this._offT = null; return; }
    const lt = this.ball.lastTouch; if (!lt) return;
    const prev = this._offT, t = lt.lastTouchTime;
    if (prev && prev.by === lt && prev.t === t) return;            // nothing new
    if (prev && lt !== prev.by && lt.gi === prev.by.gi && prev.set.has(lt)) { this._offside(lt); return; }
    const set = new Set();
    for (const m of this.live) if (m !== lt && m.gi === lt.gi && this.offsidePos(m)) set.add(m);
    this._offT = { by: lt, t, set };
  }

  _offside(q) {
    this._offT = null;
    this.offsides = (this.offsides || 0) + 1;
    q.stats.offsides = (q.stats.offsides || 0) + 1;
    this.sfx.whistle([0.22, 0.22]);
    q.flair('越位!', true);
    this.ui.toast?.(`越位 · ${q.label}`);
    this._freeKick(1 - q.gi, q.pos.x, q.pos.z);
  }

  /** an indirect free kick where the foul was: the nearest defender on the ball, the other side 4 m off */
  _freeKick(side, x, z) {
    const HX = FIELD.hx, HZ = FIELD.hz;
    x = clamp(x, -HX + 1.2, HX - 1.2); z = clamp(z, -HZ + 1.2, HZ - 1.2);
    const b = this.ball; b.endSpecial?.(); b.reset(x, z);
    this.possessor = null; this.idleT = 0;
    const takers = this.live.filter((a) => a.gi === side);
    const inBox = takers.find((a) => a.isKeeper && inOwnBox(a.end, x, z));
    let taker = inBox || null, bd = Infinity;
    if (!taker) for (const a of takers) { if (a.isKeeper) continue; const d = Math.hypot(a.pos.x - x, a.pos.z - z); if (d < bd) { bd = d; taker = a; } }
    for (const a of this.live) {
      let px = a.pos.x, pz = a.pos.z;
      if (a === taker) {
        const d = -GOALS[a.end].sign;                          // stand behind the ball, facing up the pitch
        px = x - d * 0.9; pz = z;
      } else if (a.gi !== side) {
        const dx = px - x, dz = pz - z, dd = Math.hypot(dx, dz);
        if (dd < 4) { const k = dd > 0.01 ? 4 / dd : 0; px = dd > 0.01 ? x + dx * k : x + (GOALS[a.end].sign > 0 ? 4 : -4); pz = dd > 0.01 ? z + dz * k : z; }
      }
      px = clamp(px, -HX + 0.8, HX - 0.8); pz = clamp(pz, -HZ + 0.8, HZ - 0.8);
      a.place(px, pz, a === taker ? Math.atan2(-GOALS[a.end].sign, 0) : a.facing);
      a.frozen = true; a.dribbling = false;
    }
    this.state = 'freekick'; this.timer = 1.1;
    this.emit({ e: 'kickoff' });
  }

  /** released a shot in the sweet window */
  onPerfect(ath) { this.emit({ e: 'perfect', i: ath.team }); this.sfx.touch(); }

  // ---------------------------------------------------------------- update --
  update(rawDt) {
    const input = this.input;
    if (input.wasPressed('KeyC')) this.cycleCamera();
    if (input.wasPressed('KeyM')) this.ui.toggleMute();
    if (this.role === 'local' && (input.wasPressed('Escape') || input.wasPressed('KeyP')) && ['play', 'kickoff', 'freekick', 'goal', 'halftime', 'paused'].includes(this.state)) this.ui.togglePause();
    if (this.role === 'guest') { this._guestUpdate(rawDt); return; }
    if (this.state === 'paused') { this._updateCamera(rawDt); return; }

    let dt = rawDt;
    if (this.hitstop > 0) { this.hitstop -= rawDt; dt = rawDt * 0.08; }
    if (this.slowmo > 0) { this.slowmo -= rawDt; dt *= 0.3 + 0.7 * clamp(1 - this.slowmo / 1.1, 0, 1) ** 2; }
    this.time += dt;

    this.controllers.forEach((c, i) => {
      const a = this.athletes[i];
      if (a.out) return;
      if (c.type === 'human') { input.intent(c.scheme, a.intent); this._fpMove(a); }
      else if (c.type === 'ai') c.ai.update(dt);
      // remote intents are written by the network handler
    });
    if (this.state === 'menu' || this.state === 'ended') for (const a of this.athletes) { a.intent.move.set(0, 0); a.intent.kick = a.intent.lob = a.intent.sprint = a.intent.pass = false; }
    this._updateCursors();

    if (this.state === 'kickoff' || this.state === 'freekick') {
      this.timer -= rawDt;
      if (this.timer <= 0) { this.state = 'play'; for (const a of this.athletes) a.frozen = false; this.sfx.whistle([0.45]); }
    } else if (this.state === 'play') {
      if (this.m5) {
        if (!this.golden) {
          this.clock = Math.max(0, this.clock - dt);
          if (this.half === 1 && this.clock <= (this.settings.duration || MATCH.defaultDuration) / 2 && this.clock > 0) this._halfTime();
          else if (this.clock <= 0) {
            if (this.conceded[0] !== this.conceded[1]) this.end();
            else { this.golden = true; this.banner('金球加时', '平局！下一个进球直接获胜'); this.sfx.whistle([0.3, 0.3]); }
          }
        }
      } else this.clock += dt;
      // how long the ball has been sitting dead (used by the CPUs to unstick play)
      this.idleT = this.ball.speed < 0.15 && !this.possessor ? (this.idleT || 0) + dt : 0;
      // a broken shield grows back if nobody scores on that goal in time
      if (FIELD.shields && this.shieldBroken) {
        for (const g of GOALS) {
          const t = g.team, at = this.shieldBroken[t];
          if (at === undefined || this.ball.shields.has(t) || !this.alive[t]) continue;
          const dLine = g.line - g.sign * (g.axis === 'x' ? this.ball.pos.x : this.ball.pos.z);
          if (this.time - at > 12 && dLine > 1) {
            this.ball.shields.add(t); this.pitch.setShields(this.ball.shields);
            this.sfx.post(4);
            delete this.shieldBroken[t];
          }
        }
      }
    } else if (this.state === 'halftime') {
      this.timer -= rawDt;
      if (this.timer <= 0) {
        // second half: change ends, the other side kicks off
        this.ends = 1; this.half = 2; this.kickSide = 1 - (this.firstKick ?? 0);
        this.pitch.setMap(true);                      // the goals take the colours of the sides now defending them
        this.kickoff();
      }
    } else if (this.state === 'goal') {
      this.timer -= rawDt;
      if (this.timer <= 0) {
        // the knocked-out player leaves and their goal is boarded up
        if (this.m5) { if (this.golden || this.clock <= 0) this.end(); else this.kickoff(); }
        else {
          for (let i = 0; i < this.alive.length; i++) if (!this.alive[i] && !this.athletes[i].out) this.eliminate(i);
          if (this._standing() <= 1) this.end(); else this.kickoff();
        }
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

    if (this.state !== 'kickoff' && this.state !== 'freekick') {
      const order = [...live].sort((p, q) => this._distBall(q) - this._distBall(p));
      for (const a of order) a.handleBall(dt);
      this._passAssist(dt);
      this.ball.colliders = live.flatMap((a) => (a.colliders || []).filter((c) => c.active));
      const p0 = this._bp0 || (this._bp0 = new THREE.Vector3()); p0.copy(this.ball.pos);
      const events = this.ball.update(dt);
      for (const e of events) this._ballEvent(e);
      if (this.m5) for (const a of live) if (a.isKeeper) a.saveCheck(p0);
      this._elemPassTick();
      this._offsideTick();
    } else this.ball.sync(dt);

    this._updatePossession(dt);
    this._trails(dt, true);
    this.pitch.update(dt, this.time);
    this.particles.update(dt);
    this.chargeFx.update(rawDt, this.athletes, this.time, this);
    this.specialFx.update(rawDt, this);
    this.powerFx.update(rawDt, this.camera.position);
    this._updateCrowd(rawDt);
    this._updateCamera(rawDt);
    this.ui.updateHud(this);

    if (this.role === 'host') {
      this.snapT -= rawDt;
      if (this.snapT <= 0) { this.snapT = SNAP_INTERVAL; this._sendSnapshot(); }
    }
  }

  /**
   * Fire and ice left behind by sprinting (blaze / frost). Runs on guests too, for the looks;
   * only the host applies what they do: fire scorches opponents out of the way, ice takes their grip.
   */
  _trails(dt, host) {
    const P = this.patches || (this.patches = []);
    for (const a of this.athletes) {
      if (a.out || !a.sprinting || (a.charId !== 'blaze' && a.charId !== 'frost')) { a._trailAt = null; continue; }
      const L = a._trailAt;
      if (!L || Math.hypot(a.pos.x - L.x, a.pos.z - L.z) > 0.5) {
        a._trailAt = { x: a.pos.x, z: a.pos.z };
        P.push({ x: a.pos.x, z: a.pos.z, kind: a.charId === 'blaze' ? 'fire' : 'ice', life: a.charId === 'blaze' ? 1.5 : 2.6, max: a.charId === 'blaze' ? 1.5 : 2.6, owner: a });
      }
    }
    for (const p of P) p.life -= dt;
    this.patches = P.filter((p) => p.life > 0);
    if (host && this.state === 'play') {
      for (const p of this.patches) for (const o of this.live) {
        if (!p.owner._isOpp(o) || o.air) continue;
        const dx = o.pos.x - p.x, dz = o.pos.z - p.z, d = Math.hypot(dx, dz);
        if (d > 0.6) continue;
        if (p.kind === 'ice') o.slipT = 0.4;
        else if ((o.burnCD || 0) <= 0 && o.stunT <= 0) {
          o.burnCD = 1.2;
          const v = Math.hypot(o.vel.x, o.vel.z), away = v > 0.5 ? new THREE.Vector3(-o.vel.x / v, 0, -o.vel.z / v) : new THREE.Vector3(dx / (d || 1), 0, dz / (d || 1));
          o.knock(away, 5); o.vel.copy(away).multiplyScalar(4);
          this.fx('fire', { x: o.pos.x, y: 0.6, z: o.pos.z }, { x: 0, z: 0 }, 14, 2.5);
          this.sfx.body(8);
        }
      }
    }
    this.powerFx.trails?.(this.patches, this.athletes, dt);
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
      case 'zap': {
        const a = e.who, dir = new THREE.Vector3(e.n[0], 0, e.n[2]), els = e.els || [e.kind];
        a.elemHit(els, dir, e);
        for (const k of els) this.fx(PART_OF[k] || 'spark', { x: a.pos.x, y: 1.0, z: a.pos.z }, { x: dir.x, z: dir.z }, e.mild ? 10 : Math.round(22 / Math.sqrt(els.length)) + 4, 4);
        this.sfx.body(e.mild ? 8 : 14); for (const k of els.slice(0, 3)) this.sfx.element(k, 'hit', e.mild ? 0.45 : 0.8);
        if (e.blast) { this.onImpact(a, 0xff7a2a); this.shake = Math.max(this.shake, 0.35); }
        this.shake = Math.max(this.shake, e.mild ? 0.06 : 0.15);
        this.emit({ e: 'zap', i: a.team, k: els.includes('frost') ? 'frost' : els[0], d: [dir.x, dir.z] });
        break;
      }
      case 'teleport': {
        // 雷+影: a flash where the ball vanishes, another where it lands in the net
        const p = e.from || e.to;
        this.powerFx.start({ pos: new THREE.Vector3(p[0], 0, p[2]) }, 'hit', { color: 0xb58cff });
        this.fx('ghost', { x: p[0], y: p[1], z: p[2] }, { x: 0, z: 0 }, 24, 4); this.fx('bolt', { x: p[0], y: p[1], z: p[2] }, { x: 0, z: 0 }, 16, 4);
        this.emit({ e: 'hit', p: [p[0], p[2]], c: 0xb58cff });
        this.sfx.element('phantom', 'shot', 0.8); this.sfx.element('thunder', 'hit', 0.7);
        break;
      }
      case 'squash': this.squashBall({ x: e.n[0], y: e.n[1], z: e.n[2] }, e.a); break;
      case 'shield':
        (this.shieldBroken || (this.shieldBroken = {}))[e.team] = this.time;
        this.sfx.shatter(); this.sfx.board(16); this.sfx.ooh();
        this.shake = Math.max(this.shake, 0.12);
        this.pitch.breakShield(e.team);
        this.emit({ e: 'shield', t: e.team });
        for (let k = -2; k <= 2; k++) {
          const g = GOALS[e.team], A = g.axis;
          const p = { x: e.x, y: e.y, z: e.z }; if (A === 'x') p.z += k * 0.6; else p.x += k * 0.6;
          this.fx('spark', p, { x: g.inward.x, z: g.inward.z }, 6, 4);
        }
        this.banner('护盾碎了！', `${this.athletes[e.team].label} 的球门现在没有保护`);
        break;
      case 'bumper': this.sfx.device('bumper', e.v); this.pitch.pulse('bumper', e.x, e.z); this.emit({ e: 'pulse', k: 'bumper', x: e.x, z: e.z }); this.shake = Math.max(this.shake, 0.05); break;
      case 'spring': this.sfx.device('spring', e.v); this.pitch.pulse('spring', e.x, e.z); this.emit({ e: 'pulse', k: 'spring', x: e.x, z: e.z }); break;
      case 'portal':
        this.sfx.device('portal', e.v);
        this.pitch.pulse('portal', e.from[0], e.from[1]); this.pitch.pulse('portal', e.to[0], e.to[1]);
        this.emit({ e: 'pulse', k: 'portal', x: e.from[0], z: e.from[1] }); this.emit({ e: 'pulse', k: 'portal', x: e.to[0], z: e.to[1] });
        this.fx('grass', this.ball.pos, { x: 0, z: 0 }, 8, 2);
        break;
      case 'boost': this.sfx.device('boost', e.v); this.pitch.pulse('boost', e.x, e.z); this.emit({ e: 'pulse', k: 'boost', x: e.x, z: e.z }); this.shake = Math.max(this.shake, 0.04); break;
      case 'vortex': this.sfx.device('vortex'); this.pitch.pulse('vortex', e.x, e.z); this.emit({ e: 'pulse', k: 'vortex', x: e.x, z: e.z }); break;
      case 'wheel': this.sfx.device('wheel'); this.pitch.pulse('wheel', e.x, e.z); this.emit({ e: 'pulse', k: 'wheel', x: e.x, z: e.z }); break;
      case 'body': {
        const a = e.who;
        if (this.m5 && a.tryCatch(e.part, e.v)) break;
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
      if ((a.power && a.power.type !== 'cannon') || (b.power && b.power.type !== 'cannon')) continue;   // dashing / flying / teleporting past
      if (a.ghost || b.ghost || a.air || b.air) continue;                                                // phantom sprint: straight through people
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
          const push = new THREE.Vector3(nx * sgn, 0, nz * sgn);
          if (closing > 9) loser.fall(push, closing * 0.6); else loser.knock(push, closing * 0.6);
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
    // louder when the ball is near any goal
    const near = 1 - clamp(Math.min(...GOALS.map((g) => Math.hypot(this.ball.pos.x - g.centre.x, this.ball.pos.z - g.centre.z))) / 6 - 0.3, 0, 1);
    this.sfx.crowd(0.04 + near * 0.05, 1.2);
  }

  cycleCamera() { this.camMode = (this.camMode + 1) % CAM_MODES.length; this.ui.toast?.(`视角：${['斜视全景', '正上方俯视', '第一人称'][this.camMode]}`); }

  /** the player I'm controlling (for the first-person view) */
  _myAthlete() {
    if (this.m5) { const c = (this.cursors || []).find((q) => q.kind === 'local'); if (c && this.athletes[c.idx]) return this.athletes[c.idx]; }
    const i = this.controllers.findIndex((c) => c.type === 'human' || c.type === 'self');
    return i >= 0 ? this.athletes[i] : null;
  }

  /** first person: stick directions are relative to where I'm looking */
  _fpMove(a) {
    if (this.fpAth !== a || this._fpYaw == null) return;
    const m = a.intent.move; if (m.lengthSq() < 1e-4) return;
    const fx = Math.sin(this._fpYaw), fz = Math.cos(this._fpYaw);
    const wx = fx * -m.y - fz * m.x, wz = fz * -m.y + fx * m.x;
    m.set(wx, wz);
  }

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
    // first person (C cycles to it): from my player's eyes; everything else is a fixed camera
    const fpA = CAM_MODES[this.camMode] === 'fp' && this.state !== 'menu' ? this._myAthlete() : null;
    const fp = fpA && !fpA.out ? fpA : null;
    if (this._fpHidden && this._fpHidden !== fp) { this._fpHidden.char.group.visible = !this._fpHidden.out; this._fpHidden = null; }
    this.fpAth = fp;
    const fov = fp ? 78 : 38, near = fp ? 0.05 : 0.1;
    if (cam.fov !== fov || cam.near !== near) { cam.fov = fov; cam.near = near; cam.updateProjectionMatrix(); }
    if (!fp) this._fpYaw = null;
    if (fp) {
      const a = fp, sy = a.char.group.scale.y || 1;
      fp.char.group.visible = false; this._fpHidden = fp;      // my own body would sit right in front of the lens
      if (this._fpYaw == null || this._fpLast !== a) { this._fpYaw = a.facing; this._fpLast = a; }
      // the view turns after my body, eased, so a quick turn doesn't whip it round
      const dyaw = Math.atan2(Math.sin(a.facing - this._fpYaw), Math.cos(a.facing - this._fpYaw));
      this._fpYaw += dyaw * (1 - Math.exp(-dt * 3.2));
      const fx = Math.sin(this._fpYaw), fz = Math.cos(this._fpYaw);
      const eye = 1.55 * sy + Math.max(0, a.char.group.position.y);
      pos.set(a.pos.x + fx * 0.1, eye, a.pos.z + fz * 0.1);
      look.set(pos.x + fx * 10, eye - 3.1, pos.z + fz * 10);       // tipped ~17° down so the ball at my feet is in view
      this.camPos.copy(pos); this.camLook.copy(look);
    } else if (this.state === 'menu') {
      const t = this.time * 0.05;
      const S = (this.bigMap ? FIELD.hx * 0.8 : FIELD.half) / 9;
      pos.set(Math.sin(t) * 19 * S, 8.5 * S, Math.cos(t) * 19 * S);
      look.set(0, 0.8, 0);
      const k = 1 - Math.exp(-dt * 2);
      this.camPos.lerp(pos, k); this.camLook.lerp(look, k);
    } else if (this.bigMap) {
      // big map: follow my own player(s) and the ball, zooming out as they spread apart
      const pts = [];
      this.controllers.forEach((c, i) => { const a = this.athletes[i]; if (!a.out && (c.type === 'human' || c.type === 'self')) pts.push(a.pos); });
      const b = this.ball.pos;
      let minX, maxX, minZ, maxZ;
      if (pts.length) {
        minX = Math.min(...pts.map((p) => p.x)); maxX = Math.max(...pts.map((p) => p.x));
        minZ = Math.min(...pts.map((p) => p.z)); maxZ = Math.max(...pts.map((p) => p.z));
        // the ball pulls the view towards it, but never so far that I leave the screen
        const bx = clamp(b.x, minX - 9, maxX + 9), bz = clamp(b.z, minZ - 6, maxZ + 6);
        minX = Math.min(minX, bx); maxX = Math.max(maxX, bx); minZ = Math.min(minZ, bz); maxZ = Math.max(maxZ, bz);
      } else { minX = -FIELD.hx; maxX = FIELD.hx; minZ = -FIELD.hz; maxZ = FIELD.hz; }
      const ex = (maxX - minX) / 2 + 4.5, ez = (maxZ - minZ) / 2 + 3.5;
      const fit = Math.max(ez / 9, (ex / 9) * (1.62 / aspect), 9.5 / 9);
      let cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
      cx = clamp(cx, -FIELD.hx + 6, FIELD.hx - 6); cz = clamp(cz, -FIELD.hz + 4, FIELD.hz - 4);
      if (CAM_MODES[this.camMode] === 'high') { pos.set(cx, 27 * fit, cz + 3.5 * fit); look.set(cx, 0, cz + 0.4); }
      else { pos.set(cx, 17 * fit, cz + 17.5 * fit); look.set(cx, 0, cz + 1.3); }
      const k = 1 - Math.exp(-dt * (this._camWarm ? 2.6 : 6));
      this._camWarm = true;
      this.camPos.lerp(pos, k); this.camLook.lerp(look, k);
    } else {
      // distance chosen so the pitch plus its goals fit the screen at this aspect
      // fit the whole pitch (it may be a long rectangle) plus its goals at this aspect
      const high = CAM_MODES[this.camMode] === 'high';
      if (this.m5) {
        // the big pitch fills the whole screen, edge to edge (still a fixed camera)
        const f = this._fillCam(high, aspect);
        pos.copy(f.pos); look.copy(f.look);
      } else {
        const fit = FIELD.hx > FIELD.hz ? Math.max(FIELD.hz / 9, (FIELD.hx / 9) * (1.42 / aspect)) : Math.max(1, 1.62 / aspect) * (FIELD.half / 9);
        if (high) { pos.set(0, 27 * fit, 3.5 * fit); look.set(0, 0, 0.4); }
        else { pos.set(0, 17 * fit, 17.5 * fit); look.set(0, 0, 1.3); }
      }
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

  /**
   * A fixed camera as close as it can be while the whole pitch (boards and goals) stays on screen:
   * slide the look point until the pitch sits centred, pull in until its edges touch the frame.
   */
  _fillCam(high, aspect) {
    const key = `${high}|${aspect.toFixed(3)}|${FIELD.hx}|${FIELD.hz}`;
    if (this._fillKey === key) return this._fill;
    const cam = this.camera.clone(); cam.aspect = aspect; cam.updateProjectionMatrix();
    const X = FIELD.hx + 0.9, Z = FIELD.hz + 0.25, pts = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, 0.7]) pts.push(new THREE.Vector3(sx * X, y, sz * Z));
    for (const sx of [-1, 1]) pts.push(new THREE.Vector3(sx * (FIELD.hx + 1.1), FIELD.goalH, 0));
    const q = new THREE.Vector3(), up = new THREE.Vector3();
    const span = (dir, d, lz) => {
      cam.position.copy(dir).multiplyScalar(d); cam.position.z += lz; cam.lookAt(0, 0, lz); cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      for (const p of pts) { q.copy(p).project(cam); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
      return { x0, x1, y0, y1 };
    };
    const fit = (dir) => {
      let lo = 5, hi = 250, lz = 0;
      for (let it = 0; it < 32; it++) {
        const d = (lo + hi) / 2;
        for (let k = 0; k < 5; k++) { const s = span(dir, d, lz); lz -= ((s.y0 + s.y1) / 2) * d * 0.25; }
        const s = span(dir, d, lz);
        if (Math.max(-s.x0, s.x1, -s.y0, s.y1) > 0.99) lo = d; else hi = d;
      }
      for (let k = 0; k < 5; k++) { const s = span(dir, hi, lz); lz -= ((s.y0 + s.y1) / 2) * hi * 0.25; }
      const s = span(dir, hi, lz);
      return { d: hi, lz, area: ((s.x1 - s.x0) * (s.y1 - s.y0)) / 4 };
    };
    // the camera tilt: as low (side-on) as possible while the pitch still fills the screen both
    // ways; the overhead view is simply steeper
    let best = null;
    for (let deg = high ? 70 : 44; deg <= (high ? 84 : 62); deg += 2) {
      const r = (deg * Math.PI) / 180, dir = up.set(0, Math.sin(r), Math.cos(r)).clone();
      const f = fit(dir); f.dir = dir;
      if (!best || f.area > best.area + 0.015) best = f;
    }
    this._fill = { pos: best.dir.clone().multiplyScalar(best.d).add(new THREE.Vector3(0, 0, best.lz)), look: new THREE.Vector3(0, 0, best.lz) };
    this._fillKey = key;
    return this._fill;
  }

  // ================================================================ network ==
  /** host: apply a remote player's input */
  remoteInput(id, d) {
    const i = this.controllers.findIndex((c) => c.type === 'remote' && c.id === id);
    if (i < 0) return;
    const it = this.athletes[i].intent;
    it.move.set(d.m[0], d.m[1]); it.kick = !!d.kk; it.lob = !!d.l; it.sprint = !!d.s; it.tackle = !!d.t; it.pass = !!d.pa; it.analog = !!d.an; it.swap = false;
  }

  /** host: a remote player left mid-game — a CPU takes over their goal */
  remoteLeft(id) {
    if (this.m5) { this.cursors = this.cursors.filter((c) => !(c.kind === 'remote' && c.id === id)); this._applyCursors(); return; }
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
      c: this.conceded, sc: this.scored, lb: this.athletes.map((a) => a.label), sh: [...this.ball.shields],
      en: this.ends | 0, hf: this.half || 1, bs: this.ball.specialType || 0, pe: this.ball.passEls || 0, bh: this.ball.hidden ? 1 : 0, gold: this.golden ? 1 : 0, cur: this.m5 ? this._curSnap() : 0,
      b: [r(b.pos.x, 1000), r(b.pos.y, 1000), r(b.pos.z, 1000), r(b.vel.x), r(b.vel.y), r(b.vel.z), r(q.x, 1000), r(q.y, 1000), r(q.z, 1000), r(q.w, 1000)],
      a: this.athletes.map((a) => [
        r(a.pos.x, 1000), r(a.pos.z, 1000), r(a.vel.x), r(a.vel.z), r(a.facing, 1000),
        a.charging ? r(a.charge) : a.armed ? r(a.armed.power) : -1, r(a.stamina), a.exhausted ? 1 : 0,
        a.kick ? [r(a.kick.t, 1000), r(a.kick.dur, 1000), r(a.kick.aim.x, 1000), r(a.kick.aim.z, 1000), a.kick.hit ? 1 : 0, a.kick.approach ? 1 : 0, a.kick.type === 'chip' ? 1 : a.kick.type === 'pass' ? 2 : 0] : 0,
        a.touch ? [r(a.touch.t, 1000), r(a.touch.dur, 1000), a.touch.side === 'Left' ? 1 : 0] : 0,
        r(a.trapT, 1000), r(a.holdW), r(a.turnRate),
        (a.armed ? a.armed.type : a.chargeType) === 'pass' ? 2 : (a.armed ? a.armed.type : a.chargeType) === 'chip' ? 1 : 0,
        r(a.energy), a.sprinting ? 1 : 0, a.air ? [r(a.air.y), r(a.air.rot)] : 0,
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
    this.m5 = this.settings.mode === 'match5';
    this.setRoster(this.m5);
    this.applyMap(this.m5 ? 'pitch5' : this.settings.map || 'classic');
    this.slots = msg.slots;
    this.side = msg.side || null;
    this.myId = myId;
    this.mySlot = this.m5 ? (msg.cur || []).find((c) => c[0] === myId)?.[1] ?? -1 : msg.slots.findIndex((s) => s.id === myId);
    this._guestControllers();
    if (msg.chars) msg.chars.forEach((c, i) => this.athletes[i] && this._setChar(this.athletes[i], c));
    if (this.m5) { this.conceded = [0, 0]; this.golden = false; this._curNames = msg.cur || []; for (const a of this.athletes) a.char.group.scale.setScalar(1.14); }
    this.athletes.forEach((a, i) => { a.label = msg.slots[i].name || TEAMS[i].cpuName; a.puppet = true; a.stats = { shots: 0, onTarget: 0, touches: 0, tackles: 0, skills: 0 }; a.char.stopEmotes(); });
    this.snaps = []; this.pendingEvents = []; this.state = 'kickoff';
    this._resetElimination();
    if (!this.m5) { this.conceded = TEAMS.map(() => 0); } else { this.alive = this.athletes.map(() => true); }
    this.scored = this.athletes.map(() => 0);
    this.ui.onScore(this);
    this.inputT = 0;
  }

  _guestControllers() {
    const names = this.m5 ? new Map((this._curNames || []).map((c) => [c[1], c[2]])) : null;
    this.controllers = this.athletes.map((_, i) => (i === this.mySlot ? { type: 'self', scheme: 'solo' } : { type: 'net', cursorName: names?.get(i) }));
  }

  _guestUpdate(dt) {
    // send my input
    const me = this.athletes[this.mySlot];
    if (me) {
      this.input.intent('solo', me.intent);
      this.inputT -= dt;
      const it = me.intent, sig = `${it.move.x.toFixed(2)},${it.move.y.toFixed(2)},${it.kick},${it.lob},${it.sprint},${it.tackle},${it.analog},${it.pass}`;
      if (this.inputT <= 0 || sig !== this._lastSig) {
        this.inputT = 0.05; this._lastSig = sig;
        this.net.toHost({ k: 'in', m: [+it.move.x.toFixed(2), +it.move.y.toFixed(2)], kk: it.kick ? 1 : 0, l: it.lob ? 1 : 0, s: it.sprint ? 1 : 0, t: it.tackle ? 1 : 0, an: it.analog ? 1 : 0, pa: it.pass ? 1 : 0 });
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
    if (s1.lb) s1.lb.forEach((n, i) => { if (this.athletes[i]) this.athletes[i].label = n; });
    this.ends = s1.en | 0; this.half = s1.hf || 1; if (this.m5 && !!this.pitch.swapped !== (this.ends === 1)) this.pitch.setMap(this.ends === 1); this.ball.specialType = s1.bs || null; this.ball.passEls = s1.pe || null; this.ball.hidden = !!s1.bh; this.golden = !!s1.gold;
    if (s1.cur) {
      const key = JSON.stringify(s1.cur);
      if (key !== this._curKey) {
        this._curKey = key; this._curNames = s1.cur;
        const mine = s1.cur.find((c) => c[0] === this.myId);
        this.mySlot = mine ? mine[1] : -1;
        this._guestControllers();
      }
    }
    if (s1.sh) { const key = s1.sh.join(','); if (key !== this._shKey) { this._shKey = key; const set = new Set(s1.sh); for (const t of this.ball.shields) if (!set.has(t)) this.pitch.breakShield(t); this.ball.shields = set; this.pitch.setShields(set, true); } }
    // events whose time has come
    const due = [];
    this.pendingEvents = this.pendingEvents.filter((e) => (e.t <= renderT ? (due.push(e), false) : true));
    for (const e of due) this._applyEvent(e);
    // ball
    const b = this.ball, B0 = s0.b, B1 = s1.b;
    // a teleport: jump, don't slide across the pitch
    const jump = Math.hypot(B1[0] - B0[0], B1[2] - B0[2]) > 3;
    if (jump) b.pos.set(B1[0], B1[1], B1[2]); else b.pos.set(L(B0[0], B1[0]), L(B0[1], B1[1]), L(B0[2], B1[2]));
    if (jump && !this._jumped) b.trail.reset(b.pos);
    this._jumped = jump;
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
      a.trapT = A1[10]; a.holdW = A1[11]; a.turnRate = A1[12]; a.energy = A1[14] ?? 0;
      a.sprinting = !!A1[15]; a.ghost = a.sprinting && a.charId === 'phantom'; a.netAir = A1[16] || null;
      a.char.lookTarget = b.pos;
      a._feet(dt);
      a._sync(dt);
    });
    this.pitch.update(dt, (this.time += dt));
    this.particles.update(dt);
    this.chargeFx.update(dt, this.athletes, this.time, this);
    this.specialFx.update(dt, this);
    this._trails(dt, false);
    this.powerFx.update(dt, this.camera.position);
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
      case 'pulse': this.pitch.pulse(e.k, e.x, e.z); break;
      case 'shield': this.pitch.breakShield(e.t); break;
      case 'power': { const a = this.athletes[e.i]; if (a) this.powerFx.start(a, e.k, e.f ? { from: { x: e.f[0], z: e.f[1] } } : null); break; }
      case 'hit': this.powerFx.start({ pos: new THREE.Vector3(e.p[0], 0, e.p[1]) }, 'hit', { color: e.c }); break;
      case 'zap': { const a = this.athletes[e.i]; if (a && e.k === 'frost') a.iceT = e.t || 1.8; break; }
      case 'perfect': { const a = this.athletes[e.i]; if (a) a.lastPerfectT = this.time; break; }
      case 'flair': { const a = this.athletes[e.i]; if (a) { a.flairText = e.s; a.flairT = this.time; } break; }
      case 'kickoff': for (const a of this.athletes) a.char.teleported(); this.focus = null; break;
    }
  }
}
