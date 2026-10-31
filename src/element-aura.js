import * as THREE from 'three';
import { FIRE_GLSL } from './fire-flame.js';

// Persistent, local-space signatures. At most three draws per player, including motes;
// no lights, timers, transient pools, textures, or gameplay/ball mutations.
export const AURA_IDS = ['thunder', 'blaze', 'frost', 'gale', 'phantom', 'cannon'];
const COLORS = [0xb088ff, 0xff6828, 0x92e3ff, 0x63f3bd, 0x9556ed, 0xe9ab51];
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const COMMON = `uniform float clock;uniform float energy;uniform float height;uniform float spread;uniform vec3 tint;varying vec2 vUv;`;
const GROUND = `
${COMMON}
float band(float x,float width){return 1.-smoothstep(width,width+fwidth(x)*1.5,abs(x));}
void main(){
 vec2 p=(vUv-.5)*2.;float r=length(p),a=atan(p.y,p.x);float ink=0.,haze=0.;vec3 c=tint;
 #if ELEMENT == 0
  float zig=.68+.045*abs(fract(a*2.865+clock*.12)*2.-1.);
  ink=band(r-zig,.018)*(.7+.3*sin(a*6.-clock*2.));
  ink+=band(sin(a*3.),.045)*smoothstep(.35,.52,r)*(1.-smoothstep(.65,.82,r));
 #elif ELEMENT == 1
  float tooth=.70+.035*sin(a*9.+sin(a*17.-clock*2.));
  ink=band(r-tooth,.025)*(.55+.45*pow(max(0.,sin(a*6.-clock*2.)),2.));haze=exp(-r*r*5.)*.08;
  c=mix(vec3(.35,.08,.02),vec3(1.,.40,.08),clamp(ink,0.,1.));
 #elif ELEMENT == 2
  float spoke=band(sin(a*3.),.025)*(1.-smoothstep(.54,.79,r))*smoothstep(.13,.22,r);
  float branch=band(abs(sin(a*3.))-(.65-r)*2.1,.028)*smoothstep(.32,.38,r)*(1.-smoothstep(.56,.64,r));
  ink=spoke+branch+band(r-.75,.012)*.65;haze=exp(-r*r*6.)*.09;c=mix(tint,vec3(.88,.98,1.),.4);
 #elif ELEMENT == 3
  float arm=pow(max(0.,cos(a*3.+r*7.-clock*2.8)),10.);
  ink=arm*smoothstep(.25,.48,r)*(1.-smoothstep(.75,.92,r));
  ink+=band(r-.78,.015)*.4;haze=exp(-r*r*5.)*.055;c=mix(tint,vec3(.91,1.,.96),.6);
 #elif ELEMENT == 4
  float rim=band(r-.75,.035);float orbit=pow(max(0.,cos(a*5.+r*19.-clock*1.6)),12.);
  ink=rim+orbit*smoothstep(.3,.65,r)*(1.-smoothstep(.76,.87,r))*.65;
  haze=(1.-smoothstep(.55,.75,r))*.72;c=mix(vec3(.035,.012,.075),tint*1.25,clamp(ink,0.,1.));
 #else
  float hex=cos(mod(a+3.14159/6.,3.14159/3.)-3.14159/6.)*r;
  ink=band(hex-.66,.025)+band(hex-.48,.012)*.4;
  float cracks=band(sin(a*4.+r*3.),.03)*smoothstep(.5,.56,r)*(1.-smoothstep(.78,.9,r));
  ink+=cracks;haze=exp(-r*r*6.)*.12;c=mix(vec3(.28,.12,.035),tint,clamp(ink,0.,1.));
 #endif
 // Shared halo frame round every sigil: a bright hRim with a light sweep running round it,
 // a counter-rotating rune band, a dashed outer ring and ripples rolling out from the feet.
 float turn=a/6.28318,boost=.75+energy*.55;
 float sweep=pow(fract(turn-clock*(.32+energy*.25)+float(ELEMENT)*.17),6.)+pow(fract(-turn-clock*.21+float(ELEMENT)*.41),10.)*.55;
 float hRim=band(r-.80,.011)*(.55+sweep*1.1)+exp(-pow((r-.80)/.045,2.))*(.16+sweep*.35);
 float cell=turn*48.-clock*.55,cf=fract(cell);
 float glyph=step(.36,fract(sin(floor(cell)*91.7+float(ELEMENT)*13.)*43758.5453))*step(.2,cf)*step(cf,.8);
 float runes=glyph*smoothstep(.835,.845,r)*(1.-smoothstep(.875,.885,r))*.55+band(r-.835,.004)*.45+band(r-.885,.004)*.45;
 float outer=band(r-.93,.006)*step(.42,fract(turn*32.+clock*.12))*.6;
 float ripple=pow(max(0.,sin((r-clock*.32)*24.)),12.)*smoothstep(.08,.2,r)*(1.-smoothstep(.6,.76,r))*.16;
 float deco=(hRim+runes+outer)*boost+ripple;
 vec3 dc=mix(tint*1.35,vec3(1.),clamp(sweep*.55+hRim*.15,0.,.7));
 c=mix(c,dc,clamp(deco/(ink+deco+.001),0.,1.));
 float alpha=clamp(ink*.76+haze+deco*.85,0.,.95)*(1.-smoothstep(.96,1.,r));
 if(alpha<.008)discard;gl_FragColor=vec4(c*(1.+energy*.25),alpha);
}`;
const PLANE_VERTEX = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

