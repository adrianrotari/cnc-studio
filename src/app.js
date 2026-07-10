// ---------------- app state ----------------
const PAL=['#38e07b','#37c8f0','#ffd166','#ef7bf2','#7bf2c0','#f2a17b','#8ab4ff','#e0e07b','#7be0d0','#f27ba1'];
let SEC=[], visible=new Set();
let SUBS={}, MAINTEXT='', MAINNAME='';   // loaded subprogram O-files (oNumber -> text)

// A single dropped file can hold several O#### … M99 programs — split into per-program bodies.
function splitPrograms(text){
  const out={}; let num=null, buf=[];
  const flush=()=>{ if(num!=null) out[num]=buf.join('\n'); };
  for(const ln of text.split(/\r?\n/)){
    const m=ln.match(/^\s*O\s*(\d+)/i);
    if(m){ flush(); num=parseInt(m[1],10); buf=[ln]; }
    else buf.push(ln);
  }
  flush();
  return out;
}
// Register a dropped O-file as a subprogram and re-parse the main program so calls inline.
function registerSub(text,name){
  const progs=splitPrograms(text);
  let keys=Object.keys(progs).map(Number);
  if(!keys.length){                       // no O-line — fall back to the filename's number
    const m=name.match(/(\d+)/); if(m){ keys=[parseInt(m[1],10)]; progs[keys[0]]=text; }
  }
  if(!keys.length){ document.getElementById('fname').textContent='no O-number found in '+name+' — cannot load as subprogram'; return; }
  for(const k of keys) SUBS[k]=progs[k];
  if(MAINTEXT) loadNC(MAINTEXT,MAINNAME);
  else document.getElementById('fname').textContent=keys.map(k=>'O'+k).join(', ')+' held as subprogram — open a main program to inline';
}

function loadNC(text,name){
  RAWL=text.split(/\r?\n/); PROGNAME=name; MAINTEXT=text; MAINNAME=name;
  SEC=parseNC(text,{subs:SUBS});
  let unres=0,res=0;
  for(const s of SEC){ unres+=(s.calls?s.calls.length:0); res+=(s.resolvedCalls?s.resolvedCalls.length:0); }
  const nsub=Object.keys(SUBS).length;
  let status=name+'  ·  '+SEC.length+' operations';
  if(nsub) status+='  ·  '+nsub+' subprogram'+(nsub>1?'s':'')+' loaded';
  if(res)  status+='  ·  '+res+' call'+(res>1?'s':'')+' inlined';
  if(unres) status+='  ·  ⚠ '+unres+' unresolved';
  document.getElementById('fname').textContent=status;
  document.getElementById('drop').style.display='none';
  document.getElementById('drop').style.display='none';
  SEC.forEach((s,i)=>{ s.id=i; s.color = s.isRough12 ? '#38e07b' : PAL[(i%(PAL.length-1))+1]; });
  const rough=SEC.filter(s=>s.isRough12);
  visible=new Set((rough.length?rough:SEC.filter(s=>s.segs.length)).map(s=>s.id));
  buildList(); rebuild3D(); fitView(); buildTimeline(); updateHud();
  document.getElementById('cut').style.display='block';
  if(!MODELPOS.owned) autoAlign();      // never move a model the user has placed
}

