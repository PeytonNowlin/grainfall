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
var scripts = [
  "js/materials.js",
  "js/sim.js",
  "js/render/gl.js",
  "js/render/shaders.js",
  "js/render/effects.js",
  "js/render/renderer.js",
  "js/app.js",
];
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
  id: "sim-canvas",
  className: "",
  parentNode: null,
  cloneNode: function () {
    return {
      width: this.width,
      height: this.height,
      id: this.id,
      className: this.className,
      style: {},
      parentNode: this.parentNode,
      getContext: canvasStore.getContext,
      getBoundingClientRect: canvasStore.getBoundingClientRect,
      setPointerCapture: function () {},
      addEventListener: function () {},
      cloneNode: canvasStore.cloneNode,
    };
  },
  getContext: function (type) {
    if (type === "webgl2" || type === "webgl") return null;
    return {
      imageSmoothingEnabled: true,
      createImageData: function (w, h) {
        return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
      },
      putImageData: function () {},
      clearRect: function () {},
      save: function () {},
      restore: function () {},
      beginPath: function () {},
      moveTo: function () {},
      lineTo: function () {},
      rect: function () {},
      arc: function () {},
      stroke: function () {},
      fillRect: function () {},
      fillText: function () {},
      measureText: function () {
        return { width: 40 };
      },
      translate: function () {},
    };
  },
  getBoundingClientRect: function () {
    return { left: 0, top: 0, width: 480, height: 320 };
  },
  setPointerCapture: function () {},
  addEventListener: function () {},
};

var overlayStore = {
  width: 480,
  height: 320,
  style: {},
  getContext: function () {
    return canvasStore.getContext("2d");
  },
  getBoundingClientRect: canvasStore.getBoundingClientRect,
  setPointerCapture: function () {},
  addEventListener: function () {},
};

var stageStack = {
  style: {},
  clientWidth: 800,
  clientHeight: 500,
};

var elements = {
  "sim-canvas": canvasStore,
  "sim-overlay": overlayStore,
  "stage-stack": stageStack,
  "gfx-quality": {
    value: "high",
    addEventListener: function () {},
  },
  "gfx-status": {
    hidden: true,
    textContent: "",
  },
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
    classList: { toggle: function () {}, add: function () {}, remove: function () {} },
  },
  "btn-save": { addEventListener: function () {} },
  "btn-share": { addEventListener: function () {}, textContent: "Share" },
  tools: {
    appendChild: function () {},
    querySelectorAll: function () {
      return [];
    },
  },
  speed: { min: "", max: "", value: "2", addEventListener: function () {} },
  "speed-label": { textContent: "" },
  "brush-overlap": { checked: true, addEventListener: function () {} },
  "overlap-label": { textContent: "" },
  "selection-swatch": { style: {}, classList: { toggle: function () {} } },
  "selection-name": { textContent: "" },
  "selection-chip": { title: "" },
  hint: { textContent: "" },
  stats: { textContent: "", classList: { toggle: function () {} } },
  stage: { clientWidth: 800, clientHeight: 500 },
};

canvasStore.parentNode = {
  replaceChild: function (neu, old) {
    elements["sim-canvas"] = neu;
    neu.parentNode = this;
    neu.parentElement = elements.stage;
  },
};
canvasStore.parentElement = elements.stage;
stageStack.parentElement = elements.stage;

var windowObj = {
  Materials: undefined,
  GrainfallSim: undefined,
  GrainfallApp: undefined,
  GrainfallGL: undefined,
  GrainfallShaders: undefined,
  GrainfallEffects: undefined,
  GrainfallRenderer: undefined,
  innerWidth: 1024,
  innerHeight: 768,
  devicePixelRatio: 1,
  addEventListener: function () {},
  requestAnimationFrame: function () {
    return 0;
  },
  matchMedia: function () {
    return {
      matches: false,
      addEventListener: function () {},
      addListener: function () {},
    };
  },
  console: console,
};

windowObj.window = windowObj;
windowObj.globalThis = windowObj;

