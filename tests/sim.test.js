/**
 * Unit tests for shipped Grainfall simulation.
 * Loads the real js/materials.js + js/sim.js (no reimplementation).
 * Run: node tests/sim.test.js
 */
"use strict";

var path = require("path");
var fs = require("fs");

var root = path.join(__dirname, "..");
var materialsPath = path.join(root, "js", "materials.js");
var simPath = path.join(root, "js", "sim.js");

// Load shipped sources into a sandbox global (same as browser globals)
var sandbox = globalThis;
// Ensure clean slate for globals the scripts attach
delete sandbox.Materials;
delete sandbox.GrainfallSim;

// materials.js / sim.js use window or globalThis and optionally module.exports
function loadScript(filePath) {
  var code = fs.readFileSync(filePath, "utf8");
  // Provide window for browser-like branch; keep module for CommonJS export path
  var window = sandbox;
  sandbox.window = sandbox;
  // eslint-disable-next-line no-eval
  eval(code);
}

loadScript(materialsPath);
loadScript(simPath);

var Materials = sandbox.Materials || require(materialsPath);
var Sim = sandbox.GrainfallSim || require(simPath);
var MAT = Materials.MAT;

var passed = 0;
var failed = 0;
var errors = [];

function assert(cond, msg) {
  if (!cond) {
    failed++;
    errors.push("FAIL: " + msg);
    console.log("  ✗ " + msg);
  } else {
    passed++;
    console.log("  ✓ " + msg);
  }
}

function assertEqual(a, b, msg) {
  assert(a === b, msg + " (got " + a + ", expected " + b + ")");
}

function assertGt(a, b, msg) {
  assert(a > b, msg + " (got " + a + " <= " + b + ")");
}

console.log("Grainfall unit tests");
console.log("=======================");

// --- Materials presence ---
console.log("\n[materials]");
assert(Materials && Materials.MAT, "Materials global/API exists");
assert(MAT.SAND != null && MAT.WATER != null && MAT.WALL != null, "core materials defined");
assert(MAT.LAVA != null && MAT.NAPALM != null, "lava and napalm are selectable materials");
assert(MAT.FIRE != null && MAT.OIL != null && MAT.PLANT != null && MAT.STEAM != null, "reaction materials defined");
assert(Materials.PALETTE.some(function (p) { return p.id === MAT.LAVA; }), "lava in palette");
assert(Materials.PALETTE.some(function (p) { return p.id === MAT.NAPALM; }), "napalm in palette");
assert(Materials.isFlammable(MAT.OIL) && Materials.isFlammable(MAT.PLANT) && Materials.isFlammable(MAT.NAPALM), "flammables flagged");
assert(Materials.isSolid(MAT.WALL), "wall is solid");
assert(Materials.isPowder(MAT.SAND), "sand is powder");
assert(Materials.isLiquid(MAT.WATER) && Materials.isLiquid(MAT.LAVA) && Materials.isLiquid(MAT.NAPALM), "liquids flagged");

// --- createSim API ---
console.log("\n[sim API]");
var sim = Sim.createSim(32, 24, { seed: 42 });
assert(sim.width === 32 && sim.height === 24, "createSim size");
assert(typeof sim.step === "function", "step exported");
assert(typeof sim.setCell === "function" && typeof sim.getCell === "function", "cell API");
assert(typeof sim.paint === "function" && typeof sim.clear === "function", "paint/clear API");
assert(sim.getCell(0, 0) === MAT.EMPTY, "starts empty");

// --- Sand falls ---
console.log("\n[sand gravity]");
sim.clear();
sim.setCell(10, 0, MAT.SAND);
for (var i = 0; i < 30; i++) sim.step();
assertEqual(sim.getCell(10, 0), MAT.EMPTY, "sand left top cell");
assertEqual(sim.getCell(10, 23), MAT.SAND, "sand at bottom after fall");

