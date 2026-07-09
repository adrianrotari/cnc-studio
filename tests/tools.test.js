// Tool-library unit tests — run: node tests/tools.test.js
const {SEED_TOOLS, findToolById, toolCutData, validateTool}=require('../src/tools.js');
let pass=0,fail=0;
const ok=(cond,msg)=>{ if(cond){pass++;} else {fail++; console.error('FAIL:',msg); } };

// ---- seed present and schema-valid ----
ok(Array.isArray(SEED_TOOLS) && SEED_TOOLS.length>=1,'SEED_TOOLS non-empty');
for(const t of SEED_TOOLS){
  const problems=validateTool(t);
  ok(problems.length===0, 'seed '+(t&&t.id)+' valid: '+problems.join('; '));
}

// ---- GARANT 202019-12 exact datasheet values ----
const g=findToolById(SEED_TOOLS,'garant-202019-12');
ok(g,'GARANT tool found by id');
ok(g.name==='GARANT Master Alu PickPocket ø12','name exact');
ok(g.vendor==='GARANT (Hoffmann)','vendor exact');
ok(g.orderNo==='202019 12','orderNo exact');
ok(g.gtin==='4062406381110','gtin exact');
ok(g.dc===12 && g.z===3 && g.lc===19,'dc/z/lc');
ok(g.reach===73 && g.neckDia===11 && g.shankDia===12 && g.oal===120,'reach/neck/shank/oal');
ok(g.cornerR===0.2 && g.helixDeg===42,'cornerR/helix');
ok(g.variablePitch===true && g.throughCoolant===true,'variablePitch/throughCoolant flags');
ok(g.coating==='DLC sp2' && g.substrate==='VHM','coating/substrate');
ok(g.maxRampDeg===45 && g.maxSlotDepthFactor===2,'maxRampDeg/maxSlotDepthFactor');
// cutting data across materials
ok(g.cut.alu.vc===380,'alu vc 380');
ok(g.cut['alu-short-chipping'].vc===300,'alu-short-chipping vc 300');
ok(g.cut['alu-short-chipping'].fzSlot===0.06,'fzSlot 0.06');
ok(g.cut['alu-short-chipping'].fzSide===0.08,'fzSide 0.08');
ok(g.cut['alu-short-chipping'].aeSide===0.3,'aeSide 0.3xD');
ok(g.cut['alu-10Si'].vc===270,'alu-10Si vc 270');
ok(g.cut.Cu.vc===140 && g.cut.CuZn.vc===160,'Cu 140 / CuZn 160');

// ---- lookup ----
ok(findToolById(SEED_TOOLS,'nope')===null,'unknown id -> null');
ok(findToolById(null,'x')===null,'null list -> null (no throw)');

// ---- toolCutData picks the fz-bearing material ----
const cd=toolCutData(g);
ok(cd && cd.material==='alu-short-chipping','cut data from the fz material');
ok(cd.fzSlot===0.06 && cd.fzSide===0.08,'cut data fzSlot/fzSide');
ok(toolCutData({cut:{alu:{vc:380}}})===null,'no fz material -> null cut data');
ok(toolCutData(null)===null,'null tool -> null cut data');

// ---- validateTool flags a broken tool ----
const bad=validateTool({id:'x', name:'x'});
ok(bad.length>0,'incomplete tool flagged');
ok(validateTool({...g, dc:'twelve'}).some(m=>/dc/.test(m)),'non-numeric dc flagged');
ok(validateTool({...g, variablePitch:'yes'}).some(m=>/variablePitch/.test(m)),'non-boolean flag flagged');

console.log(`tools tests: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
