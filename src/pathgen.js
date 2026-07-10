/**
 * CNC Studio — Tool Path Generator Core
 * Modular 2.5D milling strategy system for CAM-lite v0.3
 * 
 * Architecture:
 * - PathGenerator: main orchestrator
 * - MillingStrategy: base class for all strategies
 * - Subclasses: Linear Ramping, Circular Ramping, Plunge, Peck, Trochoidal, etc.
 * - ToolpathOptimizer: feed rates, rapid retracts, tool comp
 * 
 * All geometry operations are 2.5D (XY contours + Z depth layers).
 * Output: array of { x, y, z, feed, rapid, type } moves → ISO post
 */

class PathGenerator {
  constructor(config = {}) {
    this.config = {
      toolRadius: config.toolRadius || 3.0,        // mm
      feedRate: config.feedRate || 100,             // mm/min
      rapidRate: config.rapidRate || 500,           // mm/min
      maxDepth: config.maxDepth || -10,             // Z negative down
      depthPerPass: config.depthPerPass || 2,       // mm per cut
      stepover: config.stepover || 2,               // ae, mm
      units: config.units || 'mm',                  // 'mm' or 'in'
      planeMode: config.planeMode || 'XY',         // XY, XZ, YZ
      ...config
    };
    
    this.strategies = new Map();
    this.moves = [];
    this.geometry = null;
    
    this._registerDefaultStrategies();
  }
  
  _registerDefaultStrategies() {
    this.registerStrategy('linear-ramping', LinearRampingStrategy);
    this.registerStrategy('circular-ramping', CircularRampingStrategy);
    this.registerStrategy('plunge', PlungeMilling);
    this.registerStrategy('peck', PeckMilling);
    this.registerStrategy('trochoidal', TrochoidalMilling);
    this.registerStrategy('side-milling', SideMilling);
    this.registerStrategy('widening-hole', WideningHole);
    this.registerStrategy('pocket-finishing', PocketFinishing);
  }
  
  registerStrategy(name, StrategyClass) {
    this.strategies.set(name, StrategyClass);
  }
  
  /**
   * Load geometry from STL or STEP
   * Expected: { type: 'profile'|'pocket', contours: [...], depth: Z, holes: [...] }
   */
  loadGeometry(geometry) {
    if (!geometry || !geometry.contours) {
      throw new Error('Geometry must have contours array');
    }
    this.geometry = geometry;
    return this;
  }
  
  /**
   * Generate toolpath using specified strategy
   */
  generate(strategyName, options = {}) {
    if (!this.geometry) {
      throw new Error('Load geometry first with loadGeometry()');
    }
    
    const StrategyClass = this.strategies.get(strategyName);
    if (!StrategyClass) {
      throw new Error(`Unknown strategy: ${strategyName}. Registered: ${Array.from(this.strategies.keys()).join(', ')}`);
    }
    
    const strategy = new StrategyClass(this.config, this.geometry, options);
    this.moves = strategy.compute();
    return this.moves;
  }
  
  /**
   * Optimize generated moves: consolidate rapids, apply tool comp, add feed rates
   */
  optimize() {
    if (!this.moves || this.moves.length === 0) return [];
    
    const optimizer = new ToolpathOptimizer(this.config);
    return optimizer.optimize(this.moves);
  }
  
  /**
   * Convert to ISO G-code
   */
  toISO(options = {}) {
    const post = new ISOPostprocessor(this.config, options);
    return post.generate(this.moves);
  }
  
  /**
   * Export as JSON for backplot integration
   */
  toJSON() {
    return {
      config: this.config,
      geometry: this.geometry,
      moves: this.moves,
      statistics: this._computeStats()
    };
  }
  
  _computeStats() {
    if (!this.moves || this.moves.length === 0) return {};
    
    let minZ = Infinity, maxZ = -Infinity;
    let totalDist = 0, cutDist = 0;
    let feedTime = 0, rapidTime = 0;
    
    for (let i = 1; i < this.moves.length; i++) {
      const prev = this.moves[i - 1];
      const curr = this.moves[i];
      
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const dz = curr.z - prev.z;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      
      totalDist += dist;
      minZ = Math.min(minZ, curr.z);
      maxZ = Math.max(maxZ, curr.z);
      
      if (curr.type === 'feed' || curr.type === 'arc') {
        cutDist += dist;
        feedTime += dist / (curr.feed || this.config.feedRate);
      } else if (curr.type === 'rapid') {
        rapidTime += dist / (curr.feed || this.config.rapidRate);
      }
    }
    
    return {
      totalDistance: totalDist,
      cutDistance: cutDist,
      minZ, maxZ,
      feedTime,
      rapidTime,
      totalTime: feedTime + rapidTime,
      moveCount: this.moves.length
    };
  }
}