// --- Sand piles diagonally when blocked ---
console.log("\n[sand diagonal settle]");
sim.clear();
// Floor wall
for (var x = 0; x < 32; x++) sim.setCell(x, 23, MAT.WALL);
// Drop sand onto a single column blocked by wall — more sand than 1 cell
sim.setCell(16, 5, MAT.SAND);
sim.setCell(16, 4, MAT.SAND);
sim.setCell(16, 3, MAT.SAND);
sim.setCell(16, 2, MAT.SAND);
sim.setCell(16, 1, MAT.SAND);
for (var s = 0; s < 80; s++) sim.step();
// Cell above wall at 16 should have sand; diagonals should also hold sand (pile)
assertEqual(sim.getCell(16, 22), MAT.SAND, "sand piles on wall");
var diagCount =
  (sim.getCell(15, 22) === MAT.SAND ? 1 : 0) +
  (sim.getCell(17, 22) === MAT.SAND ? 1 : 0) +
  (sim.getCell(15, 21) === MAT.SAND ? 1 : 0) +
  (sim.getCell(17, 21) === MAT.SAND ? 1 : 0) +
  (sim.getCell(16, 21) === MAT.SAND ? 1 : 0);
assertGt(diagCount, 0, "sand settles into heap (diagonal/stack), not only single column void");
var sandTotal = sim.countMaterial(MAT.SAND);
assertEqual(sandTotal, 5, "all sand conserved while piling");

// --- Wall blocks fall-through ---
console.log("\n[wall blocks fall-through]");
sim.clear();
// Wide solid ledge so sand cannot slip past (tests true block, not single-pixel skirt)
for (var lx = 5; lx <= 11; lx++) sim.setCell(lx, 20, MAT.WALL);
sim.setCell(8, 10, MAT.SAND);
for (var w = 0; w < 40; w++) sim.step();
assertEqual(sim.getCell(8, 20), MAT.WALL, "wall remains");
assert(
  sim.getCell(8, 21) !== MAT.SAND &&
    sim.getCell(8, 22) !== MAT.SAND &&
    sim.getCell(8, 23) !== MAT.SAND,
  "sand did not fall through wall column below"
);
assertEqual(sim.getCell(8, 19), MAT.SAND, "sand rests on top of wall");

// --- Water falls and spreads ---
console.log("\n[water flow]");
sim.clear();
for (var fx = 0; fx < 32; fx++) sim.setCell(fx, 23, MAT.WALL);
sim.setCell(16, 5, MAT.WATER);
sim.setCell(16, 4, MAT.WATER);
sim.setCell(16, 3, MAT.WATER);
sim.setCell(16, 2, MAT.WATER);
sim.setCell(16, 1, MAT.WATER);
sim.setCell(16, 0, MAT.WATER);
for (var wf = 0; wf < 100; wf++) sim.step();
assertEqual(sim.getCell(16, 0), MAT.EMPTY, "water left top");
var waterCells = [];
for (var wy = 0; wy < 24; wy++) {
  for (var wx = 0; wx < 32; wx++) {
    if (sim.getCell(wx, wy) === MAT.WATER) waterCells.push([wx, wy]);
  }
}
assertGt(waterCells.length, 0, "water still present");
var xs = waterCells.map(function (c) { return c[0]; });
var minX = Math.min.apply(null, xs);
var maxX = Math.max.apply(null, xs);
assertGt(maxX - minX, 0, "water spreads sideways (span > 0)");
// Most water near floor
var nearFloor = waterCells.filter(function (c) { return c[1] >= 20; }).length;
assertGt(nearFloor, 0, "water falls toward floor");

