// Shot precision: from a spot, aim at a point on the goal line, charge for `frames`, measure where it crosses.
window.__shots = (frames, n = 10) => {
  const g = window.__game, A = g.athletes[0];
  g.state = 'play';
  g.controllers = g.athletes.map(() => ({ type: 'script' }));
  const goal = g.goals[1];   // the +x goal
  const res = { frames, n: 0, onTarget: 0, err: [], perfect: 0 };
  for (let k = 0; k < n; k++) {
    g.athletes.forEach((x, i) => { if (i) x.place(30 + i * 3, 30, 0); x.frozen = false; x.intent.move.set(0, 0); x.intent.kick = false; });
    g.alive = [true, true, true, true];
    const sx = 3 + (k % 3) * 1.5, sz = (k % 5 - 2) * 1.6;
    A.place(sx, sz, Math.PI / 2); g.ball.reset(sx + 0.55, sz); g.ball.lastTouch = A; A.lastTouchTime = g.time;
    window.__step(10, 1 / 60, false);
    const tz = (k % 2 ? 1 : -1) * 1.15;              // aim for a corner
    const plans = [];
    for (let s = 0; s < frames + 1; s++) {
      const dx = goal.centre.x - A.pos.x, dz = tz - A.pos.z, d = Math.hypot(dx, dz);
      A.intent.move.set(dx / d * 0.35, dz / d * 0.35); A.intent.kick = s < frames;
      window.__step(1, 1 / 60, false);
    }
    A.intent.kick = false;
    let cross = null;
    for (let s = 0; s < 120 && !cross; s++) {
      const dx = goal.centre.x - A.pos.x, dz = tz - A.pos.z, d = Math.hypot(dx, dz);
      A.intent.move.set(dx / d * 0.35, dz / d * 0.35);
      window.__step(1, 1 / 60, false);
      if (g.ball.pos.x >= 12 - 0.17 && !cross) cross = { z: g.ball.pos.z, y: g.ball.pos.y };
      if (A.kick && A.kick.perfect && s < 3) res.perfect++;
    }
    res.n++;
    if (cross) {
      if (Math.abs(cross.z) < 1.6 && cross.y < 1.7) res.onTarget++;
      res.err.push(+Math.abs(cross.z - tz).toFixed(2));
    } else res.err.push(-1);
  }
  const e = res.err.filter((x) => x >= 0).sort((a, b) => a - b);
  res.median = e.length ? e[Math.floor(e.length / 2)] : -1;
  return res;
};
