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
// prefill fz/vc from the selected library tool's cut data
function genPrefill(){
  const cd=TOOL.lib?toolCutData(TOOL.lib):null;
  if(cd){
    if(cd.vc) $('gVc').value=cd.vc;
    const fz=cd.fzSide!=null?cd.fzSide:cd.fzSlot;
    if(fz!=null) $('gFz').value=fz;
  }
}
$('tSel').addEventListener('change',genPrefill);
$('gZfit').onclick=()=>{
  if(!stepGroup.children.length) return;
  stepGroup.updateMatrixWorld(true);
  const mb=new THREE.Box3().setFromObject(stepGroup);
  $('gZt').value=mb.max.z.toFixed(1);
  $('gZb').value=mb.min.z.toFixed(1);
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
  let segs;
  try{ segs=genContourRough(collectTris(),{zTop:zT,zBot:zB,ap,ae,toolR,allow,barR,feed,plunge:Math.round(feed/3),rpm}); }
  catch(err){ $('fname').textContent='generator: '+err.message; return; }
  if(!segs.length){ $('fname').textContent='generator made no passes — check Z range vs model'; return; }
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
  const s={id:1000+GENCOUNT, name:'GEN'+GENCOUNT+' CONTOUR ROUGH ø'+D,
    tool:'GEN', toolTxt:'gen ø'+D, plane:17, color:'#ffd166',
    desc:['generated contour roughing'],
    descTxt:'ae '+ae+' · ap '+ap+' · fz '+fz+' · vc '+vc+' · S'+rpm+' · F'+feed,
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