// --- Lava burns flammable (oil) ---
console.log("\n[lava/fire burns flammable]");
sim.clear();
sim.setCell(10, 15, MAT.OIL);
sim.setCell(11, 15, MAT.LAVA);
var oilBefore = sim.countMaterial(MAT.OIL);
assertEqual(oilBefore, 1, "oil placed");
for (var b = 0; b < 30; b++) sim.step();
var oilAfter = sim.countMaterial(MAT.OIL);
var fireCount = sim.countMaterial(MAT.FIRE);
assert(oilAfter === 0 || fireCount > 0, "oil consumed or fire produced by lava adjacency");
// Stronger: plant + fire
sim.clear();
sim.setCell(5, 10, MAT.PLANT);
sim.setCell(6, 10, MAT.FIRE);
for (var bf = 0; bf < 20; bf++) sim.step();
assert(
  sim.getCell(5, 10) !== MAT.PLANT || sim.countMaterial(MAT.FIRE) > 0 || sim.countMaterial(MAT.PLANT) === 0,
  "fire interacts with plant (burn/consume)"
);
// Napalm has update rules (ignites near heat)
sim.clear();
sim.setCell(12, 12, MAT.NAPALM);
sim.setCell(13, 12, MAT.FIRE);
for (var n = 0; n < 25; n++) sim.step();
assert(
  sim.countMaterial(MAT.NAPALM) === 0 || sim.countMaterial(MAT.FIRE) >= 1,
  "napalm burns when near fire"
);

// --- Water vs fire / lava ---
console.log("\n[water vs heat]");
sim.clear();
sim.setCell(8, 10, MAT.WATER);
sim.setCell(9, 10, MAT.FIRE);
for (var e = 0; e < 15; e++) sim.step();
var steam1 = sim.countMaterial(MAT.STEAM);
var fireLeft = sim.countMaterial(MAT.FIRE);
var waterLeft = sim.countMaterial(MAT.WATER);
assert(
  steam1 > 0 || (fireLeft === 0 && waterLeft === 0) || fireLeft === 0,
  "water extinguishes fire and/or produces steam"
);

sim.clear();
sim.setCell(8, 10, MAT.WATER);
sim.setCell(9, 10, MAT.LAVA);
for (var el = 0; el < 20; el++) sim.step();
var steam2 = sim.countMaterial(MAT.STEAM);
var stone = sim.countMaterial(MAT.STONE);
var lavaLeft = sim.countMaterial(MAT.LAVA);
var waterLeft2 = sim.countMaterial(MAT.WATER);
assert(
  steam2 > 0 || stone > 0 || (lavaLeft === 0 && waterLeft2 === 0) || stone + steam2 > 0,
  "water + lava cools/steams (stone or steam)"
);

// --- Lava & napalm non-empty update (they move as liquids) ---
console.log("\n[lava & napalm motion rules]");
sim.clear();
sim.setCell(10, 0, MAT.LAVA);
for (var lv = 0; lv < 30; lv++) sim.step();
assertEqual(sim.getCell(10, 0), MAT.EMPTY, "lava falls from top");
assertEqual(sim.countMaterial(MAT.LAVA), 1, "lava conserved while falling");
var lavaAtBottom = false;
for (var lvx = 0; lvx < 32; lvx++) {
  if (sim.getCell(lvx, 23) === MAT.LAVA) lavaAtBottom = true;
}
assert(lavaAtBottom, "lava at bottom row after fall");

sim.clear();
sim.setCell(14, 0, MAT.NAPALM);
for (var np = 0; np < 30; np++) sim.step();
assertEqual(sim.getCell(14, 0), MAT.EMPTY, "napalm falls from top");
assertEqual(sim.countMaterial(MAT.NAPALM), 1, "napalm conserved");
// May rest at bottom or one cell sideways after liquid spread
var napalmAtBottom = false;
for (var nx = 0; nx < 32; nx++) {
  if (sim.getCell(nx, 23) === MAT.NAPALM) napalmAtBottom = true;
}
assert(napalmAtBottom, "napalm at bottom row after fall");

// --- New materials ---
console.log("\n[new materials]");
assert(
  MAT.GUNPOWDER != null && MAT.NITRO != null && MAT.ACID != null && MAT.ICE != null &&
    MAT.SNOW != null && MAT.WOOD != null && MAT.SEED != null && MAT.GAS != null &&
    MAT.GLASS != null && MAT.MERCURY != null && MAT.CLONE != null && MAT.TORCH != null &&
    MAT.VIRUS != null,
  "expanded material set defined"
);
assertGt(Materials.PALETTE.length, 20, "expanded palette");

