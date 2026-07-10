/**
 * CNC Studio Path Generator — Quick Start Examples
 * Copy & paste these into the browser console or wrap in a test file
 */

// ============================================================================
// Example 1: Simple Square Pocket with Linear Ramping
// ============================================================================

function example_simplePocket() {
  const gen = new PathGenerator({
    toolRadius: 3,
    feedRate: 120,
    rapidRate: 500,
    maxDepth: -5,
    depthPerPass: 1.5
  });

  const pocket = {
    type: 'pocket',
    contours: [[
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
      { x: 0, y: 0 }
    ]],
    depth: -5
  };

  gen.loadGeometry(pocket);
  const moves = gen.generate('linear-ramping');
  const iso = gen.toISO({ toolNumber: 1, spindleSpeed: 1200 });

  console.log('Generated', moves.length, 'moves');
  console.log('G-code:\n', iso);
  return gen;
}

// Run: example_simplePocket()

// ============================================================================
// Example 2: Circular Ramping into a Hole
// ============================================================================

function example_holeRamping() {
  const gen = new PathGenerator({
    toolRadius: 2.5,
    feedRate: 100,
    maxDepth: -8,
    depthPerPass: 1
  });

  const hole = {
    type: 'hole',
    holeCenter: { x: 10, y: 10 },
    holeRadius: 3.5,
    depth: -8
  };

  gen.loadGeometry(hole);
  const moves = gen.generate('circular-ramping');
  
  const stats = gen._computeStats();
  console.log(`Spiral descent: ${moves.length} moves, ${(stats.totalTime/60).toFixed(1)} min`);

  return gen;
}

// Run: example_holeRamping()

// ============================================================================
// Example 3: Peck Drilling (Chip Breaking)
// ============================================================================

function example_peckDrill() {
  const gen = new PathGenerator({
    toolRadius: 2,
    feedRate: 80,
    maxDepth: -12,
    depthPerPass: 2
  });

  const hole = {
    type: 'hole',
    holeCenter: { x: 5, y: 5 },
    holeRadius: 2,
    depth: -12
  };

  gen.loadGeometry(hole);
  const moves = gen.generate('peck', { peckDepth: 1.5 });

  console.log('Peck drilling:', moves.length, 'moves with retracts for chip breaking');
  
  return gen;
}

// Run: example_peckDrill()

// ============================================================================
// Example 4: Widening a Hole (Spiral from 5mm to 10mm)
// ============================================================================

function example_widenHole() {
  const gen = new PathGenerator({
    toolRadius: 2,
    feedRate: 110,
    maxDepth: -6,
    stepover: 1
  });

  const hole = {
    type: 'hole',
    holeCenter: { x: 15, y: 15 },
    holeRadius: 5,
    depth: -6
  };

  gen.loadGeometry(hole);
  const moves = gen.generate('widening-hole', {
    startRadius: 5,
    endRadius: 10
  });

  const stats = gen._computeStats();
  console.log(`Widen hole: ${moves.length} moves`);
  console.log(`Cut distance: ${stats.cutDistance.toFixed(1)} mm`);
  console.log(`Time: ${(stats.totalTime/60).toFixed(2)} min`);

  return gen;
}

// Run: example_widenHole()

// ============================================================================
// Example 5: Trochoidal Milling (Tooth-Path for Hard Materials)
// ============================================================================

function example_trochoidal() {
  const gen = new PathGenerator({
    toolRadius: 3,
    feedRate: 90,      // lower feed for trochoidal
    maxDepth: -4,
    stepover: 1.5,
    depthPerPass: 1
  });

  const pocket = {
    type: 'pocket',
    contours: [[
      { x: 0, y: 0 },
      { x: 15, y: 0 },
      { x: 15, y: 15 },
      { x: 0, y: 15 },
      { x: 0, y: 0 }
    ]],
    depth: -4
  };

  gen.loadGeometry(pocket);
  const moves = gen.generate('trochoidal', { ae: 1.5 });

  console.log('Trochoidal (reduced tool load):', moves.length, 'moves');

  return gen;
}

// Run: example_trochoidal()

// ============================================================================
// Example 6: Complex Pocket with Finishing Pass
// ============================================================================

function example_pocketFinish() {
  const gen = new PathGenerator({
    toolRadius: 2,
    feedRate: 100,
    maxDepth: -5,
    depthPerPass: 1.5
  });

  const pocket = {
    type: 'pocket',
    contours: [[
      { x: 0, y: 0 },
      { x: 25, y: 0 },
      { x: 25, y: 18 },
      { x: 0, y: 18 },
      { x: 0, y: 0 }
    ]],
    depth: -5
  };

  gen.loadGeometry(pocket);
  const moves = gen.generate('pocket-finishing');

  const iso = gen.toISO({
    toolNumber: 2,
    spindleSpeed: 1500,
    lineNumbers: true,
    lineStep: 5
  });

  console.log('Pocket finishing (alternating passes):');
  console.log(iso);

  return gen;
}

