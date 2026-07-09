// Stock-geometry unit tests — run: node tests/geom.test.js
const {billetHeight,billetBounds}=require('../src/geom.js');
let pass=0,fail=0;
const ok=(cond,msg)=>{ if(cond){pass++;} else {fail++; console.error('FAIL:',msg); } };
const near=(a,b,e=1e-9)=>Math.abs(a-b)<e;

const EMPTY=-999;   // sentinel for "no material" (the heightfield floor)
const r=45;         // ø90 bar

// ---- axis X: round bar along X, top tangent to Z0, centerline Y0 Z-45 ----
ok(near(billetHeight('X',r,0,0,0.5,EMPTY),0),'axis X y=0 -> top tangent Z0');
ok(near(billetHeight('X',r,123,0,0.5,EMPTY),0),'axis X independent of x (extruded)');
ok(near(billetHeight('X',r,0,r,0.5,EMPTY),-r),'axis X y=r -> side at -r');
ok(near(billetHeight('X',r,0,-r,0.5,EMPTY),-r),'axis X y=-r -> side at -r');
// 27-36-45 right triangle: z = -45 + sqrt(45²-27²) = -45 + 36 = -9
ok(near(billetHeight('X',r,0,27,0.5,EMPTY),-9),'axis X y=27 -> -9');
ok(near(billetHeight('X',r,0,-27,0.5,EMPTY),-9),'axis X symmetric in y');
ok(billetHeight('X',r,0,r+0.01,0.5,EMPTY)===EMPTY,'axis X |y|>r -> empty');
ok(billetHeight('X',r,0,-100,0.5,EMPTY)===EMPTY,'axis X far outside -> empty');
// axis X ignores ztop (surface fixed by radius)
ok(near(billetHeight('X',r,0,0,9.9,EMPTY),0),'axis X ignores ztop');
// tangency / range sweep: max height is 0 (tangent Z0), min is -r
let mx=-Infinity,mn=Infinity;
for(let y=-r;y<=r;y+=0.5){ const z=billetHeight('X',r,0,y,0.5,EMPTY); if(z!==EMPTY){ if(z>mx)mx=z; if(z<mn)mn=z; } }
ok(near(mx,0,1e-6),'axis X top surface peaks at Z0, got '+mx);
ok(near(mn,-r,0.02),'axis X bottoms at -r, got '+mn);

// ---- axis Z: vertical round bar, flat top at ztop inside circular footprint ----
ok(near(billetHeight('Z',r,0,0,0.5,EMPTY),0.5),'axis Z center -> flat top ztop');
ok(near(billetHeight('Z',r,30,30,0.5,EMPTY),0.5),'axis Z (30,30) inside -> ztop (1800<2025)');
ok(near(billetHeight('Z',r,r,0,0.5,EMPTY),0.5),'axis Z on boundary -> inside');
ok(billetHeight('Z',r,40,40,0.5,EMPTY)===EMPTY,'axis Z (40,40) outside -> empty (3200>2025)');
ok(billetHeight('Z',r,r+0.01,0,0.5,EMPTY)===EMPTY,'axis Z just outside radius -> empty');
ok(near(billetHeight('Z',r,0,0,-2,EMPTY),-2),'axis Z honours a negative ztop');

// ---- bounds unioning ----
const bx=billetBounds('X',r,0.5);
ok(bx.x===null,'axis X billet is x-extruded (x bound null)');
ok(bx.y[0]===-r && bx.y[1]===r,'axis X y bound [-r,r]');
ok(bx.minTop===-r,'axis X lowest top -r for zbot sizing');
const bz=billetBounds('Z',r,0.5);
ok(bz.x[0]===-r && bz.x[1]===r && bz.y[0]===-r && bz.y[1]===r,'axis Z footprint [-r,r]²');
ok(bz.minTop===0.5,'axis Z minTop = ztop');

console.log(`geom tests: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
