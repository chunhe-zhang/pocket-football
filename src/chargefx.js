import * as THREE from 'three';

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

export class ChargeFx {
  constructor(scene) {
    this.items = [];
    this.scene = scene;
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

  update(dt, athletes, time) {
    while (this.items.length < athletes.length) this.items.push(this._make());
    const aim = new THREE.Vector3();
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
