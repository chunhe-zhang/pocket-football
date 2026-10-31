// Geometric contact witnesses, in metres. No distance-to-player fallbacks.
export function capsuleContact(ball, a, b, ballRadius, surfaceRadius = .065) {
  const x=b.x-a.x,y=b.y-a.y,z=b.z-a.z,L=x*x+y*y+z*z;
  const u=L>1e-12?Math.max(0,Math.min(1,((ball.x-a.x)*x+(ball.y-a.y)*y+(ball.z-a.z)*z)/L)):0;
  const point={x:a.x+x*u,y:a.y+y*u,z:a.z+z*u};
  const dx=ball.x-point.x,dy=ball.y-point.y,dz=ball.z-point.z,distance=Math.hypot(dx,dy,dz);
  if(distance>ballRadius+surfaceRadius+1e-7)return null;
  return {point,distance,u,radius:ballRadius+surfaceRadius,normal:distance>1e-8?{x:dx/distance,y:dy/distance,z:dz/distance}:{x:0,y:1,z:0}};
}

export function keeperOutcome(speed, alignment, paired) {
  if(paired && speed<15 && alignment>.72)return 'catch';
  return alignment<.38?'fingertip':'parry';
}

// Continuous collision within the animation frame; teleport-sized moves are
// excluded. The witness is on an interpolated real boot, never a reach radius.
export function sweepBootContact(ball, previousA, previousB, a, b, ballRadius, bootRadius) {
  const travel=Math.max(Math.hypot(a.x-previousA.x,a.y-previousA.y,a.z-previousA.z),Math.hypot(b.x-previousB.x,b.y-previousB.y,b.z-previousB.z));
  if(travel>2)return null;
  const steps=Math.max(1,Math.ceil(travel/.012));
  for(let i=0;i<=steps;i++){
    const t=i/steps,lerp=(p,q)=>({x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t,z:p.z+(q.z-p.z)*t});
    const proof=capsuleContact(ball,lerp(previousA,a),lerp(previousB,b),ballRadius,bootRadius);
    if(proof)return {...proof,fraction:t};
  }
  return null;
}

export function recordContact(game, actor, kind, proof, ball=game.ball.pos) {
  const log=game.contactLog ||= [];
  log.push({frame:game.contactFrame||0,time:game.time,team:actor.team,kind,ball:{x:ball.x,y:ball.y,z:ball.z},point:{...proof.point},distance:proof.distance,radius:proof.radius,closing:proof.closing,normal:proof.normal?{...proof.normal}:undefined});
  if(log.length>96)log.shift();
}

// Choose a bounded wind-up, allowing the approach to get beside the ball before
// the captured contact pose. Unreachable arrivals remain buffered, not kicked.
export function planContactTime(base, distanceAt, speed) {
  const min=base*.85,max=base*1.45;
  for(let t=min;t<=max+1e-6;t+=.01){
    const travel=Math.min(6.5*t,Math.max(0,speed)*t+5*t*t)+.16;
    if(distanceAt(t)<=travel)return t;
  }
  return max;
}
