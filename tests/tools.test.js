// Tool-library unit tests — run: node tests/tools.test.js
const {SEED_TOOLS, findToolById, toolsOfType, toolCutData, validateProfile, validateTool}=require('../src/tools.js');
let pass=0,fail=0;
const ok=(cond,msg)=>{ if(cond){pass++;} else {fail++; console.error('FAIL:',msg); } };

// ---- every seed schema-valid ----
ok(Array.isArray(SEED_TOOLS) && SEED_TOOLS.length===4,'SEED_TOOLS has 4 entries');
for(const t of SEED_TOOLS){
  const problems=validateTool(t);
  ok(problems.length===0, 'seed '+(t&&t.id)+' valid: '+problems.join('; '));
}

// ---- GARANT candidate: existing values + v0.2.3 additions ----
const g=findToolById(SEED_TOOLS,'garant-202019-12');
ok(g && g.type==='endmill','GARANT is an endmill');
ok(g.dc===12 && g.z===3 && g.neckDia===11,'GARANT dc/z/neck');
ok(g.coolantStyle==='central','GARANT coolantStyle central');
ok(g.cornerType==='radius 0.2','GARANT cornerType radius 0.2');
ok(/candidate replacement/.test(g.note),'GARANT note candidate replacement');
ok(g.cut['alu-short-chipping'].fzSlot===0.06,'GARANT still has slotting fz');

// ---- Inova (broken ref) ----
const iv=findToolById(SEED_TOOLS,'inova-2405120');
ok(iv && iv.type==='endmill','Inova endmill');
ok(iv.name==='Inova Tools ø12 TYP W alu (2.405.120.00)','Inova name');
ok(iv.vendor==='Inova Tools' && iv.orderNo==='2.405.120.00','Inova vendor/orderNo');
ok(iv.dc===12 && iv.z===3 && iv.lc===19,'Inova dc/z/lc');
ok(iv.neckDia===11.7 && iv.shankDia===12 && iv.reach===73 && iv.oal===120,'Inova neck/shank/reach/oal');
ok(iv.cornerR===0.2 && iv.cornerType==='chamfer 0.2x45','Inova corner chamfer');
ok(iv.helixDeg===45 && iv.variablePitch===true,'Inova helix/variablePitch');
ok(iv.coating==='ta-C' && iv.polishedFlutes===true,'Inova coating/polished');
ok(iv.throughCoolant===true && iv.coolantStyle==='lateral Y-IK','Inova coolant');
ok(/broke in ref job/.test(iv.note),'Inova broke-in-ref note');
ok(Array.isArray(iv.profile) && iv.profile.length===7,'Inova profile 7 pts');
ok(iv.profile[0][0]===0 && iv.profile[0][1]===5.8,'Inova profile tip [0,5.8]');
ok(iv.profile[6][0]===120 && iv.profile[6][1]===4.8,'Inova profile end [120,4.8]');

// ---- Inova cut data: explicit no-slot ----
const cd=toolCutData(iv);
ok(cd && cd.material==='AW-6082 long-chipping alu','Inova cut material');
ok(cd.fzSlot===null,'Inova fzSlot explicitly null (published none)');
ok(cd.fzSide===0.050 && cd.aeSide===0.3 && cd.apSide===12,'Inova side data');
ok(typeof cd.slotNote==='string' && /INOCUT/.test(cd.slotNote),'Inova slotNote present');
ok('fzSlot' in cd,'fzSlot key present even though null');

