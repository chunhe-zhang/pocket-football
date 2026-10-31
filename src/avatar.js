import * as THREE from 'three';
import { Expressions } from './expressions.js';
import { addBootDetails, clothWeave } from './avatar-details.js';
import { clone as cloneSkinned } from '../vendor/three/addons/utils/SkeletonUtils.js';

// -----------------------------------------------------------------------------
// Avatar loading for VRM 1.0 models (VRoid etc.) without extra libraries:
//  * humanoid bone lookup from the VRMC_vrm extension
//  * retargeting of Mixamo animation clips onto the VRM skeleton
//  * a small spring-bone simulation (hair, skirt, sleeves) from VRMC_springBone
//  * expressions (blink, happy, sad…) from VRMC_vrm morph target binds
//  * toon shading with inverted-hull outlines, team-coloured kit
// -----------------------------------------------------------------------------

// Mixamo bone -> VRM humanoid bone
const MIXAMO_TO_VRM = {
  Hips: 'hips', Spine: 'spine', Spine1: 'chest', Spine2: 'upperChest', Neck: 'neck', Head: 'head',
  LeftShoulder: 'leftShoulder', LeftArm: 'leftUpperArm', LeftForeArm: 'leftLowerArm', LeftHand: 'leftHand',
  RightShoulder: 'rightShoulder', RightArm: 'rightUpperArm', RightForeArm: 'rightLowerArm', RightHand: 'rightHand',
  LeftUpLeg: 'leftUpperLeg', LeftLeg: 'leftLowerLeg', LeftFoot: 'leftFoot', LeftToeBase: 'leftToes',
  RightUpLeg: 'rightUpperLeg', RightLeg: 'rightLowerLeg', RightFoot: 'rightFoot', RightToeBase: 'rightToes',
};
for (const s of ['Left', 'Right']) {
  const l = s.toLowerCase();
  for (const [m, v] of [['Thumb', 'Thumb'], ['Index', 'Index'], ['Middle', 'Middle'], ['Ring', 'Ring'], ['Pinky', 'Little']]) {
    const parts = v === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal'];
    parts.forEach((p, i) => { MIXAMO_TO_VRM[`${s}Hand${m}${i + 1}`] = `${l}${v}${p}`; });
  }
}

// gameplay-facing bone keys -> VRM humanoid names
const KEYS = {
  hips: 'hips', spine: 'spine', spine1: 'chest', spine2: 'upperChest', neck: 'neck', head: 'head',
  upLegR: 'rightUpperLeg', legR: 'rightLowerLeg', footR: 'rightFoot', toeR: 'rightToes',
  upLegL: 'leftUpperLeg', legL: 'leftLowerLeg', footL: 'leftFoot', toeL: 'leftToes',
  armL: 'leftUpperArm', foreL: 'leftLowerArm', armR: 'rightUpperArm', foreR: 'rightLowerArm',
  handL: 'leftHand', handR: 'rightHand',
  eyeL: 'leftEye', eyeR: 'rightEye',
};

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);

function worldQuat(o) { o.updateWorldMatrix(true, false); return o.getWorldQuaternion(new THREE.Quaternion()); }

/** Everything that can be computed once per model file and shared by all players. */
export class AvatarTemplate {
  constructor(vrmGltf, mixamoGltf, mocap = null) {
    this.gltf = vrmGltf;
    const json = vrmGltf.parser.json;
    this.ext = json.extensions || {};
    const vrm = this.ext.VRMC_vrm;
    if (!vrm) throw new Error('Not a VRM 1.0 model');

    // glTF node index -> object, and object -> traversal order (to find the same node in clones)
    this.nodeObjects = [];
    for (const [obj, ref] of vrmGltf.parser.associations) if (ref && ref.nodes !== undefined && !this.nodeObjects[ref.nodes]) this.nodeObjects[ref.nodes] = obj;
    this.order = new Map(); let i = 0;
    vrmGltf.scene.traverse((o) => this.order.set(o, i++));

    vrmGltf.scene.updateMatrixWorld(true);
    this.human = {};
    for (const [name, b] of Object.entries(vrm.humanoid.humanBones)) this.human[name] = this.nodeObjects[b.node];

    const box = new THREE.Box3().setFromObject(vrmGltf.scene);
    this.height = box.max.y - box.min.y;

    this.clips = this._retargetAll(mixamoGltf);
    if (mocap) {
      Object.assign(this.clips, this._retargetMocap(mocap));
      for (const take of mocap.supplements || []) Object.assign(this.clips, this._retargetMocap(take));
    }
    this.expressions = vrm.expressions?.preset || {};
    this.springData = this.ext.VRMC_springBone || null;
  }

