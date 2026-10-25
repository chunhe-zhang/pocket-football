// Fires balls at a standing / running player from many angles and heights and counts
// how many pass straight through the body without touching anything.
window.__collide = (opts = {}) => {
  const g = window.__game, a = g.athletes[0];
  g.state = 'play';
  g.controllers = g.athletes.map(() => ({ type: 'script' }));
  g.athletes.forEach((x, i) => { if (i) x.place(30 + i * 3, 30, 0); x.frozen = false; x.intent.move.set(0, 0); x.intent.kick = x.intent.lob = x.intent.pass = x.intent.tackle = false; });
  const res = { shots: 0, through: 0, hit: 0, byPart: {}, thr: {} };
  const speeds = opts.speeds || [8, 16, 26];
  const heights = opts.heights || [0.16, 0.35, 0.6, 0.95, 1.3, 1.6];
  for (const sp of speeds) for (const h of heights) for (let k = 0; k < 12; k++) {
    const ang = (k / 12) * Math.PI * 2;
    a.place(0, 0, 0); a.stamina = 1; a.stunT = 0; a.kick = null; a.receive = null; a.touchCD = 1; a.ignoreBall = 0;
    for (let s = 0; s < 3; s++) window.__step(1, 1 / 60, false);
    const run = opts.run ? 1 : 0;
    a.intent.move.set(run * Math.cos(ang + 1.2), run * Math.sin(ang + 1.2));
    for (let s = 0; s < (run ? 30 : 1); s++) window.__step(1, 1 / 60, false);
    // aim at the body axis (plus a little lateral jitter), from 3 m away
    const off = ((k % 3) - 1) * 0.08;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const lead = 3 / (opts.leadSp || 1e9);
    const tt = 3 / 1; void tt;
    const cx0 = a.pos.x - dz * off, cz0 = a.pos.z + dx * off;
    // aim where the player will be when the ball arrives
    const arrive = 3 / sp;
    const cx = cx0 + a.vel.x * arrive, cz = cz0 + a.vel.z * arrive; void lead;
    g.ball.reset(cx - dx * 3, cz - dz * 3);
    g.ball.pos.y = h;
    const t = 3 / sp;
    g.ball.vel.set(dx * sp, h > 0.2 ? 4.9 * t : 0, dz * sp);   // gravity compensated so it arrives at height h
    g.ball.spin.set(0, 0, 0); g.ball.lastTouch = null;
    let touched = false;
    const v0 = g.ball.vel.clone();
    g.ball.colliders = [];
    for (let s = 0; s < 40; s++) {
      window.__step(1, 1 / 60, false);
      if (g.ball.lastTouch === a) touched = true;
      for (const e of g.ball.events) if (e.type === 'body') { touched = true; res.byPart[e.part] = (res.byPart[e.part] || 0) + 1; }
      const along = (g.ball.pos.x - a.pos.x) * dx + (g.ball.pos.z - a.pos.z) * dz;
      if (along > 0.8) break;
    }
    // passed through: ended up behind the player still moving the same way, nothing registered
    const along = (g.ball.pos.x - a.pos.x) * dx + (g.ball.pos.z - a.pos.z) * dz;
    const kept = (g.ball.vel.x * v0.x + g.ball.vel.z * v0.z) / (v0.x * v0.x + v0.z * v0.z);
    res.shots++;
    if (touched || kept < 0.9) res.hit++;
    else if (along > 0.5) { res.through++; const key = sp + '@' + h + (opts.byAngle ? '#' + k : ''); res.thr[key] = (res.thr[key] || 0) + 1; }
  }
  return res;
};
