// ---------------- 3D scene ----------------
let scene,camera,renderer,pathGroup,stepGroup,toolGroup,stockGroup,GRID;
let target=new THREE.Vector3(0,0,0), az=-0.9, el=0.6, dist=300;
const cv=document.getElementById('cv');

function initGL(){
  renderer=new THREE.WebGLRenderer({canvas:cv,antialias:true});
  scene=new THREE.Scene(); scene.background=new THREE.Color(0x0b0f14);
  camera=new THREE.PerspectiveCamera(45,1,0.1,20000); camera.up.set(0,0,1);
  scene.add(new THREE.HemisphereLight(0xcfe8ff,0x0b0f14,0.9));
  const dl=new THREE.DirectionalLight(0xffffff,0.7); dl.position.set(120,-180,260); scene.add(dl);
  GRID=new THREE.GridHelper(400,40,0x1e2a3a,0x131c28); GRID.rotation.x=Math.PI/2; scene.add(GRID);
  const ax=new THREE.AxesHelper(40); scene.add(ax);
  pathGroup=new THREE.Group(); scene.add(pathGroup);
  stepGroup=new THREE.Group(); scene.add(stepGroup);
  toolGroup=new THREE.Group(); scene.add(toolGroup); buildTool();
  stockGroup=new THREE.Group(); scene.add(stockGroup);
  resize(); animate();
}
function resize(){
  const r=cv.parentElement.getBoundingClientRect();
  renderer.setSize(r.width,r.height,false);
  renderer.setPixelRatio(window.devicePixelRatio||1);
  camera.aspect=r.width/r.height; camera.updateProjectionMatrix();
}
window.addEventListener('resize',resize);
function updateCam(){
  const ce=Math.cos(el), pos=new THREE.Vector3(
    target.x+dist*ce*Math.cos(az), target.y+dist*ce*Math.sin(az), target.z+dist*Math.sin(el));
  camera.position.copy(pos); camera.lookAt(target);
}
function animate(){ requestAnimationFrame(animate); stepAnim(); updateCam(); renderer.render(scene,camera); }

// mouse orbit
let drag=null;
cv.addEventListener('contextmenu',e=>e.preventDefault());
cv.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,b:e.button,sh:e.shiftKey};cv.setPointerCapture(e.pointerId);});
cv.addEventListener('pointerup',()=>drag=null);
cv.addEventListener('pointermove',e=>{
  if(!drag)return;
  const dx=e.clientX-drag.x, dy=e.clientY-drag.y; drag.x=e.clientX; drag.y=e.clientY;
  if(drag.b===2||drag.sh){
    const s=dist/700;
    const right=new THREE.Vector3().subVectors(camera.position,target).cross(camera.up).normalize();
    const up=new THREE.Vector3().copy(camera.up);
    target.addScaledVector(right,dx*s).addScaledVector(up,dy*s);
  } else { az-=dx*0.008; el=Math.min(1.55,Math.max(-1.55,el+dy*0.008)); }
});
cv.addEventListener('wheel',e=>{e.preventDefault();dist*=e.deltaY>0?1.12:0.89;dist=Math.min(8000,Math.max(5,dist));},{passive:false});

document.querySelectorAll('#views .btn').forEach(b=>b.onclick=()=>{
  const v=b.dataset.v;
  if(v==='fit'){fitView();return;}
  if(v==='iso'){az=-Math.PI/4;el=0.62;}
  if(v==='top'){az=-Math.PI/2;el=1.55;}
  if(v==='front'){az=-Math.PI/2;el=0;}
  if(v==='right'){az=0;el=0;}
});

// tool marker — parametric endmill. Simple cylinder for "custom"; real stepped
// geometry (flutes → neck → shank → holder) when a library tool is active (TOOL.lib).
const TOOL={d:12,z:3,lodF:7,lib:null};
let toolMesh,toolTip;
// helix polylines over the flute length, one per flute
function fluteHelix(r,len,z,helixDeg){
  const hp=[], nz=Math.max(1,z), tanH=Math.tan((helixDeg||40)*Math.PI/180);
  for(let f=0;f<nz;f++){
    const ph0=f*2*Math.PI/nz; let prev=null;
    for(let i=0;i<=48;i++){
      const y=len*i/48, ph=ph0+y*tanH/r;
      const p=[r*Math.cos(ph),y,r*Math.sin(ph)];
      if(prev) hp.push(...prev,...p); prev=p;
    }
  }
  const hg=new THREE.BufferGeometry();
  hg.setAttribute('position',new THREE.Float32BufferAttribute(hp,3));
  return new THREE.LineSegments(hg,new THREE.LineBasicMaterial({color:0x9feaff,transparent:true,opacity:0.6}));
}
function tubeSection(r,y0,y1,color,op){
  const h=y1-y0; if(h<=1e-6) return null;
  const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,28),
      new THREE.MeshPhongMaterial({color,transparent:op<1,opacity:op}));
  m.position.y=(y0+y1)/2; return m;
}
function buildTool(){
  while(toolGroup.children.length) toolGroup.remove(toolGroup.children[0]);
  toolMesh=new THREE.Group();
  const t=TOOL.lib;
  if(t && t.lc && t.oal){
    const rF=t.dc/2, rN=(t.neckDia||t.dc)/2, rS=(t.shankDia||t.dc)/2;
    const add=m=>{ if(m) toolMesh.add(m); };
    add(tubeSection(rF,0,t.lc,0x37c8f0,0.32));                 // flutes ø dc × lc
    add(tubeSection(rN,t.lc,Math.max(t.lc,t.reach),0x8aa0b8,0.55)); // neck ø neckDia → reach
    add(tubeSection(rS,t.reach,Math.max(t.reach,t.oal),0x6c7f96,0.9)); // shank ø shankDia → oal
    add(fluteHelix(rF,t.lc,t.z,t.helixDeg));
    const hold=new THREE.Mesh(new THREE.CylinderGeometry(rS+5,rS+7,t.dc*1.8,20),
        new THREE.MeshPhongMaterial({color:0x5a6b80}));
    hold.position.y=t.oal+t.dc*0.9; toolMesh.add(hold);
  } else {
    const d=TOOL.d, r=d/2, fl=TOOL.lodF*d;
    toolMesh.add(tubeSection(r,0,fl,0x37c8f0,0.30));
    toolMesh.add(fluteHelix(r,fl,TOOL.z,40));
    const hold=new THREE.Mesh(new THREE.CylinderGeometry(r+5,r+7,d*1.8,20),
        new THREE.MeshPhongMaterial({color:0x6c7f96}));
    hold.position.y=fl+d*0.9; toolMesh.add(hold);
  }
  toolTip=new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.8,TOOL.d/10),12,10),
      new THREE.MeshBasicMaterial({color:0x37c8f0}));
  toolGroup.add(toolMesh); toolGroup.add(toolTip); toolGroup.visible=false;
}
function setTool(p,axis){
  toolGroup.visible=document.getElementById('ckTool').checked;
  toolTip.position.set(p[0],p[1],p[2]);
  toolMesh.position.set(p[0],p[1],p[2]);
  toolMesh.rotation.set(0,0,0);
  if(axis==='x') toolMesh.rotation.z=-Math.PI/2;   // cylinder +Y → +X
  else toolMesh.rotation.x=Math.PI/2;              // +Y → +Z
}
