import * as THREE from 'three';

let weave;
export function clothWeave() {
  if (weave) return weave;
  const size = 32, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = Math.round(128 + 34 * Math.sin(x * Math.PI / 4) * Math.cos(y * Math.PI / 4));
    const i = (y * size + x) * 4; data.set([v, v, v, 255], i);
  }
  weave = new THREE.DataTexture(data, size, size);
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping; weave.repeat.set(48, 48);
  weave.generateMipmaps = true; weave.minFilter = THREE.LinearMipmapLinearFilter;
  weave.magFilter = THREE.LinearFilter; weave.needsUpdate = true;
  return weave;
}

const cord = new THREE.CylinderGeometry(1, 1, 1, 6);
const rubber = new THREE.MeshStandardMaterial({ color: 0x222432, roughness: 0.8 });
const lace = new THREE.MeshStandardMaterial({ color: 0xe8edf4, roughness: 0.7 });
const sole = new THREE.CapsuleGeometry(1, 1, 4, 10);
const Y = new THREE.Vector3(0, 1, 0);

/** Small real meshes, attached in the rest pose, follow each animated boot. */
export function addBootDetails(root, bones) {
  root.updateMatrixWorld(true);
  for (const side of ['R', 'L']) {
    const foot = bones['foot' + side], toe = bones['toe' + side];
    if (!foot || !toe) continue;
    const ankle = foot.getWorldPosition(new THREE.Vector3()), tip = toe.getWorldPosition(new THREE.Vector3());
    const forward = tip.clone().sub(ankle).setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(Y, forward).normalize();
    const group = new THREE.Group(); group.name = 'Football boot detail ' + side;
    const frame = new THREE.Matrix4().makeBasis(right, Y, forward);
    group.position.copy(ankle); group.quaternion.setFromRotationMatrix(frame);
    root.add(group); root.updateMatrixWorld(true); foot.attach(group);
    const length = Math.max(0.11, Math.min(0.18, tip.distanceTo(ankle)));
    const base = new THREE.Mesh(sole, rubber); base.name = 'Sole and heel';
    base.rotation.x = Math.PI / 2; base.scale.set(0.043, length * 0.44, 0.008);
    base.position.set(0, -ankle.y + 0.016, length * 0.24); group.add(base);
    const cords = new THREE.InstancedMesh(cord, lace, 8);
    cords.name = 'Crossed boot laces'; const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < 8; i++) {
      const a = new THREE.Vector3(-0.027, -0.006 - (i >> 1) * 0.004, 0.012 + (i >> 1) * 0.015);
      const b = a.clone().add(new THREE.Vector3(0.054, 0, i % 2 ? -0.013 : 0.013));
      const dir = b.clone().sub(a); q.setFromUnitVectors(Y, dir.clone().normalize());
      m.compose(a.add(b).multiplyScalar(0.5), q, new THREE.Vector3(0.0015, dir.length(), 0.0015)); cords.setMatrixAt(i, m);
    }
    cords.instanceMatrix.needsUpdate = true; group.add(cords);
    const studs = new THREE.InstancedMesh(cord, rubber, 6); studs.name = 'Six traction studs';
    for (let i = 0; i < 6; i++) {
      m.compose(new THREE.Vector3(i % 2 ? 0.025 : -0.025, -ankle.y + 0.007, -0.025 + (i >> 1) * length * 0.48), new THREE.Quaternion(), new THREE.Vector3(0.006, 0.008, 0.006)); studs.setMatrixAt(i, m);
    }
    studs.instanceMatrix.needsUpdate = true; group.add(studs);
  }
}