/**
 * Base class for all milling strategies
 */
class MillingStrategy {
  constructor(config, geometry, options = {}) {
    this.config = config;
    this.geometry = geometry;
    this.options = options;
    this.moves = [];
  }
  
  /**
   * Main algorithm: subclasses override
   */
  compute() {
    throw new Error('compute() must be implemented by subclass');
  }
  
  /**
   * Rapid move to (x, y, z)
   */
  addRapid(x, y, z) {
    this.moves.push({ x, y, z, type: 'rapid', feed: this.config.rapidRate });
  }
  
  /**
   * Feed move to (x, y, z)
   */
  addFeed(x, y, z, feed = null) {
    this.moves.push({ x, y, z, type: 'feed', feed: feed || this.config.feedRate });
  }
  
  /**
   * Plunge (Z move only, same XY)
   */
  addPlunge(z, feed = null) {
    const last = this.moves[this.moves.length - 1];
    if (!last) return;
    this.addFeed(last.x, last.y, z, feed);
  }
  
  /**
   * Arc move (CCW = direction > 0)
   */
  addArc(endX, endY, endZ, centerX, centerY, direction, feed = null) {
    this.moves.push({
      x: endX, y: endY, z: endZ,
      type: 'arc',
      center: { x: centerX, y: centerY },
      direction: direction, // 1=CCW (G03), -1=CW (G02)
      feed: feed || this.config.feedRate
    });
  }
  
  /**
   * Dwell (G04)
   */
  addDwell(seconds) {
    this.moves.push({ type: 'dwell', time: seconds });
  }
  
  /**
   * Compute Z passes from surface to target depth
   */
  computeDepthPasses(targetZ) {
    const passes = [];
    const step = this.config.depthPerPass;
    let z = 0; // start at surface
    
    while (z > targetZ) {
      z = Math.max(z - step, targetZ);
      passes.push(z);
    }
    
    return passes;
  }
  
  /**
   * Offset a 2D contour by radius (left/right cutter comp)
   */
  offsetContour(contour, offset) {
    // Stub: real implementation uses proper 2D polygon offsetting
    // For now, scale about center
    return contour.map(pt => ({
      x: pt.x * (1 + offset / Math.sqrt(pt.x*pt.x + pt.y*pt.y + 0.001)),
      y: pt.y * (1 + offset / Math.sqrt(pt.x*pt.x + pt.y*pt.y + 0.001))
    }));
  }
}

/**
 * Linear Ramping: Z descends linearly while following contour (XY + Z combined)
 */
class LinearRampingStrategy extends MillingStrategy {
  compute() {
    const depth = this.geometry.depth || this.config.maxDepth;
    const contour = this.geometry.contours[0]; // single contour
    
    if (!contour || contour.length < 2) {
      throw new Error('LinearRamping needs a contour with ≥2 points');
    }
    
    const passes = this.computeDepthPasses(depth);
    
    for (const targetZ of passes) {
      // Rapid to start of contour at safe Z
      const start = contour[0];
      this.addRapid(start.x, start.y, 10);
      this.addPlunge(targetZ);
      
      // Trace contour with linear ramp: Z descends proportionally
      for (let i = 0; i < contour.length; i++) {
        const pt = contour[i];
        const progress = i / (contour.length - 1); // 0 to 1
        const rampeadZ = targetZ + progress * (depth - targetZ);
        
        this.addFeed(pt.x, pt.y, rampeadZ);
      }
      
      // Return to start
      this.addRapid(start.x, start.y, 10);
    }
    
    return this.moves;
  }
}

/**
 * Circular Ramping: spiral descent into a hole or pocket
 */
class CircularRampingStrategy extends MillingStrategy {
  compute() {
    const depth = this.geometry.depth || this.config.maxDepth;
    const centerX = this.geometry.holeCenter?.x || 0;
    const centerY = this.geometry.holeCenter?.y || 0;
    const radius = this.geometry.holeRadius || this.config.toolRadius * 2;
    const pitch = this.config.depthPerPass;
    
    // Rapid to safe Z above hole
    this.addRapid(centerX + radius, centerY, 10);
    
    let z = 0;
    let angle = 0;
    const spiralPitch = pitch / (2 * Math.PI * radius); // Z per radian
    
    while (z > depth) {
      z -= spiralPitch * 10; // step angle: 10 radians ≈ 1.6 turns
      z = Math.max(z, depth);
      angle += 10;
      
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      
      this.addFeed(x, y, z);
    }
    
    // Retract
    this.addRapid(centerX + radius, centerY, 10);
    
    return this.moves;
  }
}

/**
 * Plunge Milling: rapid Z descent then horizontal cut (for shallow holes)
 */
