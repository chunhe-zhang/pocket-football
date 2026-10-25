// Procedural sound effects with the Web Audio API — no audio files needed.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(this.ctx.destination);
    this.noise = this._makeNoise(2.5);
    this._startCrowd();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
  }

  get ok() { return !!this.ctx && this.ctx.state === 'running'; }

  _makeNoise(sec) {
    const sr = this.ctx.sampleRate, buf = this.ctx.createBuffer(1, Math.floor(sr * sec), sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _env(gainNode, t, a, peak, d) {
    const g = gainNode.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  _noiseBurst(t, { freq = 1000, q = 1, type = 'bandpass', peak = 0.3, a = 0.003, d = 0.08, rate = 1 } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise; src.playbackRate.value = rate;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    src.connect(f); f.connect(g); g.connect(this.master);
    this._env(g, t, a, peak, d);
    src.start(t, Math.random() * 1.5); src.stop(t + a + d + 0.05);
  }

  _thump(t, { f0 = 160, f1 = 50, peak = 0.6, d = 0.14, type = 'sine' } = {}) {
    const o = this.ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + d);
    const g = this.ctx.createGain();
    o.connect(g); g.connect(this.master);
    this._env(g, t, 0.002, peak, d);
    o.start(t); o.stop(t + d + 0.05);
  }

  kick(power = 0.5) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this._thump(t, { f0: 140 + 60 * power, f1: 45, peak: 0.45 + 0.5 * power, d: 0.12 + 0.06 * power });
    this._noiseBurst(t, { freq: 1600, q: 0.8, peak: 0.25 + 0.35 * power, d: 0.05 + 0.03 * power });
    this._noiseBurst(t, { freq: 4200, q: 1.5, peak: 0.08 + 0.12 * power, d: 0.03 });
  }

  touch() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this._thump(t, { f0: 120, f1: 60, peak: 0.16, d: 0.07 });
    this._noiseBurst(t, { freq: 900, q: 1, peak: 0.06, d: 0.04 });
  }

  /** ball off the head: a quick, higher knock */
  head(v = 8) {
    if (!this.ok) return;
    const k = Math.min(1, v / 14), t = this.ctx.currentTime;
    this._thump(t, { f0: 260, f1: 120, peak: 0.25 + 0.3 * k, d: 0.07 });
    this._noiseBurst(t, { freq: 1300, q: 1.2, peak: 0.1 + 0.15 * k, d: 0.04 });
  }

  /** ball off the chest / thigh: soft and muffled */
  body(v = 6) {
    if (!this.ok) return;
    const k = Math.min(1, v / 14), t = this.ctx.currentTime;
    this._thump(t, { f0: 95, f1: 50, peak: 0.25 + 0.35 * k, d: 0.12 });
    this._noiseBurst(t, { freq: 380, q: 0.8, type: 'lowpass', peak: 0.1 + 0.15 * k, d: 0.08 });
  }

  /** sliding on grass */
  slide() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this._noiseBurst(t, { freq: 2400, q: 0.4, peak: 0.16, a: 0.03, d: 0.45, rate: 0.6 });
    this._noiseBurst(t, { freq: 600, q: 0.6, type: 'lowpass', peak: 0.12, a: 0.02, d: 0.35 });
  }

  /** bodies colliding */
  bump(v = 5) {
    if (!this.ok) return;
    const k = Math.min(1, v / 8), t = this.ctx.currentTime;
    this._thump(t, { f0: 80, f1: 45, peak: 0.25 + 0.3 * k, d: 0.15, type: 'triangle' });
  }

  bounce(v) {
    if (!this.ok) return;
    const k = Math.min(1, v / 10);
    const t = this.ctx.currentTime;
    this._thump(t, { f0: 110, f1: 55, peak: 0.12 + 0.3 * k, d: 0.09 });
    this._noiseBurst(t, { freq: 700, q: 0.7, peak: 0.04 + 0.08 * k, d: 0.05 });
  }

  board(v) {
    if (!this.ok) return;
    const k = Math.min(1, v / 14), t = this.ctx.currentTime;
    this._thump(t, { f0: 90, f1: 60, peak: 0.25 + 0.4 * k, d: 0.16, type: 'triangle' });
    this._noiseBurst(t, { freq: 450, q: 2, peak: 0.12 + 0.25 * k, d: 0.12 });
  }

  post(v) {
    if (!this.ok) return;
    const k = Math.min(1, v / 15), t = this.ctx.currentTime;
    for (const [f, a, d] of [[523, 0.3, 0.9], [1312, 0.18, 0.6], [2093, 0.1, 0.45], [3150, 0.05, 0.3]]) {
      const o = this.ctx.createOscillator(); o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.01);
      const g = this.ctx.createGain(); o.connect(g); g.connect(this.master);
      this._env(g, t, 0.002, a * (0.4 + k), d);
      o.start(t); o.stop(t + d + 0.05);
    }
    this._noiseBurst(t, { freq: 2500, q: 1, peak: 0.2 * k, d: 0.05 });
  }

  net() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this._noiseBurst(t, { freq: 1800, q: 0.5, type: 'bandpass', peak: 0.28, a: 0.01, d: 0.45, rate: 0.7 });
    this._noiseBurst(t, { freq: 300, q: 0.7, type: 'lowpass', peak: 0.2, a: 0.01, d: 0.25 });
  }

  whistle(pattern = [0.35]) {
    if (!this.ok) return;
    let t = this.ctx.currentTime + 0.02;
    for (const len of pattern) {
      const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = 2750;
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 28;
      const lfoG = this.ctx.createGain(); lfoG.gain.value = 140; lfo.connect(lfoG); lfoG.connect(o.frequency);
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2900; f.Q.value = 3;
      const g = this.ctx.createGain();
      o.connect(f); f.connect(g); g.connect(this.master);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      g.gain.setValueAtTime(0.22, t + len - 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.start(t); lfo.start(t); o.stop(t + len + 0.02); lfo.stop(t + len + 0.02);
      t += len + 0.12;
    }
  }

  _startCrowd() {
    const src = this.ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f1 = this.ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 520; f1.Q.value = 0.6;
    const f2 = this.ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 1400;
    this.crowdGain = this.ctx.createGain(); this.crowdGain.gain.value = 0.045;
    src.connect(f1); f1.connect(f2); f2.connect(this.crowdGain); this.crowdGain.connect(this.master);
    src.start();
    // slow random swell so the ambience breathes
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lg = this.ctx.createGain(); lg.gain.value = 0.012; lfo.connect(lg); lg.connect(this.crowdGain.gain); lfo.start();
  }

  crowd(level = 0.045, time = 0.6) {
    if (!this.ok) return;
    this.crowdGain.gain.setTargetAtTime(level, this.ctx.currentTime, time / 3);
  }

  cheer() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.cancelScheduledValues(t);
    this.crowdGain.gain.setTargetAtTime(0.32, t, 0.12);
    this.crowdGain.gain.setTargetAtTime(0.06, t + 2.4, 0.8);
    this._noiseBurst(t, { freq: 900, q: 0.4, peak: 0.25, a: 0.25, d: 2.6, rate: 0.9 });
  }

  ooh() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.cancelScheduledValues(t);
    this.crowdGain.gain.setTargetAtTime(0.16, t, 0.15);
    this.crowdGain.gain.setTargetAtTime(0.045, t + 1.1, 0.5);
  }
}