// Gunpowder detonates near fire
sim.clear();
for (var gpx = 8; gpx <= 18; gpx++) sim.setCell(gpx, 21, MAT.WALL);
for (var gp = 10; gp < 16; gp++) sim.setCell(gp, 20, MAT.GUNPOWDER);
sim.setCell(16, 20, MAT.FIRE);
for (var gs = 0; gs < 30; gs++) sim.step();
assert(sim.countMaterial(MAT.GUNPOWDER) < 6, "gunpowder detonates near fire");

// Nitro explodes near fire
sim.clear();
for (var ntx = 8; ntx <= 18; ntx++) sim.setCell(ntx, 21, MAT.WALL);
for (var nt = 10; nt < 16; nt++) sim.setCell(nt, 20, MAT.NITRO);
sim.setCell(16, 20, MAT.FIRE);
for (var ns = 0; ns < 30; ns++) sim.step();
assert(sim.countMaterial(MAT.NITRO) < 6, "nitro detonates near fire");

// Acid dissolves stone
sim.clear();
sim.setCell(7, 19, MAT.WALL);
sim.setCell(14, 19, MAT.WALL);
sim.setCell(7, 20, MAT.WALL);
sim.setCell(14, 20, MAT.WALL);
for (var acx = 8; acx < 14; acx++) {
  sim.setCell(acx, 21, MAT.WALL);
  sim.setCell(acx, 20, MAT.STONE);
  sim.setCell(acx, 19, MAT.ACID);
}
for (var as = 0; as < 120; as++) sim.step();
assert(sim.countMaterial(MAT.STONE) < 6, "acid dissolves stone");

// Ice melts next to lava (sealed box so lava cannot flow away)
sim.clear();
for (var iw = 9; iw <= 12; iw++) sim.setCell(iw, 21, MAT.WALL);
sim.setCell(9, 20, MAT.WALL);
sim.setCell(12, 20, MAT.WALL);
sim.setCell(10, 20, MAT.ICE);
sim.setCell(11, 20, MAT.LAVA);
for (var is = 0; is < 40; is++) sim.step();
assertEqual(sim.countMaterial(MAT.ICE), 0, "ice melts next to lava");

// Clone learns touched material and replicates it
sim.clear();
sim.setCell(5, 12, MAT.CLONE);
sim.setCell(5, 11, MAT.SAND);
for (var cs = 0; cs < 100; cs++) sim.step();
assertGt(sim.countMaterial(MAT.SAND), 3, "clone replicates sand it touched");
assertEqual(sim.countMaterial(MAT.CLONE), 1, "clone block persists");

// Torch continuously emits fire
sim.clear();
sim.setCell(10, 20, MAT.TORCH);
for (var ts = 0; ts < 20; ts++) sim.step();
assertGt(sim.countMaterial(MAT.FIRE), 0, "torch emits fire");
assertEqual(sim.countMaterial(MAT.TORCH), 1, "torch persists");

// Mercury sinks below water
sim.clear();
for (var mfx = 9; mfx <= 11; mfx++) sim.setCell(mfx, 23, MAT.WALL);
for (var my = 20; my <= 22; my++) {
  sim.setCell(9, my, MAT.WALL);
  sim.setCell(11, my, MAT.WALL);
}
sim.setCell(10, 22, MAT.WATER);
sim.setCell(10, 21, MAT.MERCURY);
for (var ms = 0; ms < 40; ms++) sim.step();
assertEqual(sim.getCell(10, 22), MAT.MERCURY, "mercury sinks below water");

// Gas rises
sim.clear();
sim.setCell(10, 20, MAT.GAS);
for (var gss = 0; gss < 60; gss++) sim.step();
assertEqual(sim.countMaterial(MAT.GAS), 1, "gas conserved");
var gasHigh = false;
for (var gy = 0; gy <= 6; gy++) {
  for (var gxx = 0; gxx < 32; gxx++) {
    if (sim.getCell(gxx, gy) === MAT.GAS) gasHigh = true;
  }
}
assert(gasHigh, "gas rises toward the top");