function instancePlane(count) {
  const plane = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = plane.index; geometry.attributes = { ...plane.attributes };
  const seed = Float32Array.from({ length: count }, (_, i) => (i * 0.61803398875 + 0.137) % 1);
  geometry.setAttribute('seed', new THREE.InstancedBufferAttribute(seed, 1));
  geometry.setAttribute('serial', new THREE.InstancedBufferAttribute(Float32Array.from({ length: count }, (_, i) => i), 1));
  geometry.instanceCount = count; geometry.userData.capacity = count;
  return geometry;
}

const PARTICLE_VERTEX = `
${COMMON}attribute float seed;attribute float serial;uniform vec3 anchors[8];varying float vLife;varying float vSeed;
void main(){
 vUv=uv;vSeed=seed;float t=clock;float phase=fract(seed+t*(.45+seed*.16));float a=seed*39.7+t*.65;
 vec3 p;vec2 size;vLife=sin(phase*3.14159);
 #if ELEMENT == 1
  int index=int(mod(serial,8.));p=anchors[index];
  p+=vec3(cos(a)*.09,phase*.12,sin(a)*.09)*height;
  size=vec2(.22+seed*.16,.40+seed*.26)*height*(.85+energy*.18);
  if(index>=6){size*=vec2(.80,.52);p.x+=sign(p.x)*.10*height;p.y-=.06*height;}
  // More flames hug the sides, leaving the central face readable.
  if(index<2){p.x+=sin(a)*.10*height;size*=.85;}
  p.y+=size.y*.32;vLife=.7+.3*sin(phase*3.14159);
 #else
  float radius=.4+seed*.38;p=vec3(cos(a)*radius,.12+phase*1.7,sin(a)*radius)*height;
  #if ELEMENT == 0
   size=vec2(.075,.075)*height;vLife=pow(max(0.,sin(phase*3.14159)),.6);
  #elif ELEMENT == 2
   p.x+=sin(t*1.2+seed*18.)*.10*height;size=vec2(.045+seed*.04)*height;
  #elif ELEMENT == 3
   a=seed*39.7+t*2.;p=vec3(cos(a)*(.62+seed*.18),.15+phase*1.65,sin(a)*(.62+seed*.18))*height;
   size=vec2(.08+seed*.045,.035+seed*.025)*height;
  #elif ELEMENT == 4
   size=vec2(.11+seed*.07)*height;p.y*=.7;
  #else
   p.y*=.6;size=vec2(.045+seed*.035)*height;
  #endif
 #endif
 #if ELEMENT != 1
  p.xz*=spread;
 #endif
 vec4 center=modelViewMatrix*vec4(p,1.);float scale=length(modelMatrix[0].xyz);
 center.xy+=(uv-.5)*size*scale;gl_Position=projectionMatrix*center;
}`;
const PARTICLE_FRAGMENT = `
${COMMON}varying float vLife;varying float vSeed;
${FIRE_GLSL}
void main(){
 vec2 p=vUv-.5;float r=length(p),alpha=0.;vec3 c=tint;
 #if ELEMENT == 1
  vec4 f=fireSample(vUv,clock,vSeed*18.);c=f.rgb;alpha=f.a*.78;
 #elif ELEMENT == 0
  alpha=exp(-abs(p.x)*80.)*exp(-abs(p.y)*7.)+exp(-abs(p.y)*80.)*exp(-abs(p.x)*7.);c=mix(tint,vec3(.93,.91,1.),.7);
 #elif ELEMENT == 2
  float a=atan(p.y,p.x);alpha=exp(-abs(sin(a*3.))*28.)*(1.-smoothstep(.15,.48,r));c=vec3(.80,.95,1.);
 #elif ELEMENT == 3
  float leaf=abs(p.x)*1.6+pow(abs(p.y)*2.,.65);alpha=1.-smoothstep(.28,.68,leaf);c=mix(tint,vec3(.93,1.,.82),vSeed*.7);
 #elif ELEMENT == 4
  alpha=exp(-r*r*20.)*(.5+.5*sin(p.y*10.+clock*2.+vSeed*9.));c=mix(tint,vec3(.72,.45,1.),.5);
 #else
  alpha=exp(-r*r*40.)+exp(-r*r*9.)*.25;c=mix(tint,vec3(1.,.93,.7),.45);
 #endif
 alpha*=vLife;if(alpha<.008)discard;gl_FragColor=vec4(c*(1.+energy*.20),alpha);
}`;