// Run: example_pocketFinish()

// ============================================================================
// Example 7: Export to File
// ============================================================================

function example_downloadNC() {
  const gen = new PathGenerator({
    toolRadius: 3,
    feedRate: 120,
    maxDepth: -8,
    depthPerPass: 2
  });

  const pocket = {
    type: 'pocket',
    contours: [[
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 25 },
      { x: 0, y: 25 },
      { x: 0, y: 0 }
    ]],
    depth: -8
  };

  gen.loadGeometry(pocket);
  gen.generate('linear-ramping');
  const iso = gen.toISO({
    toolNumber: 1,
    spindleSpeed: 1000
  });

  // Create and download .nc file
  const blob = new Blob([iso], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pocket_linear_ramp.nc';
  a.click();
  URL.revokeObjectURL(url);

  console.log('Downloaded: pocket_linear_ramp.nc');
}

// Run: example_downloadNC()

// ============================================================================
// Example 8: Statistics & Optimization
// ============================================================================

function example_stats() {
  const gen = new PathGenerator({
    toolRadius: 2.5,
    feedRate: 150,
    maxDepth: -10,
    depthPerPass: 2
  });

  const pocket = {
    type: 'pocket',
    contours: [[
      { x: 5, y: 5 },
      { x: 25, y: 5 },
      { x: 25, y: 20 },
      { x: 5, y: 20 },
      { x: 5, y: 5 }
    ]],
    depth: -10
  };

  gen.loadGeometry(pocket);
  gen.generate('linear-ramping');
  const optimized = gen.optimize();
  
  const stats = gen._computeStats();
  
  console.log('=== Toolpath Statistics ===');
  console.log(`Moves: ${stats.moveCount}`);
  console.log(`Total distance: ${stats.totalDistance.toFixed(1)} mm`);
  console.log(`Cut distance: ${stats.cutDistance.toFixed(1)} mm`);
  console.log(`Z range: ${stats.minZ.toFixed(2)} to ${stats.maxZ.toFixed(2)} mm`);
  console.log(`Feed time: ${(stats.feedTime/60).toFixed(2)} min`);
  console.log(`Rapid time: ${(stats.rapidTime/60).toFixed(2)} min`);
  console.log(`Total time: ${(stats.totalTime/60).toFixed(2)} min`);

  return stats;
}

// Run: example_stats()

// ============================================================================
// Example 9: Full Workflow
// ============================================================================

function example_fullWorkflow() {
  console.log('Step 1: Create generator');
  const gen = new PathGenerator({
    toolRadius: 3,
    feedRate: 120,
    maxDepth: -6,
    depthPerPass: 1.5
  });

  console.log('Step 2: Load geometry');
  const pocket = {
    type: 'pocket',
    contours: [[
      { x: 0, y: 0 }, { x: 20, y: 0 },
      { x: 20, y: 20 }, { x: 0, y: 20 },
      { x: 0, y: 0 }
    ]],
    depth: -6
  };
  gen.loadGeometry(pocket);

  console.log('Step 3: Generate with strategy');
  const moves = gen.generate('linear-ramping');
  console.log(`  Generated ${moves.length} raw moves`);

  console.log('Step 4: Optimize');
  const optimized = gen.optimize();
  console.log(`  Optimized to ${optimized.length} moves`);

  console.log('Step 5: Export to ISO');
  const iso = gen.toISO({ toolNumber: 1, spindleSpeed: 1200 });
  console.log(`  ISO code ready (${iso.split('\n').length} lines)`);

  console.log('Step 6: Show statistics');
  const stats = gen._computeStats();
  console.log(`  Total time: ${(stats.totalTime/60).toFixed(2)} min`);

  console.log('Step 7: Export JSON (for backplot)');
  const json = gen.toJSON();
  console.log(`  JSON export: ${Object.keys(json).join(', ')}`);

  console.log('\n=== COMPLETE ===');
  return iso;
}

// Run: example_fullWorkflow()

// ============================================================================
// Quick Reference
// ============================================================================

console.log(`
CNC Studio Path Generator Examples
===================================

Run any of these in the console:

1. example_simplePocket()        — Square pocket, linear ramping
2. example_holeRamping()         — Spiral hole, circular ramping
3. example_peckDrill()           — Deep hole with chip-breaking pecks
4. example_widenHole()           — Enlarge existing hole with spiral
5. example_trochoidal()          — Tooth-path for hard materials
6. example_pocketFinish()        — Multi-pass with finishing
7. example_downloadNC()          — Export and download .nc file
8. example_stats()               — Show toolpath statistics
9. example_fullWorkflow()        — Complete generate→optimize→export flow

All examples return a PathGenerator instance for further inspection.
`);