var documentObj = {
  body: { classList: { toggle: function () {} } },
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
      classList: { add: function () {}, remove: function () {}, toggle: function () {} },
    };
  },
};

windowObj.document = documentObj;

var context = vm.createContext({
  window: windowObj,
  document: documentObj,
  console: console,
  Uint8Array: Uint8Array,
  Uint8ClampedArray: Uint8ClampedArray,
  Float32Array: Float32Array,
  Math: Math,
  Array: Array,
  parseInt: parseInt,
  requestAnimationFrame: windowObj.requestAnimationFrame,
  HTMLCanvasElement: function () {},
});

var failed = 0;

scripts.forEach(function (rel) {
  var filePath = path.join(root, rel);
  var code = fs.readFileSync(filePath, "utf8");
  try {
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

var Materials = context.window.Materials;
var Sim = context.window.GrainfallSim;
var App = context.window.GrainfallApp;
var Renderer = context.window.GrainfallRenderer;

if (!Materials) {
  failed++;
  logLine("FAIL: window.Materials missing after load");
} else {
  logLine("OK: window.Materials present");
  logLine("  MAT.LAVA=" + Materials.MAT.LAVA + " MAT.NAPALM=" + Materials.MAT.NAPALM);
  if (typeof Materials.buildRenderTextures !== "function") {
    failed++;
    logLine("FAIL: Materials.buildRenderTextures missing");
  } else {
    logLine("OK: Materials.buildRenderTextures present");
  }
}

if (!Sim || typeof Sim.createSim !== "function") {
  failed++;
  logLine("FAIL: window.GrainfallSim.createSim missing");
} else {
  logLine("OK: window.GrainfallSim.createSim present");
  var s = Sim.createSim(8, 8);
  s.setCell(2, 0, Materials.MAT.SAND);
  s.step();
  if (typeof s.getRenderState !== "function" || typeof s.drainVisualEvents !== "function") {
    failed++;
    logLine("FAIL: sim missing getRenderState/drainVisualEvents");
  } else {
    logLine("OK: sim render-state API present");
  }
}

if (!Renderer || typeof Renderer.createRenderer !== "function") {
  failed++;
  logLine("FAIL: window.GrainfallRenderer missing");
} else {
  logLine("OK: window.GrainfallRenderer present");
}

if (!App || !App.sim) {
  failed++;
  logLine("FAIL: window.GrainfallApp missing (UI entry hook)");
} else {
  logLine("OK: window.GrainfallApp entry hook present");
  logLine("  GRID=" + App.GRID_W + "x" + App.GRID_H);
  logLine("  canvas dims=" + App.canvas.width + "x" + App.canvas.height);
  if (!App.renderer || !App.renderer.mode) {
    failed++;
    logLine("FAIL: GrainfallApp.renderer missing");
  } else {
    logLine("OK: renderer mode=" + App.renderer.mode);
    if (App.renderer.mode !== "canvas2d") {
      failed++;
      logLine("FAIL: expected canvas2d fallback in Node sandbox, got " + App.renderer.mode);
    }
  }
  if (!App.overlay) {
    failed++;
    logLine("FAIL: GrainfallApp.overlay missing");
  } else {
    logLine("OK: overlay canvas hooked");
  }
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
has(/id=["']sim-overlay["']/, "canvas#sim-overlay");
has(/id=["']gfx-quality["']/, "graphics quality control");
has(/id=["']palette["']/, "palette mount");
has(/id=["']brush-size["']/, "brush size control");
has(/id=["']btn-clear["']/, "clear button");
has(/<script\s+src=["']js\/materials\.js["']/, "plain script materials.js");
has(/<script\s+src=["']js\/sim\.js["']/, "plain script sim.js");
has(/<script\s+src=["']js\/render\/gl\.js["']/, "plain script render/gl.js");
has(/<script\s+src=["']js\/render\/shaders\.js["']/, "plain script render/shaders.js");
has(/<script\s+src=["']js\/render\/effects\.js["']/, "plain script render/effects.js");
has(/<script\s+src=["']js\/render\/renderer\.js["']/, "plain script render/renderer.js");
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
