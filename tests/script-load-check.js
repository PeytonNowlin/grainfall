/**
 * Browser-like script load check: evaluate each page-loaded script with
 * window defined and without relying on Node module for the happy path.
 * Captures result for verification.
 */
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var root = path.join(__dirname, "..");
var scripts = ["js/materials.js", "js/sim.js", "js/app.js"];
var log = [];

function logLine(s) {
  log.push(s);
  console.log(s);
}

logLine("Browser-like script load check");
logLine("==============================");

// Minimal browser environment
var canvasStore = {
  width: 480,
  height: 320,
  style: {},
  getContext: function () {
    return {
      imageSmoothingEnabled: true,
      createImageData: function (w, h) {
        return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
      },
      putImageData: function () {},
    };
  },
  getBoundingClientRect: function () {
    return { left: 0, top: 0, width: 480, height: 320 };
  },
  setPointerCapture: function () {},
  addEventListener: function () {},
};

var elements = {
  "sim-canvas": canvasStore,
  palette: {
    innerHTML: "",
    appendChild: function () {},
    querySelectorAll: function () {
      return [];
    },
  },
  "brush-size": {
    min: "",
    max: "",
    value: "3",
    addEventListener: function () {},
  },
  "brush-label": { textContent: "" },
  "btn-clear": { addEventListener: function () {} },
  "btn-pause": {
    addEventListener: function () {},
    textContent: "",
    setAttribute: function () {},
  },
  hint: { textContent: "" },
  stage: { clientWidth: 800, clientHeight: 500 },
};

var windowObj = {
  Materials: undefined,
  GrainfallSim: undefined,
  GrainfallApp: undefined,
  innerWidth: 1024,
  innerHeight: 768,
  addEventListener: function () {},
  requestAnimationFrame: function (cb) {
    return 0;
  },
  console: console,
};

// Circular: window.window = window
windowObj.window = windowObj;
windowObj.globalThis = windowObj;

var documentObj = {
  getElementById: function (id) {
    return elements[id] || null;
  },
  createElement: function (tag) {
    return {
      type: "",
      className: "",
      dataset: {},
      title: "",
      textContent: "",
      style: {},
      appendChild: function () {},
      addEventListener: function () {},
      setAttribute: function () {},
      classList: { add: function () {}, remove: function () {} },
    };
  },
};

windowObj.document = documentObj;

// Parent of canvas
canvasStore.parentElement = elements.stage;

var context = vm.createContext({
  window: windowObj,
  document: documentObj,
  console: console,
  Uint8Array: Uint8Array,
  Uint8ClampedArray: Uint8ClampedArray,
  Math: Math,
  Array: Array,
  parseInt: parseInt,
  requestAnimationFrame: windowObj.requestAnimationFrame,
  // Intentionally NO module / require for app path check
});

// materials and sim check both window and module; hide module for strict browser path
var failed = 0;

scripts.forEach(function (rel) {
  var filePath = path.join(root, rel);
  var code = fs.readFileSync(filePath, "utf8");
  try {
    // For materials/sim, they also assign module.exports if module exists.
    // Ensure module is undefined in this sandbox for browser-like path.
    vm.runInContext(
      "(function(){ var module = undefined; var exports = undefined; var require = undefined;\n" +
        code +
        "\n})();",
      context,
      { filename: rel }
    );
    logLine("OK load: " + rel);
  } catch (e) {
    failed++;
    logLine("FAIL load: " + rel + " — " + e.message);
    logLine(String(e.stack));
  }
});

// After materials + sim, app needs DOM; re-run order: we already ran all three in order
// But app runs inside IIFE and expects Materials on window
var Materials = context.window.Materials;
var Sim = context.window.GrainfallSim;
var App = context.window.GrainfallApp;

if (!Materials) {
  failed++;
  logLine("FAIL: window.Materials missing after load");
} else {
  logLine("OK: window.Materials present");
  logLine("  MAT.LAVA=" + Materials.MAT.LAVA + " MAT.NAPALM=" + Materials.MAT.NAPALM);
}

if (!Sim || typeof Sim.createSim !== "function") {
  failed++;
  logLine("FAIL: window.GrainfallSim.createSim missing");
} else {
  logLine("OK: window.GrainfallSim.createSim present");
  var s = Sim.createSim(8, 8);
  s.setCell(2, 0, Materials.MAT.SAND);
  s.step();
  logLine("OK: sim step runs under window global");
}

if (!App || !App.sim) {
  failed++;
  logLine("FAIL: window.GrainfallApp missing (UI entry hook)");
} else {
  logLine("OK: window.GrainfallApp entry hook present");
  logLine("  GRID=" + App.GRID_W + "x" + App.GRID_H);
  logLine("  canvas dims=" + App.canvas.width + "x" + App.canvas.height);
}

// Static HTML checks
var html = fs.readFileSync(path.join(root, "index.html"), "utf8");
function has(re, name) {
  if (re.test(html)) logLine("OK html: " + name);
  else {
    failed++;
    logLine("FAIL html: " + name);
  }
}
has(/id=["']sim-canvas["']/, "canvas#sim-canvas");
has(/id=["']palette["']/, "palette mount");
has(/id=["']brush-size["']/, "brush size control");
has(/id=["']btn-clear["']/, "clear button");
has(/<script\s+src=["']js\/materials\.js["']/, "plain script materials.js");
has(/<script\s+src=["']js\/sim\.js["']/, "plain script sim.js");
has(/<script\s+src=["']js\/app\.js["']/, "plain script app.js");
has(/stylesheet.*css\/style\.css/, "stylesheet linked");

// No type=module required for play
if (/<script[^>]+type=["']module["']/.test(html)) {
  failed++;
  logLine("FAIL: page uses type=module (file:// risk)");
} else {
  logLine("OK: no type=module scripts (file:// safe)");
}

logLine("==============================");
logLine(failed === 0 ? "Script-load check PASSED" : "Script-load check FAILED (" + failed + ")");
process.exit(failed === 0 ? 0 : 1);
