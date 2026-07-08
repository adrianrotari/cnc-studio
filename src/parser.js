/*__PARSER_START__*/
// ---------- pure ISO G-code parser (Fanuc-style, mill-turn dialect) ----------
function parseNC(text, opts){
  const lines = text.split(/\r?\n/);
  const sections = [];
  const st = {x:null,y:null,z:null, f:null, s:null, motion:null, plane:17,
              off:{x:0,y:0,z:0}, bOri:0, comp:0};
  let cur = null;
  // Optional subprogram bodies for M98/G65 resolution: opts.subs = {oNumber: text}.
  // Pure/node-testable is preserved — no DOM, everything comes in through opts.
  const subs = (opts && opts.subs) || null;
  const subCache = new Map();
  const getSub = n => {
    if(!subs) return null;
    let t = subs[n]; if(t===undefined) t = subs[String(n)];
    if(t===undefined) return null;
    if(!subCache.has(n)) subCache.set(n, t.split(/\r?\n/));
    return subCache.get(n);
  };
  const MAXDEPTH = 8;             // guard against recursive/self-referential subprograms
  let SUBLINE = null, SUBNAME = null;   // set while inlining a subprogram body
  const newSec = (name,lineNo)=>{
    cur = {name, lineNo, desc:[], tool:null, toolTxt:'', segs:[], calls:[],
           plane:null, bOri:null, g52:false, comp:false,
           cutLen:0, rapLen:0, tMin:0, zMin:Infinity, zMax:-Infinity};
    sections.push(cur);
  };
  newSec('HEADER',0);

  const addSeg=(pts,kind,lineNo,srcTxt)=>{
    if(pts.length<2) return;
    let len=0;
    for(let i=1;i<pts.length;i++){
      const a=pts[i-1],b=pts[i];
      len+=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
    }
    if(!isFinite(len)) return;
    for(const p of pts){ if(!p.every(isFinite)) return;
      if(p[2]<cur.zMin)cur.zMin=p[2]; if(p[2]>cur.zMax)cur.zMax=p[2]; }
    cur.segs.push({pts,kind,line:lineNo,f:st.f,s:st.s,len,src:srcTxt,sub:SUBNAME});
    if(kind==='rapid'){cur.rapLen+=len; cur.tMin+=len/12000;}
    else {cur.cutLen+=len; if(st.f>0) cur.tMin+=len/st.f;}
    if(cur.plane===null)cur.plane=st.plane;
    if(cur.bOri===null)cur.bOri=st.bOri;
  };

  const planeAxes = ()=> st.plane===18 ? ['z','x','y'] : st.plane===19 ? ['y','z','x'] : ['x','y','z'];
  const IJKof = w => st.plane===18 ? [w.K,w.I] : st.plane===19 ? [w.J,w.K] : [w.I,w.J];

  function arcPts(dest, w, cw, lineNo){
    const [A,B,P] = planeAxes();
    const a0=st[A], b0=st[B], p0=st[P];
    const a1=dest[A], b1=dest[B], p1=dest[P];
    if([a0,b0,p0].some(v=>v===null)) return null;
    let ca,cb;
    const [ci,cj]=IJKof(w);
    let full=false;
    if(ci!==undefined || cj!==undefined){
      ca=a0+(ci||0); cb=b0+(cj||0);
      if(Math.abs(a1-a0)<1e-9 && Math.abs(b1-b0)<1e-9) full=true;
    } else if(w.R!==undefined){
      const R=w.R, dx=a1-a0, dy=b1-b0, d=Math.hypot(dx,dy);
      if(d<1e-9) return null;
      const h2=R*R-d*d/4, h=Math.sqrt(Math.max(h2,0));
      let nx=-dy/d, ny=dx/d;                 // left normal (CCW side)
      let sgn = cw ? -1 : 1;
      if(R<0) sgn=-sgn;
      ca=(a0+a1)/2 + sgn*nx*h; cb=(b0+b1)/2 + sgn*ny*h;
    } else return null;
    const r0=Math.hypot(a0-ca,b0-cb), r1=Math.hypot(a1-ca,b1-cb);
    const r=(r0+r1)/2;
    let th0=Math.atan2(b0-cb,a0-ca), th1=Math.atan2(b1-cb,a1-ca);
    let span;
    if(full){ span = cw? -2*Math.PI : 2*Math.PI; }
    else if(cw){ span=th1-th0; while(span>=-1e-9) span-=2*Math.PI; }
    else { span=th1-th0; while(span<=1e-9) span+=2*Math.PI; }
    const n=Math.min(256,Math.max(8,Math.ceil(Math.abs(span)*r/0.4)));
    const pts=[];
    for(let i=0;i<=n;i++){
      const t=i/n, th=th0+span*t;
      const pa=ca+r*Math.cos(th), pb=cb+r*Math.sin(th), pp=p0+(p1-p0)*t;
      const P3={[A]:pa,[B]:pb,[P]:pp};
      pts.push([P3.x,P3.y,P3.z]);
    }
    // snap exact endpoints
    const e={[A]:a1,[B]:b1,[P]:p1}; pts[pts.length-1]=[e.x,e.y,e.z];
    return {pts, rerr:Math.abs(r0-r1)};
  }

  const IGNORED_G = new Set([4,5,5.1,9,20,21,28,30,43,44,49,50,53,54,55,56,57,58,59,
                             61,64,65,69.1,92,94,95,96,97,98,99,330,332,343,363]);
  const CYCLES = new Set([73,74,76,81,82,83,83.6,84,84.2,85,86,87,87.6,88,89]);

  function runBlocks(blk, depth, callLine){
   for(let li=0; li<blk.length; li++){
    const raw=blk[li];
    // Inside an inlined subprogram, attribute segments to the call site in the main file.
    const lineNo = callLine!=null ? callLine : li+1;
    let code=raw.replace(/\(([^)]*)\)/g,(m,c)=>{ if(depth===0&&cur&&cur.desc.length<6&&c.trim())cur.desc.push(c.trim()); return ' '; });
    code=code.trim();
    if(!code) continue;
    if(/^(%|#|IF|GOTO|O\d)/i.test(code)) continue;

    const mN=code.match(/^N(\d+)\b/);
    if(mN){
      if(depth===0){                       // subprogram N-blocks fold into the calling op
        const cm = raw.match(/\(([^)]*)\)/);
        newSec('N'+mN[1]+(cm?' '+cm[1].trim():''), lineNo);
      }
      code=code.replace(/^N\d+\s*/,'');
      if(!code) continue;
    }

    const words=[...code.toUpperCase().matchAll(/([A-Z])\s*([+-]?(?:\d+\.?\d*|\.\d+))/g)]
                 .map(m=>({L:m[1],V:parseFloat(m[2])}));
    if(!words.length) continue;

    const w={}; const gs=[]; const ms=[];
    for(const t of words){
      if(t.L==='G') gs.push(t.V);
      else if(t.L==='M') ms.push(t.V);
      else if(w[t.L]===undefined) w[t.L]=t.V;
    }

    if(gs.includes(4)) continue;                     // dwell — X/P is time, not a move
    if(ms.includes(99)){ if(depth>0) return; continue; }   // M99 subprogram return
    if(ms.includes(98) || gs.includes(65)){
      const p=w.P;
      if(p!==undefined){
        const isM98=ms.includes(98);
        let prog, rep;
        if(isM98 && w.L===undefined && p>9999){        // Fanuc combined P: <reps><4-digit prog>
          const ps=String(Math.trunc(p));
          prog=parseInt(ps.slice(-4),10); rep=parseInt(ps.slice(0,-4),10)||1;
        } else {
          prog=Math.trunc(p); rep=w.L!==undefined?Math.max(1,Math.trunc(w.L)):1;
        }
        const label=(isM98?'O':'macro P')+prog;
        const subLines=getSub(prog) || getSub(Math.trunc(p));
        if(subLines && depth<MAXDEPTH){                 // O-file loaded — inline it into this op
          (cur.resolvedCalls||(cur.resolvedCalls=[])).push(label+(rep>1?' ×'+rep:''));
          const pL=SUBLINE, pN=SUBNAME;
          SUBLINE=lineNo; SUBNAME='O'+prog;
          for(let r=0;r<rep;r++) runBlocks(subLines, depth+1, lineNo);
          SUBLINE=pL; SUBNAME=pN;
        } else {
          cur.calls.push(label);                        // unresolved — surface as a warning
        }
      }
      continue;
    }
    if(gs.includes(52)){
      if(w.X!==undefined) st.off.x=w.X;
      if(w.Y!==undefined) st.off.y=w.Y;
      if(w.Z!==undefined) st.off.z=w.Z;
      cur.g52 = cur.g52 || (st.off.x||st.off.y||st.off.z) ? true : cur.g52;
      continue;
    }
    if(gs.includes(361)){ if(w.B!==undefined) st.bOri=w.B; continue; }
    if(gs.includes(28)) continue;                    // reference return

    let cycle=null, motionHere=null, suppress=false;
    for(const g of gs){
      if(g===0||g===1||g===2||g===3) motionHere=g;
      else if(g===17||g===18||g===19) st.plane=g;
      else if(g===40) st.comp=0;
      else if(g===41||g===42){ st.comp=g; cur.comp=true; }
      else if(g===80) st.cycleActive=false;
      else if(CYCLES.has(g)) cycle=g;
      else if(IGNORED_G.has(g)) suppress = suppress || (g===330||g===332||g===343);
    }
    if(w.F!==undefined && !ms.includes(92)) st.f=w.F;
    if(w.S!==undefined) st.s=w.S;
    if(w.T!==undefined && cur.tool===null) cur.tool='T'+w.T;

    if(cycle!==null){
      // one-shot canned cycle: plunge along drilling axis, retract
      const axis = (w.Z!==undefined && st.plane===17)?'z' : (w.X!==undefined)?'x' : (w.Z!==undefined)?'z':null;
      if(axis && st.x!==null && st.y!==null && st.z!==null){
        const p0=[st.x,st.y,st.z];
        const tgt={x:st.x,y:st.y,z:st.z};
        tgt[axis]=w[axis==='z'?'Z':'X'] + st.off[axis];
        // reposition in-plane coords if also given
        for(const ax of ['x','y','z']) if(ax!==axis){
          const W=ax.toUpperCase(); if(w[W]!==undefined){ tgt[ax]=w[W]+st.off[ax]; }
        }
        const pre=[tgt.x,tgt.y,tgt.z]; pre['xyz'.indexOf(axis)]=p0['xyz'.indexOf(axis)];
        if(pre.some((v,i)=>Math.abs(v-p0[i])>1e-9)) addSeg([p0,pre],'rapid',lineNo,raw.trim());
        addSeg([pre,[tgt.x,tgt.y,tgt.z]],'cycle',lineNo,raw.trim());
        addSeg([[tgt.x,tgt.y,tgt.z],pre],'cycle',lineNo,raw.trim());
        st.x=pre[0];st.y=pre[1];st.z=pre[2];
      }
      continue;
    }

    if(motionHere!==null) st.motion=motionHere;
    const hasCoord = w.X!==undefined||w.Y!==undefined||w.Z!==undefined;
    if(!hasCoord || suppress) continue;
    if(st.motion===null) st.motion=0;

    const dest={
      x: w.X!==undefined ? w.X+st.off.x : st.x,
      y: w.Y!==undefined ? w.Y+st.off.y : st.y,
      z: w.Z!==undefined ? w.Z+st.off.z : st.z
    };
    const ready = st.x!==null&&st.y!==null&&st.z!==null &&
                  dest.x!==null&&dest.y!==null&&dest.z!==null;
    if(ready){
      if(st.motion===2||st.motion===3){
        const arc=arcPts(dest,w,st.motion===2,lineNo);
        if(arc) addSeg(arc.pts, 'feed', lineNo, raw.trim());
        else addSeg([[st.x,st.y,st.z],[dest.x,dest.y,dest.z]],'feed',lineNo,raw.trim());
      } else {
        addSeg([[st.x,st.y,st.z],[dest.x,dest.y,dest.z]],
               st.motion===0?'rapid':'feed', lineNo, raw.trim());
      }
    }
    st.x=dest.x; st.y=dest.y; st.z=dest.z;
   }
  }
  runBlocks(lines, 0, null);

  for(const s of sections){
    s.toolTxt = (s.desc.find(d=>/T2\d{3}/.test(d))||'').trim();
    if(!s.tool){ const m=s.toolTxt.match(/T(2\d{3})/); if(m) s.tool='T'+m[1]; }
    s.isRough12 = s.desc.some(d=>/EB\s*12/i.test(d));
    s.descTxt = s.desc.filter(d=>!/T2\d{3}/.test(d)).slice(0,2).join(' · ');
  }
  for(let i=0;i<sections.length;i++)
    sections[i].endLine = i+1<sections.length ? sections[i+1].lineNo-1 : lines.length;
  return sections.filter(s=>s.segs.length>0 || s.calls.length>0);
}
/*__PARSER_END__*/
if(typeof module!=='undefined'&&module.exports){ module.exports={parseNC}; }
