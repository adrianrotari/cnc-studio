// kernel tests: ported Kiri:Moto polygon math over Clipper (src/poly.js)
const {POLY}=require('../src/poly.js');
let pass=0,fail=0;
const ok=(c,m)=>{ if(c){pass++;} else {fail++; console.log('FAIL:',m);} };
const near=(a,b,tol)=>Math.abs(a-b)<=tol;
const sq=(w,cx,cy)=>POLY.newPolygon().centerRectangle({x:cx||0,y:cy||0,z:0},w,w);
const jtRound=POLY.ClipperLib.JoinType.jtRound;

// outward offset, miter joins: 20x20 grown 2 -> 24x24
let o1=POLY.offset([sq(20)],2,{z:0});
ok(o1.length===1&&near(o1[0].area(),576,0.05),'miter outset area 576 (got '+o1[0].area().toFixed(2)+')');

// outward offset, round joins: 576 - (4-pi)*r^2 = 572.57, tolerance for arc facets
let o2=POLY.offset([sq(20)],2,{z:0,join:jtRound,arc:1000});
ok(o2.length===1&&near(o2[0].area(),572.57,0.25),'round outset area (got '+o2[0].area().toFixed(2)+')');
ok(o2[0].points.length>20,'round joins produce arc points (got '+o2[0].points.length+')');

// inward offset until exhausted: 20x20 step -3 -> 14, 8, 2 squares
let outs=[];
POLY.offset([sq(20)],-3,{z:0,count:99,outs,flat:true});
ok(outs.length===3,'3 inward passes (got '+outs.length+')');
ok(near(outs[0].area(),196,0.05)&&near(outs[1].area(),64,0.05)&&near(outs[2].area(),4,0.05),
  'inward pass areas 196/64/4');

// exact stepover: consecutive outward rings 2.0 apart everywhere
let r0=POLY.offset([sq(20)],2,{z:0,join:jtRound,arc:1000});
let r1=POLY.offset(r0,2,{z:0,join:jtRound,arc:1000});
let dmin=1e9,dmax=-1e9;
for(const p of r1[0].points){
  let d=1e9;
  r0[0].forEachSegment((a,b)=>{ d=Math.min(d,p.distToLine(a,b)); });
  dmin=Math.min(dmin,d); dmax=Math.max(dmax,d);
}
ok(dmin>=2-0.05&&dmax<=2+0.05,'ring spacing exact ae ('+dmin.toFixed(3)+'..'+dmax.toFixed(3)+')');

// union of overlapping squares: 100+100-40 = 160
let u=POLY.union([sq(10),sq(10,6,0)],0,true);
ok(u.length===1&&near(u[0].area(),160,0.05),'union area 160 (got '+(u[0]&&u[0].area().toFixed(2))+')');

// union keeps disjoint islands separate
let u2=POLY.union([sq(10,-20,0),sq(10,20,0)],0,true);
ok(u2.length===2,'disjoint islands stay separate');

// diff: 20x20 minus 10x10 hole -> nested result, areaDeep 300
let d1=POLY.diff([sq(20)],[sq(10)],0);
ok(d1.length===1&&d1[0].inner&&d1[0].inner.length===1,'diff produces hole');
ok(near(d1[0].areaDeep(),300,0.05),'diff areaDeep 300 (got '+d1[0].areaDeep().toFixed(2)+')');

// cut a ring with a disk -> open runs only, all inside the disk
let ring=POLY.newPolygon().centerCircle({x:0,y:0,z:-3},30,72,false);
let disk=POLY.newPolygon().centerCircle({x:15,y:0,z:0},25,72,false);
let cuts=ring.cut([disk],true);
ok(cuts&&cuts.length>=1&&cuts.every(c=>c.open),'cut yields open runs');
let inMax=0;
for(const c of cuts)for(const p of c.points) inMax=Math.max(inMax,Math.hypot(p.x-15,p.y));
ok(inMax<=25.01,'cut runs stay inside clip disk (max '+inMax.toFixed(2)+')');

// closed poly fully inside clip: isInside shortcut holds
ok(sq(6).isInside(sq(30)),'isInside true for nested');
ok(!sq(30).isInside(sq(6)),'isInside false for container');

// nest + flatten + winding opposition
let nested=POLY.nest([sq(20),sq(5)]);
ok(nested.length===1&&nested[0].inner&&nested[0].inner.length===1,'nest builds parent/child');
ok(POLY.flatten(nested,[]).length===2,'flatten returns 2');
let ex=POLY.expand(nested,1,0,[]);
ok(ex.length===1&&ex[0].inner&&ex[0].inner.length===1,'expand keeps hole');
ok(ex[0].isClockwise()!==ex[0].inner[0].isClockwise(),'outer/inner windings opposed');
ok(near(ex[0].area(),484,0.05)&&near(ex[0].inner[0].area(),9,0.05),'expand grows outer, shrinks hole');

// reconnect open chains into a closed loop
let c1=POLY.newPolygon().setOpen().add(0,0,0).add(10,0,0);
let c2=POLY.newPolygon().setOpen().add(10,0,0).add(10,10,0);
let c3=POLY.newPolygon().setOpen().add(10,10,0).add(0,10,0).add(0,0,0);
let healed=POLY.reconnect([c1,c2,c3]);
ok(healed.length===1&&!healed[0].open,'reconnect heals to closed loop');
ok(near(healed[0].area(),100,0.05),'healed loop area 100');

console.log('poly tests:',pass,'passed,',fail,'failed');
process.exit(fail?1:0);
