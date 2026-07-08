// ---------------- STEP loader (occt-import-js, lazy from CDN) ----------------
let occtReady=null;
function loadOcct(){
  if(occtReady) return occtReady;
  occtReady=new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/occt-import-js.js';
    s.onload=()=>occtimportjs({locateFile:f=>'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/'+f}).then(res,rej);
    s.onerror=()=>rej(new Error('CDN unreachable'));
    document.head.appendChild(s);
  });
  return occtReady;
}
async function loadSTEP(buf,name){
  document.getElementById('fname').textContent='loading STEP… (first time downloads ~12 MB engine)';
  try{
    const occt=await loadOcct();
    const r=occt.ReadStepFile(new Uint8Array(buf),null);
    if(!r.success||!r.meshes.length) throw new Error('STEP read failed');
    while(stepGroup.children.length) stepGroup.remove(stepGroup.children[0]);
    const mat=new THREE.MeshPhongMaterial({color:0x9fb2c8,transparent:true,opacity:0.35,side:THREE.DoubleSide,depthWrite:false});
    for(const m of r.meshes){
      const g=new THREE.BufferGeometry();
      g.setAttribute('position',new THREE.Float32BufferAttribute(m.attributes.position.array,3));
      if(m.attributes.normal) g.setAttribute('normal',new THREE.Float32BufferAttribute(m.attributes.normal.array,3));
      else g.computeVertexNormals();
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(m.index.array),1));
      stepGroup.add(new THREE.Mesh(g,mat));
    }
    stepGroup.userData.mat=mat;
    document.getElementById('stepbox').style.display='block';
    autoAlign();
    document.getElementById('fname').textContent=name+' loaded — auto-aligned to path (model top → Z0); adjust with rot/offset if needed';
  }catch(err){
    document.getElementById('fname').textContent='STEP load failed: '+err.message+' (internet needed for the 3D engine)';
  }
}
document.getElementById('stOp').oninput=e=>{if(stepGroup.userData.mat)stepGroup.userData.mat.opacity=e.target.value/100;};
document.getElementById('stShow').onchange=e=>stepGroup.visible=e.target.checked;
document.querySelectorAll('#stepbox [data-r]').forEach(b=>b.onclick=()=>{stepGroup.rotation[b.dataset.r]+=Math.PI/2;});
['stX','stY','stZ'].forEach((id,i)=>document.getElementById(id).oninput=e=>{stepGroup.position.setComponent(i,parseFloat(e.target.value)||0);});

// ---------------- file handling ----------------
function routeFile(file){
  const ext=file.name.split('.').pop().toLowerCase();
  if(ext==='stp'||ext==='step'){ file.arrayBuffer().then(b=>loadSTEP(b,file.name)); return; }
  const rd=new FileReader();
  rd.onload=()=>handleNC(rd.result,file.name);
  rd.readAsText(file,'ISO-8859-1');
}
// First NC file is the main program; later NC drops that look like subprograms
// (contain M99, or carry an O-number the main program calls) are loaded as O-files.
function handleNC(text,name){
  if(!MAINTEXT){ loadNC(text,name); return; }
  const nums=Object.keys(splitPrograms(text)).map(Number);
  const referenced=SEC.some(s=>[...(s.calls||[]),...(s.resolvedCalls||[])].some(c=>{
    const m=c.match(/(\d+)/); return m && nums.includes(parseInt(m[1],10)); }));
  if(referenced || /\bM99\b/i.test(text)) registerSub(text,name);   // subprogram O-file
  else { SUBS={}; loadNC(text,name); }                               // a different main program
}
document.getElementById('fnc').onchange=e=>{if(e.target.files[0])routeFile(e.target.files[0]);};
document.getElementById('fstp').onchange=e=>{if(e.target.files[0])routeFile(e.target.files[0]);};
window.addEventListener('dragover',e=>e.preventDefault());
window.addEventListener('drop',e=>{e.preventDefault();[...e.dataTransfer.files].forEach(routeFile);});
