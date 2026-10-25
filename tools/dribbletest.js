// Injected into the page: scripted dribbling courses, reports ball losses.
window.__dribble = (course, sprint = false) => {
  const g = window.__game, a = g.athletes[0];
  g.state = 'play';
  for (const x of g.athletes) x.frozen = false;
  g.controllers = [{ type: 'script' }, { type: 'script' }, { type: 'script' }, { type: 'script' }];
  g.athletes.forEach((x, i) => { if (i) x.place(30 + i * 3, 30, 0); x.intent.move.set(0, 0); });
  a.place(-6, 0, Math.PI / 2); a.stamina = 1;
  g.ball.reset(-5.45, 0); g.ball.lastTouch = a; a.lastTouchTime = g.time;
  const steps = 60 * course.dur;
  let lost = 0, maxD = 0, losing = false, sum = 0, n = 0, lossAt = [], footGap = [], prevDone = false;
  for (let i = 0; i < steps; i++) {
    const t = i / 60;
    const [mx, mz] = course.f(t, a);
    a.intent.move.set(mx, mz); a.intent.sprint = sprint; a.intent.kick = a.intent.lob = a.intent.tackle = false;
    window.__step(1, 1 / 60, false);
    const d = Math.hypot(g.ball.pos.x - a.pos.x, g.ball.pos.z - a.pos.z);
    // how far was the touching boot from the ball when the touch happened?
    const done = !!(a.touch && a.touch.done);
    if (done && !prevDone) {
      const side = a.touch.side === 'Left' ? 'L' : 'R';
      const toe = a.char.footPos(side), ank = a.char.anklePos(side);
      const ab = toe.clone().sub(ank), u = Math.max(0, Math.min(1, g.ball.pos.clone().sub(ank).dot(ab) / ab.lengthSq()));
      footGap.push(Math.max(0, ank.clone().addScaledVector(ab, u).distanceTo(g.ball.pos) - 0.16));
    }
    prevDone = done;
    if (t > 0.5) { maxD = Math.max(maxD, d); sum += d; n++; }
    if (d > 2.2 && !losing) { lost++; losing = true; lossAt.push(t.toFixed(1)); }
    if (d < 1.2) losing = false;
  }
  footGap.sort((x, y) => x - y);
  const med = footGap.length ? footGap[Math.floor(footGap.length / 2)] : -1, p90 = footGap.length ? footGap[Math.floor(footGap.length * 0.9)] : -1;
  return { lost, maxD: +maxD.toFixed(2), avgD: +(sum / n).toFixed(2), lossAt, touches: footGap.length, gapMed: +med.toFixed(2), gap90: +p90.toFixed(2) };
};
window.__courses = {
  straight: { dur: 3, f: () => [1, 0] },
  zigzag: { dur: 6, f: (t) => [0.7, Math.sin(t * 2.4) > 0 ? 0.7 : -0.7] },
  circle: { dur: 6, f: (t) => [Math.cos(t * 1.6), Math.sin(t * 1.6)] },
  uturn: { dur: 4, f: (t) => (t < 1.5 ? [1, 0] : [-1, 0]) },
  rightAngle: { dur: 4, f: (t) => (t < 1.2 ? [1, 0] : [0, 1]) },
  stopGo: { dur: 5, f: (t) => ((t % 1.2) < 0.6 ? [1, 0.2] : [0, 0]) },
  wiggle: { dur: 5, f: (t) => { const a = Math.sin(t * 7) * 1.2; return [Math.cos(a), Math.sin(a)]; } },
};
window.__suite = () => {
  const out = {};
  for (const [k, c] of Object.entries(window.__courses)) {
    out[k] = window.__dribble(c, false);
    out[k + '+sprint'] = window.__dribble(c, true);
  }
  return out;
};
