/**
 * CNC Studio — Path Generator UI Integration
 * Wires the PathGenerator into the backplot app for v0.3 CAM-lite preview
 */

let pathGenPanel = null;
let currentPathgen = null;

function initPathgenUI() {
  // Create panel if it doesn't exist
  if (!pathGenPanel) {
    pathGenPanel = document.createElement('div');
    pathGenPanel.id = 'pathgen-panel';
    pathGenPanel.className = 'panel pathgen-panel';
    pathGenPanel.innerHTML = `
      <div class="panel-header">
        <h3>Path Generator (v0.3 Preview)</h3>
        <button id="pathgen-toggle" class="btn btn-sm">−</button>
      </div>
      <div class="panel-body" id="pathgen-body">
        <fieldset>
          <legend>Milling Strategy</legend>
          <select id="pathgen-strategy">
            <option value="linear-ramping">Linear Ramping</option>
            <option value="circular-ramping">Circular Ramping</option>
            <option value="plunge">Plunge Milling</option>
            <option value="peck">Peck Milling</option>
            <option value="trochoidal">Trochoidal</option>
            <option value="side-milling">Side Milling</option>
            <option value="widening-hole">Widening Hole</option>
            <option value="pocket-finishing">Pocket Finishing</option>
          </select>
        </fieldset>

        <fieldset>
          <legend>Tool & Feed</legend>
          <label>Tool Radius (mm):
            <input type="number" id="pathgen-radius" value="3" min="0.5" step="0.1">
          </label>
          <label>Feed Rate (mm/min):
            <input type="number" id="pathgen-feed" value="100" min="10" step="10">
          </label>
          <label>Rapid Rate (mm/min):
            <input type="number" id="pathgen-rapid" value="500" min="50" step="50">
          </label>
        </fieldset>

        <fieldset>
          <legend>Depth Strategy</legend>
          <label>Max Depth (mm):
            <input type="number" id="pathgen-maxdepth" value="-10" step="1">
          </label>
          <label>Depth Per Pass (mm):
            <input type="number" id="pathgen-depthpass" value="2" min="0.1" step="0.1">
          </label>
          <label>Stepover / AE (mm):
            <input type="number" id="pathgen-stepover" value="2" min="0.1" step="0.1">
          </label>
        </fieldset>

        <fieldset>
          <legend>Geometry Input</legend>
          <div id="pathgen-geom-status">No geometry loaded</div>
          <button id="pathgen-load-geom" class="btn">Load from Backplot</button>
          <textarea id="pathgen-geom-json" placeholder="Or paste JSON geometry..." rows="4"></textarea>
        </fieldset>

        <div class="pathgen-actions">
          <button id="pathgen-generate" class="btn btn-primary">Generate Toolpath</button>
          <button id="pathgen-export-iso" class="btn">Export ISO</button>
          <button id="pathgen-show-stats" class="btn">Show Stats</button>
        </div>

        <div id="pathgen-output" class="output hidden">
          <h4>G-Code Preview</h4>
          <pre id="pathgen-code"></pre>
        </div>

        <div id="pathgen-stats" class="stats hidden">
          <h4>Toolpath Statistics</h4>
          <table>
            <tr><td>Total Distance:</td><td id="stat-totdist">—</td></tr>
            <tr><td>Cut Distance:</td><td id="stat-cutdist">—</td></tr>
            <tr><td>Z Range:</td><td id="stat-zrange">—</td></tr>
            <tr><td>Feed Time:</td><td id="stat-feedtime">—</td></tr>
            <tr><td>Total Time:</td><td id="stat-totaltime">—</td></tr>
            <tr><td>Moves:</td><td id="stat-moves">—</td></tr>
          </table>
        </div>
      </div>
    `;

    const mainPanel = document.querySelector('.main-panel') || document.body;
    mainPanel.appendChild(pathGenPanel);

    // Bind events
    document.getElementById('pathgen-toggle').addEventListener('click', togglePathgenPanel);
    document.getElementById('pathgen-load-geom').addEventListener('click', loadGeomFromBackplot);
    document.getElementById('pathgen-generate').addEventListener('click', generateToolpath);
    document.getElementById('pathgen-export-iso').addEventListener('click', exportISO);
    document.getElementById('pathgen-show-stats').addEventListener('click', showStats);
  }
}

