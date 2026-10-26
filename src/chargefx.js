import * as THREE from 'three';
import { BALL, FIELD } from './config.js';

// Ground-level shot charge display: a ring around the feet that fills
// clockwise (green → yellow → red) plus an arrow showing aim and power.

const ringVert = `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ringFrag = `
  uniform float uProgress; uniform float uTime; uniform float uOpacity; uniform float uPass;
  varying vec2 vP;
  void main(){
    // 0 at the front of the player, increasing clockwise when seen from above
    float a = atan(vP.x, vP.y);
    float f = fract(a / 6.28318 + 1.0);
    vec3 cold = vec3(0.45, 0.95, 0.45), mid = vec3(1.0, 0.82, 0.25), hot = vec3(1.0, 0.3, 0.22);
    vec3 col = f < 0.5 ? mix(cold, mid, f * 2.0) : mix(mid, hot, (f - 0.5) * 2.0);
    // passes: mint → sky → blue
    vec3 pc = f < 0.5 ? mix(vec3(0.54, 0.94, 0.65), vec3(0.31, 0.85, 1.0), f * 2.0) : mix(vec3(0.31, 0.85, 1.0), vec3(0.24, 0.49, 1.0), (f - 0.5) * 2.0);
    col = mix(col, pc, uPass);
    float on = step(f, uProgress);
    float full = step(0.999, uProgress);
    col += full * 0.35 * (0.5 + 0.5 * sin(uTime * 22.0));
    // the unfilled track stays faintly visible so the player sees how far there is to go
    float alpha = mix(0.22, 0.95, on) * uOpacity;
    gl_FragColor = vec4(mix(vec3(1.0), col, on), alpha);
  }`;

const N_DOTS = 40;

export class ChargeFx {
  constructor(scene) {
    this.items = [];
    this.scene = scene;
    // shot preview (only for the players controlled on this screen): dotted flight path + target ring
    const dot = document.createElement('canvas'); dot.width = dot.height = 32;
    const c = dot.getContext('2d'); c.fillStyle = '#fff'; c.beginPath(); c.arc(16, 16, 12, 0, Math.PI * 2); c.fill();
    this.previews = [];
    this._dotTex = new THREE.CanvasTexture(dot);
  }

  _makePreview() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_DOTS * 3), 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ map: this._dotTex, size: 0.42, transparent: true, depthWrite: false, depthTest: false, opacity: 0.95 }));
    pts.frustumCulled = false; pts.renderOrder = 4;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.4, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
    const dotC = new THREE.Mesh(new THREE.CircleGeometry(0.07, 16), ring.material); ring.add(dotC);
    const cross = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.9), ring.material);
    const cross2 = cross.clone(); cross2.rotation.z = Math.PI / 2; cross.add(cross2); ring.add(cross); cross.visible = false;
    ring.renderOrder = 5;
    this.scene.add(pts); this.scene.add(ring);
    return { pts, ring, cross };
  }

  /** where a shot leaves to: a cheap version of the ball physics, stopping at the goal line */
  _simulate(start, vel, goal, out) {
    const p = start.clone(), v = vel.clone(), R = BALL.r, dt = 1 / 60;
    let n = 0, hit = null;
    for (let i = 0; i < 110 && n < N_DOTS; i++) {
      if (p.y > R + 0.002 || v.y > 0.35) {
        v.y -= BALL.gravity * dt;
        const s = v.length(); v.multiplyScalar(Math.max(0, 1 - BALL.drag * s * dt));
      } else {
        v.y = 0; const gs = Math.hypot(v.x, v.z);
        if (gs > 0) { const k = Math.max(0, gs - (BALL.rollDecel + BALL.rollQuad * gs * gs) * dt) / gs; v.x *= k; v.z *= k; }
      }
      p.addScaledVector(v, dt);
      if (p.y < R) { p.y = R; if (v.y < -0.35) v.y = -v.y * BALL.bounce; else v.y = 0; }
      if (goal) {
        const A = goal.axis, line = goal.sign * goal.line;
        if (p[A] * goal.sign >= line) { hit = p.clone(); hit[A] = line; break; }
      }
      if (i % 2 === 0) out.set([p.x, p.y, p.z], 3 * n++);
    }
    return { n, hit };
  }

  _make() {
    const ringMat = new THREE.ShaderMaterial({
      vertexShader: ringVert, fragmentShader: ringFrag, transparent: true, depthWrite: false,
      uniforms: { uProgress: { value: 0 }, uTime: { value: 0 }, uOpacity: { value: 0 }, uPass: { value: 0 } },
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.8, 72, 1), ringMat);
    ring.rotation.x = -Math.PI / 2; ring.renderOrder = 2;

    // arrow: shaft + head drawn in the XY plane pointing +Y, laid flat on the grass
    const shape = new THREE.Shape();
    shape.moveTo(-0.06, 0); shape.lineTo(0.06, 0); shape.lineTo(0.06, 0.78);
    shape.lineTo(0.17, 0.78); shape.lineTo(0, 1); shape.lineTo(-0.17, 0.78); shape.lineTo(-0.06, 0.78); shape.closePath();
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, opacity: 0 });
    const arrow = new THREE.Mesh(new THREE.ShapeGeometry(shape), arrowMat);
    arrow.renderOrder = 2;
    const arrowPivot = new THREE.Group(); arrowPivot.add(arrow);
    arrow.rotation.x = -Math.PI / 2; // shape +Y now lies along the pivot's -Z

    const g = new THREE.Group(); g.add(ring); g.add(arrowPivot);
    this.scene.add(g);
    return { g, ring, ringMat, arrow, arrowMat, arrowPivot, opacity: 0 };
  }

  update(dt, athletes, time, game) {
    while (this.items.length < athletes.length) this.items.push(this._make());
    while (this.previews.length < athletes.length) this.previews.push(this._makePreview());
    const aim = new THREE.Vector3();
    for (let i = athletes.length; i < this.items.length; i++) { this.items[i].g.visible = false; this.items[i].opacity = 0; this.previews[i].pts.visible = this.previews[i].ring.visible = false; }
    athletes.forEach((a, i) => {
      const pv = this.previews[i];
      const type = game?.controllers[i]?.type;
      const mineHere = type === 'human' || type === 'self';
      const shot = a.charging && (a.chargeType === 'kick' || a.chargeType === 'chip') && mineHere && !a.out;
      pv.pts.visible = pv.ring.visible = shot;
      if (!shot) return;
      a.aimDir(aim);
      const plan = a.shotPlan(a.chargeType, Math.max(0.12, a.charge), aim);
      const { speed, elev } = a.strikeSpeed(a.chargeType, Math.max(0.12, a.charge), plan.aim);
      const v = new THREE.Vector3(plan.aim.x * Math.cos(elev) * speed, Math.sin(elev) * speed, plan.aim.z * Math.cos(elev) * speed);
      const b = game.ball.pos;
      const start = Math.hypot(b.x - a.pos.x, b.z - a.pos.z) < 1.4 ? b.clone() : a.pos.clone().addScaledVector(plan.aim, 0.55).setY(BALL.r);
      const arr = pv.pts.geometry.attributes.position.array;
      const { n, hit } = this._simulate(start, v, plan.goal, arr);
      pv.pts.geometry.setDrawRange(0, n); pv.pts.geometry.attributes.position.needsUpdate = true;
      const over = a.charge > 0.95, perfect = plan.perfect;
      let onTarget = false;
      if (hit && plan.goal) {
        const B = plan.goal.axis === 'x' ? 'z' : 'x';
        onTarget = Math.abs(hit[B]) < FIELD.goalHalfW - 0.05 && hit.y < FIELD.goalH - 0.05;
        pv.ring.position.copy(hit).addScaledVector(new THREE.Vector3(plan.goal.inward.x, 0, plan.goal.inward.z), 0.05);
        pv.ring.rotation.set(0, plan.goal.axis === 'x' ? Math.PI / 2 : 0, 0);
        pv.ring.visible = true;
      } else pv.ring.visible = false;
      let col = !onTarget && hit ? 0xff5a4a : over ? 0xff5a4a : perfect ? 0xffd23f : 0xffffff;
      if (a.energy >= 1 && a.chargeType === 'kick' && a.charge >= 0.5) col = a.charDef.color;   // this one will be the special
      pv.ring.material.color.setHex(col); pv.pts.material.color.setHex(col);
      pv.cross.visible = !onTarget && !!hit;
      const s = perfect ? 1 + Math.sin(time * 18) * 0.08 : 1; pv.ring.scale.setScalar(s);
    });
    athletes.forEach((a, i) => {
      const it = this.items[i];
      const target = a.charging || a.armed ? 1 : 0;
      it.opacity += (target - it.opacity) * Math.min(1, dt * (target ? 18 : 8));
      it.g.visible = it.opacity > 0.01;
      if (!it.g.visible) return;
      if (a.charging) it.lastCharge = a.charge; else if (a.armed) it.lastCharge = a.armed.power;
      const c = it.lastCharge ?? 0;
      it.g.position.set(a.pos.x, 0.025, a.pos.z);
      it.ringMat.uniforms.uProgress.value = c;
      it.ringMat.uniforms.uTime.value = time;
      it.ringMat.uniforms.uOpacity.value = it.opacity;
      if (a.charging) it.isPass = a.chargeType === 'pass'; else if (a.armed) it.isPass = a.armed.type === 'pass';
      it.ringMat.uniforms.uPass.value = it.isPass ? 1 : 0;
      // ring "front" follows the player's facing
      it.ring.rotation.z = a.facing + Math.PI;
      // arrow along the aim, longer with more power, colour shifts with power
      a.aimDir(aim);
      it.arrowPivot.rotation.y = Math.atan2(aim.x, aim.z) + Math.PI;
      let len = 0.9 + 1.6 * c;
      if (it.isPass) {
        // a pass arrow reaches out towards where the ball will be played
        const r = a.passTo || a.mate;
        if (r) { const t = a.passLead(r, c); len = Math.max(0.6, Math.min(Math.hypot(t.x - a.pos.x, t.z - a.pos.z) - 1.1, 0.8 + 3.2 * c)); }
        it.arrowMat.color.setHSL(0.42 + 0.18 * c, 0.85, 0.62);
      } else it.arrowMat.color.setHSL(0.33 - 0.33 * c, 0.9, 0.6);
      it.arrow.scale.set(1, len, 1);
      it.arrow.position.z = -0.85; // start just outside the ring
      it.arrowMat.opacity = 0.85 * it.opacity;
    });
  }
}
