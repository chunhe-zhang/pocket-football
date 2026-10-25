// Standing-tackle odds: a dribbler runs forward, a defender pokes from a given angle.
window.__tackle = (from = 'front', skill = null, n = 12) => {
  const g = window.__game, A = g.athletes[0], D = g.athletes[1];
  g.state = 'play';
  g.controllers = g.athletes.map(() => ({ type: 'script' }));
  let won = 0, tried = 0, dodged = 0, kept = 0; const log = [];
  for (let k = 0; k < n; k++) {
    g.athletes.forEach((x, i) => { if (i > 1) x.place(30 + i * 3, 30, 0); x.frozen = false; x.intent.move.set(0, 0); x.intent.tackle = x.intent.sprint = x.intent.kick = false; x.slideCD = 0; x.skillCD = 0; });
    A.place(-4, 0, Math.PI / 2); g.ball.reset(-3.45, 0); g.ball.lastTouch = A; A.lastTouchTime = g.time;
    const off = { front: [2.2, 0], side: [0.4, 1.6], behind: [-2.0, 0.05] }[from];
    D.place(-4 + off[0] + 1.2, off[1] + (Math.random() - 0.5) * 0.3, 0);
    for (let s = 0; s < 40; s++) { A.intent.move.set(1, 0); window.__step(1, 1 / 60, false); }
    // defender closes and pokes; the carrier may try a skill at the same moment
    let poked = false, t0 = -1;
    for (let s = 0; s < 90; s++) {
      A.intent.move.set(skill === 'drag' && t0 >= 0 ? 0 : (from === 'front' ? 1 : 0.4), skill === 'drag' && t0 >= 0 ? 1 : 0);
      A.intent.tackle = false; D.intent.tackle = false;
      const dx = g.ball.pos.x - D.pos.x, dz = g.ball.pos.z - D.pos.z, d = Math.hypot(dx, dz);
      if (poked) D.intent.move.set(0, 0); else D.intent.move.set(dx / d, dz / d);
      if (!poked && d < 1.5) { D.intent.tackle = true; poked = true; t0 = s; if (skill) A.intent.tackle = true; }
      if (skill && t0 >= 0 && s === t0 - 1) A.intent.tackle = true;
      window.__step(1, 1 / 60, false);
      if (D.poke && D.poke.done) { log.push([D.poke.ok, A.skill ? A.skill.type : (A._lastSkill || '-'), +Math.hypot(g.ball.pos.x - D.pos.x, g.ball.pos.z - D.pos.z).toFixed(2)]); break; }
      if (poked && !D.poke && s > t0 + 2) { log.push(['nopoke', D.slide ? 'slide' : D.dive ? 'dive' : '?', +d.toFixed(2)]); break; }
    }
    for (let s = 0; s < 20; s++) { A.intent.move.set(1, 0); D.intent.move.set(0, 0); D.intent.tackle = A.intent.tackle = false; window.__step(1, 1 / 60, false); }
    if (poked) tried++;
    if (g.ball.lastTouch === D) won++;
    else if (g.ball.lastTouch === A && Math.hypot(g.ball.pos.x - A.pos.x, g.ball.pos.z - A.pos.z) < 1.6) kept++;
    if (A.stats.skills) dodged++;
  }
  return { from, skill, tried, won, kept, log: log.slice(0, 6) };
};
