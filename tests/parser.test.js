// Parser unit tests — run: node tests/parser.test.js
const {parseNC}=require('../src/parser.js');
let pass=0,fail=0;
const ok=(cond,msg)=>{ if(cond){pass++;} else {fail++; console.error('FAIL:',msg);} };

const FIXTURE=`%
O0001(TEST PROGRAM)
N5(ROUGH CONTOUR)
( T2002 H2. FRAISE MD EB12)
G00G21G17G40G54
G00T2002
G97S8350M13
G00X0Y0Z5.
G01Z-1.F100.
G01X10.
G02X10.Y0.I0.J-5.(full circle r5)
G03X20.Y10.R10.(quarter ccw)
G04X5(dwell - not a move)
M92F1(feed guard - F1 must NOT become modal feed)
G01X30.
N10(DRILL)
( T2007 FORET)
G00X0Y0Z2.
G83Z-8.R0.F200.
G80
N15(RADIAL G19)
G19
G00Y0.Z-10.
G00X50.
G01X40.F300.
G03Y10.Z-20.J10.K0.(ccw yz arc)
N20(SUBCALL)
M98P0555
N25(G52 SHIFT)
G17G52X1.Y-1.
G00X0Y0Z5.
G01Z0.F100.
G52X0Y0
M30
%`;

const S=parseNC(FIXTURE);
ok(S.length===5,'expected 5 sections, got '+S.length);
const n5=S.find(s=>/^N5/.test(s.name));
ok(n5 && n5.isRough12,'N5 flagged EB12');
ok(n5 && n5.tool==='T2002','N5 tool T2002, got '+(n5&&n5.tool));
// full circle: length ≈ 2πr = 31.42
const circ=n5.segs.find(sg=>sg.src.includes('G02'));
ok(circ && Math.abs(circ.len-2*Math.PI*5)<0.05,'full circle length ≈ 31.42, got '+(circ&&circ.len.toFixed(2)));
// R-form quarter arc r10: length ≈ π*10/2 = 15.71
const quart=n5.segs.find(sg=>sg.src.includes('G03'));
ok(quart && Math.abs(quart.len-Math.PI*5)<0.35,'R10 quarter arc ≈ 15.71, got '+(quart&&quart.len.toFixed(2)));
// dwell must not create a move to X5
ok(!n5.segs.some(sg=>sg.src.includes('G04')),'G04 dwell produced no segment');
// M92F1 must not override modal feed for the following G01X30
const last=n5.segs[n5.segs.length-1];
ok(last && last.f===100,'modal feed stays 100 after M92F1, got '+(last&&last.f));
// drill cycle: plunge to -8 and retract
const n10=S.find(s=>/^N10/.test(s.name));
const cyc=n10.segs.filter(sg=>sg.kind==='cycle');
ok(cyc.length===2 && Math.abs(cyc[0].pts[1][2]+8)<1e-6,'G83 plunge to Z-8 + retract');
// G19 arc consumes J/K in YZ
const n15=S.find(s=>/^N15/.test(s.name));
ok(n15 && n15.plane===19,'N15 plane G19');
const yz=n15.segs.find(sg=>sg.src.includes('G03'));
ok(yz && Math.abs(yz.len-Math.PI*10/2)<0.35,'G19 quarter arc r10 ≈ 15.71, got '+(yz&&yz.len.toFixed(2)));
// subprogram call captured
const n20=S.find(s=>/^N20/.test(s.name));
ok(n20 && n20.calls[0]==='O555','M98P0555 captured as O555, got '+(n20&&n20.calls[0]));
// G52 shift applied: G01 Z0 at X1 Y-1
const n25=S.find(s=>/^N25/.test(s.name));
const sh=n25.segs.find(sg=>sg.kind==='feed');
ok(sh && Math.abs(sh.pts[1][0]-1)<1e-9 && Math.abs(sh.pts[1][1]+1)<1e-9,'G52 X1 Y-1 shift applied');

// ---- subprogram inlining (v0.2): M98/G65 O-file resolution ----
const SUB100=`O0100(SUBPROG - 10x10 SQUARE)
G01X10.F150.
G01Y10.
G01X0.
G01Y0.
M99`;
const MAIN=`%
O0002(MAIN)
N5(POCKET)
( T2002 EB12)
G17G54
G00X0Y0Z5.
G01Z-2.F100.
M98P100L2
G00Z5.
N10(FINISH)
G00X0Y0Z5.
M98P0100
G00Z5.
M30
%`;
// no O-file supplied -> call stays an unresolved warning, no geometry
const U=parseNC(MAIN);
const u5=U.find(s=>/^N5/.test(s.name));
ok(u5 && u5.calls.includes('O100'),'M98P100 unresolved -> warning, got '+(u5&&JSON.stringify(u5.calls)));
ok(u5 && !u5.resolvedCalls,'no resolvedCalls without subs');
// O-file supplied -> call resolves and plots inline
const R=parseNC(MAIN,{subs:{100:SUB100}});
ok(R.length===U.length,'op count unchanged by inlining, got '+R.length+' vs '+U.length);
const r5=R.find(s=>/^N5/.test(s.name));
ok(r5 && !r5.calls.length,'no warning once inlined, got '+(r5&&JSON.stringify(r5.calls)));
ok(r5 && r5.resolvedCalls && r5.resolvedCalls[0]==='O100 ×2','N5 resolved O100 ×2, got '+(r5&&JSON.stringify(r5.resolvedCalls)));
const subsegs=r5.segs.filter(sg=>sg.sub==='O100');
ok(subsegs.length>0,'N5 has inlined sub segments, got '+subsegs.length);
// L2 -> two passes of a 10x10 square perimeter (40 mm each) = 80 mm of feed from the sub
const subfeed=subsegs.filter(sg=>sg.kind==='feed').reduce((a,sg)=>a+sg.len,0);
ok(Math.abs(subfeed-80)<1e-6,'two passes of 40mm square = 80, got '+subfeed.toFixed(2));
// inlined segments attribute to the M98 call line in the MAIN file (source readout stays meaningful)
const callLine=MAIN.split(/\r?\n/).findIndex(l=>/M98P100/.test(l))+1;
ok(subsegs.every(sg=>sg.line===callLine),'sub segs carry the call-site line '+callLine);
// M99 return + single call (no L) => one pass
const r10=R.find(s=>/^N10/.test(s.name));
ok(r10 && r10.resolvedCalls && r10.resolvedCalls[0]==='O100','N10 resolved O100 single, got '+(r10&&JSON.stringify(r10.resolvedCalls)));
const r10feed=r10.segs.filter(sg=>sg.sub==='O100'&&sg.kind==='feed').reduce((a,sg)=>a+sg.len,0);
ok(Math.abs(r10feed-40)<1e-6,'N10 single pass = 40, got '+r10feed.toFixed(2));

console.log(`parser tests: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
