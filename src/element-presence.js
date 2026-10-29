import * as THREE from 'three';

// These effects read skill motion. All debris and pressure fronts are visual only.
const rand = (a, b) => a + Math.random() * (b - a);

class Presence {
  constructor(scene, name) {
    this.scene = scene; this.group = new THREE.Group(); this.group.name = name;
    scene.add(this.group); this.resources = new Set();
  }
  mesh(geometry, material) {
    this.resources.add(geometry); this.resources.add(material);
    const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false;
    this.group.add(mesh); return mesh;
  }
  dispose() { this.scene.remove(this.group); for (const resource of this.resources) resource.dispose(); }
}

/** Broad white pressure ribbons, rotating airborne leaves and lifted dust reveal the air flow. */
export class WindPresence extends Presence {
  constructor(scene) {
    super(scene, 'Gale pressure vortex'); this.ribbons = [];
    for (let k = 0; k < 5; k++) {
      const geometry = new THREE.BufferGeometry(), positions = new Float32Array(80 * 6), colors = new Float32Array(80 * 8), indices = [];
      for (let i = 0; i < 80; i++) {
        const alpha = Math.pow(Math.sin(i / 79 * Math.PI), .65) * .85;
        for (let s = 0; s < 2; s++) colors.set([.74, 1, .91, alpha], i * 8 + s * 4);
        if (i < 79) { const n = i * 2; indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2); }
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4)); geometry.setIndex(indices);
      const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const mesh = this.mesh(geometry, material); mesh.renderOrder = 6;
      this.ribbons.push({ mesh, geometry, material, positions, k });
    }
    const leafGeo = new THREE.PlaneGeometry(.12, .23);
    this.leaves = Array.from({ length: 24 }, (_, i) => {
      const material = new THREE.MeshBasicMaterial({ color: i % 3 ? 0x73a05a : 0xd8b373, side: THREE.DoubleSide, transparent: true });
      return { mesh: this.mesh(leafGeo, material), phase: i / 24 * Math.PI * 2, radius: rand(.65, 1.8), speed: rand(4, 8) };
    });
  }
  update(t, actor, strength) {
    this.group.position.copy(actor.pos); const air = actor.char?.airY || 0;
    const fade = Math.min(1, t * 8) * strength;
    for (const r of this.ribbons) {
      r.material.opacity = fade * .64;
      for (let i = 0; i < 80; i++) {
        const u = i / 79, a = u * Math.PI * 2.7 - t * (7 + r.k * .35) + r.k * Math.PI * .4;
        const radius = .5 + u * 1.35 + Math.sin(u * 10 - t * 5 + r.k) * .12;
        const y = .08 + u * (2.5 + air * .6), width = (.035 + Math.sin(u * Math.PI) * .09) * (r.k % 2 ? .7 : 1);
        const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
        r.positions.set([x, y - width, z, x, y + width, z], i * 6);
      }
      r.geometry.attributes.position.needsUpdate = true;
    }
    for (const leaf of this.leaves) {
      const a = leaf.phase - t * leaf.speed;
      leaf.mesh.position.set(Math.cos(a) * leaf.radius, .1 + ((t * .9 + leaf.phase / 7) % 1) * (2.4 + air * .4), Math.sin(a) * leaf.radius);
      leaf.mesh.rotation.set(a * 2, a, t * 9); leaf.mesh.material.opacity = fade * .75;
    }
  }
}