  _retargetAll(src) {
    src.scene.updateMatrixWorld(true);
    const srcRest = {}, srcParentRest = {};
    src.scene.traverse((o) => {
      if (!o.isBone && !/mixamorig/.test(o.name)) return;
      srcRest[o.name] = worldQuat(o);
      srcParentRest[o.name] = worldQuat(o.parent);
    });
    const srcHips = src.scene.getObjectByName('mixamorigHips');
    const srcHipsY = srcHips.getWorldPosition(new THREE.Vector3()).y;
    const tHips = this.human.hips;
    const tHipsLocal = tHips.position.clone();
    const tHipsY = tHips.getWorldPosition(new THREE.Vector3()).y;
    const tRest = {}, tParentRest = {};
    for (const [name, o] of Object.entries(this.human)) { tRest[name] = worldQuat(o); tParentRest[name] = worldQuat(o.parent); }

    const out = {};
    for (const clip of src.animations) {
      const tracks = [];
      for (const tr of clip.tracks) {
        const [bone, prop] = tr.name.split('.');
        const vname = MIXAMO_TO_VRM[bone.replace('mixamorig', '').replace(':', '')];
        const target = vname && this.human[vname];
        if (!target) continue;
        if (prop === 'quaternion') {
          const Sp = srcParentRest[bone], SbInv = srcRest[bone].clone().invert();
          const WpInv = tParentRest[vname].clone().invert(), Wb = tRest[vname];
          const v = tr.values.slice();
          for (let k = 0; k < v.length; k += 4) {
            _q.fromArray(v, k);
            // target local = Wp^-1 · Sp · q · Sb^-1 · Wb
            _q2.copy(WpInv).multiply(Sp).multiply(_q).multiply(SbInv).multiply(Wb);
            _q2.toArray(v, k);
          }
          tracks.push(new THREE.QuaternionKeyframeTrack(`${target.name}.quaternion`, tr.times, v));
        } else if (prop === 'position' && vname === 'hips') {
          // vertical bob only, scaled to the new leg length; horizontal root motion is driven by gameplay
          const v = tr.values.slice(), r = tHipsY / (srcHipsY * 100) * 100;
          const parentScale = srcHips.parent.getWorldScale(new THREE.Vector3()).y;
          for (let k = 0; k < v.length; k += 3) {
            const yWorld = v[k + 1] * parentScale;
            v[k] = tHipsLocal.x; v[k + 1] = tHipsLocal.y + (yWorld * r - tHipsY); v[k + 2] = tHipsLocal.z;
          }
          tracks.push(new THREE.VectorKeyframeTrack(`${target.name}.position`, tr.times, v));
        }
      }
      out[clip.name] = new THREE.AnimationClip(clip.name, clip.duration, tracks);
    }
    return out;
  }

