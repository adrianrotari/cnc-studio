// ---------------- chuck + round stock fixture (visual only) ----------------
// Parametric 3-jaw chuck gripping a round bar. B tilts the whole assembly:
//   B0  = bar axis Z (vertical), bar top face at `box top` — matches billetHeight axis 'Z'
//   B90 = bar axis X (horizontal), centerline at z=-r so the bar top touches Z0 —
//         matches billetHeight axis 'X'. Free end faces +X (part side).
// Bar ø follows the STOCK `bar ø` field (sDia). Does not affect the cut sim.
let fixtureGroup=null;
const FIX={b:0,len:150,tipX:80,show:true};
const FIX_LSKEY='cncstudio.fixture';
(function(){ try{ const s=JSON.parse(localStorage.getItem(FIX_LSKEY)||'null');
  if(s){ FIX.b=Math.min(90,Math.max(0,+s.b||0)); FIX.len=Math.min(2000,Math.max(10,+s.len||150)); FIX.show=s.show!==false; } }catch(_){} })();
function fixSave(){ try{ localStorage.setItem(FIX_LSKEY,JSON.stringify({b:FIX.b,len:FIX.len,show:FIX.show})); }catch(_){} }
function fixDia(){ return Math.max(1,parseFloat($('sDia').value)||90); }
function fixTop(){ const v=parseFloat($('sTop').value); return isFinite(v)?v:0.5; }
function fixTipX(){
  if(typeof SEC!=='undefined'&&SEC.length){ const bb=bboxVisible(); if(bb) return bb.max.x+10; }
  return FIX.tipX;
}
function fixtureBuild(){
  if(!fixtureGroup) return;
  while(fixtureGroup.children.length) fixtureGroup.remove(fixtureGroup.children[0]);
  const D=fixDia(), r=D/2, len=Math.max(10,FIX.len);
  const bodyR=Math.min(160,Math.max(60,0.95*D));          // chuck body radius
  const bodyL=Math.min(130,Math.max(50,bodyR));           // body length
  const grip=Math.min(32,bodyL*0.38);                     // jaw protrusion over the bar
  const mat=(c,o)=>new THREE.MeshPhongMaterial({color:c,transparent:o<1,opacity:o});
  const cyl=(rad,h,m,seg)=>{const ms=new THREE.Mesh(new THREE.CylinderGeometry(rad,rad,h,seg||48),m);ms.rotation.x=Math.PI/2;return ms;};
  // bar stock — free end face at local z=0, bar extends to -len (into the chuck)
  const bar=cyl(r,len,new THREE.MeshPhongMaterial({color:0xb9c8d8,transparent:true,opacity:0.30,depthWrite:false}));
  bar.position.z=-len/2; fixtureGroup.add(bar);
  const zF=-len;                                          // chuck face plane
  const body=cyl(bodyR,bodyL,mat(0x3a4a5e,0.97)); body.position.z=zF-bodyL/2; fixtureGroup.add(body);
  const ring=cyl(bodyR*0.985,1.6,mat(0x22303f,1)); ring.position.z=zF+0.8; fixtureGroup.add(ring);
  const back=cyl(bodyR*0.62,bodyL*0.3,mat(0x2a3646,1)); back.position.z=zF-bodyL-bodyL*0.15; fixtureGroup.add(back);
  // 3 stepped jaws at 120°, gripping the bar OD
  const jt=Math.max(6,(bodyR*0.88-r)/3), w=Math.max(14,bodyR*0.34), hs=[grip*0.5,grip*0.78,grip];
  for(let j=0;j<3;j++){
    const jaw=new THREE.Group();
    for(let s=0;s<3;s++){
      const ri=Math.max(1,r-1+s*jt), h=hs[s];
      const b=new THREE.Mesh(new THREE.BoxGeometry(jt,w,h),mat(0x8aa0b8,1));
      b.position.set(ri+jt/2,0,zF+h/2);
      jaw.add(b);
    }
    jaw.rotation.z=j*2*Math.PI/3;
    fixtureGroup.add(jaw);
  }
  fixturePlace();
}
function fixturePlace(){
  if(!fixtureGroup) return;
  const t=FIX.b/90, r=fixDia()/2;
  const vz=fixTop(), hx=fixTipX();
  fixtureGroup.position.set(hx*t, 0, vz+(-r-vz)*t);
  fixtureGroup.rotation.set(0,FIX.b*Math.PI/180,0);
  updateGridZ();
}
// grid always sits under everything — toolpath and fixture alike
function updateGridZ(){
  if(typeof GRID==='undefined'||!GRID) return;
  let z=0;
  if(typeof SEC!=='undefined'&&SEC.length){ const bb=bboxVisible(); if(bb) z=bb.min.z; }
  if(fixtureGroup&&fixtureGroup.visible){
    fixtureGroup.updateMatrixWorld(true);
    const fb=new THREE.Box3().setFromObject(fixtureGroup);
    if(isFinite(fb.min.z)) z=Math.min(z,fb.min.z);
  }
  GRID.position.z=z-1;
}
function fixtureSetB(v){
  FIX.b=Math.min(90,Math.max(0,v));
  $('fxB').value=FIX.b; $('fxBv').textContent=FIX.b.toFixed(0)+'°';
  fixSave();
  fixturePlace();
}
function fixtureInit(){
  fixtureGroup=new THREE.Group(); scene.add(fixtureGroup);
  $('fxShow').checked=FIX.show; $('fxLen').value=FIX.len;
  $('fxB').value=FIX.b; $('fxBv').textContent=FIX.b.toFixed(0)+'°';
  fixtureGroup.visible=FIX.show;
  fixtureBuild();
}
$('fxShow').onchange=e=>{ FIX.show=e.target.checked; fixSave();
  if(fixtureGroup){ fixtureGroup.visible=FIX.show; updateGridZ(); } };
$('fxLen').onchange=e=>{ let v=parseFloat(e.target.value); if(!isFinite(v)) v=150;
  v=Math.min(2000,Math.max(10,v)); e.target.value=v; FIX.len=v; fixSave(); fixtureBuild(); };
$('fxB').oninput=e=>fixtureSetB(parseFloat(e.target.value)||0);
$('fxB0').onclick=()=>{ fixtureSetB(0); if($('sAxis').value!=='Z'){ $('sAxis').value='Z'; stockRefresh(); } };
$('fxB90').onclick=()=>{ fixtureSetB(90); if($('sAxis').value!=='X'){ $('sAxis').value='X'; stockRefresh(); } };
$('sAxis').addEventListener('change',e=>fixtureSetB(e.target.value==='Z'?0:90));
$('sDia').addEventListener('change',fixtureBuild);
$('sTop').addEventListener('change',fixturePlace);
