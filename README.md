# CNC Studio

Browser-based CNC **program analyzer** — backplot, material-removal simulation, live
engagement data (ae / fz / hex / ap / MRR) and an embedded Claude chat that reads the
actual G-code. Runs as a single HTML file, no install, works offline except CDN
libraries (three.js, occt-import-js) and the chat API.

Born 2026-07-08 from a real case: analyzing a colleague's mill-turn roughing program
(ø12 endmill) without opening a CAM seat.

## What it does today (v0.1)

- Parses Fanuc-style mill-turn ISO code: G0–G3 (helical arcs, IJK + R, full circles),
  G17/18/19 planes, canned cycles (G83/G84/G87/… incl. .6 variants), G52 shifts,
  G361 B-orientation, M98/G65 external-call detection, dwell/feed-guard edge cases
- Operation list from N-blocks with tool, plane, Z-range, cut length, time estimate
- three.js 3D backplot: feeds/rapids/cycles, per-op colors, animation with a
  parametric endmill (ø × flutes × 7×D) and live source-line readout
- STEP model overlay (occt-import-js) with auto-align (center on path, top face → Z0)
- 2.5D heightfield stock simulation; stock = STEP model + offset, or flat box;
  live ae / ae/D / hex (chip thinning) / ap / MRR measured from the sim
- Claude chat panel (user's own API key): sees the parsed op table, current animation
  line, raw G-code of ticked ops, and pasted/captured screenshots

## Honest scope

This is NOT a CAD/CAM system and does not try to be one. Geometry kernels, surfacing
and post-processors are decades of work owned by Fusion/Mastercam/hyperMILL.
The ownable niche: **understand, verify and optimize existing programs** —
and later generate simple 2.5D toolpaths.

## Roadmap

- **v0.1 — analyzer (this)**: parse → backplot → stock sim → cut data → AI chat
- **v0.2 — verifier**: cutter-comp offset paths, subprogram loading (drop O-files in),
  per-op cutting-data audit vs material library (kc1.1/mc from the 41-material Sandvik
  set), collision/limit warnings, printable setup report
- **v0.3 — CAM-lite**: DXF import → contour / pocket / drill 2.5D paths with the
  Chip·Force engine recommending fz/vc/ae, ISO post
- Integration with the Chatter-calculator suite (test-lobe-tune, Cut Coach, chip-force-polar)

## Structure

```
src/shell.html    UI markup + CSS, /*__APP_JS__*/ marker
src/parser.js     pure ISO parser (node-testable, no DOM)
src/scene.js      three.js scene, orbit, parametric tool
src/app.js        op list, path rendering, hud
src/anim.js       timeline + animation loop
src/step.js       STEP import + file routing
src/chat.js       Claude chat (direct API, image attach)
src/stock.js      2.5D stock sim + cut data + auto-align
src/main.js       boot
build.js          concat modules → dist/nc-backplot.html
tests/            node tests (no fixtures from customer data)
```

Modules are plain script fragments sharing top-level scope, concatenated in a fixed
order — a faithful split of the proven monolith. ES-module + bundler migration is a
future task (do it in Claude Code with browser testing, not blind).

## Develop

```
node build.js            # build dist/nc-backplot.html
node tests/parser.test.js
```

Open `dist/nc-backplot.html` in Chrome (file:// is fine; chat may need
`python -m http.server` if CORS blocks file://).

## Rules learned the hard way

- Never commit customer programs or STEP files (tests use synthetic fixtures)
- GitHub Pages auto-deploys every commit — only push what should go live
- Verify built output in a real browser before committing a refactor
