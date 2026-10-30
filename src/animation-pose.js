/** Keep additive bone layers out of the animation mixer's cached base pose. */
export class AnimationPose {
  sample(root, mixer, dt) {
    if (this.bones) for (const p of this.bones) {
      p.b.quaternion.copy(p.q); p.b.position.copy(p.p); p.b.scale.copy(p.s);
    }
    mixer.update(dt);
    if (!this.bones) {
      this.bones = [];
      root.traverse(b => { if (b.isBone) this.bones.push({ b, q: b.quaternion.clone(), p: b.position.clone(), s: b.scale.clone() }); });
    } else for (const p of this.bones) {
      p.q.copy(p.b.quaternion); p.p.copy(p.b.position); p.s.copy(p.b.scale);
    }
  }
}