  /**
   * The motion-capture pack (assets/anim/mocap.json: Mixamo rig rest pose + quaternion tracks) onto the
   * VRM skeleton, the same way as the glTF clips. Every clip also gets a mirrored copy ("name@M"), the
   * left/right of it swapped, so a dive or a tackle can go either way.
   */
  _retargetMocap(raw) {
    const tRest = {}, tParentRest = {};
    for (const [name, o] of Object.entries(this.human)) { tRest[name] = worldQuat(o); tParentRest[name] = worldQuat(o.parent); }
    const tHips = this.human.hips, hp = tHips.position.clone(), tHipsY = tHips.getWorldPosition(new THREE.Vector3()).y;
    const Q = (a) => new THREE.Quaternion().fromArray(a);
    const mir = (b) => (b.startsWith('Left') ? 'Right' + b.slice(4) : b.startsWith('Right') ? 'Left' + b.slice(5) : b);
    const out = {};
    for (const [name, c] of Object.entries(raw.clips)) for (const mirror of [false, true]) {
      const tracks = [];
      // turns and cuts: the hips' turn about the vertical is taken out of the clip and kept as a curve,
      // so the game can turn the whole body itself (in step with the clip) and blending never spins the hips
      const deyaw = /^(turn|cut)/.test(name);
      let yawCurve = null;
      // A looping gait captured with the actor facing away from the run (and_dribble_run is ~165° off):
      // take that constant heading out of the hips so it blends with the other gaits instead of
      // twisting the body side-on part-way through the blend (or running it backwards at full weight).
      let yawFix = null;
      if (c.loop && !deyaw) {
        const hq = c.tr.find((tr) => tr.b === 'Hips' && tr.p === 'q');
        if (hq && raw.rest.Hips) {
          const Sp = Q(raw.prest.Hips), SbInv = Q(raw.rest.Hips).invert();
          let sx = 0, cz = 0;
          for (let k = 0; k < hq.v.length; k += 4) {
            _q.fromArray(hq.v, k); _q2.copy(Sp).multiply(_q).multiply(SbInv);
            if (mirror) _q2.set(_q2.x, -_q2.y, -_q2.z, _q2.w);
            _v.set(0, 0, 1).applyQuaternion(_q2); const a = Math.atan2(_v.x, _v.z); sx += Math.sin(a); cz += Math.cos(a);
          }
          const mean = Math.atan2(sx, cz);
          if (Math.abs(mean) > 1) yawFix = new THREE.Quaternion().setFromAxisAngle(_Y, -mean);
        }
      }
      for (const tr of c.tr) {
        const vname = MIXAMO_TO_VRM[mirror ? mir(tr.b) : tr.b], target = vname && this.human[vname];
        if (!target || !raw.rest[tr.b]) continue;
        if (tr.p === 'q') {
          const Sp = Q(raw.prest[tr.b]), SbInv = Q(raw.rest[tr.b]).invert();
          const WpInv = tParentRest[vname].clone().invert(), Wb = tRest[vname];
          const v = new Float32Array(tr.v.length);
          for (let k = 0; k < v.length; k += 4) {
            _q.fromArray(tr.v, k);
            _q2.copy(Sp).multiply(_q).multiply(SbInv);                       // the rotation in the rest-world frame
            if (mirror) _q2.set(_q2.x, -_q2.y, -_q2.z, _q2.w);                  // reflected left ↔ right
            if (yawFix && vname === 'hips') _q2.premultiply(yawFix);
            if (deyaw && vname === 'hips') {
              _v.set(0, 0, 1).applyQuaternion(_q2);
              let yaw = Math.atan2(_v.x, _v.z);
              if (k > 0) { const prev = yawCurve.v[k / 4 - 1]; yaw = prev + Math.atan2(Math.sin(yaw - prev), Math.cos(yaw - prev)); }
              (yawCurve ||= { t: tr.t, v: [] }).v.push(yaw);
              _q.setFromAxisAngle(_Y, -yaw); _q2.premultiply(_q);
            }
            _q2.premultiply(WpInv).multiply(Wb);
            _q2.toArray(v, k);
          }
          tracks.push(new THREE.QuaternionKeyframeTrack(`${target.name}.quaternion`, tr.t, v));
        } else if (tr.p === 'hy' && vname === 'hips') {
          const v = new Float32Array(tr.v.length * 3);
          tr.v.forEach((r, i) => { v[i * 3] = hp.x; v[i * 3 + 1] = hp.y + tHipsY * (r - 1); v[i * 3 + 2] = hp.z; });
          tracks.push(new THREE.VectorKeyframeTrack(`${target.name}.position`, tr.t, v));
        }
      }
      const clip = new THREE.AnimationClip(mirror ? name + '@M' : name, c.d, tracks);
      clip.userData = { ...(yawCurve ? { yaw: yawCurve } : {}), ...(c.contact !== undefined ? { contact: c.contact } : {}) };
      out[clip.name] = clip;
    }
    return out;
  }

