/**
 * Unit tests for CNC Studio Path Generator
 * Run: node tests/pathgen.test.js
 */

const {
  PathGenerator,
  LinearRampingStrategy,
  CircularRampingStrategy,
  PlungeMilling,
  PeckMilling,
  TrochoidalMilling,
  SideMilling,
  WideningHole,
  PocketFinishing
} = require('../src/pathgen.js');

let passed = 0, failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    failed++;
  } else {
    console.log(`✓ ${message}`);
    passed++;
  }
}

function test(name, fn) {
  try {
    fn();
  } catch (e) {
    console.error(`❌ ERROR in ${name}: ${e.message}`);
    failed++;
  }
}

// ============================================================================
// Test utilities
// ============================================================================

function makeSimpleContour() {
  // 10×10 mm square
  return [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
    { x: 0, y: 0 }
  ];
}

function makePocketGeometry() {
  return {
    type: 'pocket',
    contours: [makeSimpleContour()],
    depth: -5
  };
}

function makeHoleGeometry() {
  return {
    type: 'hole',
    holeCenter: { x: 5, y: 5 },
    holeRadius: 3,
    depth: -8
  };
}

// ============================================================================
// PathGenerator tests
// ============================================================================

test('PathGenerator instantiation', () => {
  const gen = new PathGenerator({ toolRadius: 3, feedRate: 100 });
  assert(gen.config.toolRadius === 3, 'toolRadius set');
  assert(gen.config.feedRate === 100, 'feedRate set');
  assert(gen.strategies.size > 0, 'default strategies registered');
});

test('PathGenerator.loadGeometry', () => {
  const gen = new PathGenerator();
  const geom = makePocketGeometry();
  gen.loadGeometry(geom);
  assert(gen.geometry === geom, 'geometry stored');
});

test('PathGenerator rejects missing geometry', () => {
  const gen = new PathGenerator();
  try {
    gen.generate('linear-ramping');
    assert(false, 'should throw on missing geometry');
  } catch (e) {
    assert(e.message.includes('Load geometry'), 'correct error message');
  }
});

test('PathGenerator rejects unknown strategy', () => {
  const gen = new PathGenerator();
  gen.loadGeometry(makePocketGeometry());
  try {
    gen.generate('unknown-strategy');
    assert(false, 'should throw on unknown strategy');
  } catch (e) {
    assert(e.message.includes('Unknown strategy'), 'correct error message');
  }
});

// ============================================================================
// Strategy tests
// ============================================================================

test('LinearRampingStrategy.compute', () => {
  const config = { toolRadius: 3, feedRate: 100, depthPerPass: 2, maxDepth: -5 };
  const geom = makePocketGeometry();
  const strategy = new LinearRampingStrategy(config, geom, {});
  const moves = strategy.compute();
  
  assert(moves.length > 0, 'generates moves');
  assert(moves.some(m => m.type === 'feed'), 'has feed moves');
  assert(moves.some(m => m.type === 'rapid'), 'has rapid moves');
});

test('LinearRampingStrategy depth passes', () => {
  const config = { depthPerPass: 1, maxDepth: -3 };
  const strategy = new LinearRampingStrategy(config, {}, {});
  const passes = strategy.computeDepthPasses(-3);
  
  assert(passes.length === 3, '3 passes for 3mm depth with 1mm step');
  assert(passes[passes.length - 1] === -3, 'final pass reaches target depth');
});

test('CircularRampingStrategy.compute', () => {
  const config = { toolRadius: 3, feedRate: 100, depthPerPass: 1, maxDepth: -8 };
  const geom = makeHoleGeometry();
  const strategy = new CircularRampingStrategy(config, geom, {});
  const moves = strategy.compute();
  
  assert(moves.length > 0, 'generates spiral moves');
  const feedMoves = moves.filter(m => m.type === 'feed');
  assert(feedMoves.length > 0, 'has feed moves');
  assert(feedMoves[feedMoves.length - 1].z <= -8, 'reaches target depth');
});

test('PlungeMilling.compute', () => {
  const config = { toolRadius: 3, feedRate: 100, maxDepth: -3 };
  const geom = makePocketGeometry();
  const strategy = new PlungeMilling(config, geom, {});
  const moves = strategy.compute();
  
  assert(moves.length > 0, 'generates moves');
  const zMoves = moves.filter(m => m.z === -3);
  assert(zMoves.length > 0, 'plunges to target depth');
});

test('PeckMilling.compute', () => {
  const config = { toolRadius: 3, feedRate: 100, depthPerPass: 1, maxDepth: -4 };
  const geom = makePocketGeometry();
  const strategy = new PeckMilling(config, geom, { peckDepth: 1 });
  const moves = strategy.compute();
  
  assert(moves.length > 0, 'generates peck moves');
  const retracts = moves.filter(m => m.type === 'rapid' && m.z > -4);
  assert(retracts.length > 0, 'retracts for chip breaking');
});

test('TrochoidalMilling.compute', () => {
  const config = { toolRadius: 3, feedRate: 100, depthPerPass: 2, maxDepth: -5, stepover: 1.5 };
  const geom = makePocketGeometry();
  const strategy = new TrochoidalMilling(config, geom, { ae: 1.5 });
  const moves = strategy.compute();
  
  assert(moves.length > 0, 'generates trochoidal moves');
});

test('SideMilling.compute', () => {
  const config = { toolRadius: 3, feedRate: 100, depthPerPass: 1, maxDepth: -5 };
  const geom = makePocketGeometry();
  const strategy = new SideMilling(config, geom, {});
  const moves = strategy.compute();
  
  assert(moves.length > 0, 'generates side milling passes');
});

