// Procedural sound effects with the Web Audio API — no audio files needed.
//
// Everything is built from a few voices (noise through filters, swept oscillators, FM pings) and
// routed through a short stadium reverb. Each element has its own sound family, used for its special
// shot, its skill move, its slide tackle and when it hits someone:
//   雷 thunder  electric crackle + zap sweep + a roll of thunder
//   火 blaze    a rising roar of flame with crackles
//   冰 frost    crystal chimes and a cracking of ice
//   风 gale     a howling gust and a whistle
//   影 phantom  a ghostly detuned swell that bends downward
//   土 cannon   a deep boom and grinding rock

import { MenuMusic } from './music.js';

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.scene = 'menu'; this.musicVolume = 0.55; this.musicEnabled = true;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.18;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.noise = this._makeNoise(2.5);
    this.pink = this._makePink(2.5);
    // dry bus + a short, bright stadium reverb on a send
    this.bus = ctx.createGain(); this.bus.connect(this.master);
    this.verb = ctx.createConvolver(); this.verb.buffer = this._impulse(1.6, 2.6);
    this.verbSend = ctx.createGain(); this.verbSend.gain.value = 0.22;
    this.bus.connect(this.verbSend); this.verbSend.connect(this.verb); this.verb.connect(this.master);
    this._startCrowd();
    this.music = new MenuMusic(ctx, this.master);
    this.music.setVolume(this.musicVolume);
    this._syncMusic();
    this.music.prepare();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
  }

  get ok() { return !!this.ctx && this.ctx.state === 'running'; }
  get now() { return this.ctx.currentTime; }

  setScene(scene) {
    if (this.scene === scene) return;
    this.scene = scene; this._syncMusic();
    if (this.ok) this.crowd(scene === 'menu' || scene === 'paused' ? 0.006 : 0.045);
  }
  setMusicEnabled(enabled) { this.musicEnabled = enabled; this._syncMusic(); }
  setMusicVolume(volume) { this.musicVolume = Math.max(0, Math.min(1, volume)); this.music?.setVolume(this.musicVolume); }
  _syncMusic() { this.music?.setActive(this.scene === 'menu' && this.musicEnabled && !document.hidden); }
  visibilityChanged() {
    this._syncMusic();
    if (!this.ctx) return;
    if (document.hidden && this.ctx.state === 'running') { this._resumeVisible = true; this.ctx.suspend().catch(() => {}); }
    else if (!document.hidden && this._resumeVisible) { this._resumeVisible = false; this.ctx.resume().catch(() => {}); }
  }

  // ---------------------------------------------------------------- building blocks --
  _makeNoise(sec) {
    const sr = this.ctx.sampleRate, buf = this.ctx.createBuffer(1, Math.floor(sr * sec), sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  _makePink(sec) {
    const sr = this.ctx.sampleRate, buf = this.ctx.createBuffer(1, Math.floor(sr * sec), sr);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029591; b1 = 0.985 * b1 + w * 0.032534; b2 = 0.95 * b2 + w * 0.048056;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 2.2;
    }
    return buf;
  }
  _impulse(sec, decay) {
    const sr = this.ctx.sampleRate, n = Math.floor(sr * sec), buf = this.ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay) * (i < sr * 0.012 ? i / (sr * 0.012) : 1);
    }
    return buf;
  }

  _env(g, t, a, peak, d, hold = 0) {
    const p = g.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(0.0001, t);
    p.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    if (hold) p.setValueAtTime(Math.max(peak, 0.0002), t + a + hold);
    p.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
  }

  /** filtered noise with an envelope; optional filter sweep to `f1` */
  _noise(t, { freq = 1000, f1 = null, q = 1, type = 'bandpass', peak = 0.3, a = 0.003, d = 0.08, hold = 0, rate = 1, pink = false, out = null } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = pink ? this.pink : this.noise; src.playbackRate.value = rate;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + a + hold + d);
    const g = this.ctx.createGain();
    src.connect(f); f.connect(g); g.connect(out || this.bus);
    this._env(g, t, a, peak, d, hold);
    src.start(t, Math.random() * 1.5); src.stop(t + a + hold + d + 0.05);
    return f;
  }
  // kept for older call sites
  _noiseBurst(t, o) { return this._noise(t, o); }

  /** an oscillator sweeping f0 → f1 */
  _tone(t, { f0 = 440, f1 = null, type = 'sine', peak = 0.2, a = 0.002, d = 0.2, hold = 0, detune = 0, out = null, curve = 'exp' } = {}) {
    const o = this.ctx.createOscillator(); o.type = type; o.detune.value = detune;
    o.frequency.setValueAtTime(f0, t);
    if (f1) { if (curve === 'lin') o.frequency.linearRampToValueAtTime(f1, t + a + hold + d); else o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + a + hold + d); }
    const g = this.ctx.createGain();
    o.connect(g); g.connect(out || this.bus);
    this._env(g, t, a, peak, d, hold);
    o.start(t); o.stop(t + a + hold + d + 0.05);
    return o;
  }
  _thump(t, { f0 = 160, f1 = 50, peak = 0.6, d = 0.14, type = 'sine' } = {}) { return this._tone(t, { f0, f1, peak, d, type }); }

  /** a bright FM ping (metal, ice, chimes) */
  _ping(t, { f = 1200, ratio = 2.76, index = 3, peak = 0.12, d = 0.8 } = {}) {
    const car = this.ctx.createOscillator(), mod = this.ctx.createOscillator(), mg = this.ctx.createGain(), g = this.ctx.createGain();
    car.frequency.value = f; mod.frequency.value = f * ratio;
    mg.gain.setValueAtTime(f * index, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + d);
    mod.connect(mg); mg.connect(car.frequency); car.connect(g); g.connect(this.bus);
    this._env(g, t, 0.002, peak, d);
    car.start(t); mod.start(t); car.stop(t + d + 0.05); mod.stop(t + d + 0.05);
  }

  /** many tiny clicks over `dur` (crackle of fire / electricity / gravel) */
  _crackle(t, { dur = 0.4, n = 18, freq = 3000, q = 2, peak = 0.12, spread = 0.6 } = {}) {
    for (let i = 0; i < n; i++) {
      const tt = t + Math.pow(Math.random(), 0.8) * dur;
      this._noise(tt, { freq: freq * (1 - spread / 2 + Math.random() * spread), q, peak: peak * (0.4 + Math.random() * 0.6), a: 0.001, d: 0.008 + Math.random() * 0.02 });
    }
  }

  // ---------------------------------------------------------------- ball --
  /** a struck ball: low body, the leather "pock", a snap; big hits get a boom and the air tearing after it */
  kick(power = 0.5) {
    if (!this.ok) return;
    const t = this.now, p = Math.max(0, Math.min(1, power));
    this._tone(t, { f0: 150 + 70 * p, f1: 42, peak: 0.45 + 0.45 * p, d: 0.1 + 0.08 * p });
    this._noise(t, { freq: 1900 + 500 * p, q: 1.6, peak: 0.22 + 0.3 * p, d: 0.035 + 0.02 * p });
    this._noise(t, { freq: 5200, q: 1.2, type: 'highpass', peak: 0.05 + 0.1 * p, d: 0.018 });
    if (p > 0.55) {
      this._tone(t, { f0: 70, f1: 32, peak: 0.35 * (p - 0.4), d: 0.28 });
      this._noise(t + 0.03, { freq: 2600, f1: 700, q: 0.7, peak: 0.12 * p, a: 0.02, d: 0.32, pink: true });
    }
  }

  /** side-footed pass: a rounder, softer knock */
  pass(power = 0.3) {
    if (!this.ok) return;
    const t = this.now, p = Math.max(0, Math.min(1, power));
    this._tone(t, { f0: 175 + 40 * p, f1: 80, peak: 0.28 + 0.2 * p, d: 0.08 });
    this._noise(t, { freq: 1300, q: 1.4, peak: 0.1 + 0.12 * p, d: 0.03 });
  }

  touch() {
    if (!this.ok) return;
    const t = this.now;
    this._tone(t, { f0: 130, f1: 70, peak: 0.15, d: 0.06 });
    this._noise(t, { freq: 1100, q: 1.2, peak: 0.05, d: 0.03 });
    this._noise(t, { freq: 3500, q: 0.6, type: 'highpass', peak: 0.015, d: 0.05, pink: true });   // a brush of grass
  }

  /** ball off the head: a quick, higher knock */
  head(v = 8) {
    if (!this.ok) return;
    const k = Math.min(1, v / 14), t = this.now;
    this._tone(t, { f0: 280, f1: 120, peak: 0.25 + 0.3 * k, d: 0.07 });
    this._noise(t, { freq: 1500, q: 1.3, peak: 0.1 + 0.16 * k, d: 0.035 });
    if (k > 0.6) this._tone(t, { f0: 90, f1: 50, peak: 0.2 * k, d: 0.12 });
  }

  /** ball off the chest / thigh: soft and muffled */
  body(v = 6) {
    if (!this.ok) return;
    const k = Math.min(1, v / 14), t = this.now;
    this._tone(t, { f0: 100, f1: 48, peak: 0.25 + 0.35 * k, d: 0.12 });
    this._noise(t, { freq: 420, q: 0.8, type: 'lowpass', peak: 0.1 + 0.16 * k, d: 0.08 });
    this._noise(t, { freq: 2200, q: 0.8, peak: 0.03 + 0.04 * k, d: 0.05 });   // shirt fabric
  }

  /** sliding on grass */
  slide() {
    if (!this.ok) return;
    const t = this.now;
    this._noise(t, { freq: 2600, f1: 1200, q: 0.5, peak: 0.16, a: 0.03, d: 0.45, rate: 0.6, pink: true });
    this._noise(t, { freq: 650, q: 0.6, type: 'lowpass', peak: 0.12, a: 0.02, d: 0.35 });
    this._crackle(t, { dur: 0.35, n: 8, freq: 4200, peak: 0.03 });
  }

  /** bodies colliding */
  bump(v = 5) {
    if (!this.ok) return;
    const k = Math.min(1, v / 8), t = this.now;
    this._tone(t, { f0: 85, f1: 42, peak: 0.28 + 0.3 * k, d: 0.16, type: 'triangle' });
    this._noise(t, { freq: 500, q: 0.7, type: 'lowpass', peak: 0.12 * k, d: 0.1 });
  }

  bounce(v) {
    if (!this.ok) return;
    const k = Math.min(1, v / 10), t = this.now;
    this._tone(t, { f0: 120, f1: 55, peak: 0.12 + 0.3 * k, d: 0.09 });
    this._noise(t, { freq: 800, q: 0.7, peak: 0.04 + 0.08 * k, d: 0.045 });
  }

  board(v) {
    if (!this.ok) return;
    const k = Math.min(1, v / 14), t = this.now;
    this._tone(t, { f0: 95, f1: 58, peak: 0.25 + 0.4 * k, d: 0.18, type: 'triangle' });
    this._noise(t, { freq: 480, q: 2.2, peak: 0.12 + 0.25 * k, d: 0.13 });
    this._noise(t, { freq: 1700, q: 3, peak: 0.04 + 0.08 * k, d: 0.25 });   // the board rattling
  }

  /** the woodwork: a ringing metal clang */
  post(v) {
    if (!this.ok) return;
    const k = Math.min(1, v / 15), t = this.now;
    for (const [f, a, d] of [[523, 0.28, 1.1], [1309, 0.17, 0.8], [2093, 0.1, 0.55], [3170, 0.05, 0.35]]) this._tone(t, { f0: f * (1 + (Math.random() - 0.5) * 0.008), peak: a * (0.4 + k), d });
    this._ping(t, { f: 740, ratio: 3.17, index: 2, peak: 0.08 * (0.4 + k), d: 0.9 });
    this._noise(t, { freq: 2600, q: 1, peak: 0.2 * k, d: 0.05 });
  }

  net() {
    if (!this.ok) return;
    const t = this.now;
    this._noise(t, { freq: 2200, f1: 900, q: 0.5, peak: 0.3, a: 0.01, d: 0.5, rate: 0.7, pink: true });
    this._noise(t, { freq: 320, q: 0.7, type: 'lowpass', peak: 0.22, a: 0.01, d: 0.28 });
    this._crackle(t + 0.02, { dur: 0.3, n: 10, freq: 1800, q: 1, peak: 0.05 });   // the mesh snapping taut
  }

  whistle(pattern = [0.35]) {
    if (!this.ok) return;
    let t = this.now + 0.02;
    for (const len of pattern) {
      const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = 2750;
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 28;
      const lfoG = this.ctx.createGain(); lfoG.gain.value = 140; lfo.connect(lfoG); lfoG.connect(o.frequency);
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2900; f.Q.value = 3;
      const g = this.ctx.createGain();
      o.connect(f); f.connect(g); g.connect(this.bus);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      g.gain.setValueAtTime(0.22, t + len - 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.start(t); lfo.start(t); o.stop(t + len + 0.02); lfo.stop(t + len + 0.02);
      this._noise(t, { freq: 3000, q: 1, peak: 0.03, a: 0.01, d: len, pink: true });   // breath
      t += len + 0.12;
    }
  }

  // ---------------------------------------------------------------- elements --
  /**
   * An element's sound. `what`: 'shot' (special shot leaves the boot), 'move' (skill move),
   * 'slide' (element slide tackle), 'hit' (someone is struck by it).
   */
  element(id, what = 'shot', power = 1) {
    if (!this.ok) return;
    const t = this.now, big = what === 'shot' ? 1 : what === 'hit' ? 0.8 : 0.7;
    const k = big * (0.6 + 0.4 * Math.min(1, power));
    switch (id) {
      case 'thunder': {
        this._tone(t, { f0: 2400, f1: 160, type: 'sawtooth', peak: 0.1 * k, d: 0.22 });           // the zap
        this._tone(t, { f0: 1800, f1: 120, type: 'square', peak: 0.05 * k, d: 0.18, detune: 30 });
        this._crackle(t, { dur: 0.35, n: 26, freq: 5200, q: 3, peak: 0.12 * k, spread: 0.8 });   // arcing
        this._noise(t + 0.06, { freq: 180, q: 0.7, type: 'lowpass', peak: 0.3 * k, a: 0.02, d: 0.9, hold: 0.1, pink: true });   // rumble
        this._noise(t, { freq: 3000, q: 0.6, type: 'highpass', peak: 0.12 * k, d: 0.12 });     // the crack
        break;
      }
      case 'blaze': {
        this._noise(t, { freq: 300, f1: 1400, q: 0.8, type: 'lowpass', peak: 0.32 * k, a: 0.04, d: 0.55, pink: true });   // fwoom
        this._tone(t, { f0: 90, f1: 55, peak: 0.25 * k, d: 0.35 });
        this._crackle(t + 0.05, { dur: 0.6, n: 22, freq: 2400, q: 1.5, peak: 0.08 * k });       // crackling flame
        this._noise(t, { freq: 900, f1: 2600, q: 1.2, peak: 0.08 * k, a: 0.1, d: 0.4 });
        break;
      }
      case 'frost': {
        const base = 1400 + Math.random() * 300;
        [1, 1.5, 2.01, 2.53, 3.2].forEach((r, i) => this._ping(t + i * 0.035, { f: base * r, ratio: 1.41, index: 1.2, peak: 0.07 * k, d: 0.9 - i * 0.1 }));   // chimes
        this._noise(t, { freq: 6000, q: 0.7, type: 'highpass', peak: 0.12 * k, d: 0.25 });     // frost hiss
        this._crackle(t + 0.02, { dur: 0.25, n: 12, freq: 3800, q: 4, peak: 0.1 * k });       // ice cracking
        this._tone(t, { f0: 220, f1: 110, peak: 0.12 * k, d: 0.2 });
        break;
      }
      case 'gale': {
        const f = this._noise(t, { freq: 400, q: 2.5, peak: 0.28 * k, a: 0.08, d: 0.7, pink: true });   // gust: a howl that rises and falls
        f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(1800, t + 0.3); f.frequency.exponentialRampToValueAtTime(500, t + 0.78);
        this._tone(t, { f0: 900, f1: 2200, peak: 0.04 * k, a: 0.08, d: 0.45, curve: 'lin' });   // whistle
        this._noise(t, { freq: 120, q: 0.7, type: 'lowpass', peak: 0.14 * k, a: 0.05, d: 0.5 });
        break;
      }
      case 'phantom': {
        for (const [f0, dt] of [[660, 0], [666, 0], [990, 7]]) this._tone(t, { f0, f1: f0 * 0.5, type: 'sine', peak: 0.07 * k, a: 0.12, d: 0.55, detune: dt });   // ghostly chord bending down
        this._noise(t, { freq: 1800, f1: 400, q: 3, peak: 0.12 * k, a: 0.2, d: 0.15, pink: true });   // a swell sucked away
        this._tone(t + 0.15, { f0: 140, f1: 60, peak: 0.1 * k, d: 0.3 });
        break;
      }
      case 'cannon': {
        this._tone(t, { f0: 75, f1: 28, peak: 0.6 * k, d: 0.55 });                              // boom
        this._noise(t, { freq: 160, q: 0.7, type: 'lowpass', peak: 0.35 * k, a: 0.005, d: 0.6, pink: true });
        this._crackle(t + 0.02, { dur: 0.45, n: 16, freq: 900, q: 1, peak: 0.12 * k });         // rock grinding
        this._noise(t, { freq: 1500, q: 1, peak: 0.12 * k, d: 0.06 });
        break;
      }
    }
  }

  /** a combo callout (volley, one-two…): a short rising sting */
  combo(level = 1) {
    if (!this.ok) return;
    const t = this.now;
    [523, 659, 784, 1046].slice(0, 2 + Math.min(2, level)).forEach((f, i) => this._tone(t + i * 0.06, { f0: f, type: 'triangle', peak: 0.07, d: 0.3 }));
    if (level >= 3) {
      // a 合击: the whole chord rings out together, with a bright shimmer on top
      const t2 = t + 0.26;
      for (const f of [523, 659, 784, 1046, 1318]) this._tone(t2, { f0: f, type: 'triangle', peak: 0.05, d: 0.7 });
      this._tone(t2, { f0: 2093, f1: 3136, type: 'sine', peak: 0.03, d: 0.5 });
    }
  }

  // ---------------------------------------------------------------- 方块乐园 devices --
  device(kind, v = 6) {
    if (!this.ok) return;
    const t = this.now, k = Math.min(1, v / 14);
    switch (kind) {
      case 'spring': {   // boing
        const o = this._tone(t, { f0: 180, f1: 620, type: 'sine', peak: 0.22, d: 0.32 });
        const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain(); lfo.frequency.value = 22; lg.gain.value = 60;
        lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + 0.4);
        this._tone(t, { f0: 110, f1: 60, peak: 0.25, d: 0.1 });
        break;
      }
      case 'portal': {   // warp: two voices sweeping apart, with a shimmer
        this._tone(t, { f0: 300, f1: 1600, type: 'triangle', peak: 0.1, d: 0.35 });
        this._tone(t, { f0: 1600, f1: 250, type: 'triangle', peak: 0.08, d: 0.4 });
        this._noise(t, { freq: 3000, f1: 600, q: 4, peak: 0.08, a: 0.05, d: 0.35 });
        this._ping(t + 0.25, { f: 1760, ratio: 1.5, index: 0.8, peak: 0.05, d: 0.5 });
        break;
      }
      case 'boost': {    // zoom
        this._tone(t, { f0: 160, f1: 1300, type: 'sawtooth', peak: 0.07 + 0.05 * k, d: 0.3 });
        this._noise(t, { freq: 800, f1: 5000, q: 1, peak: 0.16, a: 0.02, d: 0.35, pink: true });
        this._tone(t, { f0: 100, f1: 45, peak: 0.22, d: 0.12 });
        break;
      }
      case 'vortex': {   // swirling water
        const f = this._noise(t, { freq: 500, q: 5, peak: 0.16, a: 0.08, d: 0.7, pink: true });
        const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain(); lfo.frequency.value = 6; lg.gain.value = 350;
        lfo.connect(lg); lg.connect(f.frequency); lfo.start(t); lfo.stop(t + 0.85);
        this._tone(t, { f0: 400, f1: 900, type: 'sine', peak: 0.04, a: 0.1, d: 0.6 });
        break;
      }
      case 'wheel': { for (let i = 0; i < 6; i++) this._noise(t + i * 0.05, { freq: 2500, q: 6, peak: 0.08, d: 0.02 }); this._ping(t + 0.3, { f: 1046, peak: 0.08, d: 0.4 }); break; }
      case 'bumper': { this._tone(t, { f0: 520, f1: 260, type: 'square', peak: 0.08, d: 0.15 }); this._tone(t, { f0: 140, f1: 70, peak: 0.25, d: 0.12 }); break; }
    }
  }

  /** a goal shield shattering: glass */
  shatter() {
    if (!this.ok) return;
    const t = this.now;
    for (let i = 0; i < 14; i++) this._ping(t + Math.random() * 0.25, { f: 2000 + Math.random() * 4500, ratio: 1.7 + Math.random(), index: 1.5, peak: 0.05, d: 0.25 + Math.random() * 0.4 });
    this._noise(t, { freq: 5000, q: 0.5, type: 'highpass', peak: 0.25, d: 0.35 });
    this._tone(t, { f0: 160, f1: 60, peak: 0.3, d: 0.25 });
  }

  // ---------------------------------------------------------------- crowd --
  _startCrowd() {
    const src = this.ctx.createBufferSource(); src.buffer = this.pink; src.loop = true;
    const f1 = this.ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 560; f1.Q.value = 0.55;
    const f2 = this.ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 1500;
    this.crowdGain = this.ctx.createGain(); this.crowdGain.gain.value = this.scene === 'menu' ? 0.006 : 0.045;
    src.connect(f1); f1.connect(f2); f2.connect(this.crowdGain); this.crowdGain.connect(this.master);
    src.start();
    // slow random swell so the ambience breathes
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lg = this.ctx.createGain(); lg.gain.value = 0.003; lfo.connect(lg); lg.connect(this.crowdGain.gain); lfo.start();
  }

  crowd(level = 0.045, time = 0.6) {
    if (!this.ok) return;
    this.crowdGain.gain.setTargetAtTime(level, this.now, time / 3);
  }

  cheer() {
    if (!this.ok) return;
    const t = this.now;
    this.crowdGain.gain.cancelScheduledValues(t);
    this.crowdGain.gain.setTargetAtTime(0.32, t, 0.12);
    this.crowdGain.gain.setTargetAtTime(0.06, t + 2.4, 0.8);
    this._noise(t, { freq: 900, q: 0.4, peak: 0.25, a: 0.25, d: 2.6, rate: 0.9, pink: true });
    this._noise(t + 0.1, { freq: 2200, q: 0.6, peak: 0.08, a: 0.3, d: 2.0, pink: true });   // whistles and shrieks on top
    for (let i = 0; i < 10; i++) this._noise(t + 0.2 + Math.random() * 1.8, { freq: 1200 + Math.random() * 900, q: 1, peak: 0.05, a: 0.004, d: 0.04 });   // clapping
  }

  ooh() {
    if (!this.ok) return;
    const t = this.now;
    this.crowdGain.gain.cancelScheduledValues(t);
    this.crowdGain.gain.setTargetAtTime(0.16, t, 0.15);
    this.crowdGain.gain.setTargetAtTime(0.045, t + 1.1, 0.5);
    this._noise(t, { freq: 380, f1: 300, q: 2, peak: 0.08, a: 0.15, d: 0.9, pink: true });   // a vowel-ish "ooh"
  }
}
