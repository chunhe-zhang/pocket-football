import * as THREE from 'three';

// Advected noise carves an upright flame, rather than tinting a round glow sprite.
// Shared by the pooled sprites, fine embers/flames and the expanding fire front.
export const FIRE_GLSL = `
float fireHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float fireNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(fireHash(i),fireHash(i+vec2(1,0)),f.x),mix(fireHash(i+vec2(0,1)),fireHash(i+vec2(1,1)),f.x),f.y);}
float fireFbm(vec2 p){return .57*fireNoise(p)+.28*fireNoise(p*2.03+7.1)+.15*fireNoise(p*4.1+19.7);}
vec4 fireSample(vec2 uv,float clock,float seed){
 float y=uv.y,x=uv.x-.5;
 float flow=fireFbm(vec2(x*6.+seed,y*5.-clock*3.6));
 float bend=sin(y*5.5-clock*3.2+seed)*.10*y+(flow-.5)*.24*y;
 float width=mix(.35,.012,pow(clamp(y,0.,1.),.72));
 float edge=abs(x-bend)/max(.012,width);
 float tongue=1.-smoothstep(.56,1.17,edge);
 float holes=smoothstep(.13,.53,flow+(1.-y)*.46);
 float alpha=tongue*holes*smoothstep(0.,.10,y)*(1.-smoothstep(.7,1.,y));
 float heat=clamp((1.-edge)*.72+(1.-y)*.44+(flow-.5)*.35,0.,1.);
 vec3 color=mix(vec3(.48,.025,.003),vec3(1.4,.20,.012),smoothstep(.05,.55,heat));
 color=mix(color,vec3(1.9,.92,.18),smoothstep(.48,.87,heat));
 color=mix(color,vec3(2.0,1.65,.78),smoothstep(.84,1.,heat)*(1.-y));
 return vec4(color,alpha);
}`;

export function installFireSprite(material, clock, seed) {
  material.userData.fireSeed = { value: seed };
  material.customProgramCacheKey = () => material.userData.realFire ? 'upright-fire-v1' : 'ordinary-sprite';
  material.onBeforeCompile = shader => {
    if (!material.userData.realFire) return;
    shader.uniforms.fireClock = clock;
    shader.uniforms.fireSeed = material.userData.fireSeed;
    shader.fragmentShader = 'uniform float fireClock;uniform float fireSeed;\n' + FIRE_GLSL + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
      'vec4 fire=fireSample(vMapUv,fireClock,fireSeed);diffuseColor*=fire;');
  };
}

/** A thin, turbulent fire front and a short rising central plume. No simulated damage. */
export class FireFlame {
  constructor(scene, pos) {
    this.scene = scene; this.group = new THREE.Group(); this.group.position.copy(pos);
    this.group.name = 'Turbulent fire front'; scene.add(this.group);
    this.geometry = new THREE.CylinderGeometry(1, 1, 1, 64, 8, true).translate(0, .5, 0);
    this.meshes = [0, 1].map(mode => {
      const material = new THREE.ShaderMaterial({
        uniforms: { clock: { value: 0 }, opacity: { value: 0 }, mode: { value: mode } },
        vertexShader: `uniform float clock;varying vec2 vUv;void main(){vUv=uv;vec3 p=position;p.x+=sin(uv.y*8.+uv.x*19.-clock*5.)*.065*uv.y;p.z+=cos(uv.y*7.+uv.x*17.-clock*4.)*.065*uv.y;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
        fragmentShader: `uniform float clock;uniform float opacity;uniform float mode;varying vec2 vUv;${FIRE_GLSL}
void main(){
 float angle=vUv.x*6.2831853,y=vUv.y;
 vec2 circle=vec2(cos(angle),sin(angle))*(mode<.5?6.:3.);
 float warp=fireFbm(circle+vec2(y*1.5,-clock*2.8));
 float flow=fireFbm(circle*1.7+vec2((warp-.5)*2.,y*5.-clock*4.2));
 float height=.30+.70*fireFbm(circle*.8+vec2(clock*.4,clock*.7));
 float density=smoothstep(-.14,.20,height-y+(flow-.5)*.62);
 float heat=clamp(density*.55+(1.-y)*.46+(flow-.5)*.4,0.,1.);
 vec3 color=mix(vec3(.52,.035,.003),vec3(1.5,.24,.012),smoothstep(.1,.65,heat));
 color=mix(color,vec3(1.85,.72,.12),smoothstep(.58,.96,heat));
 float breakup=smoothstep(.23,.63,flow+(1.-y)*.08);
 float alpha=density*breakup*smoothstep(0.,.045,y)*(1.-smoothstep(.75,1.,y))*opacity;
 gl_FragColor=vec4(color,alpha);
}`,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.NormalBlending, toneMapped: false,
      });
      const mesh = new THREE.Mesh(this.geometry, material); mesh.renderOrder = 6;
      mesh.frustumCulled = false; this.group.add(mesh); return mesh;
    });
  }
  update(t) {
    const front = this.meshes[0], plume = this.meshes[1];
    const u = Math.max(0, Math.min(1, (t - .23) / .66));
    const radius = .48 + 3.0 * (1 - Math.pow(1 - u, 1.6));
    front.scale.set(radius, .45 + Math.sin(u * Math.PI) * 1.25, radius);
    front.material.uniforms.opacity.value = t < .23 ? 0 : Math.min(1, u * 9) * Math.pow(1 - u, .65) * .92;
    const size = .5 + Math.min(.25, t * .3);
    plume.scale.set(size, 1.35 + Math.min(1, t * 2), size);
    plume.material.uniforms.opacity.value = Math.min(1, t * 10) * Math.max(0, 1 - Math.max(0, t - .4) / .55) * .78;
    for (const mesh of this.meshes) mesh.material.uniforms.clock.value = t;
  }
  dispose() { this.scene.remove(this.group); this.geometry.dispose(); for (const mesh of this.meshes) mesh.material.dispose(); }
}