test('WideningHole.compute', () => {
  const config = { toolRadius: 3, feedRate: 100, maxDepth: -8, stepover: 1 };
  const geom = makeHoleGeometry();
  const strategy = new WideningHole(config, geom, { startRadius: 5, endRadius: 10 });
  const moves = strategy.compute();
  
  assert(moves.length > 0, 'generates widening passes');
});

test('PocketFinishing.compute', () => {
  const config = { toolRadius: 3, feedRate: 100, depthPerPass: 1, maxDepth: -5 };
  const geom = makePocketGeometry();
  const strategy = new PocketFinishing(config, geom, {});
  const moves = strategy.compute();
  
  assert(moves.length > 0, 'generates finishing passes');
});

// ============================================================================
// Move sequence tests
// ============================================================================

test('Move sequence starts with rapid', () => {
  const gen = new PathGenerator();
  gen.loadGeometry(makePocketGeometry());
  const moves = gen.generate('linear-ramping');
  
  assert(moves[0].type === 'rapid', 'first move is rapid');
  assert(moves[0].z > 0, 'initial Z is positive (above workpiece)');
});

test('Move sequence has valid coordinates', () => {
  const gen = new PathGenerator();
  gen.loadGeometry(makePocketGeometry());
  const moves = gen.generate('linear-ramping');
  
  for (const move of moves) {
    if (move.type === 'dwell') continue;
    assert(typeof move.x === 'number', `X is number: ${move.x}`);
    assert(typeof move.y === 'number', `Y is number: ${move.y}`);
    assert(typeof move.z === 'number', `Z is number: ${move.z}`);
  }
});

// ============================================================================
// ISO Postprocessor tests
// ============================================================================

test('ISOPostprocessor generates G-code header', () => {
  const { ISOPostprocessor } = require('../src/pathgen.js');
  const post = new ISOPostprocessor({ toolRadius: 3, feedRate: 100 }, { toolNumber: 1 });
  const code = post.generate([
    { x: 0, y: 0, z: 10, type: 'rapid' }
  ]);
  
  assert(code.includes('G21'), 'includes G21 (metric)');
  assert(code.includes('G40'), 'includes G40 (cutter comp off)');
  assert(code.includes('M03'), 'includes M03 (spindle on)');
  assert(code.includes('M30'), 'includes M30 (end program)');
});

test('ISOPostprocessor generates rapid moves', () => {
  const { ISOPostprocessor } = require('../src/pathgen.js');
  const post = new ISOPostprocessor({ toolRadius: 3, feedRate: 100 }, {});
  const code = post.generate([
    { x: 10, y: 20, z: 5, type: 'rapid' }
  ]);
  
  assert(code.includes('G00'), 'includes G00 (rapid)');
  assert(code.includes('X10.000'), 'includes X coordinate');
  assert(code.includes('Y20.000'), 'includes Y coordinate');
});

test('ISOPostprocessor generates feed moves with F word', () => {
  const { ISOPostprocessor } = require('../src/pathgen.js');
  const post = new ISOPostprocessor({ toolRadius: 3, feedRate: 100 }, {});
  const code = post.generate([
    { x: 10, y: 20, z: -5, type: 'feed', feed: 150 }
  ]);
  
  assert(code.includes('G01'), 'includes G01 (feed)');
  assert(code.includes('F150'), 'includes feed rate');
});

test('ISOPostprocessor generates line numbers', () => {
  const { ISOPostprocessor } = require('../src/pathgen.js');
  const post = new ISOPostprocessor({ toolRadius: 3, feedRate: 100 }, { lineNumbers: true, lineStep: 5 });
  const code = post.generate([
    { x: 0, y: 0, z: 10, type: 'rapid' },
    { x: 5, y: 5, z: -2, type: 'feed', feed: 100 }
  ]);
  
  assert(code.includes('N5'), 'includes line number N5');
  assert(code.includes('N10'), 'includes line number N10');
});

// ============================================================================
// Statistics tests
// ============================================================================

test('PathGenerator computes statistics', () => {
  const gen = new PathGenerator();
  gen.loadGeometry(makePocketGeometry());
  gen.generate('linear-ramping');
  const stats = gen._computeStats();
  
  assert(typeof stats.totalDistance === 'number', 'computes total distance');
  assert(typeof stats.cutDistance === 'number', 'computes cut distance');
  assert(typeof stats.minZ === 'number', 'computes min Z');
  assert(typeof stats.maxZ === 'number', 'computes max Z');
  assert(typeof stats.totalTime === 'number', 'computes total time');
  assert(stats.moveCount > 0, 'counts moves');
});

// ============================================================================
// Integration tests
// ============================================================================

test('Full workflow: generate → optimize → export', () => {
  const gen = new PathGenerator({ toolRadius: 3, feedRate: 100, depthPerPass: 2, maxDepth: -4 });
  gen.loadGeometry(makePocketGeometry());
  const moves = gen.generate('linear-ramping');
  const optimized = gen.optimize();
  const iso = gen.toISO({ toolNumber: 1, spindleSpeed: 800 });
  
  assert(optimized.length > 0, 'optimization produces moves');
  assert(iso.includes('G00'), 'ISO export includes rapids');
  assert(iso.includes('G01'), 'ISO export includes feeds');
});

test('PathGenerator.toJSON export', () => {
  const gen = new PathGenerator();
  gen.loadGeometry(makePocketGeometry());
  gen.generate('plunge');
  const json = gen.toJSON();
  
  assert(json.config, 'JSON includes config');
  assert(json.geometry, 'JSON includes geometry');
  assert(json.moves.length > 0, 'JSON includes moves');
  assert(json.statistics, 'JSON includes statistics');
});

// ============================================================================
// Results
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log(`Tests: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

process.exit(failed > 0 ? 1 : 0);
