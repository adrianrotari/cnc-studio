// ---------------- stock simulation (2.5D heightfield, G17 ops) + live cut data ----------------
const STK={on:false,cell:0.5,grid:null,nx:0,ny:0,x0:0,y0:0,ztop:0.5,zbot:-10,mesh:null,offs:null,stamped:0,dirty:false,ae:null,ap:null};
function stockBounds(){
  let mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9],any=false;
  for(const s of SEC){
    if(!visible.has(s.id)||s.plane!==17) continue;
    for(const sg of s.segs){
      if(sg.kind!=='feed') continue;
      for(const p of sg.pts){ any=true;
        for(let i=0;i<3;i++){ if(p[i]<mn[i])mn[i]=p[i]; if(p[i]>mx[i])mx[i]=p[i]; } } } }
  return any?{mn,mx}:null;
}
function setCol(col,k,z){
  const t=Math.max(0,Math.min(1,(z-STK.zbot)/((STK.ztop-STK.zbot)||1)));
  col[k*3]=0.13+0.42*t; col[k*3+1]=0.20+0.50*t; col[k*3+2]=0.30+0.55*t;
}
function rasterModel(){
  // heightfield of the STEP model's top surface, in world coords
  const cell=STK.cell, nx=STK.nx, ny=STK.ny;
  const hf=new Float32Array(nx*ny).fill(-Infinity);
  stepGroup.updateMatrixWorld(true);
  const A=new THREE.Vector3(), B=new THREE.Vector3(), C=new THREE.Vector3();
  stepGroup.traverse(o=>{
    if(!o.isMesh) return;
    const pa=o.geometry.attributes.position, ia=o.geometry.index;
    const cnt=ia?ia.count:pa.count;
    for(let t=0;t<cnt;t+=3){
      A.fromBufferAttribute(pa,ia?ia.getX(t):t).applyMatrix4(o.matrixWorld);
      B.fromBufferAttribute(pa,ia?ia.getX(t+1):t+1).applyMatrix4(o.matrixWorld);
      C.fromBufferAttribute(pa,ia?ia.getX(t+2):t+2).applyMatrix4(o.matrixWorld);
      const minx=Math.min(A.x,B.x,C.x), maxx=Math.max(A.x,B.x,C.x);
      const miny=Math.min(A.y,B.y,C.y), maxy=Math.max(A.y,B.y,C.y);
      const i0=Math.max(0,Math.floor((minx-STK.x0)/cell)), i1=Math.min(nx-1,Math.ceil((maxx-STK.x0)/cell));
      const j0=Math.max(0,Math.floor((miny-STK.y0)/cell)), j1=Math.min(ny-1,Math.ceil((maxy-STK.y0)/cell));
      if(i1<i0||j1<j0) continue;
      const d=(B.y-C.y)*(A.x-C.x)+(C.x-B.x)*(A.y-C.y);
      if(Math.abs(d)<1e-9){                       // vertical wall — mark its footprint at wall top
        const zt=Math.max(A.z,B.z,C.z);
        for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const k=j*nx+i; if(zt>hf[k])hf[k]=zt;}
        continue;
      }
      for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
        const px=STK.x0+i*cell, py=STK.y0+j*cell;
        const w0=((B.y-C.y)*(px-C.x)+(C.x-B.x)*(py-C.y))/d;
        const w1=((C.y-A.y)*(px-C.x)+(A.x-C.x)*(py-C.y))/d;
        const w2=1-w0-w1;
        if(w0<-0.02||w1<-0.02||w2<-0.02) continue;
        const z=w0*A.z+w1*B.z+w2*C.z;
        const k=j*nx+i; if(z>hf[k])hf[k]=z;
      }
    }
  });
  return hf;
}
function stockInit(){
  while(stockGroup.children.length) stockGroup.remove(stockGroup.children[0]);
  STK.grid=null; STK.stamped=0; STK.ae=null; STK.ap=null;
  const bb=stockBounds();
  if(!bb){ STK.on=false; $('ckStock').checked=false; return; }
  const mode=$('sMode').value;
  const useModel = mode==='model' && stepGroup.children.length>0;
  const useCyl = mode==='cyl';
  const off = Math.max(0,parseFloat($('sOff').value)||0);
  const boxTop = isFinite(parseFloat($('sTop').value))?parseFloat($('sTop').value):0.5;
  const cAxis = $('sAxis').value==='Z'?'Z':'X';
  const cR = Math.max(0.5,(parseFloat($('sDia').value)||90)/2);
  const cBnd = useCyl?billetBounds(cAxis,cR,boxTop):null;
  const m=TOOL.d*0.75, cell=STK.cell;
  let x0=bb.mn[0]-m, y0=bb.mn[1]-m, x1=bb.mx[0]+m, y1=bb.mx[1]+m, mb=null;
  if(useModel){
    stepGroup.updateMatrixWorld(true);
    mb=new THREE.Box3().setFromObject(stepGroup);
    x0=Math.min(x0,mb.min.x-off-2); y0=Math.min(y0,mb.min.y-off-2);
    x1=Math.max(x1,mb.max.x+off+2); y1=Math.max(y1,mb.max.y+off+2);
  }
  if(useCyl){                                   // union grid with the billet footprint
    if(cBnd.x){ x0=Math.min(x0,cBnd.x[0]); x1=Math.max(x1,cBnd.x[1]); }
    if(cBnd.y){ y0=Math.min(y0,cBnd.y[0]); y1=Math.max(y1,cBnd.y[1]); }
  }
  STK.x0=x0; STK.y0=y0;
  STK.nx=Math.min(1200,Math.ceil((x1-x0)/cell)+1);
  STK.ny=Math.min(1200,Math.ceil((y1-y0)/cell)+1);
  STK.zbot=Math.min(bb.mn[2],mb?mb.min.z:1e9,cBnd?cBnd.minTop:1e9)-2;
  const NC=STK.nx*STK.ny;
  STK.grid=new Float32Array(NC);
  if(useModel){
    let hf=null;
    try{ hf=rasterModel(); }catch(_){ hf=null; }
    if(hf){
      const rD=Math.max(0,Math.round(off/cell)), dOffs=[];
      for(let j=-rD;j<=rD;j++)for(let i=-rD;i<=rD;i++)
        if(Math.hypot(i,j)*cell<=off+cell*0.25) dOffs.push([i,j]);
      let zmax=-Infinity;
      for(let j=0;j<STK.ny;j++)for(let i=0;i<STK.nx;i++){
        let mx=-Infinity;
        for(const o of dOffs){
          const ii=i+o[0], jj=j+o[1];
          if(ii<0||jj<0||ii>=STK.nx||jj>=STK.ny) continue;
          const z=hf[jj*STK.nx+ii]; if(z>mx)mx=z;
        }
        const v = mx===-Infinity ? STK.zbot : mx+off;
        STK.grid[j*STK.nx+i]=v; if(v>zmax)zmax=v;
      }
      STK.ztop=isFinite(zmax)?zmax:0.5;
    } else {
      STK.ztop=boxTop;
      STK.grid.fill(STK.ztop);
    }
  } else if(useCyl){
    let zmax=-Infinity;
    for(let j=0;j<STK.ny;j++)for(let i=0;i<STK.nx;i++){
      const px=STK.x0+i*cell, py=STK.y0+j*cell;
      const v=billetHeight(cAxis,cR,px,py,boxTop,STK.zbot);
      STK.grid[j*STK.nx+i]=v; if(v>zmax)zmax=v;
    }
    STK.ztop=isFinite(zmax)?zmax:0.5;
  } else {
    STK.ztop=boxTop;
    STK.grid.fill(STK.ztop);
  }
  const rC=Math.ceil((TOOL.d/2)/cell), offs=[];
  for(let j=-rC;j<=rC;j++)for(let i=-rC;i<=rC;i++)
    if(Math.hypot(i,j)*cell<=TOOL.d/2+cell*0.4) offs.push([i,j]);
  STK.offs=offs;
  const nx=STK.nx, ny=STK.ny;
  const pos=new Float32Array(nx*ny*3), col=new Float32Array(nx*ny*3);
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const k=j*nx+i;
    pos[k*3]=STK.x0+i*cell; pos[k*3+1]=STK.y0+j*cell; pos[k*3+2]=STK.grid[k];
    setCol(col,k,STK.grid[k]);
  }
  const idx=new Uint32Array((nx-1)*(ny-1)*6); let q=0;
  for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){
    const a=j*nx+i, b=a+1, c=a+nx, d2=c+1;
    idx[q++]=a;idx[q++]=b;idx[q++]=c; idx[q++]=b;idx[q++]=d2;idx[q++]=c;
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(pos,3));
  g.setAttribute('color',new THREE.BufferAttribute(col,3));
  g.setIndex(new THREE.BufferAttribute(idx,1));
  STK.mesh=new THREE.Mesh(g,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide}));
  stockGroup.add(STK.mesh);
}
function stamp(cx,cy,cz,ux,uy,measure){
  const cell=STK.cell, nx=STK.nx, ny=STK.ny, g=STK.grid;
  const ci=Math.round((cx-STK.x0)/cell), cj=Math.round((cy-STK.y0)/cell);
  const pos=STK.mesh.geometry.attributes.position.array;
  const col=STK.mesh.geometry.attributes.color.array;
  let mnP=1e9, mxP=-1e9, ap=0, hit=false;
  const r=TOOL.d/2;
  for(const o of STK.offs){
    const i=ci+o[0], j=cj+o[1];
    if(i<0||j<0||i>=nx||j>=ny) continue;
    const k=j*nx+i, zc=g[k];
    if(zc>cz+1e-4){
      if(measure && zc>cz+0.05){        // count real engagement only (≥0.05 mm), not µm re-cuts
        hit=true;
        const rx=o[0]*cell, ry=o[1]*cell;
        if(rx*ux+ry*uy>=-r*0.25){
          const pr=-rx*uy+ry*ux;
          if(pr<mnP)mnP=pr; if(pr>mxP)mxP=pr;
        }
        if(zc-cz>ap) ap=zc-cz;
      }
      g[k]=cz; pos[k*3+2]=cz; setCol(col,k,cz); STK.dirty=true;
    }
  }
  if(!measure) return null;
  return {hit, ae:hit&&mxP>mnP?mxP-mnP+cell:(hit?cell:0), ap};
}
function stampTo(target){
  if(!STK.on||!STK.grid||!TL.length) return;
  if(target<STK.stamped-1e-6) stockInit();
  const from=STK.stamped;
  if(target<=from){ STK.stamped=target; return; }
  let lo=0, hi=TL.length-1;
  while(lo<hi){ const mid=(lo+hi>>1); (TL[mid].off+TL[mid].l<from)?lo=mid+1:hi=mid; }
  const step=0.45, mFrom=target-2.5;      // measure over trailing 2.5 mm of path
  let aeM=0, apM=0, sawCut=false, measured=false;
  for(let ie=lo; ie<TL.length; ie++){
    const e=TL[ie];
    if(e.off>target) break;
    if(e.sg.kind!=='feed'||e.sec.plane!==17) continue;
    const a=Math.max(from,e.off), b=Math.min(target,e.off+e.l);
    if(b<=a) continue;
    const dx=e.b[0]-e.a[0], dy=e.b[1]-e.a[1];
    const L=Math.hypot(dx,dy)||1e-9, ux=dx/L, uy=dy/L;
    const n=Math.max(1,Math.ceil((b-a)/step));
    for(let k=1;k<=n;k++){
      const d=a+(b-a)*k/n, t=Math.min(1,Math.max(0,(d-e.off)/e.l));
      const res=stamp(e.a[0]+(e.b[0]-e.a[0])*t, e.a[1]+(e.b[1]-e.a[1])*t, e.a[2]+(e.b[2]-e.a[2])*t, ux,uy, d>=mFrom);
      if(res){ measured=true;
        if(res.hit){ sawCut=true; if(res.ae>aeM)aeM=res.ae; if(res.ap>apM)apM=res.ap; } }
    }
  }
  if(measured){ STK.ae=sawCut?Math.min(TOOL.d,aeM):0; STK.ap=sawCut?apM:0; }
  STK.stamped=target;
  if(STK.dirty&&STK.mesh){
    STK.mesh.geometry.attributes.position.needsUpdate=true;
    STK.mesh.geometry.attributes.color.needsUpdate=true;
    STK.dirty=false;
  }
}
function updateCut(e){
  const n=e.sg.s, f=e.sg.kind==='feed'?e.sg.f:null;
  const fz=(f&&n)?f/(n*TOOL.z):null;
  const vc=n?Math.PI*TOOL.d*n/1000:null;
  $('cN').textContent=n?n.toFixed(0):'—';
  $('cVc').textContent=vc?vc.toFixed(0):'—';
  $('cF').textContent=f?f.toFixed(0):'—';
  $('cFz').textContent=fz?fz.toFixed(3):'—';
  const cutting=STK.on&&e.sg.kind==='feed'&&e.sec.plane===17&&STK.ae!==null;
  const ae=cutting?STK.ae:null, ap=cutting?STK.ap:null;
  const kk=ae!==null?Math.max(0,Math.min(1,ae/TOOL.d)):null;
  const hex=(kk!==null&&fz)?(kk>=0.5?fz:fz*2*Math.sqrt(Math.max(kk-kk*kk,0))):null;
  $('cAe').textContent=ae!==null?ae.toFixed(2):'—';
  $('cAeD').textContent=kk!==null?(100*kk).toFixed(0):'—';
  $('cHex').textContent=hex!==null?hex.toFixed(3):'—';
  $('cAp').textContent=ap!==null?ap.toFixed(2):'—';
  $('cMrr').textContent=(ae&&ap&&f)?(ae*ap*f/1000).toFixed(1):'—';
  // catalog fz vs live (library tools) — slotting vs side by measured engagement
  const cat=$('cFzCat'), cd=TOOL.lib?toolCutData(TOOL.lib):null;
  if(cat){
    if(cd && fz!=null){
      const slotting = kk!==null ? kk>=0.8 : true;
      let cf = slotting?cd.fzSlot:cd.fzSide, kind = slotting?'slot':'side';
      if(cf==null){ cf = slotting?cd.fzSide:cd.fzSlot; kind = slotting?'side':'slot'; }
      cat.textContent = cf!=null ? ` (cat ${kind} ${cf})` : '';
      cat.style.color = (cf!=null && fz>cf) ? 'var(--org)' : 'var(--dim)';
    } else cat.textContent='';
  }
}
function autoAlign(){
  if(!stepGroup.children.length||!SEC.length) return;
  const bb=bboxVisible(); if(!bb) return;
  const mb=new THREE.Box3().setFromObject(stepGroup);
  const mc=new THREE.Vector3(); mb.getCenter(mc);
  const pc=new THREE.Vector3(); bb.getCenter(pc);
  stepGroup.position.x+=pc.x-mc.x;
  stepGroup.position.y+=pc.y-mc.y;
  stepGroup.position.z+=0-mb.max.z;   // model top face → program Z0
  ['stX','stY','stZ'].forEach((id,i)=>$(id).value=stepGroup.position.getComponent(i).toFixed(1));
}
function stockRefresh(){ if(STK.on){ stockInit(); if(STK.grid) stampTo(tlPos); } }
$('stAuto').onclick=()=>{ autoAlign(); stockRefresh(); };
$('ckStock').onchange=e=>{
  STK.on=e.target.checked;
  if(STK.on) stockRefresh();
  else { while(stockGroup.children.length) stockGroup.remove(stockGroup.children[0]); STK.grid=null; STK.ae=null; }
};
$('bStkReset').onclick=stockRefresh;
$('sTop').onchange=stockRefresh;
$('sMode').onchange=stockRefresh;
$('sOff').onchange=stockRefresh;
$('sDia').onchange=stockRefresh;
$('sAxis').onchange=stockRefresh;
$('tD').onchange=e=>{ TOOL.d=Math.max(0.5,parseFloat(e.target.value)||12); buildTool(); stockRefresh(); };
$('tZ').onchange=e=>{ TOOL.z=Math.max(1,parseInt(e.target.value)||3); };