// ---- Inova 247 HPC (long flute, no cut data captured yet) ----
const iv2=findToolById(SEED_TOOLS,'inova-247121-10');
ok(iv2 && iv2.type==='endmill','Inova 247 endmill');
ok(iv2.name==='Inova 247 HPC ø12 (247.121.10)' && iv2.orderNo==='247.121.10','247 name/orderNo');
ok(iv2.dc===12 && iv2.z===3 && iv2.lc===26,'247 dc/z + longer 26mm flute');
ok(iv2.neckDia===11.7 && iv2.reach===73 && iv2.oal===120,'247 neck/reach/oal');
ok(iv2.cornerType==='chamfer 0.2x45' && iv2.coolantStyle==='IC','247 corner/coolant');
ok(iv2.helixDeg===undefined && !iv2.coating,'247 helix/coating not captured');
ok(iv2.cut===undefined,'247 has no cut data yet');
ok(toolCutData(iv2)===null,'247 toolCutData null (no cut)');
ok(validateTool(iv2).length===0,'247 valid despite missing cut');
ok(Array.isArray(iv2.profile) && iv2.profile.length===8,'247 profile 8 pts');
ok(iv2.profile[2][0]===26 && iv2.profile[2][1]===6,'247 flute zone ends at axial 26');
ok(validateProfile(iv2.profile)===null,'247 profile valid');

// ---- Sandvik holder ----
const h=findToolById(SEED_TOOLS,'sandvik-930-c5-s-20-085');
ok(h && h.type==='holder','Sandvik is a holder');
ok(h.name==='Sandvik CoroChuck 930 C5 slender ø20 GL85','holder name');
ok(h.orderNo==='930-C5-S-20-085','holder orderNo');
ok(h.gaugeLen===85 && h.boreDia===20 && h.taper==='Capto C5','holder gaugeLen/bore/taper');
ok(Array.isArray(h.profile) && h.profile.length===9,'holder profile 9 pts');
ok(h.profile[0][0]===0 && h.profile[0][1]===17.97,'holder nose [0,17.97]');
ok(h.profile[8][0]===85 && h.profile[8][1]===25,'holder gauge plane [85,25]');
ok(!h.cut,'holder carries no cut data');

// ---- type filtering (dropdown split) ----
const em=toolsOfType(SEED_TOOLS,'endmill'), ho=toolsOfType(SEED_TOOLS,'holder');
ok(em.length===3 && em.every(t=>t.type==='endmill'),'3 endmills, no holders');
ok(ho.length===1 && ho[0].id==='sandvik-930-c5-s-20-085','1 holder');
ok(toolsOfType(null,'endmill').length===0,'null list -> [] (no throw)');

// ---- lookup ----
ok(findToolById(SEED_TOOLS,'nope')===null,'unknown id -> null');
ok(findToolById(null,'x')===null,'null list -> null');

// ---- profile validation ----
ok(validateProfile(iv.profile)===null,'Inova profile valid');
ok(validateProfile(h.profile)===null,'holder profile valid');
ok(validateProfile([[0,6]])!==null,'single point rejected');
ok(validateProfile([[0,6],[10,6],[5,6]])==='axial coords must be non-decreasing','decreasing axial rejected');
ok(/radius/.test(validateProfile([[0,6],[10,0]])||''),'non-positive radius rejected');
ok(/radius/.test(validateProfile([[0,6],[10,-3]])||''),'negative radius rejected');
ok(validateProfile([[0,6],[10,6],[10,8]])===null,'equal axial (vertical face) allowed');
ok(validateProfile('nope')!==null,'non-array rejected');
// a bad profile is surfaced by validateTool
ok(validateTool({...iv, profile:[[0,6],[5,6],[1,6]]}).some(m=>/profile/.test(m)),'validateTool flags bad profile');

// ---- validateTool edge cases ----
ok(validateTool({id:'x', name:'x'}).length>0,'incomplete endmill flagged');
ok(validateTool({...g, dc:'twelve'}).some(m=>/dc/.test(m)),'non-numeric dc flagged');
ok(validateTool({...g, variablePitch:'yes'}).some(m=>/variablePitch/.test(m)),'non-boolean flag flagged');
ok(validateTool({type:'holder', id:'x', name:'x', vendor:'v', orderNo:'o'}).some(m=>/gaugeLen/.test(m)),'holder missing gaugeLen flagged');
ok(validateTool({type:'holder', id:'x', name:'x', vendor:'v', orderNo:'o', gaugeLen:85, boreDia:20}).some(m=>/profile/.test(m)),'holder missing profile flagged');

console.log(`tools tests: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