  /** Clone the model for one player. */
  instantiate(kit) {
    const root = cloneSkinned(this.gltf.scene);
    const list = []; root.traverse((o) => list.push(o));
    const map = (orig) => (orig ? list[this.order.get(orig)] : null);
    const node = (i) => map(this.nodeObjects[i]);
    const bones = {};
    for (const [k, v] of Object.entries(KEYS)) bones[k] = map(this.human[v]);
    // finger joints (thumb left alone): [proximal, intermediate, distal] for each finger, per hand
    bones.fingers = { L: [], R: [] };
    for (const [s, side] of [['L', 'left'], ['R', 'right']]) for (const f of ['Index', 'Middle', 'Ring', 'Little']) {
      const chain = ['Proximal', 'Intermediate', 'Distal'].map((p) => map(this.human[`${side}${f}${p}`]));
      if (chain.every(Boolean)) bones.fingers[s].push(chain);
    }
    const avatar = {
      root, bones, node,
      constraints: new NodeConstraints(this.gltf.parser.json, node),
      springs: this.springData ? new SpringBones(this.springData, node) : null,
      expressions: new Expressions(this.expressions, node),
    };
    styleAvatar(root, kit, this.authoredElement || this.authoredThunder);
    addBootDetails(root, bones);
    return avatar;
  }
}

// ---- node constraints (VRMC_node_constraint: aim / roll / rotation) ------------
// VRoid rigs use these for shoulder/sleeve helpers and twist bones; without them
// sleeves stay in the T-pose while the arms move.
const AXES = { PositiveX: [1, 0, 0], NegativeX: [-1, 0, 0], PositiveY: [0, 1, 0], NegativeY: [0, -1, 0], PositiveZ: [0, 0, 1], NegativeZ: [0, 0, -1], X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
class NodeConstraints {
  constructor(json, node) {
    this.list = [];
    (json.nodes || []).forEach((n, i) => {
      const c = n.extensions?.VRMC_node_constraint?.constraint; if (!c) return;
      const dst = node(i); if (!dst) return;
      const type = c.aim ? 'aim' : c.roll ? 'roll' : c.rotation ? 'rotation' : null; if (!type) return;
      const d = c[type], src = node(d.source); if (!src) return;
      const item = { type, dst, src, weight: d.weight ?? 1, dstRest: dst.quaternion.clone(), srcRest: src.quaternion.clone() };
      if (type === 'aim') item.axis = new THREE.Vector3().fromArray(AXES[d.aimAxis]);
      if (type === 'roll') {
        item.axis = new THREE.Vector3().fromArray(AXES[d.rollAxis]);
        item.srcToDst = item.srcRest.clone().invert().multiply(item.dstRest); // srcRest^-1 · dstRest
        item.dstToSrc = item.srcToDst.clone().invert();
      }
      if (type === 'rotation') { item.srcToDst = item.srcRest.clone().invert().multiply(item.dstRest); item.dstToSrc = item.srcToDst.clone().invert(); }
      this.list.push(item);
    });
    // aims first: their helpers are parents of some roll bones
    this.list.sort((a, b) => (a.type === 'aim' ? 0 : 1) - (b.type === 'aim' ? 0 : 1));
  }
  update() {
    const q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), pq = new THREE.Quaternion(), a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const c of this.list) {
      if (c.type === 'aim') {
        c.dst.quaternion.copy(c.dstRest);
        c.dst.updateWorldMatrix(true, false);
        c.dst.parent.getWorldQuaternion(pq);
        const restWorld = q.copy(pq).multiply(c.dstRest);
        const from = a.copy(c.axis).applyQuaternion(restWorld).normalize();
        c.src.updateWorldMatrix(true, false);
        const to = c.src.getWorldPosition(b).sub(c.dst.getWorldPosition(new THREE.Vector3())).normalize();
        const delta = q2.setFromUnitVectors(from, to);
        const targetWorld = delta.multiply(restWorld);
        const local = pq.invert().multiply(targetWorld);
        c.dst.quaternion.copy(c.dstRest).slerp(local, c.weight);
      } else {
        // source rotation relative to its rest, expressed in the destination's rest frame
        const delta = q.copy(c.srcRest).invert().multiply(c.src.quaternion);
        const inDst = q2.copy(c.dstToSrc).multiply(delta).multiply(c.srcToDst);
        if (c.type === 'roll') {
          // twist part about the roll axis
          a.set(inDst.x, inDst.y, inDst.z);
          const p = c.axis.clone().multiplyScalar(a.dot(c.axis));
          inDst.set(p.x, p.y, p.z, inDst.w).normalize();
        }
        q.identity().slerp(inDst, c.weight);
        c.dst.quaternion.copy(c.dstRest).multiply(q);
      }
      c.dst.updateMatrixWorld(true);
    }
  }
}

