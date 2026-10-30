import * as THREE from 'three';

/** A thin translucent frost film: broken feathered edges and fine crystalline veins. */
export function frostPatch() {
  const material = new THREE.ShaderMaterial({
    uniforms: { opacity: { value: 0 }, seed: { value: 0 } },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `uniform float opacity;uniform float seed;varying vec2 vUv;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
void main(){
 vec2 p=(vUv-.5)*2.;float n=noise(p*7.+seed);
 float edge=length(vec2(p.x*1.25,p.y*.94))+(n-.5)*.28;
 float film=1.-smoothstep(.48,.96,edge);
 float veins=pow(1.-abs(sin((p.x+p.y*.42)*39.+n*2.)),18.);
 float branches=pow(1.-abs(sin((p.x-p.y*.67)*51.+seed)),28.)*.45;
 vec3 color=mix(vec3(.35,.72,.86),vec3(.88,.98,1.),veins);
 gl_FragColor=vec4(color,film*(.14+veins*.55+branches*.30)*opacity);
}`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.45), material);
  mesh.rotation.x = -Math.PI / 2; mesh.renderOrder = 1;
  mesh.name = 'Thin crystalline frost trail'; return mesh;
}
