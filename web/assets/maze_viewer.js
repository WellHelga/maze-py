const COLORS = {
  wall: "#ffffff",
  floor: "#000000",
  frontier: "#ff00ff",
  path: "#ff0000",
};

const FRONTIER_FRAMES = 6;

class MazeTimeline {
  constructor(canvas, statusEl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.statusEl = statusEl;
    this.delay = 80;
    this.data = null;
    this.events = [];
    this.pointer = 0;
    this.playing = false;
    this.timer = null;
    this.width = 0;
    this.height = 0;
    this.cellSize = 8;
    this.cellSpacing = 4;
    this.offsetX = 0;
    this.offsetY = 0;
    this.mazePixelWidth = 0;
    this.mazePixelHeight = 0;
    this.start = [0, 0];
    this.target = [0, 0];
    this.playCallback = null;
    this.solverIndex = 0;
    this.turbo = false;
    this.timerType = "timeout";
    this.carvedCells = new Map();
    this.linkedEdges = new Map();
    this.exploredCells = new Map();
    this.exploredEdges = new Map();
    this.pathCells = new Map();
    this.pathEdges = new Map();
    this.solveStep = 0;
    // ddistance-based coloring
    this.distance = 0;
    this.distanceMap = new Map(); // Map cell key -> distance
    this.frontier = [];
  }

  setStatus(message) {
    if (this.statusEl) {
      this.statusEl.textContent = message;
    }
  }

  setDelay(ms) {
    this.delay = Number(ms);
  }

  toggleTurbo() {
    this.setTurbo(!this.turbo);
  }

  setTurbo(enabled) {
    const next = Boolean(enabled);
    if (this.turbo === next) return;
    const wasPlaying = this.playing;
    if (wasPlaying) {
      this._clearTimer();
    }
    this.turbo = next;
    this.setStatus(
      this.turbo ? "Turbo enabled (max speed)." : "Turbo disabled (respecting delay)."
    );
    if (wasPlaying) {
      this._scheduleNext();
    }
  }

  resetTimeline() {
    this._stopPlayback();
    this.resetState();
    this.setStatus("Timeline reset. Press Play to watch again.");
  }

  setPlaybackListener(callback) {
    this.playCallback = callback;
  }