// ---- spring bones --------------------------------------------------------------
class SpringBones {
  constructor(data, node) {
    this.chains = [];
    const colliders = (data.colliders || []).map((c) => {
      const o = node(c.node);
      if (c.shape.sphere) return { o, type: 'sphere', offset: new THREE.Vector3().fromArray(c.shape.sphere.offset || [0, 0, 0]), radius: c.shape.sphere.radius };
      const cap = c.shape.capsule;
      return { o, type: 'capsule', offset: new THREE.Vector3().fromArray(cap.offset || [0, 0, 0]), tail: new THREE.Vector3().fromArray(cap.tail || [0, 0, 0]), radius: cap.radius };
    });
    const groups = (data.colliderGroups || []).map((g) => g.colliders.map((i) => colliders[i]));
    for (const s of data.springs || []) {
      const cols = (s.colliderGroups || []).flatMap((g) => groups[g] || []);
      const joints = [];
      for (let i = 0; i < s.joints.length - 1; i++) {
        const j = s.joints[i], bone = node(j.node), child = node(s.joints[i + 1].node);
        if (!bone || !child) continue;
        joints.push({
          bone, child,
          stiffness: j.stiffness ?? 1, drag: j.dragForce ?? 0.5, gravity: j.gravityPower ?? 0,
          gravityDir: new THREE.Vector3().fromArray(j.gravityDir || [0, -1, 0]), hitRadius: j.hitRadius ?? 0,
          axis: child.position.clone().normalize(), restLocal: bone.quaternion.clone(),
          length: 0, tail: new THREE.Vector3(), prevTail: new THREE.Vector3(),
        });
      }
      if (joints.length) this.chains.push({ joints, cols });
    }
    this.needsReset = true;
  }

  reset() {
    for (const c of this.chains) for (const j of c.joints) {
      j.bone.quaternion.copy(j.restLocal);
      j.bone.updateWorldMatrix(true, true);
      j.child.getWorldPosition(j.tail); j.prevTail.copy(j.tail);
      j.length = j.bone.getWorldPosition(_v).distanceTo(j.tail);
    }
    this.needsReset = false;
    this.accumulator = 0;
  }

  update(dt) {
    if (this.needsReset) this.reset();
    if (dt <= 0) return;
    // The Verlet coefficients were authored for 60 Hz. A fixed simulation
    // step prevents display refresh rate and thumbnail cadence changing them.
    this.accumulator = Math.min(0.1, (this.accumulator || 0) + dt);
    while (this.accumulator + 1e-9 >= 1 / 60) {
      this._step(1 / 60);
      this.accumulator -= 1 / 60;
    }
  }

