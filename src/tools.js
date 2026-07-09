// ---------- pure tool library (no DOM, node-testable) ----------
// Schema per entry (lengths mm, angles deg). Common:
//   id, name, vendor, orderNo, type:'endmill'|'holder' (default 'endmill'),
//   note (string; shown as the dropdown entry's tooltip),
//   profile:[[axial_mm_from_tip, radius_mm], ...]  (revolved silhouette, optional)
// Endmill: dc, z, lc, reach, neckDia, shankDia, oal, cornerR, cornerType, helixDeg,
//   variablePitch, coating, substrate, polishedFlutes, throughCoolant, coolantStyle,
//   maxRampDeg, maxSlotDepthFactor(×dc), cut:{ <material>:{vc, fzSlot, fzSide, aeSide,
//   apSide, slotNote} }. fzSlot may be null with a slotNote when the vendor publishes
//   no slotting data.
// Holder: gaugeLen, boreDia, taper, profile (required).
const SEED_TOOLS = [
  {
    id:'garant-202019-12',
    type:'endmill',
    name:'GARANT Master Alu PickPocket ø12',
    vendor:'GARANT (Hoffmann)',
    orderNo:'202019 12',
    gtin:'4062406381110',
    dc:12, z:3, lc:19, reach:73, neckDia:11, shankDia:12, oal:120,
    cornerR:0.2, cornerType:'radius 0.2', helixDeg:42, variablePitch:true,
    coating:'DLC sp2', substrate:'VHM', throughCoolant:true, coolantStyle:'central',
    maxRampDeg:45, maxSlotDepthFactor:2,
    note:'candidate replacement — ø11 neck = 0.5 mm/side chip clearance',
    cut:{
      'alu':                {vc:380},
      'alu-short-chipping': {vc:300, fzSlot:0.06, fzSide:0.08, aeSide:0.3},
      'alu-10Si':           {vc:270},   // aluminium up to ~10% Si
      'Cu':                 {vc:140},
      'CuZn':               {vc:160}
    }
  },
  {
    id:'inova-2405120',
    type:'endmill',
    name:'Inova Tools ø12 TYP W alu (2.405.120.00)',
    vendor:'Inova Tools',
    orderNo:'2.405.120.00',
    dc:12, z:3, lc:19, reach:73, neckDia:11.7, shankDia:12, oal:120,
    cornerR:0.2, cornerType:'chamfer 0.2x45', helixDeg:45, variablePitch:true,
    coating:'ta-C', polishedFlutes:true, throughCoolant:true, coolantStyle:'lateral Y-IK',
    note:'broke in ref job — neck clearance 0.15 mm/side in the ø12 slot',
    cut:{
      'AW-6082 long-chipping alu':{vc:275, fzSide:0.050, aeSide:0.3, apSide:12,
        fzSlot:null, slotNote:'INOCUT publishes NO roughing/grooving values for this tool in this material'}
    },
    // dims verified against inovatools.eu; cut data from INOCUT sheet 2026-07-09
    profile:[[0,5.8],[0.2,6],[19,6],[72.74,5.85],[73.56,6],[118.8,6],[120,4.8]]
  },
  {
    id:'sandvik-930-c5-s-20-085',
    type:'holder',
    name:'Sandvik CoroChuck 930 C5 slender ø20 GL85',
    vendor:'Sandvik Coromant',
    orderNo:'930-C5-S-20-085',
    gaugeLen:85, boreDia:20, taper:'Capto C5',
    note:'customer setup: ø12 shank via ø20→12 reduction sleeve',
    // measured from the vendor STEP's circle entities; profile ends at the gauge
    // plane, Capto male side intentionally omitted
    profile:[[0,17.97],[1.05,19.17],[14.79,20.85],[17.22,21],[49.25,21],
             [51.6,22.65],[52.22,24.34],[53.16,25],[85,25]]
  }
];

function findToolById(list, id){ return (list||[]).find(t=>t&&t.id===id) || null; }
function toolsOfType(list, type){ return (list||[]).filter(t=>t && (t.type||'endmill')===type); }

// The cutting-data material that carries fz values (for catalog-vs-live fz display).
function toolCutData(tool){
  if(!tool || !tool.cut) return null;
  for(const mat in tool.cut){
    const c=tool.cut[mat];
    if(c && (c.fzSlot!==undefined || c.fzSide!==undefined)) return Object.assign({material:mat}, c);
  }
  return null;
}

// Revolved-silhouette profile: >=2 points, non-decreasing axial coord, positive radii.
// Returns an error string, or null when valid.
function validateProfile(prof){
  if(!Array.isArray(prof) || prof.length<2) return 'need >=2 points';
  let prev=-Infinity;
  for(const pt of prof){
    if(!Array.isArray(pt) || pt.length<2) return 'point must be [axial,radius]';
    const a=pt[0], r=pt[1];
    if(typeof a!=='number' || typeof r!=='number' || !isFinite(a) || !isFinite(r)) return 'non-numeric point';
    if(r<=0) return 'radius must be > 0';
    if(a<prev) return 'axial coords must be non-decreasing';
    prev=a;
  }
  return null;
}

// Returns a list of schema problems ([] = valid). Used by tests and before persisting.
function validateTool(t){
  const p=[];
  if(!t || typeof t!=='object') return ['not an object'];
  const type=t.type||'endmill';
  if(type!=='endmill' && type!=='holder') p.push('bad type '+type);
  for(const f of ['id','name','vendor','orderNo'])
    if(typeof t[f]!=='string' || !t[f]) p.push('missing/blank '+f);
  for(const f of ['coating','substrate','cornerType','coolantStyle','taper','note'])
    if(t[f]!=null && typeof t[f]!=='string') p.push(f+' must be a string');
  for(const f of ['variablePitch','throughCoolant','polishedFlutes'])
    if(t[f]!=null && typeof t[f]!=='boolean') p.push(f+' must be boolean');
  if(type==='endmill'){
    for(const f of ['dc','z'])
      if(typeof t[f]!=='number' || !isFinite(t[f])) p.push('missing/non-numeric '+f);
    for(const f of ['lc','reach','neckDia','shankDia','oal','cornerR','helixDeg','maxRampDeg','maxSlotDepthFactor'])
      if(t[f]!=null && (typeof t[f]!=='number' || !isFinite(t[f]))) p.push(f+' must be numeric');
    if(!t.cut || typeof t.cut!=='object' || !Object.keys(t.cut).length) p.push('missing cut materials');
    else for(const mat in t.cut){
      const c=t.cut[mat];
      if(typeof c.vc!=='number') p.push('material '+mat+' missing vc');
      if('fzSlot' in c && c.fzSlot!==null && typeof c.fzSlot!=='number') p.push('material '+mat+' bad fzSlot');
    }
  } else {   // holder
    for(const f of ['gaugeLen','boreDia'])
      if(typeof t[f]!=='number' || !isFinite(t[f])) p.push('missing/non-numeric '+f);
    if(!Array.isArray(t.profile)) p.push('holder needs a profile');
  }
  if(t.profile!=null){ const pe=validateProfile(t.profile); if(pe) p.push('profile: '+pe); }
  return p;
}

if(typeof module!=='undefined'&&module.exports){ module.exports={SEED_TOOLS, findToolById, toolsOfType, toolCutData, validateProfile, validateTool}; }
