// ---------------- animation ----------------
let TL=[], tlLen=0, tlPos=0, playing=false, lastTs=0;
function buildTimeline(){
  TL=[]; tlLen=0;
  const showR=document.getElementById('ckRapid').checked;
  const showC=document.getElementById('ckCycle').checked;
  for(const s of SEC){
    if(!visible.has(s.id)) continue;
    for(const sg of s.segs){
      if(sg.kind==='rapid'&&!showR) continue;
      if(sg.kind==='cycle'&&!showC) continue;
      for(let i=1;i<sg.pts.length;i++){
        const a=sg.pts[i-1],b=sg.pts[i];
        const l=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
        if(l<1e-9)continue;
        TL.push({a,b,l,off:tlLen,sec:s,sg}); tlLen+=l;
      }
    }
  }
  tlPos=0; document.getElementById('seek').value=0;
  if(STK.on) stockInit();
}
document.getElementById('bPlay').onclick=()=>{playing=!playing;document.getElementById('bPlay').textContent=playing?'❚❚ Pause':'▶ Play';};
document.getElementById('seek').oninput=e=>{tlPos=tlLen*e.target.value/1000;playing=false;document.getElementById('bPlay').textContent='▶ Play';stepAnim(true);};
document.getElementById('speed').oninput=e=>{document.getElementById('spdLab').textContent=(e.target.value*4)+' mm/s';};
function stepAnim(force){
  const ts=performance.now();
  const dt=Math.min(0.1,(ts-lastTs)/1000); lastTs=ts;
  if(!TL.length){toolGroup.visible=false;return;}
  if(playing){ tlPos+=dt*document.getElementById('speed').value*4;
    if(tlPos>=tlLen){tlPos=tlLen;playing=false;document.getElementById('bPlay').textContent='▶ Play';}
    document.getElementById('seek').value=1000*tlPos/tlLen;
  } else if(!force) { if(!toolGroup.visible&&tlPos===0) return; }
  let lo=0,hi=TL.length-1;
  while(lo<hi){const mid=(lo+hi>>1); (TL[mid].off+TL[mid].l<tlPos)?lo=mid+1:hi=mid;}
  const e=TL[lo], t=Math.min(1,Math.max(0,(tlPos-e.off)/e.l));
  const p=[e.a[0]+(e.b[0]-e.a[0])*t, e.a[1]+(e.b[1]-e.a[1])*t, e.a[2]+(e.b[2]-e.a[2])*t];
  setTool(p, e.sec.plane===19?'x':'z');
  if(STK.on&&STK.grid) stampTo(tlPos);
  updateCut(e);
  document.getElementById('readout').innerHTML=
    `<b>${e.sec.name}</b> · <span class="src">L${e.sg.line}</span> <b>${(e.sg.src||'').slice(0,70)}</b>`+
    ` · ${e.sg.kind==='rapid'?'RAPID':e.sg.kind==='cycle'?'CYCLE':'F'+(e.sg.f??'—')}`+
    `${e.sg.s?' · S'+e.sg.s:''} · X${fmt(p[0],2)} Y${fmt(p[1],2)} Z${fmt(p[2],2)}`;
}