function ribbonGeometry(count, segments = 64) {
  const geometry = new THREE.BufferGeometry(), positions = [], params = [], indices = [];
  for (let k = 0; k < count; k++) {
    for (let i = 0; i <= segments; i++) for (const side of [-1, 1]) {
      positions.push(0, 0, 0); params.push(i / segments, side, k);
    }
    const start = k * (segments + 1) * 2;
    for (let i = 0; i < segments; i++) { const n = start + i * 2; indices.push(n, n+1, n+2, n+1, n+3, n+2); }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('param', new THREE.Float32BufferAttribute(params, 3));geometry.setIndex(indices);
  return geometry;
}
const RIBBON_VERTEX = `
${COMMON}attribute vec3 param;varying float vSide;varying float vAlong;
void main(){
 float u=param.x,s=param.y,k=param.z,t=clock;vec3 p;float width;
 #if ELEMENT == 0
  float side=mod(k,2.)*2.-1.;float angle=k*2.399+t*.3;
  float segment=floor(u*18.),fraction=fract(u*18.),tick=floor(t*8.);
  float n0=fract(sin(segment*12.7+k*71.+tick*2.6)*43758.5453)*2.-1.;
  float n1=fract(sin((segment+1.)*12.7+k*71.+tick*2.6)*43758.5453)*2.-1.;
  float wave=mix(n0,n1,fraction)*.075;
  float radius=.34+sin(u*3.14159)*.18+wave;
  p=vec3(cos(angle)*radius,.10+u*1.45,sin(angle)*radius);width=.026+energy*.012;
  p.x+=s*width;
 #elif ELEMENT == 3
  float a=u*5.2+t*(1.3+k*.18)+k*2.094;
  float radius=.70+.10*sin(u*3.14159+k);
  p=vec3(cos(a)*radius,.12+u*1.5,sin(a)*radius);
  width=(.080+.035*sin(u*3.14159))*(1.+energy*.25);p.y+=s*width*.65;p.xz+=normalize(p.xz)*s*width*.7;
 #else
  float a=u*4.8-t*.7+k*3.14159;float radius=.57+.10*sin(u*3.14159);
  p=vec3(cos(a)*radius,.12+u*1.20,sin(a)*radius);width=.045;p.y+=s*width;
 #endif
 p*=height;p.xz*=spread;vAlong=u;vSide=s;vUv=vec2(u,(s+1.)*.5);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
}`;
const RIBBON_FRAGMENT = `
${COMMON}varying float vSide;varying float vAlong;
void main(){
 float edge=1.-smoothstep(.45,1.,abs(vSide));float tail=pow(sin(vAlong*3.14159),.65);
 float flow=.65+.35*sin(vAlong*15.-clock*3.);vec3 c=tint;float alpha;
 #if ELEMENT == 0
  c=mix(tint,vec3(.96,.90,1.),edge*.90);alpha=edge*tail*(.76+.12*sin(clock*3.+vAlong*4.));
 #elif ELEMENT == 3
  float border=1.-smoothstep(.78,1.,abs(vSide));
  float core=1.-smoothstep(.38,.72,abs(vSide));
  c=mix(vec3(.025,.34,.24),vec3(.88,1.,.95),core);alpha=border*tail*(.78+.18*flow);
 #else
  c=mix(vec3(.12,.025,.25),tint*1.2,edge);alpha=edge*tail*flow*.64;
 #endif
 if(alpha<.008)discard;gl_FragColor=vec4(c*(1.+energy*.2),alpha);
}`;
const STONE_VERTEX = `
${COMMON}attribute float seed;varying vec3 vNormal;varying vec3 vRock;
void main(){
 float a=seed*6.28318+clock*.45;float radius=.57+seed*.12;
 float y=.35+seed*.80+sin(clock*1.6+seed*18.)*.08;
 float angle=clock*.5+seed*19.;mat2 rot=mat2(cos(angle),-sin(angle),sin(angle),cos(angle));
 vec3 p=position,localNormal=normal;
 #if ELEMENT == 2
  p*=vec3(.10,.27+seed*.1,.10);p.yz=rot*p.yz;localNormal.yz=rot*localNormal.yz;
 #else
  p*=vec3(.16+seed*.09,.14+seed*.09,.14+seed*.08);p.xz=rot*p.xz;localNormal.xz=rot*localNormal.xz;
 #endif
 vRock=position;vNormal=normalMatrix*localNormal;
 p+=vec3(cos(a)*radius,y,sin(a)*radius);p*=height;p.xz*=spread;
 gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);vUv=uv;
}`;
const STONE_FRAGMENT = `
${COMMON}varying vec3 vNormal;varying vec3 vRock;
void main(){
 float light=.55+.45*max(0.,dot(normalize(vNormal),normalize(vec3(-.3,.8,.6))));vec3 c;
 #if ELEMENT == 2
  float facet=pow(max(0.,normalize(vNormal).z),6.);
  c=mix(vec3(.07,.48,.76),vec3(.78,.96,1.),light*.63+facet*.30);
  c+=vec3(.20,.25,.28)*pow(abs(vRock.y),18.);
 #else
  float seam=min(abs(vRock.x+vRock.y*.45+.13*sin(vRock.z*4.)),abs(vRock.z-vRock.y*.4+.08*cos(vRock.x*5.)));
  float crack=1.-smoothstep(.012,.035,seam);
  c=mix(vec3(.39,.28,.14)*light,tint*(1.2+energy*.3),crack*.95);
 #endif
 gl_FragColor=vec4(c,1.);
}`;

export class ElementAura {
  constructor(character, id) {
    this.character = character;this.id = id;this.kind = AURA_IDS.indexOf(id);
    this.group = new THREE.Group();this.group.name = `Element signature: ${id}`;this.group.userData.elementAura = true;
    this.time = this.kind * .713;this.energy = 0;this.surge = 0;this.meshes = [];this._inverse = new THREE.Matrix4();
    this.height = (character._modelTemplate?.height || 1.65) / 1.65;
    this.anchors = Array.from({ length: 8 }, () => new THREE.Vector3());
    this.bones = ['hips', 'spine1', 'handL', 'handR', 'footL', 'footR', 'armL', 'armR'].map(name => character.bones[name]);
    this.uniforms = {clock:{value:this.time},energy:{value:0},height:{value:this.height},spread:{value:1},tint:{value:new THREE.Color(COLORS[this.kind] || 0xffffff)},anchors:{value:this.anchors}};
    const floor = new THREE.PlaneGeometry(2.1 * this.height, 2.1 * this.height);
    this.ground = this.mesh(floor, PLANE_VERTEX, GROUND);this.ground.rotation.x = -Math.PI / 2;this.ground.position.y = .027;
    this.ground.renderOrder = 1;this.ground.material.userData.glow = false;
    const count = id === 'blaze' ? 32 : id === 'gale' ? 20 : 24;
    this.particles = this.mesh(instancePlane(count), PARTICLE_VERTEX, PARTICLE_FRAGMENT);
    this.particles.renderOrder = 3;
    if (id === 'blaze') {
      // Bone-tethered tongues cover boots, wrists and shoulders in one draw.
      this.silhouette = null;
    } else if (id === 'cannon') {
      // Earth reads through its hexagonal floor sigil and rising motes; no orbiting rock ring.
      this.silhouette = null;
    } else if (id === 'frost') {
      const base = new THREE.OctahedronGeometry(1, 0);
      const geometry = new THREE.InstancedBufferGeometry();geometry.index = base.index;geometry.attributes = {...base.attributes};
      geometry.setAttribute('seed', new THREE.InstancedBufferAttribute(Float32Array.from({length:6},(_,i)=>(i+.5)/6),1));geometry.instanceCount = 6;
      this.silhouette = this.mesh(geometry, STONE_VERTEX, STONE_FRAGMENT, false);
    } else {
      this.silhouette = this.mesh(ribbonGeometry(id === 'thunder' ? 6 : id === 'gale' ? 3 : 2), RIBBON_VERTEX, RIBBON_FRAGMENT);
    }
    character.group.add(this.group);
  }
  mesh(geometry, vertexShader, fragmentShader, transparent = true) {
    const material = new THREE.ShaderMaterial({
      defines:{ELEMENT:this.kind},uniforms:this.uniforms,vertexShader,fragmentShader,
      transparent,depthWrite:!transparent,side:THREE.DoubleSide,toneMapped:false,
    });
    const mesh = new THREE.Mesh(geometry, material);mesh.frustumCulled = false;mesh.castShadow = mesh.receiveShadow = false;
    // Readable without bloom; selective bloom adds only a restrained halo.
    if (transparent && geometry !== this.ground?.geometry) material.userData.glow = true;
    this.group.add(mesh);this.meshes.push(mesh);return mesh;
  }
  setView(camera, viewportHeight) {
    const distance = Math.max(.1, this.character.group.position.distanceTo(camera.position));
    const pixels = viewportHeight * this.height * 1.65 * this.character.group.scale.y / (2 * Math.tan(camera.fov * Math.PI / 360) * distance);
    const fraction = pixels < 35 ? .55 : pixels < 65 ? .75 : 1;
    this.particles.geometry.instanceCount = Math.ceil(this.particles.geometry.userData.capacity * fraction);
  }
  update(dt) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, .1);this.time += dt;
    const ch = this.character;
    // Keep the full signature inside the narrow portrait canvas. Fire anchors
    // remain on their bones; only orbital geometry and floor art contract.
    this.uniforms.spread.value = ch.presentation ? .78 : 1;
    this.ground.scale.setScalar(this.uniforms.spread.value);
    const target = clamp(Math.max(ch.windup || 0, this.surge || 0, (ch.speed || 0) / 10), 0, 1);
    this.energy += (target-this.energy)*(1-Math.exp(-dt*6));
    this.uniforms.clock.value = this.time;this.uniforms.energy.value = this.energy;
    if (this.id === 'blaze') {
      this._inverse.copy(ch.group.matrixWorld).invert();
      for (let i=0;i<this.anchors.length;i++) {
        const bone = this.bones[i];
        if (bone) this.anchors[i].setFromMatrixPosition(bone.matrixWorld).applyMatrix4(this._inverse);
        else this.anchors[i].set(i%2 ? -.2 : .2, i<2 ? .8 : .25, 0);
      }
    }
  }
  dispose() {
    this.group.removeFromParent();
    for (const mesh of this.meshes) { mesh.geometry.dispose();mesh.material.dispose(); }
    this.meshes.length = 0;
  }
}