// Seed sprouts into plant on water contact
sim.clear();
for (var sfx = 8; sfx <= 12; sfx++) sim.setCell(sfx, 21, MAT.WALL);
sim.setCell(8, 20, MAT.WALL);
sim.setCell(12, 20, MAT.WALL);
for (var swx = 9; swx <= 11; swx++) sim.setCell(swx, 20, MAT.WATER);
sim.setCell(10, 18, MAT.SEED);
for (var ss = 0; ss < 30; ss++) sim.step();
assertGt(sim.countMaterial(MAT.PLANT), 0, "seed sprouts into plant near water");

// --- Wind, fan & creatures ---
console.log("\n[wind & creatures]");
assert(MAT.FAN != null && MAT.ANT != null && MAT.BIRD != null && MAT.FIGHTER != null, "fan/ant/bird/fighter defined");

// Fan builds a wind field blowing east (life=1 → DIRS8[0] = east)
sim.clear();
sim.setCell(5, 12, MAT.FAN, 1);
for (var fw = 0; fw < 20; fw++) sim.step();
var wind = sim.wind;
var wc = (12 >> 2) * wind.w + (8 >> 2); // coarse cell east of fan
assertGt(wind.x[wc], 0.1, "fan blows wind eastward");

// Wind pushes steam sideways down a corridor
sim.clear();
for (var cwx = 4; cwx <= 28; cwx++) {
  sim.setCell(cwx, 11, MAT.WALL);
  sim.setCell(cwx, 13, MAT.WALL);
}
sim.setCell(5, 12, MAT.FAN, 1);
sim.setCell(10, 12, MAT.STEAM, 200);
for (var sw = 0; sw < 30; sw++) sim.step();
var steamX = -1;
for (var sx = 0; sx < 32; sx++) {
  if (sim.getCell(sx, 12) === MAT.STEAM) steamX = sx;
}
assertGt(steamX, 10, "wind pushes steam down the corridor");

// Ant walks along the floor
sim.clear();
for (var afx = 0; afx < 32; afx++) sim.setCell(afx, 21, MAT.WALL);
sim.setCell(16, 20, MAT.ANT);
var antCols = {};
for (var an = 0; an < 40; an++) {
  sim.step();
  for (var ax3 = 0; ax3 < 32; ax3++) {
    if (sim.getCell(ax3, 20) === MAT.ANT) antCols[ax3] = true;
  }
}
assertEqual(sim.countMaterial(MAT.ANT), 1, "ant survives");
assertGt(Object.keys(antCols).length, 3, "ant walks along the floor");

// Bird flies around
sim.clear();
sim.setCell(16, 12, MAT.BIRD);
var birdSpots = {};
for (var bn = 0; bn < 40; bn++) {
  sim.step();
  var snapB = sim.snapshot();
  for (var bi = 0; bi < snapB.length; bi++) {
    if (snapB[bi] === MAT.BIRD) birdSpots[bi] = true;
  }
}
assertEqual(sim.countMaterial(MAT.BIRD), 1, "bird survives");
assertGt(Object.keys(birdSpots).length, 3, "bird flies to multiple positions");

// Fighter patrols the floor
sim.clear();
for (var ffx = 0; ffx < 32; ffx++) sim.setCell(ffx, 21, MAT.WALL);
sim.setCell(16, 20, MAT.FIGHTER);
var fCols = {};
for (var fn = 0; fn < 40; fn++) {
  sim.step();
  for (var fx3 = 0; fx3 < 32; fx3++) {
    if (sim.getCell(fx3, 20) === MAT.FIGHTER) fCols[fx3] = true;
  }
}
assertEqual(sim.countMaterial(MAT.FIGHTER), 1, "fighter survives");
assertGt(Object.keys(fCols).length, 3, "fighter patrols the floor");

