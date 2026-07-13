// ---------- pure toolpath generator (no DOM, node-testable) ----------
// Contour roughing around a billet, tool axis Z (G17). At each Z level the
// keep-out is the model silhouette (top-surface heightfield) at that depth.
// The silhouette is extracted once per level from the raster (marching
// squares on a chamfer distance field), then all pass geometry is exact:
// the POLY kernel (ported Kiri:Moto math over Clipper) offsets the
// silhouette by toolR+allowance and steps outward by ae, and each ring is
// clipped to the bar with an open-path boolean instead of point culling.
// Islands smaller than ~0.1 mm across fall below the kernel minArea filter
// and are ignored. 2.5D assumption: no undercuts.
// tris: flat [x,y,z]*3n in program coords. Returns [{kind,pts,f,s,line,src}].
// POLY resolve: bare global in the browser bundle (poly.js precedes this
// file), required directly when running under node.
const KPOLY = (typeof POLY !== 'undefined') ? POLY : require('./poly.js').POLY;
function genHeightfield(tris,x0,y0,nx,ny,cell){
  const hf=new Float32Array(nx*ny).fill(-Infinity);
  const n=Math.floor(tris.length/9);
  for(let t=0;t<n;t++){
    const ax=tris[t*9],ay=tris[t*9+1],az=tris[t*9+2],
          bx=tris[t*9+3],by=tris[t*9+4],bz=tris[t*9+5],
          cx=tris[t*9+6],cy=tris[t*9+7],cz=tris[t*9+8];
    const minx=Math.min(ax,bx,cx),maxx=Math.max(ax,bx,cx);
    const miny=Math.min(ay,by,cy),maxy=Math.max(ay,by,cy);
    const i0=Math.max(0,Math.floor((minx-x0)/cell)),i1=Math.min(nx-1,Math.ceil((maxx-x0)/cell));
    const j0=Math.max(0,Math.floor((miny-y0)/cell)),j1=Math.min(ny-1,Math.ceil((maxy-y0)/cell));
    if(i1<i0||j1<j0)continue;
    const d=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
    if(Math.abs(d)<1e-9){
      const zt=Math.max(az,bz,cz);
      for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const k=j*nx+i;if(zt>hf[k])hf[k]=zt;}
      continue;
    }
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
      const px=x0+i*cell,py=y0+j*cell;
      const w0=((by-cy)*(px-cx)+(cx-bx)*(py-cy))/d;
      const w1=((cy-ay)*(px-cx)+(ax-cx)*(py-cy))/d;
      const w2=1-w0-w1;
      if(w0<-0.05||w1<-0.05||w2<-0.05)continue;
      const z=w0*az+w1*bz+w2*cz;
      const k=j*nx+i;if(z>hf[k])hf[k]=z;
    }
  }
  return hf;
}
// two-pass chamfer distance (mm) from mask cells (mask=1 -> distance 0)
function genDist(mask,nx,ny,cell){
  const INF=1e9, D=new Float32Array(nx*ny);
  for(let k=0;k<nx*ny;k++) D[k]=mask[k]?0:INF;
  const o=cell, di=cell*Math.SQRT2;
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const k=j*nx+i; let v=D[k];
    if(i>0&&D[k-1]+o<v)v=D[k-1]+o;
    if(j>0&&D[k-nx]+o<v)v=D[k-nx]+o;
    if(i>0&&j>0&&D[k-nx-1]+di<v)v=D[k-nx-1]+di;
    if(i<nx-1&&j>0&&D[k-nx+1]+di<v)v=D[k-nx+1]+di;
    D[k]=v;
  }
  for(let j=ny-1;j>=0;j--)for(let i=nx-1;i>=0;i--){
    const k=j*nx+i; let v=D[k];
    if(i<nx-1&&D[k+1]+o<v)v=D[k+1]+o;
    if(j<ny-1&&D[k+nx]+o<v)v=D[k+nx]+o;
    if(i<nx-1&&j<ny-1&&D[k+nx+1]+di<v)v=D[k+nx+1]+di;
    if(i>0&&j<ny-1&&D[k+nx-1]+di<v)v=D[k+nx-1]+di;
    D[k]=v;
  }
  return D;
}
// marching squares at iso -> chained polylines [[x,y],...]
function genIso(D,nx,ny,x0,y0,cell,iso){
  const segs=[];
  const L=(p,q)=>{const t=p/(p-q); return isFinite(t)?Math.min(1,Math.max(0,t)):0.5;};
  for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){
    const a=D[j*nx+i]-iso, b=D[j*nx+i+1]-iso, c=D[(j+1)*nx+i+1]-iso, d2=D[(j+1)*nx+i]-iso;
    const idx=(a<0?1:0)|(b<0?2:0)|(c<0?4:0)|(d2<0?8:0);
    if(idx===0||idx===15)continue;
    const X=x0+i*cell, Y=y0+j*cell;
    const e={t:[X+cell*L(a,b),Y], r:[X+cell,Y+cell*L(b,c)],
             b2:[X+cell*L(d2,c),Y+cell], l:[X,Y+cell*L(a,d2)]};
    const add=(p,q)=>segs.push([e[p],e[q]]);
    switch(idx){
      case 1: add('l','t');break;  case 2: add('t','r');break;
      case 3: add('l','r');break;  case 4: add('r','b2');break;
      case 5: add('l','t');add('r','b2');break;
      case 6: add('t','b2');break; case 7: add('l','b2');break;
      case 8: add('b2','l');break; case 9: add('b2','t');break;
      case 10:add('t','r');add('b2','l');break;
      case 11:add('b2','r');break; case 12:add('r','l');break;
      case 13:add('r','t');break;  case 14:add('t','l');break;
    }
  }
  const key=p=>Math.round(p[0]*20)+'_'+Math.round(p[1]*20);
  const map=new Map();
  for(const s of segs)for(const end of [0,1]){
    const k=key(s[end]); if(!map.has(k))map.set(k,[]); map.get(k).push(s);
  }
  const used=new Set(), polys=[];
  for(const s of segs){
    if(used.has(s))continue;
    used.add(s);
    const poly=[s[0],s[1]];
    let guard=0;
    while(guard++<200000){
      const k=key(poly[poly.length-1]);
      const cand=(map.get(k)||[]).find(x=>!used.has(x));
      if(!cand)break;
      used.add(cand);
      poly.push(key(cand[0])===k?cand[1]:cand[0]);
    }
    guard=0;
    while(guard++<200000){
      const k=key(poly[0]);
      const cand=(map.get(k)||[]).find(x=>!used.has(x));
      if(!cand)break;
      used.add(cand);
      poly.unshift(key(cand[0])===k?cand[1]:cand[0]);
    }
    if(poly.length>=3)polys.push(poly);
  }
  return polys;
}
function genContourRough(tris,opts){
  const ap=Math.max(0.2,opts.ap), ae=Math.max(0.2,opts.ae);
  const toolR=opts.toolR, allow=Math.max(0,opts.allow||0), barR=opts.barR;
  const zTop=opts.zTop, zBot=opts.zBot;
  const clearZ=opts.clearZ!=null?opts.clearZ:zTop+5;
  const f=Math.max(1,opts.feed||500), fp=Math.max(1,opts.plunge||Math.round(f/3));
  const s=opts.rpm||null;
  const cell=opts.cell||Math.max(0.4,Math.min(1.2,barR/120));
  const R=barR+toolR+ae, maxR=barR+toolR;
  const x0=-R-2*cell, y0=-R-2*cell;
  const nx=Math.ceil((2*(R+2*cell))/cell)+1, ny=nx;
  if(nx*ny>4.2e6) throw new Error('grid too large — raise cell size');
  const hf=genHeightfield(tris,x0,y0,nx,ny,cell);
  const segs=[]; let last=null;
  const jump=to=>{
    if(last&&Math.abs(last[2]-to[2])<1e-9&&Math.hypot(to[0]-last[0],to[1]-last[1])<=2.5*ae){
      segs.push({kind:'feed',pts:[last,to],f,s,line:0,src:'generated'}); last=to; return;
    }
    const pts=last?[last,[last[0],last[1],clearZ],[to[0],to[1],clearZ],[to[0],to[1],to[2]+0.5]]
                  :[[to[0],to[1],clearZ],[to[0],to[1],to[2]+0.5]];
    segs.push({kind:'rapid',pts,f:null,s,line:0,src:'generated'});
    segs.push({kind:'feed',pts:[[to[0],to[1],to[2]+0.5],to],f:fp,s,line:0,src:'generated'});
    last=to;
  };
  const emitRing=(pts2,z,closed)=>{
    const p3=pts2.map(p=>[p[0],p[1],z]);
    if(closed||Math.hypot(p3[0][0]-p3[p3.length-1][0],p3[0][1]-p3[p3.length-1][1])<cell*1.6)
      p3.push([p3[0][0],p3[0][1],z]);         // close the loop
    jump(p3[0]);
    segs.push({kind:'feed',pts:p3,f,s,line:0,src:'generated'});
    last=p3[p3.length-1];
  };
  // bar clip boundary in tool-center space (72-seg circle like the face rings)
  const disk=KPOLY.newPolygon().centerCircle({x:0,y:0,z:0},maxR,72,false);
  const jtRound=KPOLY.ClipperLib.JoinType.jtRound;
  const arcTol=Math.max(200,Math.round(0.01*KPOLY.config.clipper));  // ~0.01mm arc facets
  const kMax=Math.ceil(2*R/ae)+2;
  const levels=[];
  for(let z=zTop-ap; z>zBot+1e-6; z-=ap) levels.push(+z.toFixed(4));
  levels.push(zBot);
  for(const z of levels){
    const mask=new Uint8Array(nx*ny);
    let any=0;
    for(let k=0;k<nx*ny;k++){ if(hf[k]>z+1e-4){mask[k]=1;any=1;} }
    if(!any){                                  // nothing in the way — plain face clearing rings
      for(let r=maxR-ae; r>ae*0.4; r-=ae){
        const pts=[]; for(let i=0;i<=72;i++){const a2=i*2*Math.PI/72; pts.push([r*Math.cos(a2),r*Math.sin(a2)]);}
        emitRing(pts,z);
      }
      continue;
    }
    // silhouette: one marching-squares pass just off the mask, then exact offsets
    const D=genDist(mask,nx,ny,cell);
    const s0=cell*0.75;
    const silh=genIso(D,nx,ny,x0,y0,cell,s0)
      .map(run=>{const P=KPOLY.newPolygon(); for(const p of run)P.add(p[0],p[1],z); return P.closeIf(cell*1.6);})
      .filter(p=>!p.open&&p.area()>0.01);
    if(!silh.length) continue;
    const base=KPOLY.union(silh,0.01,true);
    // ring 0 sits at exactly toolR+allow from the (raster) silhouette
    let cur=KPOLY.offset(base,toolR+allow-s0,{z,join:jtRound,arc:arcTol,minArea:0.01});
    const ringSets=[];
    for(let k=0;k<=kMax&&cur.length;k++){
      const loops=KPOLY.flatten(cur,[]);
      const clipped=[];
      for(const loop of loops){
        const lp=loop.clone(false).setOpenValue(loop.open);
        if(lp.isInside(disk)){ clipped.push(lp); continue; }
        const cuts=lp.cut([disk],true);
        if(cuts&&cuts.length) for(const c of cuts) if(c.length>1) clipped.push(c);
      }
      if(!clipped.length) break;               // fully outside the bar — done
      ringSets.push(clipped);
      cur=KPOLY.offset(cur,ae,{z,join:jtRound,arc:arcTol,minArea:0.01});
    }
    for(let k=ringSets.length-1;k>=0;k--){      // outermost first
      for(const loop of ringSets[k]){
        emitRing(loop.points.map(p=>[p.x,p.y]),z,!loop.open);
      }
    }
  }
  return segs;
}
// ---------- pocket clearing with helical ramp entry ----------
// Cavities are the inner holes of the deep-nested silhouette at each Z level;
// islands inside a cavity are carried as holes of the cavity polygon so the
// kernel keeps passes off them automatically. Tool-center region = cavity
// shrunk by toolR+allowance. Passes step inward by ae until exhausted and are
// organized into a containment tree of sub-regions: every leaf sub-region is
// entered with its own helical ramp (radius <= 0.7*toolR, clamped to what
// fits), children cut before parents, so nothing is ever straight-plunged.
// Cavities too tight for the tool are skipped and listed in segs.warnings.
function genPocketRough(tris,opts){
  const ap=Math.max(0.2,opts.ap), ae=Math.max(0.2,opts.ae);
  const toolR=opts.toolR, allow=Math.max(0,opts.allow||0), barR=opts.barR;
  const zTop=opts.zTop, zBot=opts.zBot;
  const clearZ=opts.clearZ!=null?opts.clearZ:zTop+5;
  const f=Math.max(1,opts.feed||500), fp=Math.max(1,opts.plunge||Math.round(f/3));
  const s=opts.rpm||null;
  const rampDeg=Math.min(30,Math.max(0.5,opts.rampDeg||3));
  const cell=opts.cell||Math.max(0.4,Math.min(1.2,barR/120));
  const R=barR+toolR+ae;
  const x0=-R-2*cell, y0=-R-2*cell;
  const nx=Math.ceil((2*(R+2*cell))/cell)+1, ny=nx;
  if(nx*ny>4.2e6) throw new Error('grid too large — raise cell size');
  const hf=genHeightfield(tris,x0,y0,nx,ny,cell);
  const segs=[]; segs.warnings=[]; let last=null;
  const linkOrRetract=(to,fRate)=>{
    if(last&&Math.abs(last[2]-to[2])<1e-9&&Math.hypot(to[0]-last[0],to[1]-last[1])<=2.5*ae){
      segs.push({kind:'feed',pts:[last,to],f,s,line:0,src:'generated'}); last=to; return true;
    }
    segs.push({kind:'rapid',pts:last?[last,[last[0],last[1],clearZ],[to[0],to[1],clearZ]]
                                   :[[to[0],to[1],clearZ]],f:null,s,line:0,src:'generated'});
    last=[to[0],to[1],clearZ];
    return false;
  };
  const emitLoop=(loop,z)=>{
    const p3=loop.points.map(p=>[p.x,p.y,z]);
    if(!loop.open) p3.push([p3[0][0],p3[0][1],z]);
    if(!linkOrRetract(p3[0])){
      // arriving from clearZ inside already-cleared floor: feed down the last 0.5
      segs.push({kind:'rapid',pts:[last,[p3[0][0],p3[0][1],z+0.5]],f:null,s,line:0,src:'generated'});
      segs.push({kind:'feed',pts:[[p3[0][0],p3[0][1],z+0.5],p3[0]],f:fp,s,line:0,src:'generated'});
    }
    segs.push({kind:'feed',pts:p3,f,s,line:0,src:'generated'});
    last=p3[p3.length-1];
  };
  const jtRound=KPOLY.ClipperLib.JoinType.jtRound;
  const arcTol=Math.max(200,Math.round(0.01*KPOLY.config.clipper));
  const oOpt=z=>({z,join:jtRound,arc:arcTol,minArea:0.01});
  // largest inward offset a region still survives (binary probe, ~0.05mm resolution)
  const fitRadius=(top,rMax,z)=>{
    let lo=0, hi=rMax;
    for(let i=0;i<9;i++){
      const mid=(lo+hi)/2;
      if(hi-lo<0.05) break;
      if(KPOLY.offset([top.clone(true)],-mid,oOpt(z)).length) lo=mid; else hi=mid;
    }
    return lo;
  };
  const levels=[];
  for(let z=zTop-ap; z>zBot+1e-6; z-=ap) levels.push(+z.toFixed(4));
  levels.push(zBot);
  let prevZ=zTop;
  for(const z of levels){
    const mask=new Uint8Array(nx*ny);
    let any=0;
    for(let k=0;k<nx*ny;k++){ if(hf[k]>z+1e-4){mask[k]=1;any=1;} }
    if(!any){ prevZ=z; continue; }               // no material — nothing encloses a pocket
    const D=genDist(mask,nx,ny,cell);
    const s0=cell*0.75;
    const loops=genIso(D,nx,ny,x0,y0,cell,s0)
      .map(run=>{const P=KPOLY.newPolygon(); for(const p of run)P.add(p[0],p[1],z); return P.closeIf(cell*1.6);})
      .filter(p=>!p.open&&p.area()>0.01);
    if(!loops.length){ prevZ=z; continue; }
    // deep nest: tops -> cavity holes -> islands -> sub-cavities ...
    const tops=KPOLY.nest(loops,true);
    const cavities=[];
    (function walk(list){
      for(const t of list){
        if(!t.inner) continue;
        for(const hole of t.inner){
          const cav=hole.clone(false);
          if(hole.inner){                        // islands ride along as holes of the cavity
            cav.inner=hole.inner.map(i2=>i2.clone(false));
            for(const i2 of cav.inner) i2.parent=cav;
            walk(hole.inner);                    // recurse for cavities inside islands
          }
          cavities.push(cav);
        }
      }
    })(tops);
    if(!cavities.length){ prevZ=z; continue; }
    const startP=KPOLY.newPoint(last?last[0]:0,last?last[1]:0,z);
    const order=cavities.length>1?KPOLY.route(cavities,startP):cavities;
    const depth=Math.min(ap,prevZ-z)+0.5;
    for(const cav of order){
      const region0=KPOLY.offset([cav],-(toolR+allow-s0),oOpt(z));
      if(!region0.length){
        segs.warnings.push('pocket at Z'+z.toFixed(2)+' too tight for tool ø'+(2*toolR).toFixed(1)+' + allowance — skipped');
        continue;
      }
      // stages of inward offsets; stage entries are nested tops (holes = island keep-outs)
      const stages=[region0];
      for(;;){
        const nxt=KPOLY.offset(stages[stages.length-1].map(p=>p.clone(true)),-ae,oOpt(z));
        if(!nxt.length) break;
        stages.push(nxt);
        if(stages.length>500) break;
      }
      // containment tree over stage tops: parent = containing top one stage out
      const nodes=[];
      for(let si=0;si<stages.length;si++)
        for(const top of stages[si]) nodes.push({top,si,children:[],parent:null});
      for(const nd of nodes){
        if(nd.si===0) continue;
        for(const cand of nodes){
          if(cand.si!==nd.si-1) continue;
          if(nd.top.isInside(cand.top,0.01)){ nd.parent=cand; cand.children.push(nd); break; }
        }
      }
      // emit depth-first: children (deeper insets) before their parent ring
      const emitNode=nd=>{
        for(const ch of nd.children) emitNode(ch);
        if(!nd.children.length){
          // leaf sub-region: helical ramp entry
          const fit=fitRadius(nd.top,0.7*toolR+0.2,z);
          const rH=Math.max(0.2,Math.min(0.7*toolR,fit*0.7));
          let hcSrc=KPOLY.offset([nd.top.clone(true)],-Math.max(0.05,fit*0.9),oOpt(z));
          const hc=(hcSrc.length?hcSrc[0]:nd.top).average();
          const pitch=2*Math.PI*rH*Math.tan(rampDeg*Math.PI/180);
          const turns=Math.max(1,Math.ceil(depth/Math.max(0.05,pitch)));
          const n=Math.max(24,Math.round(36*turns));
          const hpts=[];
          for(let i=0;i<=n;i++){
            const a2=i*2*Math.PI*turns/n;
            hpts.push([hc.x+rH*Math.cos(a2),hc.y+rH*Math.sin(a2),z+depth-(depth*i/n)]);
          }
          hpts.push([hc.x+rH,hc.y,z]);           // final flat turn closes at depth
          segs.push({kind:'rapid',pts:last?[last,[last[0],last[1],clearZ],[hpts[0][0],hpts[0][1],clearZ],hpts[0]]
                                         :[[hpts[0][0],hpts[0][1],clearZ],hpts[0]],f:null,s,line:0,src:'generated'});
          segs.push({kind:'feed',pts:hpts,f:fp,s,line:0,src:'generated'});
          last=hpts[hpts.length-1];
        }
        for(const loop of nd.top.flattenTo([])) emitLoop(loop,z);
      };
      for(const nd of nodes) if(nd.si===0) emitNode(nd);
    }
    prevZ=z;
  }
  return segs;
}
if(typeof module!=='undefined'&&module.exports){ module.exports={genHeightfield,genDist,genIso,genContourRough,genPocketRough}; }
