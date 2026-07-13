// Build: concatenate src modules into a single self-contained dist/nc-backplot.html
// Order matters — modules are plain script fragments sharing top-level scope,
// exactly mirroring the proven monolith. Do not reorder without testing.
const fs=require('fs'), path=require('path');
const SRC=path.join(__dirname,'src'), DIST=path.join(__dirname,'dist');
const ORDER=['parser.js','geom.js','tools.js','clip2.js','poly.js','gen.js','scene.js','app.js','anim.js','step.js','chat.js','stock.js','fixture.js','genui.js','main.js'];
const shell=fs.readFileSync(path.join(SRC,'shell.html'),'utf8');
const js=ORDER.map(f=>{
  // modules live in src/; vendored third-party (clip2.js) lives in vendor/
  const p=fs.existsSync(path.join(SRC,f))?path.join(SRC,f):path.join(__dirname,'vendor',f);
  let t=fs.readFileSync(p,'utf8');
  // strip the node-only export shim from parser.js
  t=t.replace(/if\(typeof module[^\n]*\n/,'');
  return '// ===== '+f+' =====\n'+t;
}).join('\n');
if(!shell.includes('/*__APP_JS__*/')) throw new Error('shell.html missing /*__APP_JS__*/ marker');
const out=shell.replace('/*__APP_JS__*/',()=>js);
fs.mkdirSync(DIST,{recursive:true});
fs.writeFileSync(path.join(DIST,'nc-backplot.html'),out);
console.log('built dist/nc-backplot.html',(out.length/1024).toFixed(1)+' KB');
