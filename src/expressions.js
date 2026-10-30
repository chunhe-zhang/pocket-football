// VRM expression mixing, including the model's blink/mouth override metadata.
// https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/expressions.md
const clamp = x => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const smooth = x => { const t = clamp(x); return t * t * (3 - 2 * t); };
const EMOTIONS = ['happy', 'angry', 'sad', 'surprised', 'relaxed'];
const MOUTH = ['aa', 'ih', 'ou', 'ee', 'oh'];
const BLINK = ['blink', 'blinkLeft', 'blinkRight'];
const LOOK = ['lookUp', 'lookDown', 'lookLeft', 'lookRight'];

export class Expressions {
  constructor(presets, node, random = Math.random) {
    this.binds = {}; this.meta = presets; this.meshes = new Set();
    this.channels = new Map(); this.random = random;
    for (const [name, p] of Object.entries(presets)) {
      this.binds[name] = (p.morphTargetBinds || []).flatMap(bind => {
        const object = node(bind.node); if (!object) return [];
        const meshes = []; object.traverse(m => { if (m.isMesh && m.morphTargetInfluences) meshes.push(m); });
        return meshes.flatMap(m => {
          if (bind.index >= m.morphTargetInfluences.length) return [];
          this.meshes.add(m);
          if (!this.channels.has(m)) this.channels.set(m, new Map());
          this.channels.get(m).set(bind.index, m.morphTargetInfluences[bind.index]);
          return [{ m, index: bind.index, weight: bind.weight ?? 1 }];
        });
      });
    }
    this.target = {}; this.value = {}; this.timers = {};
    this.blinkT = 2 + random() * 3; this.blink = 0; this.lookWeight = 1;
  }
  set(name, weight) { if (this.binds[name]) this.target[name] = clamp(weight); }
  pulse(name, weight, duration = 0.65) {
    if (!this.binds[name]) return;
    if (weight > 0 && EMOTIONS.includes(name)) {
      for (const other of EMOTIONS) if (other !== name) { this.target[other] = 0; delete this.timers[other]; }
    }
    this.set(name, weight);
    if (weight > 0) this.timers[name] = duration; else delete this.timers[name];
  }
  clear() { for (const name in this.target) this.target[name] = 0; this.timers = {}; }
  get emoting() { return EMOTIONS.some(name => this.timers[name] > 0); }
  update(dt) {
    dt = Math.max(0, dt);
    for (const name in this.timers) {
      this.timers[name] -= dt;
      if (this.timers[name] <= 0) { this.target[name] = 0; delete this.timers[name]; }
    }
    this.blinkT -= dt;
    if (this.blinkT <= 0 && this.blink <= 0) {
      this.blinkLength = 0.13 + this.random() * 0.035;
      this.blink = this.blinkLength; this.blinkT = 2.5 + this.random() * 4;
    }
    this.blink = Math.max(0, this.blink - dt);
    const phase = this.blink > 0 ? 1 - this.blink / this.blinkLength : 0;
    const automaticBlink = this.blink > 0 ? (phase < 0.32 ? smooth(phase / 0.32) : 1 - smooth((phase - 0.32) / 0.68)) : 0;
    const values = {};
    for (const name in this.binds) {
      const current = this.value[name] || 0, target = this.target[name] || 0;
      const value = this.value[name] = current + (target - current) * (1 - Math.exp(-dt * (target > current ? 14 : 9)));
      values[name] = this.meta[name].isBinary ? (value > 0.5 ? 1 : 0) : value;
    }
    // Opposing emotions and phonemes share a weight budget, avoiding stretched
    // lips/eyelids when a hit interrupts a charge or celebration.
    for (const group of [EMOTIONS, MOUTH]) {
      const sum = group.reduce((n, name) => n + (values[name] || 0), 0);
      if (sum > 1) for (const name of group) if (!this.meta[name]?.isBinary) values[name] = (values[name] || 0) / sum;
    }
    const suppression = key => {
      let amount = 0;
      for (const name in values) {
        const rule = this.meta[name]?.[key], value = values[name];
        if (rule === 'block' && value > 0) return 1;
        if (rule === 'blend') amount += value;
      }
      return clamp(amount);
    };
    const blinkWeight = 1 - suppression('overrideBlink');
    const mouthWeight = 1 - suppression('overrideMouth');
    this.lookWeight = 1 - suppression('overrideLookAt');
    values.blink = Math.max(values.blink || 0, automaticBlink);
    for (const group of [[BLINK, blinkWeight], [MOUTH, mouthWeight], [LOOK, this.lookWeight]]) {
      for (const name of group[0]) {
        const value = (values[name] || 0) * group[1];
        values[name] = this.meta[name]?.isBinary && group[1] < 1 ? 0 : value;
      }
    }
    for (const [mesh, channels] of this.channels) for (const [index, rest] of channels) mesh.morphTargetInfluences[index] = rest;
    for (const name in values) for (const bind of this.binds[name] || []) bind.m.morphTargetInfluences[bind.index] += values[name] * bind.weight;
    for (const [mesh, channels] of this.channels) for (const index of channels.keys()) mesh.morphTargetInfluences[index] = clamp(mesh.morphTargetInfluences[index]);
  }
}
