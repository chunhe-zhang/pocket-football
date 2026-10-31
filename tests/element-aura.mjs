import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../vendor/three/three.module.js';

// Run the shipped implementation with the same local THREE build. The browser
// integration page separately compiles all six GPU variants on real models.
const source=fs.readFileSync(new URL('../src/element-aura.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export const ','const ').replace('export class ','class ');
const fire=fs.readFileSync(new URL('../src/fire-flame.js',import.meta.url),'utf8').split('export const FIRE_GLSL = `')[1].split('`;')[0];
const {ElementAura,AURA_IDS}=new Function('THREE','FIRE_GLSL',`${source};return {ElementAura,AURA_IDS};`)(THREE,fire);
for(const id of AURA_IDS){
 const group=new THREE.Group();group.position.set(7,0,-3);group.scale.setScalar(1.1);
 const bones=Object.fromEntries(['hips','spine1','handL','handR','footL','footR','armL','armR'].map((name,i)=>{const b=new THREE.Bone();b.position.set(i%2?.2:-.2,i<2?.9:.5,0);group.add(b);return [name,b];}));
 const ch={group,bones,_modelTemplate:{height:1.65},speed:0,windup:0};group.updateMatrixWorld(true);
 const aura=new ElementAura(ch,id),positions=group.position.clone(),geometries=aura.meshes.map(m=>m.geometry),materials=aura.meshes.map(m=>m.material);
 assert.ok(aura.meshes.length<=3);assert.equal(aura.group.parent,group);
 const start=aura.time;
 for(const fps of [30,60,144])for(let n=0;n<fps;n++){ch.windup=n/fps;aura.update(1/fps);}
 assert.ok(Math.abs(aura.time-start-3)<1e-10,'frame-rate-independent clock');
 assert.ok(aura.energy>=0&&aura.energy<=1);assert.deepEqual(group.position,positions,'visual effect moved player');
 assert.ok(aura.meshes.every((m,i)=>m.geometry===geometries[i]&&m.material===materials[i]),'resource allocation while updating');
 if(id==='blaze')assert.ok(Math.abs(aura.anchors[0].x-bones.hips.position.x)<1e-6,'world/local anchor conversion');
 const camera=new THREE.PerspectiveCamera(38,1,0.1,200);camera.position.set(7,2,70);aura.setView(camera,720);const far=aura.particles.geometry.instanceCount;
 camera.position.set(7,2,0);aura.setView(camera,720);assert.ok(aura.particles.geometry.instanceCount>far,'distance detail did not recover');
 assert.equal(aura.particles.geometry.instanceCount,aura.particles.geometry.userData.capacity);
 let disposed=0;for(const mesh of aura.meshes){mesh.geometry.addEventListener('dispose',()=>disposed++);mesh.material.addEventListener('dispose',()=>disposed++);}
 const expected=aura.meshes.length*2;aura.dispose();assert.equal(disposed,expected);assert.ok(!group.children.some(o=>o.userData.elementAura));
}
console.log('PASS: six bounded signatures, stable resource ownership, 30/60/144 Hz clocks, local fire anchors, reversible distance detail and disposal.');
