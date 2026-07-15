/**
 * DOM layer: palette, brush, paint input, rAF render loop.
 * Depends on Materials + GrainfallSim globals from plain script tags.
 */
(function () {
  "use strict";

  var M = window.Materials;
  var Sim = window.GrainfallSim;
  if (!M || !Sim) {
    console.error("Grainfall: materials.js and sim.js must load first");
    return;
  }

  var MAT = M.MAT;

  // Logical grid size (pixels). Canvas is scaled via CSS for crisp look.
  var GRID_W = 480;
  var GRID_H = 320;
  var SCALE = 2; // CSS pixel scale factor applied via canvas size

  var sim = Sim.createSim(GRID_W, GRID_H);
  var selected = MAT.SAND;
  var brushSize = 3;
  var painting = false;
  var paused = false;
  var tool = "free"; // free | line | box | circle | fill
  var SPEEDS = [0.25, 0.5, 1, 2, 4];
  var speed = 1; // sim steps per animation frame (fractional < 1 skips frames)
  var stepAccum = 0;
  // When true (default), brush overwrites any cell. When false, only empty cells.
  var allowOverlap = true;

  // Restore last-used tool settings (best-effort; localStorage may be blocked on file://).
  var PREFS_KEY = "grainfall.prefs";
  try {
    var savedPrefs = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    if (typeof savedPrefs.selected === "number") selected = savedPrefs.selected;
    if (typeof savedPrefs.brushSize === "number") brushSize = Math.max(0, Math.min(12, savedPrefs.brushSize | 0));
    if (SPEEDS.indexOf(savedPrefs.speed) >= 0) speed = savedPrefs.speed;
    if (typeof savedPrefs.tool === "string") tool = savedPrefs.tool;
    if (typeof savedPrefs.allowOverlap === "boolean") allowOverlap = savedPrefs.allowOverlap;
  } catch (e) {}

  var canvas = document.getElementById("sim-canvas");
  var paletteEl = document.getElementById("palette");
  var brushEl = document.getElementById("brush-size");
  var brushLabel = document.getElementById("brush-label");
  var toolEl = document.getElementById("tools");
  var speedEl = document.getElementById("speed");
  var speedLabel = document.getElementById("speed-label");
  var overlapEl = document.getElementById("brush-overlap");
  var overlapLabel = document.getElementById("overlap-label");
  var clearBtn = document.getElementById("btn-clear");
  var pauseBtn = document.getElementById("btn-pause");
  var saveBtn = document.getElementById("btn-save");
  var hintEl = document.getElementById("hint");

  if (!canvas || !paletteEl) {
    console.error("Grainfall: missing #sim-canvas or #palette");
    return;
  }

  canvas.width = GRID_W;
  canvas.height = GRID_H;
  // Display size: fill available area while keeping aspect
  function sizeCanvas() {
    var wrap = canvas.parentElement;
    var maxW = wrap ? wrap.clientWidth : window.innerWidth;
    var maxH = wrap ? wrap.clientHeight : window.innerHeight - 120;
    var aspect = GRID_W / GRID_H;
    var w = maxW;
    var h = w / aspect;
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }
    canvas.style.width = Math.floor(w) + "px";
    canvas.style.height = Math.floor(h) + "px";
  }
  sizeCanvas();
  window.addEventListener("resize", sizeCanvas);

  var ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = false;
  var imageData = ctx.createImageData(GRID_W, GRID_H);
  var rgba = imageData.data;

  var selectionSwatch = document.getElementById("selection-swatch");
  var selectionName = document.getElementById("selection-name");

  function paletteEntryFor(id) {
    for (var i = 0; i < M.PALETTE.length; i++) {
      var p = M.PALETTE[i];
      if (p.id === id || (id === MAT.EMPTY && p.id === -1)) return p;
    }
    return null;
  }

  function syncSelectionChip() {
    var entry = paletteEntryFor(selected);
    var name = entry ? entry.name : "Material";
    var color = entry ? entry.color : "#e6c45c";
    if (selectionName) selectionName.textContent = name;
    if (selectionSwatch) {
      selectionSwatch.style.background = color;
      selectionSwatch.classList.toggle("swatch-erase", selected === MAT.EMPTY);
    }
    var chip = document.getElementById("selection-chip");
    if (chip) chip.title = "Current material: " + name;
  }

  // --- Palette UI ---
  function buildPalette() {
    paletteEl.innerHTML = "";
    M.PALETTE.forEach(function (item, index) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mat-btn" + (item.id === selected || (item.id === -1 && selected === MAT.EMPTY) ? " active" : "");
      btn.dataset.id = String(item.id);
      var hotkey = index < 9 ? String(index + 1) : "";
      btn.title = hotkey ? item.name + " (" + hotkey + ")" : item.name;
      btn.setAttribute("aria-label", item.name);

      var swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = item.color;
      if (item.id === -1) {
        swatch.classList.add("swatch-erase");
      }

      var label = document.createElement("span");
      label.className = "mat-label";
      label.textContent = item.name;

      btn.appendChild(swatch);
      btn.appendChild(label);
      if (hotkey) {
        var badge = document.createElement("span");
        badge.className = "key-badge";
        badge.textContent = hotkey;
        badge.setAttribute("aria-hidden", "true");
        btn.appendChild(badge);
      }
      btn.addEventListener("click", function () {
        selected = item.id === -1 ? MAT.EMPTY : item.id;
        Array.prototype.forEach.call(paletteEl.querySelectorAll(".mat-btn"), function (b) {
          b.classList.remove("active");
        });
        btn.classList.add("active");
        syncSelectionChip();
      });
      paletteEl.appendChild(btn);
    });
    syncSelectionChip();
  }
  buildPalette();

  if (brushEl) {
    brushEl.min = "0";
    brushEl.max = "12";
    brushEl.value = String(brushSize);
    function syncBrush() {
      brushSize = parseInt(brushEl.value, 10) || 0;
      if (brushLabel) brushLabel.textContent = String(brushSize + 1);
    }
    brushEl.addEventListener("input", syncBrush);
    syncBrush();
  }

  // --- Tool selector ---
  var TOOLS = [
    { id: "free", name: "Free" },
    { id: "line", name: "Line" },
    { id: "box", name: "Box" },
    { id: "circle", name: "Circle" },
    { id: "fill", name: "Fill" },
  ];
  function selectTool(id) {
    if (!TOOLS.some(function (t) { return t.id === id; })) return;
    tool = id;
    if (toolEl) {
      Array.prototype.forEach.call(toolEl.querySelectorAll(".tool-btn"), function (b) {
        b.classList.toggle("active", b.dataset.tool === tool);
      });
    }
  }
  // Letter hotkeys for tools: F/L/B/O/G.
  var TOOL_KEYS = { f: "free", l: "line", b: "box", o: "circle", g: "fill" };
  var TOOL_KEY_LABEL = { free: "F", line: "L", box: "B", circle: "O", fill: "G" };
  if (toolEl) {
    TOOLS.forEach(function (t) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tool-btn" + (t.id === tool ? " active" : "");
      btn.dataset.tool = t.id;
      btn.title = t.name + " (" + TOOL_KEY_LABEL[t.id] + ")";
      var nameSpan = document.createElement("span");
      nameSpan.className = "tool-name";
      nameSpan.textContent = t.name;
      var keySpan = document.createElement("span");
      keySpan.className = "key-badge tool-key";
      keySpan.textContent = TOOL_KEY_LABEL[t.id];
      keySpan.setAttribute("aria-hidden", "true");
      btn.appendChild(nameSpan);
      btn.appendChild(keySpan);
      btn.addEventListener("click", function () {
        selectTool(t.id);
      });
      toolEl.appendChild(btn);
    });
  }

  // --- Speed slider ---
  if (speedEl) {
    speedEl.min = "0";
    speedEl.max = String(SPEEDS.length - 1);
    speedEl.value = String(SPEEDS.indexOf(speed));
    function syncSpeed() {
      speed = SPEEDS[parseInt(speedEl.value, 10) || 0];
      if (speedLabel) speedLabel.textContent = speed + "×";
    }
    speedEl.addEventListener("input", syncSpeed);
    syncSpeed();
  }

  // --- Brush overlap toggle ---
  function syncOverlapUi() {
    if (overlapEl) overlapEl.checked = allowOverlap;
    if (overlapLabel) overlapLabel.textContent = allowOverlap ? "On" : "Off";
  }
  if (overlapEl) {
    overlapEl.checked = allowOverlap;
    overlapEl.addEventListener("change", function () {
      allowOverlap = !!overlapEl.checked;
      syncOverlapUi();
    });
    syncOverlapUi();
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      sim.clear();
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", function () {
      savePNG();
    });
  }

  function setPaused(next) {
    paused = !!next;
    if (pauseBtn) {
      pauseBtn.textContent = paused ? "Resume" : "Pause";
      pauseBtn.setAttribute("aria-pressed", paused ? "true" : "false");
      pauseBtn.classList.toggle("btn-paused", paused);
    }
    document.body.classList.toggle("is-paused", paused);
  }
  if (pauseBtn) {
    pauseBtn.addEventListener("click", function () {
      setPaused(!paused);
    });
  }

  // --- Pointer mapping ---
  function clientToGrid(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var x = ((clientX - rect.left) / rect.width) * GRID_W;
    var y = ((clientY - rect.top) / rect.height) * GRID_H;
    return {
      x: Math.max(0, Math.min(GRID_W - 1, x | 0)),
      y: Math.max(0, Math.min(GRID_H - 1, y | 0)),
    };
  }

  var lastPaint = null;
  var fanDir = 7; // 1..8 heading for painted fans; default blows up
  var shape = null; // active line/box/circle drag: {x0,y0,x1,y1,kind}
  var cursor = null; // {x,y} grid coords of pointer, for the brush-ring preview
  var erasing = false; // right-button drag paints EMPTY regardless of selection

  function currentMat() {
    return erasing ? MAT.EMPTY : selected;
  }

  function paintData() {
    return currentMat() === MAT.FAN ? fanDir : undefined;
  }

  function dab(x, y) {
    // Erase always overwrites; otherwise honor the Overlap setting.
    var mat = currentMat();
    var overlap = allowOverlap || mat === MAT.EMPTY || erasing;
    sim.paint(x, y, mat, brushSize, paintData(), overlap);
  }

  // Paint a straight line of brush dabs between two grid points.
  function strokeLine(x0, y0, x1, y1) {
    var dx = x1 - x0;
    var dy = y1 - y0;
    if (dx !== 0 || dy !== 0) {
      fanDir = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) & 7) + 1;
    }
    var steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (var s = 0; s <= steps; s++) {
      dab(x0 + Math.round((dx * s) / steps), y0 + Math.round((dy * s) / steps));
    }
  }

  function commitShape(sh) {
    if (sh.kind === "line") {
      strokeLine(sh.x0, sh.y0, sh.x1, sh.y1);
    } else if (sh.kind === "box") {
      strokeLine(sh.x0, sh.y0, sh.x1, sh.y0);
      strokeLine(sh.x1, sh.y0, sh.x1, sh.y1);
      strokeLine(sh.x1, sh.y1, sh.x0, sh.y1);
      strokeLine(sh.x0, sh.y1, sh.x0, sh.y0);
    } else if (sh.kind === "circle") {
      var r = Math.round(Math.hypot(sh.x1 - sh.x0, sh.y1 - sh.y0));
      var seg = Math.max(12, (2 * Math.PI * r) | 0);
      for (var i = 0; i < seg; i++) {
        var a = (i / seg) * Math.PI * 2;
        dab(sh.x0 + Math.round(Math.cos(a) * r), sh.y0 + Math.round(Math.sin(a) * r));
      }
    }
  }

  function paintAt(clientX, clientY) {
    var p = clientToGrid(clientX, clientY);
    if (lastPaint) strokeLine(lastPaint.x, lastPaint.y, p.x, p.y);
    else dab(p.x, p.y);
    lastPaint = p;
  }

  canvas.addEventListener("pointerdown", function (e) {
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    erasing = e.button === 2; // right button erases
    var p = clientToGrid(e.clientX, e.clientY);
    // Alt+click = eyedropper: adopt whatever material is under the cursor.
    if (e.altKey) {
      erasing = false;
      var picked = sim.getCell(p.x, p.y);
      if (picked !== MAT.EMPTY) {
        selected = picked;
        buildPalette();
      }
      return;
    }
    if (tool === "fill") {
      var fillMat = currentMat() === MAT.EMPTY ? -1 : currentMat();
      var fillOverlap = allowOverlap || fillMat === -1 || fillMat === MAT.EMPTY || erasing;
      sim.fill(p.x, p.y, fillMat, fillOverlap);
      return;
    }
    // Shift turns freehand into a straight line
    var kind = tool === "free" ? (e.shiftKey ? "line" : "free") : tool;
    if (kind === "free") {
      painting = true;
      lastPaint = null;
      paintAt(e.clientX, e.clientY);
    } else {
      shape = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, kind: kind };
    }
  });
  canvas.addEventListener("pointermove", function (e) {
    cursor = clientToGrid(e.clientX, e.clientY);
    if (painting) {
      paintAt(e.clientX, e.clientY);
      e.preventDefault();
    } else if (shape) {
      shape.x1 = cursor.x;
      shape.y1 = cursor.y;
      e.preventDefault();
    }
  });
  canvas.addEventListener("pointerleave", function () {
    cursor = null;
  });
  function endStroke() {
    painting = false;
    lastPaint = null;
    if (shape) {
      commitShape(shape);
      shape = null;
    }
    erasing = false;
  }
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", endStroke);
  canvas.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  // Touch-friendly: prevent page scroll while drawing
  canvas.style.touchAction = "none";

  // Scroll wheel adjusts brush size over canvas
  canvas.addEventListener(
    "wheel",
    function (e) {
      e.preventDefault();
      var delta = e.deltaY > 0 ? -1 : 1;
      brushSize = Math.max(0, Math.min(12, brushSize + delta));
      if (brushEl) brushEl.value = String(brushSize);
      if (brushLabel) brushLabel.textContent = String(brushSize + 1);
    },
    { passive: false }
  );

  // Persist tool settings on exit (best-effort).
  window.addEventListener("beforeunload", function () {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          selected: selected,
          brushSize: brushSize,
          speed: speed,
          tool: tool,
          allowOverlap: allowOverlap,
        })
      );
    } catch (e) {}
  });

  // Keyboard shortcuts 1-9
  window.addEventListener("keydown", function (e) {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (e.key === " ") {
      setPaused(!paused);
      e.preventDefault();
    }
    if (e.key === "c" || e.key === "C") {
      sim.clear();
    }
    if (e.key === "s" || e.key === "S") {
      savePNG();
      e.preventDefault();
    }
    if (TOOL_KEYS[e.key.toLowerCase()]) {
      selectTool(TOOL_KEYS[e.key.toLowerCase()]);
    }
    // Brush resize from the keyboard (the scroll-wheel resize needs a mouse).
    if (e.key === "[" || e.key === "]") {
      brushSize = Math.max(0, Math.min(12, brushSize + (e.key === "]" ? 1 : -1)));
      if (brushEl) brushEl.value = String(brushSize);
      if (brushLabel) brushLabel.textContent = String(brushSize + 1);
    }
    var num = parseInt(e.key, 10);
    if (num >= 1 && num <= 9) {
      var item = M.PALETTE[num - 1];
      if (item) {
        selected = item.id === -1 ? MAT.EMPTY : item.id;
        buildPalette();
      }
    }
    // Arrow keys step through the whole palette (most materials have no 1-9 hotkey).
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      var cur = selected === MAT.EMPTY ? -1 : selected;
      var idx = 0;
      for (var i = 0; i < M.PALETTE.length; i++) {
        if (M.PALETTE[i].id === cur) { idx = i; break; }
      }
      var dir = e.key === "ArrowRight" ? 1 : -1;
      idx = (idx + dir + M.PALETTE.length) % M.PALETTE.length;
      var next = M.PALETTE[idx];
      selected = next.id === -1 ? MAT.EMPTY : next.id;
      buildPalette();
      e.preventDefault();
    }
  });

  // Outline preview of the shape being dragged, drawn over the blitted grid.
  function drawPreview() {
    if (!shape) return;
    var c = M.colorFor(selected === MAT.EMPTY ? MAT.WALL : selected);
    var rgb = "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
    ctx.save();
    ctx.lineWidth = Math.max(1, brushSize);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    // Soft glow under the crisp stroke
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = rgb;
    ctx.shadowColor = rgb;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    if (shape.kind === "line") {
      ctx.moveTo(shape.x0 + 0.5, shape.y0 + 0.5);
      ctx.lineTo(shape.x1 + 0.5, shape.y1 + 0.5);
    } else if (shape.kind === "box") {
      ctx.rect(
        Math.min(shape.x0, shape.x1),
        Math.min(shape.y0, shape.y1),
        Math.abs(shape.x1 - shape.x0),
        Math.abs(shape.y1 - shape.y0)
      );
    } else if (shape.kind === "circle") {
      var r = Math.hypot(shape.x1 - shape.x0, shape.y1 - shape.y0);
      ctx.arc(shape.x0 + 0.5, shape.y0 + 0.5, r, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    ctx.restore();
  }

  // Ring showing brush position/size while hovering (not during a shape drag).
  function drawCursor() {
    if (!cursor || shape) return;
    var c = M.colorFor(currentMat() === MAT.EMPTY ? MAT.WALL : currentMat());
    var rgb = "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
    var rad = brushSize + 0.5;
    ctx.save();
    ctx.translate(cursor.x + 0.5, cursor.y + 0.5);
    // Outer glow
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = rgb;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, rad + 1, 0, Math.PI * 2);
    ctx.stroke();
    // Crisp ring
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, rad, 0, Math.PI * 2);
    ctx.stroke();
    // Center pixel hint
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = rgb;
    ctx.fillRect(-0.5, -0.5, 1, 1);
    ctx.restore();
  }

  // Download the current grid as a PNG. Re-blits first so overlays (cursor
  // ring, shape preview) are excluded from the saved image.
  function savePNG() {
    sim.renderTo(rgba);
    ctx.putImageData(imageData, 0, 0);
    var a = document.createElement("a");
    a.download = "grainfall-" + Date.now() + ".png";
    a.href = canvas.toDataURL("image/png");
    a.click();
  }

  // Dim the canvas and label it while paused, so a frozen sim reads as intentional.
  function drawPausedOverlay() {
    if (!paused) return;
    ctx.save();
    // Vignette-ish dim
    ctx.fillStyle = "rgba(8, 10, 16, 0.45)";
    ctx.fillRect(0, 0, GRID_W, GRID_H);
    // Pill behind the label
    var label = "PAUSED";
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var tw = ctx.measureText(label).width;
    var px = GRID_W / 2;
    var py = GRID_H / 2;
    var padX = 16;
    var padY = 10;
    ctx.fillStyle = "rgba(20, 24, 34, 0.82)";
    ctx.strokeStyle = "rgba(91, 141, 239, 0.45)";
    ctx.lineWidth = 1;
    var rw = tw + padX * 2;
    var rh = 22 + padY * 2;
    var rx = px - rw / 2;
    var ry = py - rh / 2;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(rx, ry, rw, rh, 8);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
    }
    ctx.fillStyle = "rgba(232, 236, 244, 0.95)";
    ctx.fillText(label, px, py);
    ctx.restore();
  }

  // FPS meter: sampled once per ~500ms so the readout doesn't flicker.
  var statsEl = document.getElementById("stats");
  var fpsFrames = 0;
  var fpsSince = 0;

  // --- Main loop ---
  function frame(now) {
    if (!paused) {
      // Hold the pointer still to keep pouring
      if (painting && lastPaint) dab(lastPaint.x, lastPaint.y);
      stepAccum += speed;
      var n = 0;
      while (stepAccum >= 1 && n < 8) {
        sim.step();
        stepAccum -= 1;
        n++;
      }
    }
    sim.renderTo(rgba);
    ctx.putImageData(imageData, 0, 0);
    drawPreview();
    drawCursor();
    drawPausedOverlay();
    if (statsEl && now) {
      fpsFrames++;
      if (!fpsSince) fpsSince = now;
      if (now - fpsSince >= 500) {
        var fps = Math.round((fpsFrames * 1000) / (now - fpsSince));
        statsEl.textContent = fps + " fps";
        statsEl.classList.toggle("stats-good", fps >= 50);
        statsEl.classList.toggle("stats-ok", fps >= 30 && fps < 50);
        statsEl.classList.toggle("stats-low", fps < 30);
        fpsFrames = 0;
        fpsSince = now;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Expose for browser verification / debugging
  window.GrainfallApp = {
    sim: sim,
    get selected() {
      return selected;
    },
    setSelected: function (id) {
      selected = id;
      buildPalette();
      syncSelectionChip();
    },
    get brushSize() {
      return brushSize;
    },
    setBrushSize: function (n) {
      brushSize = n;
      if (brushEl) brushEl.value = String(n);
    },
    paintAt: paintAt,
    clientToGrid: clientToGrid,
    get tool() {
      return tool;
    },
    setTool: selectTool,
    get speed() {
      return speed;
    },
    GRID_W: GRID_W,
    GRID_H: GRID_H,
    canvas: canvas,
  };

  if (hintEl) {
    hintEl.textContent =
      "Drag paint · Right-drag erase · Shift+drag line · Scroll brush · Alt+click pick material · [ ] brush size · ←/→ cycle materials · F/L/B/O/G tools · Space pause · C clear · S save PNG · 1–9 materials";
  }
})();