/** Earth is heavy: angular rocks lift, fall and settle beside persistent ground fractures. */
export class EarthPresence extends Presence {
  constructor(scene, pos) {
    super(scene, 'Terra fractured ground'); this.group.position.copy(pos);
    const rockGeo = new THREE.IcosahedronGeometry(1, 1);
    const positions = rockGeo.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      const rough = .88 + Math.sin(x * 13 + y * 9 + z * 17) * .12;
      positions.setXYZ(i, x * rough, y * rough, z * rough);
    }
    rockGeo.computeVertexNormals();
    this.rocks = Array.from({ length: 22 }, (_, i) => {
      const material = new THREE.MeshStandardMaterial({ color: i % 3 ? 0x75604d : 0xb19a75, roughness: .98, metalness: .01, flatShading: true, emissive: 0x623006, emissiveIntensity: .1 });
      material.customProgramCacheKey = () => 'weathered-stone-v1';
      material.onBeforeCompile = shader => {
        shader.vertexShader = 'varying vec3 vStone;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvStone=position;');
        shader.fragmentShader = 'varying vec3 vStone;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nfloat grain=fract(sin(dot(floor(vStone*37.),vec3(127.1,311.7,74.7)))*43758.5453);diffuseColor.rgb*=.72+.3*grain;');
      };
      const mesh = this.mesh(rockGeo, material), a = i / 22 * Math.PI * 2;
      const size = rand(.09, .24); mesh.scale.set(size, size * rand(.65, 1.6), size);
      return { mesh, a, radius: rand(.4, 1.1), speed: rand(1, 3), vy: rand(2.6, 4.4), size, stretch: rand(.7, 1.4) };
    });
    const vertices = [];
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2;
      let x = Math.cos(a) * .3, z = Math.sin(a) * .3;
      for (let j = 1; j <= 4; j++) {
        const r = j * .6, b = a + rand(-.1, .1), nx = Math.cos(b) * r, nz = Math.sin(b) * r;
        const width = .045 * (1 - j / 6);
        vertices.push(x - width, .035, z, x + width, .035, z, nx, .035, nz);
        x = nx; z = nz;
      }
    }
    const cracks = new THREE.BufferGeometry(); cracks.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    this.cracks = this.mesh(cracks, new THREE.MeshBasicMaterial({ color: 0x4c3324, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.cracks.renderOrder = 2;
  }
  update(t, actor) {
    const fade = Math.min(1, t * 12) * Math.min(1, (1.5 - t) * 3);
    this.cracks.material.opacity = Math.max(0, fade) * .85;
    this.cracks.scale.setScalar(.6 + Math.min(1, t * 4) * .65);
    for (const rock of this.rocks) {
      const u = Math.max(0, t - .07), r = rock.radius + Math.min(.8, u) * rock.speed;
      rock.mesh.position.set(Math.cos(rock.a) * r, Math.max(rock.size * .4, rock.vy * u - 4.9 * u * u), Math.sin(rock.a) * r);
      rock.mesh.rotation.set(Math.min(u, .8) * 3 + rock.a, rock.a, Math.min(u, .8) * 2);
      const sink = Math.max(0, Math.min(1, (1.5 - t) * 4)); rock.mesh.scale.set(rock.size * sink, rock.size * sink * rock.stretch, rock.size * sink * .86);
    }
  }
}

/** A dark centre anchors the purple light; two rifts mark departure and reappearance. */
export class ShadowPresence extends Presence {
  constructor(scene, pos) {
    super(scene, 'Shadow paired rifts'); this.departure = pos.clone();
    this.rifts = [0, 1].map(() => {
      const hole = this.mesh(new THREE.CircleGeometry(.72, 48), new THREE.MeshBasicMaterial({ color: 0x130b21, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      hole.rotation.x = -Math.PI / 2; hole.renderOrder = 4;
      const rim = this.mesh(new THREE.TorusGeometry(.76, .035, 8, 64), new THREE.MeshBasicMaterial({ color: 0xac69ff, transparent: true, depthWrite: false, toneMapped: false }));
      rim.rotation.x = -Math.PI / 2; rim.renderOrder = 5;
      return { hole, rim };
    });
  }
  update(t, actor) {
    this.rifts.forEach((rift, i) => {
      const age = t - i * .17, pos = i ? actor.pos : this.departure;
      const size = age <= 0 ? 0 : Math.sin(Math.min(1, age / 1.1) * Math.PI) * 1.25;
      for (const mesh of [rift.hole, rift.rim]) {
        mesh.visible = size > .01; mesh.position.set(pos.x, mesh === rift.hole ? .06 : .075, pos.z);
        mesh.scale.setScalar(Math.max(.001, size)); mesh.material.opacity = Math.min(1, size) * (mesh === rift.hole ? .85 : .95);
      }
    });
  }
}