  async load(path) {
    this.setStatus(`Loading ${path}...`);
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Unable to load animation JSON (${response.status})`);
    }
    this.data = await response.json();
    this.events = this.data.events ?? [];
    this.start = this.data.start ?? [0, 0];
    this.target = this.data.target ?? [0, 0];
    this.width = this.data.grid?.width ?? 0;
    this.height = this.data.grid?.height ?? 0;
    this.solverIndex = this.events.findIndex((evt) => evt.phase === "solve");
    if (this.solverIndex === -1) {
      this.solverIndex = this.events.length;
    }
    this._configureCanvas();
    this.resetState();
    this.setStatus(
      `Loaded ${this.events.length} events for a ${this.width}×${this.height} maze.`
    );
  }

  _configureCanvas() {
    const maxDimension = Math.max(this.width, this.height, 1);
    const base = Math.max(6, Math.floor(720 / maxDimension));
    this.cellSpacing = Math.max(2, Math.floor(base / 3));
    this.cellSize = Math.max(3, base - this.cellSpacing);
    this.mazePixelWidth =
      this.width * this.cellSize + (this.width + 1) * this.cellSpacing;
    this.mazePixelHeight =
      this.height * this.cellSize + (this.height + 1) * this.cellSpacing;
    this.canvas.width = Math.max(this.mazePixelWidth, 320);
    this.canvas.height = Math.max(this.mazePixelHeight, 320);
    this.offsetX = Math.floor((this.canvas.width - this.mazePixelWidth) / 2);
    this.offsetY = Math.floor((this.canvas.height - this.mazePixelHeight) / 2);
  }

  resetState() {
    if (!this.width || !this.height) return;
    this.pointer = 0;
    this.carvedCells = new Map();
    this.linkedEdges = new Map();
    this.exploredCells = new Map();
    this.exploredEdges = new Map();
    this.pathCells = new Map();
    this.pathEdges = new Map();
    this.solveStep = 0;
  // Reset distance-based coloring
    this.distance = 0;
    this.distanceMap.clear();
    this.frontier = [];
    this.draw();
  }

  togglePlayback() {
    if (!this.events.length) return;
    if (this.playing) {
      this._stopPlayback();
      return;
    }
    if (this.pointer >= this.events.length) {
      this.resetState();
    }
    this.playing = true;
    this._emitPlayback();
    this.setStatus("Playing animation…");
    this._loop();
  }

  _loop() {
    if (!this.playing) return;
    const frameBudget = this.turbo ? 12 : 1;
    let hasMore = true;
    for (let i = 0; i < frameBudget; i += 1) {
      const advanced = this._applyNextEvent();
      if (!advanced) {
        hasMore = false;
        break;
      }
    }
    this.draw();
    if (!hasMore) {
      this._stopPlayback();
      this.setStatus("Animation finished.");
      return;
    }
    this._scheduleNext();
  }

  _scheduleNext() {
    if (!this.playing) return;
    if (this.turbo) {
      this.timerType = "raf";
      this.timer = window.requestAnimationFrame(() => this._loop());
    } else {
      this.timerType = "timeout";
      this.timer = window.setTimeout(() => this._loop(), this.delay);
    }
  }

  _stopPlayback() {
    this.playing = false;
    this._clearTimer();
    this._emitPlayback();
  }

  _clearTimer() {
    if (!this.timer) return;
    if (this.timerType === "raf") {
      window.cancelAnimationFrame(this.timer);
    } else {
      window.clearTimeout(this.timer);
    }
    this.timer = null;
  }

  _emitPlayback() {
    if (typeof this.playCallback === "function") {
      this.playCallback(this.playing);
    }
  }

  _applyNextEvent() {
    if (this.pointer >= this.events.length) {
      return false;
    }
    const event = this.events[this.pointer++];
    this._applyEvent(event);
    return true;
  }

  _applyEvent(event) {
    if (event.phase === "generate") {
      if (event.event === "activate") {
        this._activateCell(event.cell);
      } else if (event.event === "link") {
        this._linkCells(event.parent, event.child);
      }
    } else if (event.phase === "solve") {
      if (event.event === "explore") {
        // Initialize frontier with start cell
        if (this.frontier.length === 0 && this.start) {
          const startKey = this._cellKey(this.start);
          this.distanceMap.set(startKey, 0);
          this.frontier = [this.start];
        }
        this._exploreCellWithDistance(event.cell, event.parent);
      } else if (event.event === "path" && Array.isArray(event.cells)) {
        this._recordPath(event.cells);
      }
    }
  }
  _exploreCellWithDistance(cell, parent) {
    if (!Array.isArray(cell)) return;
    
    const cellKey = this._cellKey(cell);
    
    // Calculate Manhattan distance from start
    let distance = 0;
    if (this.start) {
      distance = Math.abs(cell[0] - this.start[0]) + Math.abs(cell[1] - this.start[1]);
    }
    
    // Store the distance
    this.distanceMap.set(cellKey, distance);
    
    // Update the distance counter for color cycling
    if (distance > this.distance) {
      this.distance = distance;
    }
    
    const color = this._exploreColor(distance);
    
    // Store in explored cells
    this.exploredCells.set(cellKey, {
      coords: this._clone(cell),
      color,
    });
    
    // Store edge if there's a parent
    if (Array.isArray(parent)) {
      const edgeKey = this._edgeKey(cell, parent);
      this.exploredEdges.set(edgeKey, {
        from: this._clone(cell),
        to: this._clone(parent),
        color,
      });
    }
  }

  jumpToSolve() {
    if (!this.events.length) return;
    this._stopPlayback();
    this.resetState();
    for (let i = 0; i < this.solverIndex; i += 1) {
      this._applyEvent(this.events[i]);
    }
    this.pointer = this.solverIndex;
    this.draw();
    this.setStatus("Skipped to solver phase.");
  }

  draw() {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.floor;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    this._drawBaseEdges();
    this._drawBaseCells();
    this._drawExploration();
    this._drawPath();
    this._drawMarker(this.start, "#00ffa3");
    this._drawMarker(this.target, "#f87171");
    ctx.restore();
  }

  _drawBaseCells() {
    for (const cell of this.carvedCells.values()) {
      const color = cell.highlight > 0 ? COLORS.frontier : COLORS.wall;
      this._fillCell(cell.coords, color);
      if (cell.highlight > 0) {
        cell.highlight -= 1;
      }
    }
  }

  _drawBaseEdges() {
    for (const edge of this.linkedEdges.values()) {
      const color = edge.highlight > 0 ? COLORS.frontier : COLORS.wall;
      this._drawEdge(edge.from, edge.to, color);
      if (edge.highlight > 0) {
        edge.highlight -= 1;
      }
    }
  }

  _drawExploration() {
    for (const edge of this.exploredEdges.values()) {
      this._drawEdge(edge.from, edge.to, edge.color);
    }
    for (const cell of this.exploredCells.values()) {
      this._fillCell(cell.coords, cell.color);
    }
  }

  _drawPath() {
    for (const edge of this.pathEdges.values()) {
      this._drawEdge(edge.from, edge.to, COLORS.path);
    }
    for (const cell of this.pathCells.values()) {
      this._fillCell(cell.coords, COLORS.path);
    }
  }

  _fillCell(coords, color) {
    if (!coords) return;
    const [x, y] = coords;
    const px = x * this.cellSize + (x + 1) * this.cellSpacing;
    const py = y * this.cellSize + (y + 1) * this.cellSpacing;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(px, py, this.cellSize, this.cellSize);
  }

  _drawEdge(from, to, color) {
    if (!from || !to) return;
    const ctx = this.ctx;
    ctx.fillStyle = color;
    if (from[0] === to[0]) {
      const x = from[0];
      const y = Math.min(from[1], to[1]);
      const px = x * this.cellSize + (x + 1) * this.cellSpacing;
      const py = (y + 1) * (this.cellSize + this.cellSpacing);
      ctx.fillRect(px, py, this.cellSize, this.cellSpacing);
    } else if (from[1] === to[1]) {
      const y = from[1];
      const x = Math.min(from[0], to[0]);
      const px = (x + 1) * (this.cellSize + this.cellSpacing);
      const py = y * this.cellSize + (y + 1) * this.cellSpacing;
      ctx.fillRect(px, py, this.cellSpacing, this.cellSize);
    }
  }

  _drawMarker(coords, color) {
    if (!coords) return;
    const [cx, cy] = this._cellCenter(coords);
    const radius = Math.max(3, this.cellSize / 2.5);
    this.ctx.beginPath();
    this.ctx.fillStyle = color;
    this.ctx.strokeStyle = "#050608";
    this.ctx.lineWidth = 1;
    this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.stroke();
  }

  _cellCenter(coords) {
    const [x, y] = coords;
    const px = x * this.cellSize + (x + 1) * this.cellSpacing + this.cellSize / 2;
    const py = y * this.cellSize + (y + 1) * this.cellSpacing + this.cellSize / 2;
    return [px, py];
  }

  _activateCell(coords) {
    if (!Array.isArray(coords)) return;
    const key = this._cellKey(coords);
    const entry = this.carvedCells.get(key);
    if (entry) {
      entry.highlight = FRONTIER_FRAMES;
    } else {
      this.carvedCells.set(key, {
        coords: this._clone(coords),
        highlight: FRONTIER_FRAMES,
      });
    }
  }

  _linkCells(parent, child) {
    if (!Array.isArray(parent) || !Array.isArray(child)) return;
    const key = this._edgeKey(parent, child);
    this.linkedEdges.set(key, {
      from: this._clone(parent),
      to: this._clone(child),
      highlight: FRONTIER_FRAMES,
    });
    this._ensureCell(parent);
    this._ensureCell(child);
  }

  _exploreCell(cell, parent) {
    if (!Array.isArray(cell)) return;
    const key = this._cellKey(cell);
    const color = this._exploreColor(this.solveStep++);
    this.exploredCells.set(key, {
      coords: this._clone(cell),
      color,
    });
    if (Array.isArray(parent)) {
      const edgeKey = this._edgeKey(cell, parent);
      this.exploredEdges.set(edgeKey, {
        from: this._clone(cell),
        to: this._clone(parent),
        color,
      });
    }
  }

  _recordPath(cells) {
    this.pathCells = new Map();
    this.pathEdges = new Map();
    if (!Array.isArray(cells)) return;
    for (let i = 0; i < cells.length; i += 1) {
      const coords = this._clone(cells[i]);
      const key = this._cellKey(coords);
      this.pathCells.set(key, { coords });
      if (i > 0) {
        const prev = this._clone(cells[i - 1]);
        const edgeKey = `${this._edgeKey(prev, coords)}:${i}`;
        this.pathEdges.set(edgeKey, {
          from: prev,
          to: coords,
        });
      }
    }
  }

  _ensureCell(coords) {
    const key = this._cellKey(coords);
    const entry = this.carvedCells.get(key);
    if (entry) {
      entry.highlight = Math.max(entry.highlight, FRONTIER_FRAMES);
    } else {
      this.carvedCells.set(key, {
        coords: this._clone(coords),
        highlight: FRONTIER_FRAMES,
      });
    }
  }

  _exploreColor(distance) {
    // Hue encodes Manhattan distance (cycling through 360 degrees)
    // You can adjust the multiplier to control color change speed
    const hue = (distance * 10) % 360;
    
    // Fixed saturation and lightness for similar appearance to the example
    // You can adjust these values as needed
    const saturation = 1;      // 0-1
    const lightness = 0.5;     // 0-1
    
    return `hsl(${hue}, ${saturation * 100}%, ${lightness * 100}%)`;
  }

  _cellKey(coords) {
    return `${coords[0]},${coords[1]}`;
  }

  _edgeKey(a, b) {
    const [ax, ay] = a;
    const [bx, by] = b;
    if (ax < bx || (ax === bx && ay <= by)) {
      return `${ax},${ay}-${bx},${by}`;
    }
    return `${bx},${by}-${ax},${ay}`;
  }

  _clone(coords) {
    return Array.isArray(coords) ? [coords[0], coords[1]] : null;
  }

  async exportGif() {
    // Check if library is loaded
    if (typeof GIF === 'undefined') {
      this.setStatus("Error: GIF.js not loaded. Add: <script src='https://unpkg.com/gif.js@0.2.0/dist/gif.js'></script>");
      return;
    }
    
    if (!this.events.length) {
      this.setStatus("No animation to export");
      return;
    }
    
    this._stopPlayback();
    this.resetState();
    this.setStatus("🔄 Preparing GIF export...");
    
    // Use a promise to handle async export
    return new Promise((resolve) => {
      try {
        // Create GIF instance with minimal config
        const gif = new GIF({
          workers: 8,
          quality: 10,
          width: this.canvas.width,
          height: this.canvas.height,
          // Let gif.js handle worker script automatically
          workerScript: 'gif.worker.js' // Will be loaded from same directory
        });
        
        let frameCount = 0;
        const totalFrames = this.events.length + 1;
        
        // Function to add frames
        const addFrames = () => {
          // Add initial frame
          gif.addFrame(this.ctx, { 
            copy: true, 
            delay: Math.max(this.delay, 50) 
          });
          frameCount++;
          this.setStatus(`📸 Frame ${frameCount}/${totalFrames}`);
          
          // Add event frames
          for (let i = 0; i < this.events.length; i++) {
            this._applyEvent(this.events[i]);
            this.draw();
            gif.addFrame(this.ctx, { 
              copy: true, 
              delay: Math.max(this.delay, 50) 
            });
            frameCount++;
            
            // Update status every 10 frames
            if (frameCount % 10 === 0) {
              this.setStatus(`📸 Frame ${frameCount}/${totalFrames}`);
            }
          }
          
          // Start rendering
          this.setStatus("⚙️ Encoding GIF...");
          gif.render();
        };
        
        // Handle finished GIF
        gif.on('finished', (blob) => {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          const filename = `maze-${this.width}x${this.height}-${Date.now()}.gif`;
          
          link.href = url;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          
          // Cleanup
          setTimeout(() => {
            URL.revokeObjectURL(url);
            this.setStatus(`✅ GIF exported: ${filename} (${(blob.size / 1024).toFixed(1)} KB)`);
            resolve();
          }, 100);
        });
        
        // Start adding frames
        addFrames();
        
      } catch (error) {
        this.setStatus(`❌ Error: ${error.message}`);
        console.error("GIF export failed:", error);
        resolve();
      }
    });
  }
}

const canvas = document.getElementById("mazeCanvas");
const statusEl = document.getElementById("status");
const viewer = new MazeTimeline(canvas, statusEl);
const dataInput = document.getElementById("dataPath");
const speedInput = document.getElementById("speedInput");
const speedValue = document.getElementById("speedValue");
const loadBtn = document.getElementById("loadBtn");
const playBtn = document.getElementById("playBtn");
const gifBtn = document.getElementById("gifBtn");
const jumpBtn = document.getElementById("jumpBtn");
const resetBtn = document.getElementById("resetBtn");
const turboBtn = document.getElementById("turboBtn");

const actionButtons = [playBtn, gifBtn, jumpBtn, resetBtn, turboBtn];
actionButtons.forEach((btn) => {
  btn.disabled = true;
});
speedValue.textContent = `${speedInput.value} ms`;

viewer.setPlaybackListener((isPlaying) => {
  playBtn.textContent = isPlaying ? "Pause" : "Play";
});

speedInput.addEventListener("input", (event) => {
  const value = event.target.value;
  viewer.setDelay(value);
  speedValue.textContent = `${value} ms`;
});

loadBtn.addEventListener("click", async () => {
  try {
    actionButtons.forEach((btn) => {
      btn.disabled = true;
    });
    await viewer.load(dataInput.value.trim());
    actionButtons.forEach((btn) => {
      btn.disabled = false;
    });
    viewer.setTurbo(false);
    turboBtn.textContent = "Turbo: Off";
    viewer.setStatus("Animation ready. Press Play to begin.");
  } catch (error) {
    viewer.setStatus(error.message);
  }
});

playBtn.addEventListener("click", () => viewer.togglePlayback());
jumpBtn.addEventListener("click", () => viewer.jumpToSolve());
resetBtn.addEventListener("click", () => viewer.resetTimeline());
turboBtn.addEventListener("click", () => {
  viewer.toggleTurbo();
  turboBtn.textContent = viewer.turbo ? "Turbo: On" : "Turbo: Off";
});
gifBtn.addEventListener("click", () => viewer.exportGif());

