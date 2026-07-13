const {genContourRough,genDist,genIso}=require('../src/gen.js');
let pass=0,fail=0;
const ok=(c,m)=>{ if(c){pass++;} else {fail++; console.log('FAIL:',m);} };
// synthetic part: 20x20 square top face at z=0 (part below it, 2.5D)
const tris=[
  -10,-10,0,  10,-10,0,  10,10,0,
  -10,-10,0,  10,10,0,  -10,10,0
];
const segs=genContourRough(tris,{zTop:0,zBot:-6,ap:3,ae:8,toolR:6,allow:0.5,barR:45,feed:3000,plunge:1000,rpm:8000});
ok(segs.length>0,'segs generated');
let finite=true, zbad=false, minDistL1=1e9, rings1=0;
for(const sg of segs){
  for(const p of sg.pts){
    if(!isFinite(p[0])||!isFinite(p[1])||!isFinite(p[2])) finite=false;
    if(p[2]<-6.001||p[2]>5.001) zbad=true;
  }
  if(sg.kind==='feed'&&sg.pts.length>10&&Math.abs(sg.pts[0][2]-(-3))<1e-6){
    rings1++;
    for(const p of sg.pts){
      const dx=Math.max(Math.abs(p[0])-10,0), dy=Math.max(Math.abs(p[1])-10,0);
      const d=(Math.abs(p[0])<=10&&Math.abs(p[1])<=10)?-1:Math.hypot(dx,dy);
      if(d>=0&&d<minDistL1) minDistL1=d;
      if(d<0) minDistL1=-1;
    }
  }
}
ok(finite,'all coords finite');
ok(!zbad,'z within [zBot, clearZ]');
ok(rings1>=3,'>=3 rings at level -3 (got '+rings1+')');
ok(minDistL1>=6.5-0.8,'tool center keeps toolR+allow off the part (min '+minDistL1.toFixed(2)+')');
ok(minDistL1!==-1,'no pass enters the part silhouette');
// all points inside bar+toolR
let rmax=0;
for(const sg of segs)for(const p of sg.pts){const r=Math.hypot(p[0],p[1]); if(r>rmax)rmax=r;}
ok(rmax<=51.01,'passes stay within bar radius + toolR (max '+rmax.toFixed(1)+')');
// empty level fallback: no model above -1 in a 10mm bar
const segs2=genContourRough([],{zTop:0,zBot:-2,ap:2,ae:4,toolR:3,allow:0,barR:10,feed:1000,rpm:5000});
ok(segs2.some(sg=>sg.kind==='feed'&&sg.pts.length>10),'face-clearing fallback rings');
// two islands: rings union as offsets meet, none enter either island
const tris3=[
  -35,-10,0, -15,-10,0, -15,10,0,  -35,-10,0, -15,10,0, -35,10,0,   // island A: x -35..-15
   15,-10,0,  35,-10,0,  35,10,0,   15,-10,0,  35,10,0,  15,10,0    // island B: x 15..35
];
const segs3=genContourRough(tris3,{zTop:0,zBot:-3,ap:3,ae:6,toolR:5,allow:0,barR:45,feed:2000,rpm:6000});
const inA=p=>p[0]>=-35&&p[0]<=-15&&Math.abs(p[1])<=10;
const inB=p=>p[0]>=15&&p[0]<=35&&Math.abs(p[1])<=10;
let hit=false, rings3=0;
for(const sg of segs3){
  if(sg.kind!=='feed')continue;
  if(sg.pts.length>10)rings3++;
  for(const p of sg.pts){ if(inA(p)||inB(p)) hit=true; }
}
ok(rings3>=4,'two-island: rings generated (got '+rings3+')');
ok(!hit,'two-island: no pass enters either island');
// ---- pocket: 40x40 block, 20x20 cavity to -10, ø8 tool ----
const {genPocketRough}=require('../src/gen.js');
const T4=[];
const quad=(x0,y0,x1,y1,z)=>{T4.push(x0,y0,z, x1,y0,z, x1,y1,z,  x0,y0,z, x1,y1,z, x0,y1,z);};
quad(-20,-20,20,-10,0); quad(-20,10,20,20,0); quad(-20,-10,-10,10,0); quad(10,-10,20,10,0);
quad(-10,-10,10,10,-10);
const segs4=genPocketRough(T4,{zTop:0,zBot:-10,ap:5,ae:3,toolR:4,allow:0,barR:45,feed:2000,plunge:600,rpm:6000});
ok(segs4.length>0,'pocket segs generated');
ok(segs4.warnings.length===0,'pocket no warnings');
let helices=0, wallHit=false, minZ4=1e9, cutPts=0;
for(const sg of segs4){
  if(sg.kind!=='feed')continue;
  const spiral=sg.pts.length>20&&sg.pts[0][2]-sg.pts[sg.pts.length-1][2]>1;
  if(spiral) helices++;
  for(const p of sg.pts){
    if(p[2]<minZ4)minZ4=p[2];
    if(p[2]<=-4.99&&p[2]>=-10.01){
      cutPts++;
      // tool center must stay >= toolR inside the cavity walls (raster bias tolerance 0.85)
      if(Math.abs(p[0])>10-4+0.85||Math.abs(p[1])>10-4+0.85) wallHit=true;
    }
  }
}
ok(helices>=2,'helix entry per level (got '+helices+')');
ok(!wallHit,'pocket passes keep toolR off the walls');
ok(Math.abs(minZ4-(-10))<1e-6,'pocket reaches floor');
ok(cutPts>50,'pocket produces cutting points');
// helix geometry: monotone descent, radius <= 0.7*toolR
let hOK=true;
for(const sg of segs4){
  if(sg.kind!=='feed')continue;
  if(!(sg.pts.length>20&&sg.pts[0][2]-sg.pts[sg.pts.length-1][2]>1))continue;
  const p0=sg.pts[0], pm=sg.pts.length>36?sg.pts[18]:sg.pts[Math.floor(sg.pts.length/2)];
  const ccx=(p0[0]+pm[0])/2, ccy=(p0[1]+pm[1])/2;
  if(Math.hypot(p0[0]-ccx,p0[1]-ccy)>0.7*4+0.3) hOK=false;
  for(let i=1;i<sg.pts.length;i++) if(sg.pts[i][2]-sg.pts[i-1][2]>1e-6) hOK=false;
}
ok(hOK,'helix monotone descent, radius <= 0.7 toolR');
// island: 30x30 cavity with 10x10 island, tool must never enter island + toolR
const T5=[];
const quad5=(x0,y0,x1,y1,z)=>{T5.push(x0,y0,z, x1,y0,z, x1,y1,z,  x0,y0,z, x1,y1,z, x0,y1,z);};
quad5(-25,-25,25,-15,0); quad5(-25,15,25,25,0); quad5(-25,-15,-15,15,0); quad5(15,-15,25,15,0);
quad5(-5,-5,5,5,0);
quad5(-15,-15,15,-5,-6); quad5(-15,5,15,15,-6); quad5(-15,-5,-5,5,-6); quad5(5,-5,15,5,-6);
const segs5=genPocketRough(T5,{zTop:0,zBot:-6,ap:6,ae:3,toolR:3,allow:0,barR:45,feed:2000,rpm:6000});
let islHit=false, ring5=0;
for(const sg of segs5){
  if(sg.kind!=='feed')continue;
  if(sg.pts.length>10)ring5++;
  for(const p of sg.pts){
    if(p[2]<=-5.99&&Math.abs(p[0])<5+3-0.85&&Math.abs(p[1])<5+3-0.85) islHit=true;
  }
}
ok(segs5.warnings.length===0,'island pocket no warnings');
ok(ring5>=2,'island pocket rings (got '+ring5+')');
ok(!islHit,'island kept out by toolR');
// too tight: 6x6 cavity, ø8 tool -> skip + warning
const T6=[];
const quad6=(x0,y0,x1,y1,z)=>{T6.push(x0,y0,z, x1,y0,z, x1,y1,z,  x0,y0,z, x1,y1,z, x0,y1,z);};
quad6(-20,-20,20,-3,0); quad6(-20,3,20,20,0); quad6(-20,-3,-3,3,0); quad6(3,-3,20,3,0);
quad6(-3,-3,3,3,-5);
const segs6=genPocketRough(T6,{zTop:0,zBot:-5,ap:5,ae:2,toolR:4,allow:0,barR:45,feed:1000,rpm:5000});
ok(segs6.warnings.length>=1,'tight cavity warned (got '+segs6.warnings.length+')');
ok(!segs6.some(sg=>sg.kind==='feed'&&sg.pts.some(p=>Math.abs(p[0])<7&&Math.abs(p[1])<7&&p[2]<-0.1)),'tight cavity not entered');
console.log('gen tests:',pass,'passed,',fail,'failed');
process.exit(fail?1:0);
