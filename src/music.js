// "Kickoff Lights" — original instrumental for Genshin football.
// 112 BPM, D major, 32 bars. Warm electric keys, syncopated bass, plucked
// melody and a light breakbeat; a quieter middle eight gives the loop space.
// Render once off the main audio thread. Gameplay never schedules music voices.
export const MUSIC = { title: 'Kickoff Lights', bpm: 112, bars: 32 };
const midi = n => 440 * 2 ** ((n - 69) / 12);

export async function renderTheme(OfflineContext) {
  const sr = 32000, beat = 60 / MUSIC.bpm, duration = MUSIC.bars * 4 * beat;
  const frames = Math.round(duration * sr), tail = 3;
  const ctx = new OfflineContext(2, frames + sr * tail, sr);
  const mix = ctx.createGain(); mix.gain.value = 0.78;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 15; comp.ratio.value = 3;
  comp.attack.value = 0.012; comp.release.value = 0.18;
  mix.connect(comp); comp.connect(ctx.destination);
  const delay = ctx.createDelay(2), feedback = ctx.createGain(), wet = ctx.createGain();
  delay.delayTime.value = beat * 0.75; feedback.gain.value = 0.26; wet.gain.value = 0.2;
  delay.connect(feedback); feedback.connect(delay); delay.connect(wet); wet.connect(mix);
  let seed = 7391;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const noise = ctx.createBuffer(1, sr, sr);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = rand() * 2 - 1;

  function note(n, t, length, level, { type = 'sine', pan = 0, cutoff = 3500, echo = false, attack = 0.008 } = {}) {
    const osc = ctx.createOscillator(), gain = ctx.createGain(), filter = ctx.createBiquadFilter(), p = ctx.createStereoPanner();
    osc.type = type; osc.frequency.value = midi(n);
    filter.type = 'lowpass'; filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(180, cutoff * 0.4), t + length);
    p.pan.value = pan;
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(level, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(filter); filter.connect(gain); gain.connect(p); p.connect(mix);
    if (echo) p.connect(delay);
    osc.start(t); osc.stop(t + length + 0.02);
  }
  function drum(t, kind, level = 1, pan = 0) {
    if (kind === 'kick') {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.frequency.setValueAtTime(145, t); osc.frequency.exponentialRampToValueAtTime(46, t + 0.12);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.48 * level, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      osc.connect(g); g.connect(mix); osc.start(t); osc.stop(t + 0.27); return;
    }
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner();
    src.buffer = noise;
    const snare = kind === 'snare', open = kind === 'open';
    f.type = snare ? 'bandpass' : 'highpass'; f.frequency.value = snare ? 1900 : 7200; f.Q.value = 0.65;
    const len = snare ? 0.16 : open ? 0.18 : 0.045;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime((snare ? 0.23 : 0.075) * level, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len); p.pan.value = pan;
    src.connect(f); f.connect(g); g.connect(p); p.connect(mix); src.start(t, rand() * 0.7); src.stop(t + len + 0.01);
    if (snare) note(50, t, 0.085, 0.09 * level, { cutoff: 800 });
  }

  // Dmaj9 / Aadd9 / Bm7 / Gmaj9; voice leading keeps the keys soft.
  const chords = [[62, 66, 69, 73, 76], [61, 64, 69, 71, 76], [62, 66, 69, 71, 74], [62, 66, 67, 69, 74]];
  const roots = [38, 33, 35, 31];
  const motifs = [
    [[0, 78], [0.75, 76], [1.5, 73], [2.5, 74], [3.25, 76]],
    [[0.5, 76], [1.25, 73], [2, 71], [3, 69]],
    [[0, 74], [0.75, 78], [1.5, 81], [2.75, 78], [3.5, 76]],
    [[0.5, 74], [1.25, 73], [2.5, 71], [3.25, 69]],
  ];
  for (let bar = 0; bar < MUSIC.bars; bar++) {
    const t0 = bar * beat * 4, ci = Math.floor(bar / 2) % 4;
    const intro = bar < 4, bridge = bar >= 16 && bar < 24;
    const energy = intro ? 0.65 : bridge ? 0.62 : 1;
    // Wide electric piano: a fundamental plus a gentle bell harmonic.
    for (const offset of [0, 1.75, 3]) for (let v = 0; v < chords[ci].length; v++) {
      const n = chords[ci][v], t = t0 + (offset + v * 0.012) * beat;
      note(n, t, beat * (offset === 0 ? 2.5 : 1.2), 0.039 * energy, { pan: (v - 2) * 0.22, echo: true });
      note(n + 12, t, beat * 0.65, 0.009 * energy, { pan: (2 - v) * 0.25 });
    }
    const bass = bridge ? [[0, 0, 1.5], [2.5, 7, 0.8]] : [[0, 0, 0.7], [0.75, 0, 0.35], [1.5, 12, 0.4], [2.25, 7, 0.5], [3.5, 0, 0.35]];
    for (const [off, interval, len] of bass) note(roots[ci] + interval, t0 + off * beat, len * beat, 0.17 * energy, { type: 'triangle', cutoff: 850 });
    if (!bridge || bar % 2 === 0) for (const off of bridge ? [0, 2.5] : [0, 1.5, 2, 3.5]) drum(t0 + off * beat, 'kick', energy);
    if (!intro || bar >= 2) for (const off of [1, 3]) drum(t0 + off * beat, 'snare', energy);
    for (let h = 0; h < (bridge ? 4 : 8); h++) {
      const off = bridge ? h : h / 2 + (h % 2 ? 0.045 : 0);
      drum(t0 + off * beat, !bridge && h === 7 && bar % 4 === 3 ? 'open' : 'hat', energy * (h % 2 ? 0.58 : 0.85), h % 2 ? 0.32 : -0.2);
    }
    // Melody enters after the opening; alternate phrases leave breathing room.
    if (!intro && (!bridge || bar % 2 === 0) && bar % 8 < 6) {
      for (const [off, n] of motifs[bar % 4]) {
        const pitch = n + (bridge ? -12 : bar >= 24 && bar % 4 === 2 ? 12 : 0);
        note(pitch, t0 + off * beat, beat * 0.85, 0.063 * energy, { type: 'triangle', cutoff: 3200, pan: 0.12, echo: true });
        note(pitch + 12, t0 + off * beat, beat * 0.28, 0.008 * energy, { pan: -0.15, echo: true });
      }
    }
    if (!bridge && bar % 8 === 7) for (const off of [3.25, 3.75]) drum(t0 + off * beat, 'snare', 0.28, off < 3.5 ? -0.3 : 0.3);
  }
  const rendered = await ctx.startRendering();
  const buffer = ctx.createBuffer(2, frames, sr);
  // Wrap delay/release tails into the beginning instead of cutting them at the
  // loop seam. There is no fade to silence or doubled downbeat on repetition.
  for (let ch = 0; ch < 2; ch++) {
    const source = rendered.getChannelData(ch), dest = buffer.getChannelData(ch);
    dest.set(source.subarray(0, frames));
    for (let i = 0; i < sr * tail; i++) dest[i] += source[frames + i];
  }
  return buffer;
}

export class MenuMusic {
  constructor(ctx, output) {
    this.ctx = ctx; this.gain = ctx.createGain(); this.gain.gain.value = 0;
    this.gain.connect(output); this.volume = 0.55; this.active = false;
  }
  async prepare() {
    if (this.loading) return this.loading;
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Offline) return;
    this.loading = renderTheme(Offline).then(buffer => {
      this.source = this.ctx.createBufferSource(); this.source.buffer = buffer;
      this.source.loop = true; this.source.connect(this.gain); this.source.start();
      this._fade();
    }).catch(error => { console.warn('Menu music unavailable:', error.message); });
    return this.loading;
  }
  setActive(active) { if (this.active !== active) { this.active = active; this._fade(); } }
  setVolume(volume) { this.volume = Math.max(0, Math.min(1, volume)); this._fade(); }
  _fade() {
    const p = this.gain.gain, t = this.ctx.currentTime;
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
    else { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); }
    p.setTargetAtTime(this.active ? this.volume * 0.48 : 0, t, this.active ? 0.45 : 0.16);
  }
}
