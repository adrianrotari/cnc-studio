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
console.log('gen tests:',pass,'passed,',fail,'failed');
process.exit(fail?1:0);