// --- Electricity ---
console.log("\n[electricity]");
assert(MAT.METAL != null && MAT.THUNDER != null, "metal & thunder defined");

// Charge travels down a metal wire, then dissipates
sim.clear();
for (var mwx = 2; mwx <= 20; mwx++) sim.setCell(mwx, 10, MAT.METAL);
sim.setCell(1, 10, MAT.THUNDER);
var reachedMetal = false;
for (var el2 = 0; el2 < 40; el2++) {
  sim.step();
  if (sim.getCharge(19, 10) > 0) reachedMetal = true;
}
assert(reachedMetal, "charge travels down a metal wire");
for (var el3 = 0; el3 < 60; el3++) sim.step();
var anyCharge = false;
for (var cq = 2; cq <= 20; cq++) if (sim.getCharge(cq, 10) > 0) anyCharge = true;
assert(!anyCharge, "charge dissipates (no perpetual current)");

// Charge conducts through water too
sim.clear();
for (var wwx = 2; wwx <= 20; wwx++) {
  sim.setCell(wwx, 10, MAT.WATER);
  sim.setCell(wwx, 11, MAT.WALL);
}
sim.setCell(1, 10, MAT.METAL);
sim.setCell(1, 11, MAT.WALL);
sim.setCell(1, 9, MAT.THUNDER);
var reachedWater = false;
for (var el4 = 0; el4 < 40; el4++) {
  sim.step();
  if (sim.getCharge(18, 10) > 0) reachedWater = true;
}
assert(reachedWater, "charge conducts through water");

// Charged metal electrocutes an adjacent creature
sim.clear();
for (var efx = 3; efx <= 6; efx++) sim.setCell(efx, 11, MAT.WALL);
sim.setCell(5, 10, MAT.METAL);
sim.setCell(4, 10, MAT.ANT);
sim.setCell(6, 10, MAT.THUNDER);
for (var el5 = 0; el5 < 6; el5++) sim.step();
assertEqual(sim.countMaterial(MAT.ANT), 0, "charged metal electrocutes adjacent creature");

// --- Explosions break through solids ---
console.log("\n[explosions vs solids]");
sim.clear();
for (var ibx = 8; ibx <= 16; ibx++)
  for (var iby = 15; iby <= 20; iby++) sim.setCell(ibx, iby, MAT.ICE);
for (var gcx = 10; gcx <= 14; gcx++) sim.setCell(gcx, 14, MAT.GUNPOWDER);
sim.setCell(12, 13, MAT.FIRE);
var iceBefore = sim.countMaterial(MAT.ICE);
for (var ex = 0; ex < 20; ex++) sim.step();
var iceAfter = sim.countMaterial(MAT.ICE);
assertGt(iceBefore - iceAfter, 10, "gunpowder blast shatters through an ice block");

// Burning napalm melts ice even without exploding
sim.clear();
for (var ncy = 10; ncy <= 18; ncy++) sim.setCell(10, ncy, MAT.ICE);
sim.setCell(11, 14, MAT.NAPALM);
sim.setCell(12, 14, MAT.FIRE);
var niceBefore = sim.countMaterial(MAT.ICE);
for (var nex = 0; nex < 40; nex++) sim.step();
assertGt(niceBefore - sim.countMaterial(MAT.ICE), 0, "burning napalm melts through ice");

// --- paint API ---
console.log("\n[paint]");
sim.clear();
sim.paint(16, 12, MAT.SAND, 2);
assertGt(sim.countMaterial(MAT.SAND), 1, "paint places multiple cells with brush radius");
sim.paint(16, 12, MAT.EMPTY, 5);
assertEqual(sim.countMaterial(MAT.SAND), 0, "erase/paint empty clears cells");

// --- Summary ---
console.log("\n=======================");
console.log("Passed: " + passed + "  Failed: " + failed);
if (failed > 0) {
  console.log("\nFailures:");
  errors.forEach(function (e) {
    console.log("  " + e);
  });
  process.exit(1);
}
console.log("All tests passed.");
process.exit(0);
