// ---------------- chat tab (talks straight to the Anthropic API) ----------------
let RAWL=[], PROGNAME='';
const $=id=>document.getElementById(id);
$('bChat').onclick=()=>{
  const open=$('chat').classList.toggle('open');
  $('stepbox').style.right=open?'380px':'10px';
};
$('ckey').value=localStorage.getItem('ncbp_key')||'';
$('ckey').onchange=e=>localStorage.setItem('ncbp_key',e.target.value.trim());
$('cmodel').value=localStorage.getItem('ncbp_model')||'claude-sonnet-5';
$('cmodel').onchange=e=>localStorage.setItem('ncbp_model',e.target.value);
let HIST=[];
$('cClear').onclick=()=>{HIST=[];$('cmsgs').innerHTML='';};
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function md(s){
  s=esc(s);
  s=s.replace(/```([\s\S]*?)```/g,(m,c)=>'<pre>'+c.replace(/^\w*\n/,'')+'</pre>');
  s=s.replace(/`([^`\n]+)`/g,'<code>$1</code>');
  s=s.replace(/\*\*([^*\n]+)\*\*/g,'<b>$1</b>');
  return s;
}
function addMsg(cls,txt){
  const d=document.createElement('div');d.className='msg '+cls;d.innerHTML=md(txt);
  $('cmsgs').append(d);$('cmsgs').scrollTop=1e9;return d;
}
function chatContext(){
  if(!SEC.length) return 'No NC program loaded yet.';
  let out=`PROGRAM FILE: ${PROGNAME}\nPARSED OPERATIONS (✓ = currently shown in 3D):\n`;
  for(const s of SEC){
    out+=`${visible.has(s.id)?'✓':'·'} ${s.name} | ${s.tool||'?'} | G${s.plane||'?'} | Z ${isFinite(s.zMin)?s.zMin.toFixed(1):'-'}..${isFinite(s.zMax)?s.zMax.toFixed(1):'-'} | cut ${(s.cutLen/1000).toFixed(2)}m${s.calls.length?' | CALLS EXTERNAL SUB (not in file): '+s.calls.join(','):''}\n`;
  }
  const ro=$('readout').textContent;
  if(ro && ro!=='—') out+=`\nCURRENT ANIMATION POSITION: ${ro}\n`;
  if($('cAttach').checked){
    const lines=[]; let budget=700;
    for(const s of SEC){
      if(!visible.has(s.id)||!s.endLine) continue;
      const a=Math.max(0,s.lineNo-1), b=Math.min(s.endLine,RAWL.length);
      const chunk=RAWL.slice(a,b);
      if(budget-chunk.length<0){lines.push(`[... ${s.name} truncated, budget reached ...]`);break;}
      lines.push(`--- ${s.name} (source lines ${a+1}-${b}) ---`,...chunk);
      budget-=chunk.length;
    }
    if(lines.length) out+='\nRAW G-CODE OF VISIBLE OPS:\n'+lines.join('\n');
  }
  return out;
}
const SYS='You are a CNC machining expert embedded in a G-code backplot viewer. Dialect: Fanuc-style mill-turn (G361 = B-axis head orientation, G343/G43 H length comp, C rotary axis, G17/G19 planes, canned cycles incl. G83.6/G87.6 high-speed peck, M98/G65 external subprogram calls). Units mm, feed mm/min, comments in French (EBAUCHE=roughing, FINITION=finish, PERCAGE=drilling, TARAUDAGE=tapping, FRAISE=endmill). Answer short and concrete, cite N-numbers and source line numbers. The user is a machining professional. He may attach screenshots of the viewer: green lines = cutting moves, red = rapids, orange = canned cycles, translucent gray = the STEP part model. IMPORTANT: the STEP model is positioned manually and its alignment to the toolpath is approximate — never diagnose model/path misalignment as a program error. The viewer draws programmed contour points; cutter-comp radius offsets are not applied. Parsed program context follows.';
let pendingImg=null;
function setPending(b64,label){
  pendingImg=b64;
  const c=$('cattach');
  c.style.display=b64?'block':'none';
  c.innerHTML=b64?label+' attached — <a href="#" style="color:var(--red)" onclick="this.parentElement.style.display=\'none\';window._clrImg();return false">remove</a>':'';
}
window._clrImg=()=>{pendingImg=null;};
function captureView(){
  renderer.render(scene,camera);                       // fresh frame so the buffer isn't blank
  const w=Math.min(1024,cv.width), h=Math.round(cv.height*w/cv.width);
  const t=document.createElement('canvas'); t.width=w; t.height=h;
  t.getContext('2d').drawImage(cv,0,0,w,h);
  return t.toDataURL('image/jpeg',0.85).split(',')[1];
}
$('cShot').onclick=()=>setPending(captureView(),'3D view snapshot');
$('cin').addEventListener('paste',e=>{
  for(const it of e.clipboardData.items){
    if(it.type.startsWith('image/')){
      e.preventDefault();
      const rd=new FileReader();
      rd.onload=()=>{
        const img=new Image();
        img.onload=()=>{
          const w=Math.min(1024,img.width), h=Math.round(img.height*w/img.width);
          const t=document.createElement('canvas'); t.width=w; t.height=h;
          t.getContext('2d').drawImage(img,0,0,w,h);
          setPending(t.toDataURL('image/jpeg',0.85).split(',')[1],'pasted image');
        };
        img.src=rd.result;
      };
      rd.readAsDataURL(it.getAsFile());
      return;
    }
  }
});
async function sendChat(){
  const key=$('ckey').value.trim();
  if(!key){addMsg('e','Paste your Anthropic API key first (console.anthropic.com → API keys). It is stored only in this browser.');return;}
  const q=$('cin').value.trim(); if(!q&&!pendingImg) return;
  $('cin').value='';
  addMsg('u',(q||'')+(pendingImg?'\n[image attached]':''));
  const content = pendingImg
    ? [{type:'image',source:{type:'base64',media_type:'image/jpeg',data:pendingImg}},
       {type:'text',text:q||'Look at this view of the toolpath and comment.'}]
    : q;
  setPending(null,'');
  HIST.push({role:'user',content}); HIST=HIST.slice(-12);
  const el=addMsg('a','…'); let acc='';
  $('cSend').disabled=true;
  try{
    const r=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'content-type':'application/json','x-api-key':key,
               'anthropic-version':'2023-06-01',
               'anthropic-dangerous-direct-browser-access':'true'},
      body:JSON.stringify({model:$('cmodel').value,max_tokens:1500,stream:true,
        system:SYS+'\n\n'+chatContext(),messages:HIST})
    });
    if(!r.ok){const t=await r.text();throw new Error(r.status+' '+t.slice(0,300));}
    const rd=r.body.getReader(), dec=new TextDecoder(); let buf='', serr=null;
    while(true){
      const {done,value}=await rd.read(); if(done)break;
      buf+=dec.decode(value,{stream:true});
      const parts=buf.split('\n'); buf=parts.pop();
      for(const ln of parts){
        if(!ln.startsWith('data:')) continue;
        let j=null; try{j=JSON.parse(ln.replace(/^data:\s*/,''));}catch(_){continue;}
        if(j.type==='error'||j.error) serr=(j.error&&j.error.message)||'stream error';
        if(j.type==='content_block_delta'&&j.delta&&j.delta.text){
          acc+=j.delta.text; el.innerHTML=md(acc); $('cmsgs').scrollTop=1e9;
        }
      }
    }
    if(serr&&!acc) throw new Error(serr);
    if(!acc){
      // stream produced nothing — retry non-streaming to surface the real answer or error
      const r2=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',
        headers:{'content-type':'application/json','x-api-key':key,
                 'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
        body:JSON.stringify({model:$('cmodel').value,max_tokens:1500,
          system:SYS+'\n\n'+chatContext(),messages:HIST})});
      const jj=await r2.json().catch(()=>null);
      if(jj&&jj.error) throw new Error(jj.error.message||JSON.stringify(jj.error));
      acc=jj&&jj.content?jj.content.map(b=>b.text||'').join(''):'';
      if(acc) el.innerHTML=md(acc);
      else el.textContent='(empty response — switch model and retry)';
    }
    HIST.push({role:'assistant',content:acc||'(empty)'});
    const u=HIST[HIST.length-2];   // drop heavy image from history once answered
    if(u&&Array.isArray(u.content))
      u.content=u.content.filter(b=>b.type==='text').map(b=>b.text).join(' ')+' [an image was attached]';
  }catch(err){
    el.remove(); HIST.pop();
    addMsg('e','Request failed: '+err.message+
      (location.protocol==='file:'?' — if this is a CORS/network block, serve the folder (python -m http.server 8765) and open via http://localhost:8765/nc-backplot.html':''));
  }
  $('cSend').disabled=false;
}
$('cSend').onclick=sendChat;
$('cin').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();}});
