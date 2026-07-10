# CNC Studio — Path Generator v0.3 (CAM-lite)

Tool path generation engine for 2.5D CNC milling. Converts DXF contours or manual geometry into G-code with multiple milling strategies.

## Milling Strategies

All strategies follow this flow:
1. Load geometry (contours + depth)
2. Select strategy with parameters
3. Generate move sequence
4. Optimize (consolidate rapids, tool comp)
5. Export as ISO G-code (Fanuc dialect)

### Supported Strategies

| Strategy | Use Case | Notes |
|----------|----------|-------|
| **Linear Ramping** | Gentle Z descent while tracing contour | Low shock, good for shallow pockets. Z descends linearly proportional to XY progress. |
| **Circular Ramping** | Spiral descent into holes | Helical entry for rigid holes. Gradual Z + smooth circular XY. |
| **Plunge Milling** | Rapid XY, then vertical plunge | Fast for shallow, rigid cavities. Single Z feed. |
| **Peck Milling** | Repeated shallow plunges | Chip breaking on deep holes. Rapid retract between pecks. |
| **Trochoidal** | Tooth-path loading reduction | Variable offset + scalloped edges. Extends tool life in hard materials. |
| **Side Milling** | Full-width slotting | Back-and-forth passes along contour edges. |
| **Widening Hole** | Enlarge existing hole | Spiral passes from start to end radius. |
| **Pocket Finishing** | Smooth walls | Alternating pass directions for consistent finish. |

## Configuration

```javascript
const gen = new PathGenerator({
  toolRadius: 3.0,        // mm, endmill diameter ÷ 2
  feedRate: 100,          // mm/min, cutting feed
  rapidRate: 500,         // mm/min, G00 speed
  maxDepth: -10,          // mm, negative = down
  depthPerPass: 2,        // mm, adaptive depth per layer
  stepover: 2,            // mm (ae), engagement per pass
  units: 'mm',            // 'mm' or 'in'
  planeMode: 'XY'         // XY (default), XZ, YZ
});
```

## Geometry Format

```javascript
{
  type: 'pocket' | 'hole' | 'profile',
  contours: [
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 }    // closed contour
    ]
  ],
  depth: -5,             // target Z (negative)
  
  // For holes:
  holeCenter: { x: 5, y: 5 },
  holeRadius: 3,
  
  // Multiple contours for complex pockets
  holes: [               // optional islands/obstacles
    { center: { x: 15, y: 15 }, radius: 2 }
  ]
}
```

## Usage

### Basic Example

```javascript
// 1. Create generator
const gen = new PathGenerator({
  toolRadius: 3,
  feedRate: 120,
  maxDepth: -5,
  depthPerPass: 1.5
});

// 2. Load geometry
const pocket = {
  type: 'pocket',
  contours: [[
    { x: 0, y: 0 }, { x: 20, y: 0 },
    { x: 20, y: 20 }, { x: 0, y: 20 },
    { x: 0, y: 0 }
  ]],
  depth: -5
};
gen.loadGeometry(pocket);

// 3. Generate toolpath
const moves = gen.generate('linear-ramping');

// 4. Optimize
const optimized = gen.optimize();

// 5. Export to G-code
const iso = gen.toISO({
  toolNumber: 1,
  spindleSpeed: 800,
  lineNumbers: true,
  lineStep: 10
});
console.log(iso);

// 6. Stats
const stats = gen._computeStats();
console.log(`${stats.moveCount} moves, ${(stats.totalTime/60).toFixed(1)} min`);
```

### Hole Widening

```javascript
const gen = new PathGenerator({ toolRadius: 2, maxDepth: -8 });
gen.loadGeometry({
  type: 'hole',
  holeCenter: { x: 10, y: 10 },
  holeRadius: 5,
  depth: -8
});

const moves = gen.generate('widening-hole', {
  startRadius: 5,
  endRadius: 12
});
```

### Peck Drilling

```javascript
const moves = gen.generate('peck', {
  peckDepth: 2       // 2mm per peck
});
```

## Move Structure

