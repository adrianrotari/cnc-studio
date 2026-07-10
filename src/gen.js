// ---------- pure toolpath generator (no DOM, node-testable) ----------
// Contour roughing around a billet, tool axis Z (G17). At each Z level the
// keep-out is the model silhouette (top-surface heightfield) at that depth;
// passes are iso-distance contours of the keep-out stepped by ae, clipped to
// the bar, outermost first. 2.5D assumption: no undercuts.
// tris: flat [x,y,z]*3n in program coords. Returns [{kind,pts,f,s,line,src}].
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
function genClipRuns(poly,maxR){
  const runs=[]; let cur=[];
  for(const p of poly){
    if(Math.hypot(p[0],p[1])<=maxR) cur.push(p);
    else { if(cur.length>1) runs.push(cur); cur=[]; }
  }
  if(cur.length>1) runs.push(cur);
  return runs;
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
  const emitRing=(pts2,z)=>{
    const p3=pts2.map(p=>[p[0],p[1],z]);
    if(Math.hypot(p3[0][0]-p3[p3.length-1][0],p3[0][1]-p3[p3.length-1][1])<cell*1.6)
      p3.push([p3[0][0],p3[0][1],z]);         // close the loop
    jump(p3[0]);
    segs.push({kind:'feed',pts:p3,f,s,line:0,src:'generated'});
    last=p3[p3.length-1];
  };
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
    const D=genDist(mask,nx,ny,cell);
    const kMax=Math.ceil(2*R/ae);
    for(let k2=kMax;k2>=0;k2--){
      const iso=toolR+allow+k2*ae;
      const polys=genIso(D,nx,ny,x0,y0,cell,iso);
      for(const poly of polys)
        for(const run of genClipRuns(poly,maxR))
          emitRing(run,z);
    }
  }
  return segs;
}
if(typeof module!=='undefined'&&module.exports){ module.exports={genHeightfield,genDist,genIso,genContourRough}; }
