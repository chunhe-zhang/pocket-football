// Scripted "simple human": waits for passes, dribbles towards the best goal, shoots inside 9 m.
window.__humanRun = (secs = 240) => {
  const g = window.__game, me = g.athletes[0];
  const c = { pass: 0, recv: 0, shots: 0, goals: [], tr: [] };
  g.input.intent = (scheme, out) => out;   // the script drives the human's intent directly
  for (const a of g.athletes) {
    const oc = a._contact.bind(a);
    a._contact = (ft) => { const t = a.kick && a.kick.type; oc(ft); if (t === 'pass' && a.kick && a.kick.hit) c.pass++; };
  }
  const og = g.goal.bind(g);
  g.goal = (t) => { c.goals.push([g.time.toFixed(0), 'in' + t, 'by' + (g.ball.lastTouch ? g.ball.lastTouch.team : -1)]); og(t); };
  let hold = 0, had = false;
  for (let s = 0; s < 60 * secs && !g.endShown; s++) {
    const it = me.intent;
    it.kick = false; it.tackle = false; it.sprint = false;
    if (!me.out) {
      const mine = g.possessor === me;
      if (mine && !had) c.recv++;
      had = mine;
      if (mine || hold > 0) {
        const t = me.goalTarget();
        const dx = t.x - me.pos.x, dz = t.z - me.pos.z, d = Math.hypot(dx, dz);
        it.move.set(dx / d, dz / d);
        if (d < 9 || hold > 0) { hold++; it.kick = hold < 35; if (hold === 1) c.shots++; if (hold > 60) hold = 0; }
      } else {
        const b = g.ball.pos, dx = b.x - me.pos.x, dz = b.z - me.pos.z, d = Math.hypot(dx, dz);
        if (d < 4 && d > 0.3) it.move.set(dx / d, dz / d); else it.move.set(0, 0);
      }
    }
    window.__step(1, 1 / 60, false);
    const bp = g.ball.pos;
    if (g.state === 'play' && c._lb && Math.hypot(bp.x - c._lb[0], bp.z - c._lb[1]) < 0.01) c._still = (c._still || 0) + 1; else c._still = 0;
    c._lb = [bp.x, bp.z];
    if (c._still === 600 && !c.stall) c.stall = { t: +g.time.toFixed(0), ball: [+bp.x.toFixed(2), +bp.z.toFixed(2)], who: g.live.map((a) => ({ i: a.team, pos: [+a.pos.x.toFixed(1), +a.pos.z.toFixed(1)], intent: [+a.intent.move.x.toFixed(2), +a.intent.move.y.toFixed(2)], frozen: a.frozen, ctl: g.controllers[a.team].type, plan: g.controllers[a.team].ai ? [+g.controllers[a.team].ai.plan.move.x.toFixed(2), +g.controllers[a.team].ai.plan.move.y.toFixed(2)] : null, think: g.controllers[a.team].ai?.think })) };
    if (s % 180 === 0) c.tr.push([Math.round(s / 60), +me.pos.x.toFixed(1), +me.pos.z.toFixed(1), +Math.hypot(g.ball.pos.x - me.pos.x, g.ball.pos.z - me.pos.z).toFixed(1), g.possessor ? g.possessor.label : '-', g.state]);
  }
  delete c.tr; return { t: +g.time.toFixed(0), ended: g.endShown, winner: g.results()[0].name, c };
};