class PlungeMilling extends MillingStrategy {
  compute() {
    const depth = this.geometry.depth || this.config.maxDepth;
    const contour = this.geometry.contours[0];
    
    if (!contour) throw new Error('PlungeMilling needs a contour');
    
    const start = contour[0];
    
    // Rapid to XY, then plunge Z
    this.addRapid(start.x, start.y, 10);
    this.addPlunge(depth, this.config.feedRate * 0.5); // half feed on plunge
    
    // Trace contour at depth
    for (const pt of contour) {
      this.addFeed(pt.x, pt.y, depth);
    }
    
    // Retract
    this.addRapid(start.x, start.y, 10);
    
    return this.moves;
  }
}

/**
 * Peck Milling: repeated shallow plunges (chip breaking)
 */
class PeckMilling extends MillingStrategy {
  compute() {
    const depth = this.geometry.depth || this.config.maxDepth;
    const peckDepth = this.options.peckDepth || 2; // mm per peck
    const contour = this.geometry.contours[0];
    const start = contour[0];
    
    const passes = this.computeDepthPasses(depth);
    
    for (const targetZ of passes) {
      this.addRapid(start.x, start.y, 10);
      
      let z = 0;
      while (z > targetZ) {
        z = Math.max(z - peckDepth, targetZ);
        this.addPlunge(z, this.config.feedRate * 0.5);
        
        // Rapid retract to break chip
        this.addRapid(start.x, start.y, 5);
        this.addRapid(start.x, start.y, z + peckDepth);
      }
    }
    
    return this.moves;
  }
}

/**
 * Trochoidal Milling: tooth-path interpolation (reduce load, extend tool life)
 */
class TrochoidalMilling extends MillingStrategy {
  compute() {
    const depth = this.geometry.depth || this.config.maxDepth;
    const contour = this.geometry.contours[0];
    const radius = this.config.toolRadius;
    const ae = this.options.ae || this.config.stepover;
    
    if (!contour) throw new Error('TrochoidalMilling needs a contour');
    
    const start = contour[0];
    this.addRapid(start.x, start.y, 10);
    this.addPlunge(depth, this.config.feedRate * 0.6);
    
    // Trochoidal path: offset inward by (radius - ae), then scallop edges
    const insetDist = radius - ae;
    const offsetContour = this.offsetContour(contour, -insetDist);
    
    for (const pt of offsetContour) {
      // Approximate trochoidal with small circular scallops
      const tooth = this._trochoidTooth(pt.x, pt.y, radius, ae);
      for (const tp of tooth) {
        this.addFeed(tp.x, tp.y, depth);
      }
    }
    
    this.addRapid(start.x, start.y, 10);
    return this.moves;
  }
  
  _trochoidTooth(x, y, radius, ae) {
    // Generate tooth-path oscillation
    const teeth = [];
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const dx = ae * Math.cos(t * Math.PI * 2);
      teeth.push({ x: x + dx, y: y });
    }
    return teeth;
  }
}

/**
 * Side Milling: full-width slotting (for grooves, pockets)
 */
class SideMilling extends MillingStrategy {
  compute() {
    const depth = this.geometry.depth || this.config.maxDepth;
    const contour = this.geometry.contours[0];
    const passes = this.computeDepthPasses(depth);
    
    for (const z of passes) {
      for (let i = 0; i < contour.length - 1; i++) {
        const start = contour[i];
        const end = contour[i + 1];
        
        this.addRapid(start.x, start.y, 10);
        this.addPlunge(z);
        this.addFeed(end.x, end.y, z);
      }
    }
    
    return this.moves;
  }
}

/**
 * Widening Hole: enlarge existing hole with spiral or ramping
 */
class WideningHole extends MillingStrategy {
  compute() {
    const depth = this.geometry.depth || this.config.maxDepth;
    const holeX = this.geometry.holeCenter?.x || 0;
    const holeY = this.geometry.holeCenter?.y || 0;
    const startRadius = this.options.startRadius || 5;
    const endRadius = this.options.endRadius || 10;
    const passes = Math.ceil((endRadius - startRadius) / this.config.stepover);
    
    for (let pass = 0; pass < passes; pass++) {
      const radius = startRadius + (pass / passes) * (endRadius - startRadius);
      
      // Spiral at this radius
      this.addRapid(holeX + radius, holeY, 10);
      this.addPlunge(depth, this.config.feedRate * 0.7);
      
      let angle = 0;
      for (let i = 0; i < 4; i++) {
        const x = holeX + radius * Math.cos(angle);
        const y = holeY + radius * Math.sin(angle);
        this.addFeed(x, y, depth);
        angle += Math.PI / 2;
      }
    }
    
    return this.moves;
  }
}