  _step(dt) {
    const pos = new THREE.Vector3(), parentQ = new THREE.Quaternion(), restDir = new THREE.Vector3();
    const next = new THREE.Vector3(), tmp = new THREE.Vector3(), c0 = new THREE.Vector3(), c1 = new THREE.Vector3();
    for (const ch of this.chains) {
      for (const j of ch.joints) {
        j.bone.quaternion.copy(j.restLocal);
        j.bone.updateWorldMatrix(true, false);
        j.bone.getWorldPosition(pos);
        j.bone.parent.getWorldQuaternion(parentQ);
        restDir.copy(j.axis).applyQuaternion(_q.copy(parentQ).multiply(j.restLocal));
        // verlet: inertia + pull back to rest + gravity
        next.copy(j.tail).sub(j.prevTail).multiplyScalar(1 - j.drag).add(j.tail)
          .addScaledVector(restDir, j.stiffness * dt)
          .addScaledVector(j.gravityDir, j.gravity * dt);
        next.sub(pos).setLength(j.length).add(pos);
        for (const col of ch.cols) {
          col.o.localToWorld(c0.copy(col.offset));
          let cp = c0;
          if (col.type === 'capsule') {
            col.o.localToWorld(c1.copy(col.tail));
            const ab = tmp.copy(c1).sub(c0); const t = THREE.MathUtils.clamp(next.clone().sub(c0).dot(ab) / ab.lengthSq(), 0, 1);
            cp = c0.addScaledVector(ab, t);
          }
          const r = col.radius + j.hitRadius;
          const d = next.distanceTo(cp);
          if (d < r && d > 1e-6) { next.sub(cp).setLength(r).add(cp); next.sub(pos).setLength(j.length).add(pos); }
        }
        j.prevTail.copy(j.tail); j.tail.copy(next);
        // aim the bone at the simulated tail
        const to = tmp.copy(next).sub(pos).applyQuaternion(_q.copy(parentQ).multiply(j.restLocal).invert()).normalize();
        j.bone.quaternion.copy(j.restLocal).multiply(_q2.setFromUnitVectors(j.axis, to));
        j.bone.updateMatrixWorld(true);
      }
    }
  }
}

// ---- look ------------------------------------------------------------------------
let GRADIENT = null;
function gradient() {
  if (GRADIENT) return GRADIENT;
  const d = new Uint8Array([150, 215, 255]);
  GRADIENT = new THREE.DataTexture(d, 3, 1, THREE.RedFormat);
  GRADIENT.minFilter = GRADIENT.magFilter = THREE.NearestFilter; GRADIENT.needsUpdate = true;
  return GRADIENT;
}

function tintedTexture(tex, color, decorate, mode = 'multiply') {
  const img = tex.image; if (!img) return tex;
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = mode; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
  if (mode === 'color') { g.globalCompositeOperation = 'screen'; g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, 0, c.width, c.height); }
  g.globalCompositeOperation = 'destination-in'; g.drawImage(img, 0, 0); // keep original alpha
  g.globalCompositeOperation = 'source-over';
  decorate?.(g, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.flipY = tex.flipY; t.colorSpace = THREE.SRGBColorSpace; t.wrapS = tex.wrapS; t.wrapT = tex.wrapT; t.anisotropy = 4;
  return t;
}

/**
 * Anime cel shading, in the style of modern gacha-game characters: one crisp light/shadow edge
 * from the key light, coloured shadows (warm and rosy on skin, cool on cloth, deep and saturated
 * on hair) instead of grey, a thin warm band right at the terminator, a fresnel rim light that
 * separates the figure from the grass, and a glossy "angel ring" highlight across the hair.
 * Colours are not tone-mapped, so the palette stays clean and flat like the reference art.
 */
