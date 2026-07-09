# CNC Studio — instructions for Claude Code

Browser-based CNC program analyzer. Single-file deliverable built from plain-script modules.

## Commands

- Build: `node build.js` → `dist/nc-backplot.html`
- Test: `node tests/parser.test.js` (must stay green)
- No bundler, no npm dependencies. three.js and occt-import-js come from CDN at runtime.

## Architecture — read before editing

`src/*.js` are NOT ES modules. They are plain script fragments sharing one top-level
scope, concatenated by `build.js` in a fixed order (parser → geom → tools → scene → app →
anim → step → chat → stock → main). Cross-module references are bare globals. Do not
reorder, do not add import/export, do not introduce duplicate top-level names.
ES-module migration is allowed only as a dedicated refactor with browser testing.

`src/parser.js`, `src/geom.js` and `src/tools.js` are pure (no DOM) and node-testable —
keep them that way.
The `/*__PARSER_START__*/ ... /*__PARSER_END__*/` markers are used by tooling; keep them.
Tests: `node tests/{parser,geom,tools}.test.js` (all must stay green).
Pure modules must keep the node export shim on ONE line, e.g.
`if(typeof module!=='undefined'&&module.exports){ module.exports={...}; }` — `build.js`
strips it with a single-line regex, so a multi-line shim leaves a dangling `}` that
breaks the browser bundle (node tests still pass, since they require the raw file).

## Rules

- Never commit customer data (`*.dnc`, `*.stp` are git-ignored). Tests use synthetic fixtures only.
- After any change: run tests, run build, and open `dist/nc-backplot.html` in a real
  browser with a real program before committing. The dist file IS the product.
- Reference behavior check: the parser must report 171 operations, 3 EB12 ops and
  min Z −68.9 on the reference program (user has it locally; do not add it to the repo).
- User is a machining professional (BRW, DMG DMU 50). Units mm, feeds mm/min.
  Short answers; no over-explaining.

## Dialect notes (Fanuc-style mill-turn)

G361 B-axis head orientation, G343/G43 H length comp, C rotary, G17/G19 planes,
canned cycles incl. G83.6/G87.6 high-speed variants, M98/G65 external subprogram
calls (files usually NOT present — surface them as warnings), G52 local shift,
M92Fn is a feed-guard macro (F word there is NOT modal feed), G04 X = dwell seconds.

## Roadmap (next milestones)

1. v0.2 verifier: drop-in loading of subprogram O-files (M98/G65 resolve + inline
   plot), cutter-comp offset paths (left/right by tool radius), cutting-data audit
   per op (fz/vc/hex vs material library), printable setup report.
2. v0.3 CAM-lite: DXF import → contour/pocket/drill 2.5D paths, ISO post.

Backlog / nice-to-have:
- Cylinder billet: optional centerline offsets (X/Y for axis Z, Y/Z for axis X) for
  off-center setups. Currently the centerline is fixed through the program origin.