/**
 * Pocket Finishing: alternating passes to leave smooth walls
 */
class PocketFinishing extends MillingStrategy {
  compute() {
    const depth = this.geometry.depth || this.config.maxDepth;
    const contour = this.geometry.contours[0];
    const passes = this.computeDepthPasses(depth);
    
    for (let passNum = 0; passNum < passes.length; passNum++) {
      const z = passes[passNum];
      const reversed = passNum % 2 === 1; // alternate direction for smoother finish
      const pts = reversed ? [...contour].reverse() : contour;
      
      const start = pts[0];
      this.addRapid(start.x, start.y, 10);
      this.addPlunge(z);
      
      for (const pt of pts) {
        this.addFeed(pt.x, pt.y, z);
      }
    }
    
    return this.moves;
  }
}

/**
 * Toolpath Optimizer: consolidate moves, compute feed rates, apply tool comp
 */
class ToolpathOptimizer {
  constructor(config) {
    this.config = config;
  }
  
  optimize(moves) {
    let optimized = [];
    
    for (const move of moves) {
      // Skip redundant moves
      if (optimized.length > 0) {
        const last = optimized[optimized.length - 1];
        if (last.x === move.x && last.y === move.y && last.z === move.z) {
          continue;
        }
      }
      
      optimized.push(move);
    }
    
    return optimized;
  }
}

/**
 * ISO Postprocessor: convert moves to Fanuc G-code
 */
class ISOPostprocessor {
  constructor(config, options = {}) {
    this.config = config;
    this.options = {
      lineNumbers: options.lineNumbers !== false,
      lineStep: options.lineStep || 10,
      toolNumber: options.toolNumber || 1,
      spindleSpeed: options.spindleSpeed || 800,
      ...options
    };
    this.code = [];
    this.lineNum = 0;
  }
  
  generate(moves) {
    this.code = [];
    this.lineNum = 0;
    
    this._header();
    
    let lastFeed = null;
    for (const move of moves) {
      if (move.type === 'rapid') {
        this._rapidTo(move.x, move.y, move.z);
        lastFeed = null;
      } else if (move.type === 'feed') {
        this._feedTo(move.x, move.y, move.z, move.feed, lastFeed);
        lastFeed = move.feed;
      } else if (move.type === 'arc') {
        this._arc(move, lastFeed);
        lastFeed = move.feed;
      } else if (move.type === 'dwell') {
        this._dwell(move.time);
      }
    }
    
    this._footer();
    
    return this.code.join('\n');
  }
  
  _header() {
    this.code.push('(CNC Studio Tool Path)');
    this.code.push(`(Tool: T${this.options.toolNumber} Spindle: ${this.options.spindleSpeed} RPM)`);
    this.code.push('G21 G40 G49');
    this.code.push(`T${this.options.toolNumber}`);
    this.code.push(`M03 S${this.options.spindleSpeed}`);
  }
  
  _line(content) {
    if (this.options.lineNumbers) {
      this.lineNum += this.options.lineStep;
      this.code.push(`N${this.lineNum} ${content}`);
    } else {
      this.code.push(content);
    }
  }
  
  _rapidTo(x, y, z) {
    this._line(`G00 X${x.toFixed(3)} Y${y.toFixed(3)} Z${z.toFixed(3)}`);
  }
  
  _feedTo(x, y, z, feed, lastFeed) {
    let line = `G01 X${x.toFixed(3)} Y${y.toFixed(3)} Z${z.toFixed(3)}`;
    if (feed !== lastFeed) {
      line += ` F${feed.toFixed(1)}`;
    }
    this._line(line);
  }
  
  _arc(move, lastFeed) {
    const dir = move.direction > 0 ? '03' : '02';
    let line = `G${dir} X${move.x.toFixed(3)} Y${move.y.toFixed(3)} Z${move.z.toFixed(3)}`;
    line += ` I${move.center.x.toFixed(3)} J${move.center.y.toFixed(3)}`;
    if (move.feed !== lastFeed) {
      line += ` F${move.feed.toFixed(1)}`;
    }
    this._line(line);
  }
  
  _dwell(seconds) {
    this._line(`G04 X${seconds.toFixed(2)}`);
  }
  
  _footer() {
    this.code.push('G00 Z10');
    this.code.push('M05');
    this.code.push('M30');
  }
}

// Node export (stripped by build.js on one line)
if(typeof module!=='undefined'&&module.exports){ module.exports={PathGenerator,MillingStrategy,LinearRampingStrategy,CircularRampingStrategy,PlungeMilling,PeckMilling,TrochoidalMilling,SideMilling,WideningHole,PocketFinishing,ToolpathOptimizer,ISOPostprocessor}; }
