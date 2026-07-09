// ---------- pure tool library (no DOM, node-testable) ----------
// Schema per tool (all lengths mm, angles deg):
//   id, name, vendor, orderNo, gtin, dc (cutting ø), z (flutes), lc (flute length),
//   reach, neckDia, shankDia, oal, cornerR, helixDeg, variablePitch, coating,
//   substrate, throughCoolant, maxRampDeg, maxSlotDepthFactor (× dc),
//   cut: { <material>: { vc (m/min), fzSlot, fzSide (mm/tooth), aeSide (× dc) } }
const SEED_TOOLS = [
  {
    id:'garant-202019-12',
    name:'GARANT Master Alu PickPocket ø12',
    vendor:'GARANT (Hoffmann)',
    orderNo:'202019 12',
    gtin:'4062406381110',
    dc:12, z:3, lc:19, reach:73, neckDia:11, shankDia:12, oal:120,
    cornerR:0.2, helixDeg:42, variablePitch:true,
    coating:'DLC sp2', substrate:'VHM', throughCoolant:true,
    maxRampDeg:45, maxSlotDepthFactor:2,
    cut:{
      'alu':                {vc:380},
      'alu-short-chipping': {vc:300, fzSlot:0.06, fzSide:0.08, aeSide:0.3},
      'alu-10Si':           {vc:270},   // aluminium up to ~10% Si
      'Cu':                 {vc:140},
      'CuZn':               {vc:160}
    }
  }
];

// Numeric fields every complete catalogue tool must carry.
const TOOL_NUM_FIELDS = ['dc','z','lc','reach','neckDia','shankDia','oal','cornerR',
                         'helixDeg','maxRampDeg','maxSlotDepthFactor'];

function findToolById(list, id){ return (list||[]).find(t=>t&&t.id===id) || null; }

// The cutting-data material that carries fz values (for catalog-vs-live fz display).
function toolCutData(tool){
  if(!tool || !tool.cut) return null;
  for(const mat in tool.cut){
    const c=tool.cut[mat];
    if(c && (c.fzSlot!=null || c.fzSide!=null)) return Object.assign({material:mat}, c);
  }
  return null;
}

// Returns a list of schema problems ([] = valid). Used by tests and before persisting.
function validateTool(t){
  const p=[];
  if(!t || typeof t!=='object'){ return ['not an object']; }
  for(const f of ['id','name','vendor','orderNo','coating','substrate'])
    if(typeof t[f]!=='string' || !t[f]) p.push('missing/blank '+f);
  for(const f of TOOL_NUM_FIELDS)
    if(typeof t[f]!=='number' || !isFinite(t[f])) p.push('missing/non-numeric '+f);
  for(const f of ['variablePitch','throughCoolant'])
    if(typeof t[f]!=='boolean') p.push('missing boolean '+f);
  if(!t.cut || typeof t.cut!=='object' || !Object.keys(t.cut).length) p.push('missing cut materials');
  else for(const mat in t.cut){
    if(typeof t.cut[mat].vc!=='number') p.push('material '+mat+' missing vc');
  }
  return p;
}

if(typeof module!=='undefined'&&module.exports){ module.exports={SEED_TOOLS, findToolById, toolCutData, validateTool}; }
