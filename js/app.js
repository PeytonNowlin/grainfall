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

  var canvas = document.getElementById("sim-canvas");
  var paletteEl = document.getElementById("palette");
  var brushEl = document.getElementById("brush-size");
  var brushLabel = document.getElementById("brush-label");
  var toolEl = document.getElementById("tools");
  var speedEl = document.getElementById("speed");
  var speedLabel = document.getElementById("speed-label");
  var clearBtn = document.getElementById("btn-clear");
  var pauseBtn = document.getElementById("btn-pause");
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

  // --- Palette UI ---
  function buildPalette() {
    paletteEl.innerHTML = "";
    M.PALETTE.forEach(function (item) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mat-btn" + (item.id === selected || (item.id === -1 && selected === MAT.EMPTY) ? " active" : "");
      btn.dataset.id = String(item.id);
      btn.title = item.name;
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
      btn.addEventListener("click", function () {
        selected = item.id === -1 ? MAT.EMPTY : item.id;
        Array.prototype.forEach.call(paletteEl.querySelectorAll(".mat-btn"), function (b) {
          b.classList.remove("active");
        });
        btn.classList.add("active");
      });
      paletteEl.appendChild(btn);
    });
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
  if (toolEl) {
    TOOLS.forEach(function (t) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tool-btn" + (t.id === tool ? " active" : "");
      btn.textContent = t.name;
      btn.dataset.tool = t.id;
      btn.addEventListener("click", function () {
        tool = t.id;
        Array.prototype.forEach.call(toolEl.querySelectorAll(".tool-btn"), function (b) {
          b.classList.toggle("active", b.dataset.tool === tool);
        });
      });
      toolEl.appendChild(btn);
    });
  }

  // --- Speed slider ---
  if (speedEl) {
    speedEl.min = "0";
    speedEl.max = String(SPEEDS.length - 1);
    speedEl.value = String(SPEEDS.indexOf(1));
    function syncSpeed() {
      speed = SPEEDS[parseInt(speedEl.value, 10) || 0];
      if (speedLabel) speedLabel.textContent = speed + "×";
    }
    speedEl.addEventListener("input", syncSpeed);
    syncSpeed();
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      sim.clear();
    });
  }

  if (pauseBtn) {
    pauseBtn.addEventListener("click", function () {
      paused = !paused;
      pauseBtn.textContent = paused ? "Resume" : "Pause";
      pauseBtn.setAttribute("aria-pressed", paused ? "true" : "false");
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
    sim.paint(x, y, currentMat(), brushSize, paintData());
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
    if (tool === "fill") {
      sim.fill(p.x, p.y, currentMat() === MAT.EMPTY ? -1 : currentMat());
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

  // Keyboard shortcuts 1-9
  window.addEventListener("keydown", function (e) {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (e.key === " ") {
      paused = !paused;
      if (pauseBtn) {
        pauseBtn.textContent = paused ? "Resume" : "Pause";
      }
      e.preventDefault();
    }
    if (e.key === "c" || e.key === "C") {
      sim.clear();
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
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
    ctx.lineWidth = Math.max(1, brushSize);
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
    ctx.restore();
  }

  // Ring showing brush position/size while hovering (not during a shape drag).
  function drawCursor() {
    if (!cursor || shape) return;
    var c = M.colorFor(currentMat() === MAT.EMPTY ? MAT.WALL : currentMat());
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cursor.x + 0.5, cursor.y + 0.5, brushSize + 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // --- Main loop ---
  function frame() {
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
    setTool: function (t) {
      tool = t;
      if (toolEl) {
        Array.prototype.forEach.call(toolEl.querySelectorAll(".tool-btn"), function (b) {
          b.classList.toggle("active", b.dataset.tool === tool);
        });
      }
    },
    get speed() {
      return speed;
    },
    GRID_W: GRID_W,
    GRID_H: GRID_H,
    canvas: canvas,
  };

  if (hintEl) {
    hintEl.textContent =
      "Drag paint · Right-drag erase · Shift+drag line · Scroll brush · ←/→ cycle materials · Space pause · C clear · 1–9 materials";
  }
})();