function fmt(n,d=1){return isFinite(n)?n.toFixed(d):'—';}
function buildList(){
  const q=document.getElementById('filter').value.trim().toLowerCase();
  const box=document.getElementById('ops'); box.innerHTML='';
  for(const s of SEC){
    const hay=(s.name+' '+s.toolTxt+' '+s.desc.join(' ')).toLowerCase();
    if(q && !hay.includes(q)) continue;
    const row=document.createElement('div'); row.className='op';
    const ck=document.createElement('input'); ck.type='checkbox'; ck.checked=visible.has(s.id);
    ck.onclick=e=>{e.stopPropagation(); ck.checked?visible.add(s.id):visible.delete(s.id); rebuild3D(); buildTimeline(); updateHud();};
    const dot=document.createElement('span'); dot.className='dot'; dot.style.background=s.color;
    const nm=document.createElement('div'); nm.className='nm';
    const time=s.tMin>0.005?` · ~${fmt(s.tMin,1)} min`:'';
    nm.innerHTML=`<div class="t">${s.name||'—'}</div>
      <div class="d">${s.descTxt||''}${s.segs.length?` · cut ${fmt(s.cutLen/1000,2)} m${time} · Z ${fmt(s.zMin)}…${fmt(s.zMax)}`:''}</div>`;
    row.append(ck,dot,nm);
    if(s.tool){const b=document.createElement('span');b.className='badge tool';b.textContent=s.tool;row.append(b);}
    if(s.isRough12){const b=document.createElement('span');b.className='badge rough';b.textContent='EB12';row.append(b);}
    if(s.plane){const b=document.createElement('span');b.className='badge';b.textContent='G'+s.plane;row.append(b);}
    for(const c of (s.resolvedCalls||[]).slice(0,2)){const b=document.createElement('span');b.className='badge sub';b.title='subprogram inlined from a loaded O-file';b.textContent='⤷ '+c;row.append(b);}
    for(const c of (s.calls||[]).slice(0,1)){const b=document.createElement('span');b.className='badge warn';b.title='calls external subprogram — drop its O-file to inline';b.textContent='⚠ '+c;row.append(b);}
    row.onclick=()=>{visible=new Set([s.id]); buildList(); rebuild3D(); buildTimeline(); fitView(); updateHud();};
    row.ondblclick=()=>{visible=new Set(SEC.map(x=>x.id)); buildList(); rebuild3D(); buildTimeline();};
    box.append(row);
  }
}
document.getElementById('filter').oninput=buildList;
document.getElementById('bRough').onclick=()=>{visible=new Set(SEC.filter(s=>s.isRough12).map(s=>s.id)); buildList(); rebuild3D(); buildTimeline(); fitView(); updateHud();};
document.getElementById('bAll').onclick=()=>{visible=new Set(SEC.filter(s=>s.segs.length).map(s=>s.id)); buildList(); rebuild3D(); buildTimeline(); fitView(); updateHud();};
document.getElementById('bNone').onclick=()=>{visible=new Set(); buildList(); rebuild3D(); buildTimeline(); updateHud();};
['ckRapid','ckCycle','ckTool'].forEach(id=>document.getElementById(id).onchange=()=>{rebuild3D();buildTimeline();});

function rebuild3D(){
  while(pathGroup.children.length) pathGroup.remove(pathGroup.children[0]);
  const showR=document.getElementById('ckRapid').checked;
  const showC=document.getElementById('ckCycle').checked;
  for(const s of SEC){
    if(!visible.has(s.id)) continue;
    const feed=[], rap=[], cyc=[];
    for(const sg of s.segs){
      const dst = sg.kind==='rapid'?rap : sg.kind==='cycle'?cyc : feed;
      for(let i=1;i<sg.pts.length;i++){ dst.push(...sg.pts[i-1],...sg.pts[i]); }
    }
    const mk=(arr,color,op,lw)=>{
      if(!arr.length)return;
      const g=new THREE.BufferGeometry();
      g.setAttribute('position',new THREE.Float32BufferAttribute(arr,3));
      pathGroup.add(new THREE.LineSegments(g,new THREE.LineBasicMaterial({color,transparent:op<1,opacity:op})));
    };
    mk(feed,s.color,1);
    if(showR) mk(rap,0xff5c5c,0.28);
    if(showC) mk(cyc,0xffb347,0.9);
  }
  if(typeof fixturePlace!=='undefined') fixturePlace();   // horizontal tip follows path extent
}
function bboxVisible(){
  const bb=new THREE.Box3();
  let any=false;
  for(const s of SEC){ if(!visible.has(s.id))continue;
    for(const sg of s.segs) for(const p of sg.pts){ bb.expandByPoint(new THREE.Vector3(p[0],p[1],p[2])); any=true; } }
  return any?bb:null;
}
function fitView(){
  const bb=bboxVisible(); if(!bb)return;
  bb.getCenter(target);
  const size=bb.getSize(new THREE.Vector3()).length();
  dist=Math.max(40,size*0.9);
  if(GRID) GRID.position.z=bb.min.z-1;   // grid sits under the work, not through it
  if(typeof updateGridZ!=='undefined') updateGridZ();
}
function updateHud(){
  let cut=0,rap=0,t=0,n=0;
  for(const s of SEC){ if(!visible.has(s.id))continue; cut+=s.cutLen; rap+=s.rapLen; t+=s.tMin; n++; }
  document.getElementById('hud').innerHTML=
    `${n} ops visible · cutting ${fmt(cut/1000,2)} m · rapid ${fmt(rap/1000,2)} m · est ~${fmt(t,1)} min <span style="color:#5d6f85">(feed-based, rapids @12 m/min, comp radius not applied)</span>`;
}
