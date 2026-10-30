import * as THREE from 'three';
import { clone as cloneSkinned } from '../vendor/three/addons/utils/SkeletonUtils.js';
import { ElementVFX, ELEMENTS } from './element-vfx.js';
const V=THREE.Vector3;
/** Five-element visuals sampled from the existing simulation, never a second ball. */
export class GameElementFx {
  constructor(scene,camera){
    this.scene=scene;this.effects=new Map();this.states=new Map();this.pending=[];this.ghosts=[];this.time=0;this.stats={shots:0,hits:0,starts:0};
    for(const id of Object.keys(ELEMENTS)){const fx=new ElementVFX(scene,camera,id);fx.intensity=.9;fx.visibleAura=false;fx.group.visible=false;fx.onGhost=pos=>this.ghost(this.actor,id,pos);this.effects.set(id,fx);}
    this.cooldowns=new Map();this.flight=new Map();
  }
  ids(ball){return (ball.specialType||'').replaceAll('!','').split('+').filter(id=>this.effects.has(id));}
  ghost(a,id,pos){
    if(!a||this.ghosts.length>=10)return;const root=cloneSkinned(a.char.group),materials=[];root.visible=true;root.position.copy(pos);root.traverse(o=>{if(!o.isMesh)return;const make=()=>{const m=new THREE.MeshBasicMaterial({color:ELEMENTS[id].color,transparent:true,opacity:.16,depthWrite:false,side:THREE.DoubleSide});materials.push(m);return m;};o.material=Array.isArray(o.material)?o.material.map(make):make();o.castShadow=false;});this.scene.add(root);this.ghosts.push({root,materials,age:0});
  }
  start(a,kind){if(!this.effects.has(kind))return;this.effects.get(kind).linger=1.8;this.stats.starts++;this.pending.push({a,id:kind,t:kind==='blaze'?.2:.08});}
  hit(id,pos,big=false){if((this.cooldowns.get(id)||0)>0)return false;const fx=this.effects.get(id);if(!fx)return false;this.actor=[...this.states.keys()].find(a=>a.charId===id&&!a.out);this.cooldowns.set(id,big?.22:.12);this.stats.hits++;fx.linger=Math.max(fx.linger||0,1.6);fx.group.visible=true;if(big)fx.impact(pos);else{fx.emit(pos,30,{speed:2.2,life:.6,size:id==='blaze'?.16:.07});if(id==='frost'||id==='cannon')fx.debris(pos,12,2);fx.ringAt(pos,.75,.45);}return true;}
  ballEvent(e,game,ids){
    if(!['board','post','net','goal','zap'].includes(e.type))return;
    const pos=e.type==='zap'?e.who.pos.clone().add(new V(0,.7,0)):game.ball.pos.clone(),big=e.type==='net'||e.type==='goal';
    for(const id of ids||this.ids(game.ball))if(this.hit(id,pos,big))game.emit({e:'elementHit',id,p:pos.toArray(),big});
  }
  update(dt,game){
    this.time+=dt;for(const [id,t] of this.cooldowns)this.cooldowns.set(id,Math.max(0,t-dt));
    const active=!['menu','ended'].includes(game.state),live=new Set(active?game.athletes.filter(a=>!a.out&&this.effects.has(a.charId)&&(a.char.group.visible||a.charId==='phantom')):[]);
    for(const [a,s] of this.states)if(!live.has(a)||a.charId!==s.id){const fx=this.effects.get(s.id);fx.group.remove(s.ring.mesh);s.ring.m.dispose();const i=fx.pool.rings.indexOf(s.ring);if(i>=0)fx.pool.rings.splice(i,1);this.states.delete(a);}
    if(!active){this.pending.length=0;this.flight.clear();for(const fx of this.effects.values()){if(fx.group.visible)fx.clear();fx.group.visible=false;}this.updateGhosts(dt);return;}
    for(let i=this.pending.length-1;i>=0;i--){const p=this.pending[i];p.t-=dt;if(p.t<=0){const fx=this.effects.get(p.id);if(!p.a.out){this.actor=p.a;if(p.id==='phantom')fx.portalBurst(p.a.pos);else fx.impact(p.a.pos);}this.pending.splice(i,1);}}
    const shotIds=this.ids(game.ball),ball=game.ball;
    for(const [id,fx] of this.effects){
      const actors=[...live].filter(a=>a.charId===id),shooting=shotIds.includes(id)&&!ball.hidden&&!ball.heldBy,old=this.flight.get(id);
      fx.linger=Math.max(0,(fx.linger||0)-dt);
      if(!actors.length&&!shooting&&!fx.linger){if(fx.group.visible)fx.clear();fx.group.visible=false;this.flight.delete(id);continue;}
      fx.group.visible=true;fx.visibleAura=actors.length>0;fx.skillStrength=actors.some(a=>a.power?.type===id||a.tm?.type===id)?1:0;
      const primary=actors.find(a=>a.charging)||actors[0];if(primary)fx.setOrigin(primary.pos);else fx.setOrigin(ball.pos);
      let charge=0,chargePos=ball.pos;
      for(const a of actors){
        let s=this.states.get(a);if(!s){const ring=fx.ringAt(a.pos,1.7,9999);ring.permanent=true;s={id,ring,last:a.pos.clone(),moveClock:0,auraClock:0};this.states.set(a,s);}
        const skill=a.power?.type===id||a.tm?.type===id,moving=a.sprinting||skill||a.slide||(id==='frost'&&a.vel.lengthSq()>4);
        s.moveClock-=dt;s.auraClock-=dt;const d=s.last.distanceTo(a.pos);
        if(moving&&s.moveClock<=0&&d>.05&&d<7){this.actor=a;if(id==='phantom'&&d>.7)fx.dash(s.last,a.pos);else{fx.emit(a.pos.clone().add(new V(0,id==='frost'?.08:.18,0)),id==='blaze'?6:id==='frost'?2:3,{speed:id==='frost'?.25:1,life:id==='frost'?.45:.6,size:id==='blaze'?.17:id==='frost'?.035:.055,...(id==='frost'?{up:.4}:{})});if((id==='frost'||id==='cannon')&&skill)fx.debris(a.pos,2,1.3);}s.moveClock=.09;}
        if(a!==primary&&s.auraClock<=0){fx.emit(a.pos.clone().add(new V(.2,.1,0)),2,{speed:.5,life:.7});s.auraClock=.3;}
        if(a.charging&&a.charge>charge){charge=a.charge;chargePos=ball.pos.distanceTo(a.pos)<2?ball.pos:a.pos.clone().addScaledVector(a.forward,.45).add(new V(0,.15,0));}
        s.last.copy(a.pos);
      }
      fx.setCharge(charge,chargePos);
      if(shooting){
        const renewed=!old||(ball.special&&old.special!==ball.special);const flight=renewed?{p:ball.pos.clone(),clock:0,special:ball.special}:old;
        if(renewed){this.stats.shots++;fx.emit(ball.pos,45,{speed:2.4,size:id==='blaze'?.2:.07});if(id==='frost'||id==='cannon')fx.debris(ball.pos,12,2);}
        flight.clock-=dt;if(flight.clock<=0){const dist=flight.p.distanceTo(ball.pos);if(dist<12){const count=Math.min(5,Math.max(1,Math.ceil(dist/.3)));for(let k=1;k<=count;k++)fx.emit(new V().lerpVectors(flight.p,ball.pos,k/count),3,{speed:.6,life:.5,size:id==='blaze'?.18:.065});if(id==='frost'||id==='cannon')fx.debris(ball.pos,1,1.1);}flight.p.copy(ball.pos);flight.clock=.045;}flight.special=ball.special;this.flight.set(id,flight);
      }else this.flight.delete(id);
      fx.update(dt,this.time);
      for(const a of actors){const s=this.states.get(a);s.ring.mesh.position.set(a.pos.x,.023,a.pos.z);s.ring.mesh.visible=a!==primary;s.ring.m.uniforms.opacity.value=a.charging?.5:(a.sprinting||a.power)?.3:.16;}
    }
    this.updateGhosts(dt);
  }
  updateGhosts(dt){for(let i=this.ghosts.length-1;i>=0;i--){const g=this.ghosts[i];g.age+=dt;g.materials.forEach(m=>m.opacity=Math.max(0,.16*(1-g.age/.5)));if(g.age>.5){this.scene.remove(g.root);g.materials.forEach(m=>m.dispose());this.ghosts.splice(i,1);}}}
  dispose(){for(const fx of this.effects.values())fx.dispose();this.states.clear();for(const g of this.ghosts){this.scene.remove(g.root);g.materials.forEach(m=>m.dispose());}this.ghosts.length=0;}
}