function togglePathgenPanel() {
  const body = document.getElementById('pathgen-body');
  const btn = document.getElementById('pathgen-toggle');
  if (body.style.display === 'none') {
    body.style.display = 'block';
    btn.textContent = '−';
  } else {
    body.style.display = 'none';
    btn.textContent = '+';
  }
}

function loadGeomFromBackplot() {
  // Extract geometry from current backplot scene
  // For now, create a synthetic example pocket
  const exampleGeom = {
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

  document.getElementById('pathgen-geom-json').value = JSON.stringify(exampleGeom, null, 2);
  document.getElementById('pathgen-geom-status').textContent = 'Example pocket geometry loaded (20×20 mm, 5mm deep)';
}

function getPathgenConfig() {
  return {
    toolRadius: parseFloat(document.getElementById('pathgen-radius').value),
    feedRate: parseFloat(document.getElementById('pathgen-feed').value),
    rapidRate: parseFloat(document.getElementById('pathgen-rapid').value),
    maxDepth: parseFloat(document.getElementById('pathgen-maxdepth').value),
    depthPerPass: parseFloat(document.getElementById('pathgen-depthpass').value),
    stepover: parseFloat(document.getElementById('pathgen-stepover').value)
  };
}

function getGeometry() {
  const jsonStr = document.getElementById('pathgen-geom-json').value.trim();
  if (!jsonStr) {
    alert('No geometry JSON. Click "Load from Backplot" first.');
    return null;
  }
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    alert('Invalid JSON: ' + e.message);
    return null;
  }
}

function generateToolpath() {
  try {
    const config = getPathgenConfig();
    const geom = getGeometry();
    if (!geom) return;

    const strategy = document.getElementById('pathgen-strategy').value;
    
    currentPathgen = new PathGenerator(config);
    currentPathgen.loadGeometry(geom);
    const moves = currentPathgen.generate(strategy);
    
    document.getElementById('pathgen-geom-status').textContent = `✓ Generated ${moves.length} moves using ${strategy}`;
    document.getElementById('pathgen-code').textContent = 'Ready to export. Click "Export ISO"';
    document.getElementById('pathgen-output').classList.remove('hidden');
  } catch (e) {
    alert('Error: ' + e.message);
    console.error(e);
  }
}

function exportISO() {
  if (!currentPathgen) {
    alert('Generate a toolpath first.');
    return;
  }
  try {
    const iso = currentPathgen.toISO({
      toolNumber: 1,
      spindleSpeed: 800,
      lineNumbers: true,
      lineStep: 5
    });
    document.getElementById('pathgen-code').textContent = iso;
    
    // Offer download
    const blob = new Blob([iso], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'toolpath.nc';
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Export error: ' + e.message);
  }
}

function showStats() {
  if (!currentPathgen) {
    alert('Generate a toolpath first.');
    return;
  }
  try {
    const stats = currentPathgen._computeStats();
    document.getElementById('stat-totdist').textContent = stats.totalDistance.toFixed(1) + ' mm';
    document.getElementById('stat-cutdist').textContent = stats.cutDistance.toFixed(1) + ' mm';
    document.getElementById('stat-zrange').textContent = stats.minZ.toFixed(2) + ' to ' + stats.maxZ.toFixed(2) + ' mm';
    document.getElementById('stat-feedtime').textContent = (stats.feedTime / 60).toFixed(2) + ' min';
    document.getElementById('stat-totaltime').textContent = (stats.totalTime / 60).toFixed(2) + ' min';
    document.getElementById('stat-moves').textContent = stats.moveCount;
    
    document.getElementById('pathgen-stats').classList.remove('hidden');
  } catch (e) {
    alert('Stats error: ' + e.message);
  }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPathgenUI);
} else {
  initPathgenUI();
}