const CEL = {
  skin:  { shadow: [0.95, 0.76, 0.76], band: [0.10, 0.03, 0.0], rim: [1.0, 0.92, 0.86], rimK: 0.28 },
  hair:  { shadow: [0.66, 0.62, 0.84], band: [0.04, 0.02, 0.06], rim: [0.95, 0.95, 1.0], rimK: 0.32, ring: 1 },
  cloth: { shadow: [0.70, 0.73, 0.90], band: [0.03, 0.03, 0.05], rim: [0.92, 0.95, 1.0], rimK: 0.24 },
  face:  { shadow: [0.99, 0.92, 0.91], band: [0.02, 0.0, 0.0], rim: [1.0, 0.94, 0.9], rimK: 0.1 },   // faces stay clean: barely any shadow
};
function celMaterial(t, kind) {
  const P = CEL[kind];
  t.toneMapped = false;
  t.userData.cel = kind;
  t.onBeforeCompile = (sh) => {
    sh.uniforms.uShadow = { value: new THREE.Color(...P.shadow) };
    sh.uniforms.uBand = { value: new THREE.Color(...P.band) };
    sh.uniforms.uRim = { value: new THREE.Color(...P.rim) };
    sh.uniforms.uRimK = { value: P.rimK };
    sh.uniforms.uRing = { value: P.ring ? 1 : 0 };
    sh.uniforms.uSheen = { value: kind === 'cloth' ? 0.055 : kind === 'skin' ? 0.025 : 0 };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uShadow; uniform vec3 uBand; uniform vec3 uRim; uniform float uRimK; uniform float uRing; uniform float uSheen;')
      .replace('#include <opaque_fragment>', `
        {
          #if NUM_DIR_LIGHTS > 0
            vec3 L = directionalLights[ 0 ].direction;
          #else
            vec3 L = normalize( vec3( 0.3, 0.8, 0.5 ) );
          #endif
          vec3 N = normalize( normal );
          vec3 V = normalize( vViewPosition );
          float ndl = dot( N, L );
          float lit = smoothstep( 0.02, 0.07, ndl );
          float band = smoothstep( -0.12, 0.02, ndl ) * ( 1.0 - lit );
          vec3 base = diffuseColor.rgb;
          vec3 c = mix( base * uShadow, base, lit ) + base * uBand * band * 3.0;
          float rim = pow( 1.0 - clamp( dot( N, V ), 0.0, 1.0 ), 4.0 );
          c += uRim * rim * uRimK * ( 0.35 + 0.65 * lit );
          c += base * pow( max( dot( N, normalize( L + V ) ), 0.0 ), 24.0 ) * uSheen * lit;
          #ifdef USE_MAP
            if ( uRing > 0.5 ) {
              float ring = smoothstep( 0.28, 0.36, N.y ) * ( 1.0 - smoothstep( 0.46, 0.56, N.y ) );
              float strands = 0.8 + 0.2 * sin( vMapUv.x * 140.0 ) * clamp( 1.0 - fwidth( vMapUv.x ) * 140.0, 0.0, 1.0 );
              c += vec3( 1.0, 0.98, 0.96 ) * ring * strands * 0.2 * ( 0.4 + 0.6 * lit );
            }
          #endif
          outgoingLight = c * 1.04;
        }
        #include <opaque_fragment>`);
  };
  t.customProgramCacheKey = () => 'cel-v2-' + kind;
  return t;
}

