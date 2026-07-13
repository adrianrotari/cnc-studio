// ---------------- tool library viewer + toolpath generator UI ----------------
let GENCOUNT=0;
function toolTableRender(){
  const box=$('toolTable'); if(!box) return;
  const rows=[];
  rows.push('<tr><th>name</th><th>vendor</th><th>order no</th><th>type</th><th>ø</th><th>z</th><th>lc</th><th>vc</th><th>fz side</th><th>fz slot</th><th></th></tr>');
  for(const t of allTools()){
    const cd=toolCutData(t)||{};
    const user=String(t.id).startsWith('user-');
    rows.push('<tr><td title="'+(t.note||'')+'">'+t.name+'</td><td>'+(t.vendor||'')+'</td><td>'+(t.orderNo||'')+'</td><td>'+(t.type||'endmill')+'</td>'+
      '<td>'+(t.dc!=null?t.dc:'—')+'</td><td>'+(t.z!=null?t.z:'—')+'</td><td>'+(t.lc!=null?t.lc:'—')+'</td>'+
      '<td>'+(cd.vc!=null?cd.vc:'—')+'</td><td>'+(cd.fzSide!=null?cd.fzSide:'—')+'</td><td>'+(cd.fzSlot===null?'none':(cd.fzSlot!=null?cd.fzSlot:'—'))+'</td>'+
      '<td>'+(user?'<button class="btn" data-del="'+t.id+'" style="padding:0 6px;font-size:10px">✕</button>':'')+'</td></tr>');
  }
  box.innerHTML='<table style="border-collapse:collapse;width:100%">'+rows.join('')+'</table>';
  box.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{
    USER_TOOLS=USER_TOOLS.filter(t=>t.id!==b.dataset.del);
    try{ localStorage.setItem(TOOLS_LSKEY,JSON.stringify(USER_TOOLS)); }catch(_){}
    buildToolSelect(); buildHolderSelect(); toolTableRender();
  });
}
$('bTools').onclick=()=>{
  const p=$('toolbox');
  const show=p.style.display!=='block';
  p.style.display=show?'block':'none';
  if(show) toolTableRender();
};
$('tbClose').onclick=()=>{ $('toolbox').style.display='none'; };
// wizard state: selected strategy + stock summary line
function genStrategy(){
  const r=document.querySelector('input[name="gStrat"]:checked');
  return r?r.value:'contour';
}
function genStockSum(){
  const el=$('gStockSum'); if(!el) return;
  const dia=parseFloat($('sDia').value)||90;
  const b=(typeof FIX!=='undefined')?FIX.b:0;
  el.textContent='bar ø'+dia+' · B'+b.toFixed(0)+(genAxisX()?' · axis X':' · axis Z');
}
// prefill fz/vc from the selected library tool's cut data.
// contour rough = side milling fz; pocket = slot fz (falls back to side, noted)
function genPrefill(){
  const cd=TOOL.lib?toolCutData(TOOL.lib):null;
  const note=$('gNote');
  if(cd){
    if(cd.vc) $('gVc').value=cd.vc;
    const strat=genStrategy();
    let fz;
    if(strat==='pocket'){
      fz=cd.fzSlot!=null?cd.fzSlot:cd.fzSide;
      if(note) note.textContent=cd.fzSlot===null?'tool not rated for slotting — side fz used':'';
    } else {
      fz=cd.fzSide!=null?cd.fzSide:cd.fzSlot;
      if(note) note.textContent='';
    }
    if(fz!=null) $('gFz').value=fz;
  }
  genStockSum();
}
$('tSel').addEventListener('change',genPrefill);
document.querySelectorAll('input[name="gStrat"]').forEach(r=>r.addEventListener('change',genPrefill));
$('genbox').addEventListener('mouseenter',genStockSum);
function genAxisX(){ return typeof FIX!=='undefined' && FIX.b>=45; }   // B90 -> slice along bar axis X
$('gZfit').onclick=()=>{
  if(!stepGroup.children.length) return;
  stepGroup.updateMatrixWorld(true);
  const mb=new THREE.Box3().setFromObject(stepGroup);
  if(genAxisX()){ $('gZt').value=mb.max.x.toFixed(1); $('gZb').value=mb.min.x.toFixed(1); }
  else { $('gZt').value=mb.max.z.toFixed(1); $('gZb').value=mb.min.z.toFixed(1); }
};
function collectTris(){
  const out=[];
  stepGroup.updateMatrixWorld(true);
  const A=new THREE.Vector3(),B=new THREE.Vector3(),C=new THREE.Vector3();
  stepGroup.traverse(o=>{
    if(!o.isMesh)return;
    const pa=o.geometry.attributes.position, ia=o.geometry.index;
    const cnt=ia?ia.count:pa.count;
    for(let t=0;t<cnt;t+=3){
      A.fromBufferAttribute(pa,ia?ia.getX(t):t).applyMatrix4(o.matrixWorld);
      B.fromBufferAttribute(pa,ia?ia.getX(t+1):t+1).applyMatrix4(o.matrixWorld);
      C.fromBufferAttribute(pa,ia?ia.getX(t+2):t+2).applyMatrix4(o.matrixWorld);
      out.push(A.x,A.y,A.z,B.x,B.y,B.z,C.x,C.y,C.z);
    }
  });
  return out;
}
$('gGo').onclick=()=>{
  if(!stepGroup.children.length){ $('fname').textContent='load a STEP model first — the generator works from the model silhouette'; return; }
  const D=TOOL.d, toolR=D/2;
  const zT=parseFloat($('gZt').value), zB=parseFloat($('gZb').value);
  if(!isFinite(zT)||!isFinite(zB)||zB>=zT){ $('fname').textContent='generator: Z top must be above Z bottom'; return; }
  const ap=Math.max(0.2,parseFloat($('gAp').value)||3);
  const ae=Math.max(0.2,parseFloat($('gAe').value)||D*0.6);
  const allow=Math.max(0,parseFloat($('gAl').value)||0);
  const fz=Math.max(0.001,parseFloat($('gFz').value)||0.08);
  const vc=Math.max(10,parseFloat($('gVc').value)||300);
  const barR=Math.max(1,(parseFloat($('sDia').value)||90)/2);
  const rpm=Math.round(1000*vc/(Math.PI*D));
  const feed=Math.round(rpm*TOOL.z*fz);
  const axX=genAxisX();
  let tris=collectTris();
  if(axX){                     // map bar-axis-X world -> generator frame: (x,y,z)->(y, z+barR, x)
    const t2=new Array(tris.length);
    for(let i=0;i<tris.length;i+=3){ t2[i]=tris[i+1]; t2[i+1]=tris[i+2]+barR; t2[i+2]=tris[i]; }
    tris=t2;
  }
  const strat=genStrategy();
  let segs;
  try{ segs=(strat==='pocket'?genPocketRough:genContourRough)(
    tris,{zTop:zT,zBot:zB,ap,ae,toolR,allow,barR,feed,plunge:Math.round(feed/3),rpm,rampDeg:3}); }
  catch(err){ $('fname').textContent='generator: '+err.message; return; }
  if(axX){                     // map back: (X',Y',Z') -> (x=Z', y=X', z=Y'-barR)
    for(const sg of segs) sg.pts=sg.pts.map(p=>[p[2],p[0],p[1]-barR]);
  }
  const warns=(segs.warnings&&segs.warnings.length)?segs.warnings:[];
  if($('gNote')) $('gNote').textContent=warns.length?('⚠ '+warns.join(' · ')):'';
  if(!segs.length){ $('fname').textContent='generator made no passes — check Z range vs model'+(warns.length?' · '+warns[0]:''); return; }
  let cut=0,rap=0,zMin=1e9,zMax=-1e9;
  for(const sg of segs){
    for(let i=1;i<sg.pts.length;i++){
      const a=sg.pts[i-1],b=sg.pts[i],l=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
      if(sg.kind==='feed')cut+=l; else rap+=l;
    }
    for(const p of sg.pts){ if(p[2]<zMin)zMin=p[2]; if(p[2]>zMax)zMax=p[2]; }
  }
  const tMin=cut/feed + rap/12000;
  GENCOUNT++;
  const stratName=strat==='pocket'?'POCKET':'CONTOUR ROUGH';
  const s={id:1000+GENCOUNT, name:'GEN'+GENCOUNT+' '+stratName+' ø'+D+(axX?' B-90':' B0'),
    tool:'GEN', toolTxt:'gen ø'+D, plane:axX?19:17, bOri:axX?-90:0, color:strat==='pocket'?'#ff9e66':'#ffd166',
    desc:[strat==='pocket'?'generated pocket clearing (helical entry)':'generated contour roughing'],
    descTxt:'ae '+ae+' · ap '+ap+' · fz '+fz+' · vc '+vc+' · S'+rpm+' · F'+feed+(axX?' · along X':''),
    segs, cutLen:cut, rapLen:rap, tMin, zMin, zMax, calls:[], resolvedCalls:[], isRough12:false};
  SEC.push(s); visible.add(s.id);
  buildList(); rebuild3D(); buildTimeline(); updateHud();
  $('cut').style.display='block';
  $('fname').textContent=s.name+' — '+(cut/1000).toFixed(2)+' m cutting, ~'+tMin.toFixed(1)+' min';
};
$('gClr').onclick=()=>{
  SEC=SEC.filter(x=>x.tool!=='GEN');
  visible=new Set([...visible].filter(id=>SEC.some(x=>x.id===id)));
  buildList(); rebuild3D(); buildTimeline(); updateHud();
};
// collapsible bottom-right panels — click the title to fold, state persists
const PANELCLPS={};
for(const id of ['stepbox','fixbox','genbox']){
  const box=$(id); if(!box) continue;
  const head=box.querySelector('b'); if(!head) continue;
  const arrow=document.createElement('span');
  arrow.textContent='▾ ';
  head.insertBefore(arrow,head.firstChild);
  head.style.cursor='pointer'; head.style.userSelect='none';
  if(!head.title) head.title='click to collapse';
  const KEY='cncstudio.clps.'+id;
  const apply=c=>{
    arrow.textContent=c?'▸ ':'▾ ';
    for(const el of box.children){ if(el.tagName!=='B') el.style.display=c?'none':''; }
  };
  const setC=c=>{
    box._clps=!!c; apply(box._clps);
    try{ localStorage.setItem(KEY,box._clps?'1':'0'); }catch(_){}
  };
  head.onclick=()=>setC(!box._clps);
  PANELCLPS[id]=setC;
  let c0=false; try{ c0=localStorage.getItem(KEY)==='1'; }catch(_){}
  if(c0){ box._clps=true; apply(true); }
}
// wizard step 1: jump to the Chuck + stock panel
$('gStockGo').onclick=()=>{
  if(PANELCLPS.fixbox) PANELCLPS.fixbox(false);
  const b=$('fixbox');
  b.style.outline='1px solid var(--acc)';
  setTimeout(()=>{ b.style.outline=''; },900);
};