// ---- tool library: seed tools + user tools (localStorage) + custom ----
const TOOLS_LSKEY='cncstudio.userTools';
let USER_TOOLS=[];
try{ const s=localStorage.getItem(TOOLS_LSKEY); if(s) USER_TOOLS=JSON.parse(s)||[]; }catch(_){ USER_TOOLS=[]; }
function allTools(){ return SEED_TOOLS.concat(USER_TOOLS); }
function buildToolSelect(){
  const sel=$('tSel'); if(!sel) return;
  const cur=sel.value||'custom';
  sel.innerHTML='';
  for(const t of allTools()){
    const o=document.createElement('option'); o.value=t.id; o.textContent=t.name+' · ø'+t.dc+'×'+t.z+'Z'; sel.append(o);
  }
  const oc=document.createElement('option'); oc.value='custom'; oc.textContent='custom (manual ø/z)'; sel.append(oc);
  sel.value=[...sel.options].some(o=>o.value===cur)?cur:'custom';
}
function applyToolSelection(){
  const id=$('tSel').value;
  if(id==='custom'){
    TOOL.lib=null; $('tD').disabled=false; $('tZ').disabled=false;
  } else {
    const t=findToolById(allTools(),id);
    if(t){ TOOL.lib=t; TOOL.d=t.dc; TOOL.z=t.z; $('tD').value=t.dc; $('tZ').value=t.z;
           $('tD').disabled=true; $('tZ').disabled=true; }
  }
  buildTool(); stockRefresh(); if(TL.length) stepAnim(true);
}
$('tSel').onchange=applyToolSelection;
$('tAdd').onclick=()=>{
  const nm=prompt('Save current tool as (name):', TOOL.lib?TOOL.lib.name:('endmill ø'+TOOL.d));
  if(!nm) return;
  const base=TOOL.lib||{};
  const t=Object.assign({}, base, {id:'user-'+Date.now(), name:nm, vendor:base.vendor||'user',
      orderNo:base.orderNo||'', dc:TOOL.d, z:TOOL.z});
  USER_TOOLS.push(t);
  try{ localStorage.setItem(TOOLS_LSKEY, JSON.stringify(USER_TOOLS)); }catch(_){}
  buildToolSelect(); $('tSel').value=t.id; applyToolSelection();
};
buildToolSelect();
// model moved/rotated by hand → stock built from the model must follow
document.querySelectorAll('#stepbox [data-r]').forEach(b=>b.addEventListener('click',()=>{ if($('sMode').value==='model') stockRefresh(); }));
['stX','stY','stZ'].forEach(id=>$(id).addEventListener('change',()=>{ if($('sMode').value==='model') stockRefresh(); }));