function styleAvatar(root, kit, authoredThunder = false) {
  // outlines: drawn per material in a darker shade of what they outline (warm brown round the skin,
  // the kit colour deepened round the clothes), the way illustrated characters are inked
  const inked = (hex) => { const c = new THREE.Color(hex); c.multiplyScalar(0.32); return c; };
  const mkOutline = (color) => {
    const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
    m.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed += normal * 0.0042;'); };
    return m;
  };
  const OL = { skin: mkOutline(0x6e3f3c), hair: mkOutline(0x2b2236), dark: mkOutline(kit.outline ?? 0x1a1420),
    shirt: mkOutline(inked(kit.shirt)), shorts: mkOutline(inked(kit.shorts)) };
  const add = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingSphere();
    const radius = o.geometry.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis();
    o.castShadow = o.name !== 'Face' && (o.isSkinnedMesh || radius > 0.14);
    o.receiveShadow = false; o.frustumCulled = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!o.isSkinnedMesh && radius < 0.085 && mats.some(m => /^(RAI|ELEMENT) \/ /.test(m.name || ''))) o.userData.detailRadius = radius;
    let wantsOutline = false;
    const olMats = [];
    const next = mats.map((m) => {
      const n = (m.name || '').toUpperCase();
      if (authoredThunder && /^(RAI|ELEMENT) \/ /.test(n)) {
        const metal = m.clone(); // keep the authored metal, enamel and glow
        olMats.push(OL.dark); return metal;
      }
      if (/EYE|FACE(MOUTH|EYELINE|BROW)|HIGHLIGHT/.test(n)) { const b = m.clone(); b.toneMapped = false; olMats.push(OL.dark); return b; } // eyes and face parts stay unlit
      let map = m.map;
      if (map) map.anisotropy = Math.max(4, map.anisotropy || 1);
      if (/TOPS/.test(n) && map && !authoredThunder) map = tintedTexture(map, kit.shirt, (g, w, h) => {
        // squad number on the back panel of the shirt texture
        g.fillStyle = kit.number;
        g.font = `bold ${Math.round(h * 0.13)}px "Barlow Condensed", Impact, sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(kit.no, w * 0.5, h * 0.73);
        g.fillRect(w * 0.08, h * 0.37, w * 0.84, h * 0.012); // chest stripe on the front panel
      });
      if (/BOTTOMS/.test(n) && map && !authoredThunder) map = tintedTexture(map, kit.shorts);
      if (/HAIR/.test(n) && map && kit.hair && !authoredThunder) map = tintedTexture(map, kit.hair, null, kit.hairMode || 'multiply');
      const isSkin = /SKIN|BODY/.test(n) && !/TOPS|BOTTOMS/.test(n), isHair = /HAIR/.test(n);
      const t = new THREE.MeshToonMaterial({
        name: m.name, map, color: m.color ?? 0xffffff, gradientMap: gradient(),
        transparent: m.transparent, alphaTest: m.alphaTest, side: m.side, opacity: m.opacity,
      });
      t.alphaToCoverage = !m.transparent && m.alphaTest > 0;
      if (/TOPS|BOTTOMS/.test(n)) { t.bumpMap = clothWeave(); t.bumpScale = 0.0008; }
      t.emissive = new THREE.Color(0xffffff); t.emissiveMap = map; t.emissiveIntensity = isSkin ? 0.22 : 0.12;
      celMaterial(t, /FACE/.test(n) ? 'face' : isSkin ? 'skin' : isHair ? 'hair' : 'cloth');
      if (isHair && m.map) t.userData.hairSrc = m.map;   // so the hair can be re-dyed per character
      if (!m.transparent && !/FACE/.test(n)) wantsOutline = true;
      olMats.push(isSkin ? OL.skin : isHair ? OL.hair : /TOPS/.test(n) ? OL.shirt : /BOTTOMS/.test(n) ? OL.shorts : OL.dark);
      return t;
    });
    o.material = Array.isArray(o.material) ? next : next[0];
    if (wantsOutline && o.isSkinnedMesh) add.push([o, Array.isArray(o.material) ? olMats : olMats[0]]);
  });
  for (const [o, olm] of add) {
    const ol = new THREE.SkinnedMesh(o.geometry, olm);
    ol.bind(o.skeleton, o.bindMatrix);
    ol.frustumCulled = false; ol.castShadow = false; ol.renderOrder = -1;
    o.parent.add(ol); ol.position.copy(o.position); ol.quaternion.copy(o.quaternion); ol.scale.copy(o.scale);
  }
}

/** dye an avatar's hair (characters each have their own colour); null restores the original */
const _dyeCache = new Map();
export function dyeHair(root, color) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      const src = m.userData?.hairSrc; if (!src) continue;
      if (m.userData.dye === color) continue;
      m.userData.dye = color;
      let t = src;
      if (color) {
        const key = src.uuid + color;
        t = _dyeCache.get(key);
        if (!t) { t = tintedTexture(src, color, null, 'color'); _dyeCache.set(key, t); }
      }
      m.userData.dyeMap = t;
      if (m.map) { m.map = t; m.emissiveMap = t; }   // (not while frozen into an ice statue)
      m.needsUpdate = true;
    }
  });
}