Each move has:
```javascript
{
  x, y, z,              // coordinates (mm)
  type: 'rapid' | 'feed' | 'arc' | 'dwell',
  feed: 100,            // mm/min (for feed/arc)
  
  // For arcs:
  center: { x, y },     // arc center (XY plane)
  direction: 1 | -1     // 1=CCW (G03), -1=CW (G02)
}
```

## G-Code Output

Generates Fanuc-dialect ISO code with:
- G0 (rapid), G1 (feed), G2/G3 (arcs)
- F word (feed rate) only on changes
- N-numbers (optional, configurable step)
- M3 (spindle on), M5 (spindle off), M30 (end)

**Example output:**
```gcode
(CNC Studio Tool Path)
(Tool: T1 Spindle: 800 RPM)
G21 G40 G49
T1
M03 S800
N10 G00 X0.000 Y0.000 Z10.000
N20 G01 Z-5.000 F100
N30 X10.000 Y0.000
N40 X10.000 Y10.000
N50 X0.000 Y10.000
N60 X0.000 Y0.000
N70 G00 Z10.000
M05
M30
```

## Statistics

After `.generate()` or `.optimize()`, call `_computeStats()`:

```javascript
{
  totalDistance: 152.4,     // mm
  cutDistance: 45.2,        // feed moves only
  minZ: -5.0,
  maxZ: 10.0,
  feedTime: 27.1,           // seconds
  rapidTime: 8.3,           // seconds
  totalTime: 35.4,          // seconds
  moveCount: 42
}
```

## Testing

```bash
node tests/pathgen.test.js
```

Runs 30+ tests covering:
- Strategy instantiation & move generation
- Depth pass computation
- G-code output formatting
- Statistics accuracy
- Full workflow (generate → optimize → export)

## Integration with CNC Studio v0.1

The path generator is **preview only** in v0.3. It does NOT yet:
- Import DXF (manual JSON geometry for now)
- Backplot preview in 3D (visible in next iteration)
- Cutter compensation (offset paths left/right)
- Material library feed/speed recommendations

These are planned for v0.4+.

## Browser UI (pathgenui.js)

Opens a panel with:
- Strategy picker
- Tool/feed parameter sliders
- Geometry JSON editor
- "Load from Backplot" button (stub, for future STEP import)
- "Generate Toolpath" button
- "Export ISO" (downloads `.nc` file)
- "Show Stats" (displays time, distance, Z range)

Wired into `dist/nc-backplot.html` via `build.js`.

## API Reference

### PathGenerator

- `loadGeometry(geom)` — store geometry, validate contours
- `generate(strategyName, options)` — compute moves; returns array
- `optimize()` — consolidate redundant moves, apply tool comp
- `toISO(options)` — convert to Fanuc G-code string
- `toJSON()` — export config + geometry + moves for backplot

### Strategies (all inherit MillingStrategy)

- `LinearRampingStrategy`
- `CircularRampingStrategy`
- `PlungeMilling`
- `PeckMilling`
- `TrochoidalMilling`
- `SideMilling`
- `WideningHole`
- `PocketFinishing`

All have `.compute()` returning moves array.

### ToolpathOptimizer

- `optimize(moves)` — remove duplicate XYZ, consolidate rapids

### ISOPostprocessor

- `generate(moves)` — emit Fanuc G-code with line numbers, tool changes, spindle

## Limitations & Known Issues

1. **2.5D only** — XY contours with fixed Z depth. No 3D surfacing.
2. **No tool comp offset** — paths generated at tool centerline; must apply D-word offset in CAM.
3. **Synthetic geometry** — no DXF/STEP import yet (manual JSON entry).
4. **Arc approximation** — trochoidal scallops use linear interpolation (not true arcs yet).
5. **No collision check** — assumes single tool and no obstacles.

## Roadmap

- **v0.4**: DXF contour import, 3D backplot preview, cutter comp offset paths
- **v0.5**: Material library (Sandvik kc1.1/mc), adaptive feed rates (Chip·Force engine)
- **v0.6**: Multi-tool sequences, subprogram nesting (M98/G65)

## Author & License

CNC Studio is maintained by Adrian Rotari (adrianrotari).  
Created 2026-07-10, CAM-lite module added 2026-07-10.

**No bundler, no npm.** Plain JavaScript modules concatenated by `build.js` into a single `dist/nc-backplot.html`.
