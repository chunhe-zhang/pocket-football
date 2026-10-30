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
const fittedLaces = new Map();

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
    group.userData.detailDistance = 18;
    const frame = new THREE.Matrix4().makeBasis(right, Y, forward);
    group.position.copy(ankle); group.quaternion.setFromRotationMatrix(frame);
    root.add(group); root.updateMatrixWorld(true); foot.attach(group);
    const length = Math.max(0.11, Math.min(0.18, tip.distanceTo(ankle)));
    const base = new THREE.Mesh(sole, rubber); base.name = 'Sole and heel';
    base.rotation.x = Math.PI / 2; base.scale.set(0.043, length * 0.44, 0.008);
    base.position.set(0, -ankle.y + 0.016, length * 0.24); group.add(base);
    const cords = new THREE.InstancedMesh(cord, lace, 32);
    cords.name = 'Crossed boot laces'; const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const cacheKey = side + ':' + length.toFixed(4);
    let matrices = fittedLaces.get(cacheKey);
    if (!matrices) {
      matrices = []; const shoes = [];
      root.traverse(o => { if (o.isSkinnedMesh && [].concat(o.material).some(m => /SHOES/i.test(m.name))) shoes.push(o); });
      const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
      const surface = (point) => {
        const world = group.localToWorld(point.clone());
        ray.set(world.clone().addScaledVector(Y, 0.3), down);
        const hit = ray.intersectObjects(shoes, false)[0];
        if (hit) return group.worldToLocal(hit.point.clone().addScaledVector(Y, 0.002));
        return point;
      };
      for (let i = 0; i < 8; i++) {
        const row = i >> 1, odd = i % 2;
        const az = 0.06 + (row + odd) * 0.01, bz = 0.06 + (row + 1 - odd) * 0.01;
        const a = new THREE.Vector3(-0.014, -0.031, az), b = new THREE.Vector3(0.014, -0.031, bz);
        for (let part = 0; part < 4; part++) {
          const p0 = surface(a.clone().lerp(b, part / 4)), p1 = surface(a.clone().lerp(b, (part + 1) / 4));
          const dir = p1.clone().sub(p0); q.setFromUnitVectors(Y, dir.clone().normalize());
          matrices.push(new THREE.Matrix4().compose(p0.add(p1).multiplyScalar(0.5), q, new THREE.Vector3(0.0015, dir.length(), 0.0015)));
        }
      }
      fittedLaces.set(cacheKey, matrices);
    }
    matrices.forEach((matrix, i) => cords.setMatrixAt(i, matrix));
    cords.instanceMatrix.needsUpdate = true; group.add(cords);
    const studs = new THREE.InstancedMesh(cord, rubber, 6); studs.name = 'Six traction studs';
    for (let i = 0; i < 6; i++) {
      m.compose(new THREE.Vector3(i % 2 ? 0.025 : -0.025, -ankle.y + 0.007, -0.025 + (i >> 1) * length * 0.48), new THREE.Quaternion(), new THREE.Vector3(0.006, 0.008, 0.006)); studs.setMatrixAt(i, m);
    }
    studs.instanceMatrix.needsUpdate = true; group.add(studs);
  }
}
