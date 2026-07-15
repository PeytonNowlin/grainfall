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

// Fighter patrols the floor and lobs fire (it can die in its own flames — that's fine)
sim.clear();
for (var ffx = 0; ffx < 32; ffx++) sim.setCell(ffx, 21, MAT.WALL);
sim.setCell(16, 20, MAT.FIGHTER);
var fCols = {};
var firedShots = 0;
// Long window: lob chance is ~3%/frame, so short runs are RNG-flaky
for (var fn = 0; fn < 200; fn++) {
  sim.step();
  for (var fx3 = 0; fx3 < 32; fx3++) {
    if (sim.getCell(fx3, 20) === MAT.FIGHTER) fCols[fx3] = true;
  }
  if (sim.countMaterial(MAT.FIRE) > 0) firedShots++;
}
assertGt(Object.keys(fCols).length, 3, "fighter patrols the floor");
assertGt(firedShots, 0, "fighter lobs fire");

// --- Electricity ---
console.log("\n[electricity]");
assert(MAT.METAL != null && MAT.LIGHTNING != null, "metal & lightning defined");

// Lightning falls instead of rising like fire
sim.clear();
sim.setCell(10, 2, MAT.LIGHTNING);
for (var tf = 0; tf < 8; tf++) sim.step();
assertEqual(sim.getCell(10, 2), MAT.EMPTY, "lightning left the sky");
assertEqual(sim.countMaterial(MAT.FIRE), 0, "falling lightning does not become fire mid-air");
var boltY = -1;
for (var ty = 0; ty < 48; ty++) {
  if (sim.getCell(10, ty) === MAT.LIGHTNING) boltY = ty;
}
assert(
  boltY > 2 || sim.countMaterial(MAT.LIGHTNING) === 0,
  "lightning fell downward (or discharged on landing)"
);

// Lightning cracks / flash-melts ice on strike
sim.clear();
for (var tix = 8; tix <= 12; tix++)
  for (var tiy = 10; tiy <= 14; tiy++) sim.setCell(tix, tiy, MAT.ICE);
sim.setCell(10, 8, MAT.LIGHTNING);
var iceStruck = sim.countMaterial(MAT.ICE);
for (var tis = 0; tis < 12; tis++) sim.step();
var iceLeft = sim.countMaterial(MAT.ICE);
var meltOrShatter =
  iceStruck - iceLeft > 0 ||
  sim.countMaterial(MAT.WATER) > 0 ||
  sim.countMaterial(MAT.SNOW) > 0;
assert(meltOrShatter, "lightning strike damages ice (melt/shatter)");

// Lightning fuses sand into glass (fulgurites)
sim.clear();
for (var fsx = 8; fsx <= 14; fsx++)
  for (var fsy = 12; fsy <= 18; fsy++) sim.setCell(fsx, fsy, MAT.SAND);
sim.setCell(11, 10, MAT.LIGHTNING);
for (var fss = 0; fss < 16; fss++) sim.step();
assertGt(sim.countMaterial(MAT.GLASS), 0, "lightning fuses sand into glass (fulgurites)");

// Charge travels down a metal wire, then dissipates
sim.clear();
for (var mwx = 2; mwx <= 20; mwx++) sim.setCell(mwx, 10, MAT.METAL);
sim.setCell(1, 10, MAT.LIGHTNING);
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

// Solid metal pads must not stay electrified forever after a lightning strike
sim.clear();
for (var pmx = 8; pmx <= 16; pmx++)
  for (var pmy = 8; pmy <= 16; pmy++) sim.setCell(pmx, pmy, MAT.METAL);
sim.setCell(12, 6, MAT.LIGHTNING);
for (var pms = 0; pms < 80; pms++) sim.step();
var padCharged = false;
for (var pcx = 8; pcx <= 16; pcx++)
  for (var pcy = 8; pcy <= 16; pcy++)
    if (sim.getCharge(pcx, pcy) > 0) padCharged = true;
assert(!padCharged, "metal pad charge dissipates after lightning");

// Charge conducts through water too (airtight tank so the water can't slosh)
sim.clear();
for (var twx = 1; twx <= 21; twx++) {
  sim.setCell(twx, 9, MAT.WALL);
  sim.setCell(twx, 12, MAT.WALL);
}
for (var twy = 9; twy <= 12; twy++) {
  sim.setCell(1, twy, MAT.WALL);
  sim.setCell(21, twy, MAT.WALL);
}
for (var wwx = 2; wwx <= 20; wwx++)
  for (var wwy = 10; wwy <= 11; wwy++) sim.setCell(wwx, wwy, MAT.WATER);
sim.setCell(2, 9, MAT.METAL); // probe pokes through the ceiling
sim.setCell(2, 10, MAT.METAL);
sim.setCell(2, 8, MAT.LIGHTNING);
var reachedWater = false;
for (var el4 = 0; el4 < 40; el4++) {
  sim.step();
  if (sim.getCharge(19, 11) > 0) reachedWater = true;
}
assert(reachedWater, "charge conducts through water");

// Charged metal electrocutes an adjacent creature (ant fully boxed so it can't flee)
sim.clear();
sim.setCell(3, 10, MAT.WALL);
sim.setCell(4, 9, MAT.WALL);
sim.setCell(4, 11, MAT.WALL);
sim.setCell(5, 9, MAT.WALL);
sim.setCell(5, 11, MAT.WALL);
sim.setCell(5, 10, MAT.METAL);
sim.setCell(4, 10, MAT.ANT);
sim.setCell(6, 10, MAT.LIGHTNING);
for (var el5 = 0; el5 < 6; el5++) sim.step();
assertEqual(sim.countMaterial(MAT.ANT), 0, "charged metal electrocutes adjacent creature");

// --- Explosions break through solids ---
console.log("\n[explosions vs solids]");
sim.clear();
// Floor so unsupported ice does not collapse before the blast
for (var ifx = 8; ifx <= 16; ifx++) sim.setCell(ifx, 21, MAT.WALL);
for (var ibx = 8; ibx <= 16; ibx++)
  for (var iby = 15; iby <= 20; iby++) sim.setCell(ibx, iby, MAT.ICE);
for (var gcx = 10; gcx <= 14; gcx++) sim.setCell(gcx, 14, MAT.GUNPOWDER);
sim.setCell(12, 13, MAT.FIRE);
var iceBefore = sim.countMaterial(MAT.ICE);
for (var ex = 0; ex < 20; ex++) sim.step();
var iceAfter = sim.countMaterial(MAT.ICE);
assertGt(iceBefore - iceAfter, 10, "gunpowder blast shatters through an ice block");

// Burning napalm melts ice even without exploding (napalm pinned in a channel by ice + wall)
sim.clear();
for (var ncy = 10; ncy <= 18; ncy++) {
  sim.setCell(10, ncy, MAT.ICE);
  sim.setCell(11, ncy, MAT.NAPALM);
  sim.setCell(12, ncy, MAT.WALL);
}
for (var nfx = 10; nfx <= 12; nfx++) sim.setCell(nfx, 19, MAT.WALL); // floor
sim.setCell(11, 10, MAT.FIRE); // ignite the top of the column
var niceBefore = sim.countMaterial(MAT.ICE);
for (var nex = 0; nex < 40; nex++) sim.step();
assertGt(niceBefore - sim.countMaterial(MAT.ICE), 0, "burning napalm melts through ice");

// --- Physics feel: powders, liquids, explosions ---
console.log("\n[physics feel]");

// Helper: pour mat at (sx,sy) only when empty, then step, up to count grains.
function pour(simRef, sx, sy, mat, count, stepsBetween) {
  var placed = 0;
  var guard = 0;
  while (placed < count && guard < count * 40) {
    if (simRef.getCell(sx, sy) === MAT.EMPTY) {
      simRef.setCell(sx, sy, mat);
      placed++;
    }
    for (var pi = 0; pi < (stepsBetween || 3); pi++) simRef.step();
    guard++;
  }
  return placed;
}

// Sand dropped in a column forms a wide heap (not a 1-wide spire)
sim.clear();
for (var pfx = 0; pfx < 32; pfx++) sim.setCell(pfx, 23, MAT.WALL);
assertEqual(pour(sim, 16, 1, MAT.SAND, 40, 4), 40, "poured 40 sand");
for (var psettle = 0; psettle < 120; psettle++) sim.step();
var sandCols = {};
var sandCountHeap = sim.countMaterial(MAT.SAND);
for (var phy = 0; phy < 23; phy++) {
  for (var phx = 0; phx < 32; phx++) {
    if (sim.getCell(phx, phy) === MAT.SAND) sandCols[phx] = true;
  }
}
assertEqual(sandCountHeap, 40, "sand conserved while forming heap");
assertGt(Object.keys(sandCols).length, 3, "sand forms multi-column heap (not a thin spire)");

// Damp sand near water spreads less than dry sand poured the same way
sim.clear();
for (var dfx = 0; dfx < 32; dfx++) sim.setCell(dfx, 23, MAT.WALL);
// Water pool on the left half of the floor
for (var dwx = 0; dwx <= 16; dwx++) sim.setCell(dwx, 22, MAT.WATER);
assertEqual(pour(sim, 8, 5, MAT.SAND, 20, 3), 20, "poured damp sand");
for (var dsettle = 0; dsettle < 80; dsettle++) sim.step();
var dampMin = 32;
var dampMax = 0;
var dampGrains = 0;
for (var dy2 = 0; dy2 < 23; dy2++) {
  for (var dx2 = 0; dx2 < 32; dx2++) {
    if (sim.getCell(dx2, dy2) === MAT.SAND) {
      dampGrains++;
      if (dx2 < dampMin) dampMin = dx2;
      if (dx2 > dampMax) dampMax = dx2;
    }
  }
}
var dampSpan = dampMax - dampMin;
assertEqual(dampGrains, 20, "damp sand conserved");
// Dry control: same drop over dry floor
sim.clear();
for (var dryf = 0; dryf < 32; dryf++) sim.setCell(dryf, 23, MAT.WALL);
assertEqual(pour(sim, 8, 5, MAT.SAND, 20, 3), 20, "poured dry sand");
for (var drysettle = 0; drysettle < 80; drysettle++) sim.step();
var dryMin = 32;
var dryMax = 0;
for (var dryy = 0; dryy < 23; dryy++) {
  for (var dryx = 0; dryx < 32; dryx++) {
    if (sim.getCell(dryx, dryy) === MAT.SAND) {
      if (dryx < dryMin) dryMin = dryx;
      if (dryx > dryMax) dryMax = dryx;
    }
  }
}
var drySpan = dryMax - dryMin;
// Damp piles should not spread wider than dry; usually tighter
assert(dampSpan <= drySpan + 1, "damp sand does not spread farther than dry sand (damp=" + dampSpan + " dry=" + drySpan + ")");

// Oil floats on water after density sorting
sim.clear();
// Closed tank
for (var otx = 10; otx <= 20; otx++) {
  sim.setCell(otx, 18, MAT.WALL);
  sim.setCell(otx, 22, MAT.WALL);
}
sim.setCell(10, 19, MAT.WALL);
sim.setCell(10, 20, MAT.WALL);
sim.setCell(10, 21, MAT.WALL);
sim.setCell(20, 19, MAT.WALL);
sim.setCell(20, 20, MAT.WALL);
sim.setCell(20, 21, MAT.WALL);
// Oil under water (should bubble up)
for (var owx = 11; owx <= 19; owx++) {
  sim.setCell(owx, 21, MAT.OIL);
  sim.setCell(owx, 20, MAT.WATER);
  sim.setCell(owx, 19, MAT.WATER);
}
for (var os = 0; os < 100; os++) sim.step();
// Sample mid-tank: oil should prefer the top free row, water the bottom
var oilOnTop = 0;
var waterBelow = 0;
for (var olx = 12; olx <= 18; olx++) {
  if (sim.getCell(olx, 19) === MAT.OIL) oilOnTop++;
  if (sim.getCell(olx, 21) === MAT.WATER) waterBelow++;
}
assertGt(oilOnTop, 2, "oil rises to top layer over water");
assertGt(waterBelow, 2, "water settles under oil");

// Water poured into a wide floor pool levels out (wide span)
sim.clear();
for (var wfx = 0; wfx < 32; wfx++) sim.setCell(wfx, 23, MAT.WALL);
assertEqual(pour(sim, 16, 1, MAT.WATER, 30, 2), 30, "poured 30 water");
for (var wsettle = 0; wsettle < 150; wsettle++) sim.step();
var wMin = 32;
var wMax = 0;
var wCount = sim.countMaterial(MAT.WATER);
for (var wly = 0; wly < 23; wly++) {
  for (var wlx = 0; wlx < 32; wlx++) {
    if (sim.getCell(wlx, wly) === MAT.WATER) {
      if (wlx < wMin) wMin = wlx;
      if (wlx > wMax) wMax = wlx;
    }
  }
}
assertEqual(wCount, 30, "water conserved while leveling");
assertGt(wMax - wMin, 8, "water levels into a wide pool");

// Stone block + gunpowder: blast leaves sand debris (not only empty hole)
sim.clear();
for (var stx = 6; stx <= 18; stx++)
  for (var sty = 14; sty <= 20; sty++) sim.setCell(stx, sty, MAT.STONE);
var stoneBefore = sim.countMaterial(MAT.STONE);
for (var gpx = 10; gpx <= 14; gpx++) sim.setCell(gpx, 13, MAT.GUNPOWDER);
sim.setCell(12, 12, MAT.FIRE);
for (var bx = 0; bx < 25; bx++) sim.step();
var sandDebris = sim.countMaterial(MAT.SAND);
var stoneLeft = sim.countMaterial(MAT.STONE);
assertGt(sandDebris, 3, "blast leaves flingable sand debris");
assertGt(stoneBefore - stoneLeft, 5, "blast carves stone (crater)");

// Blast impulse flings debris outside the original stone block
sim.clear();
for (var b2x = 10; b2x <= 22; b2x++)
  for (var b2y = 12; b2y <= 20; b2y++) sim.setCell(b2x, b2y, MAT.STONE);
for (var g2x = 14; g2x <= 18; g2x++) sim.setCell(g2x, 11, MAT.GUNPOWDER);
sim.setCell(16, 10, MAT.FIRE);
for (var b2s = 0; b2s < 30; b2s++) sim.step();
var outsideDebris = 0;
for (var ody = 0; ody < 24; ody++) {
  for (var odx = 0; odx < 32; odx++) {
    var om = sim.getCell(odx, ody);
    if (om !== MAT.SAND && om !== MAT.SNOW) continue;
    if (odx < 10 || odx > 22 || ody < 12 || ody > 20) outsideDebris++;
  }
}
assertGt(outsideDebris, 0, "blast flings debris outside the original block");

// Splash: sand falling into a water pool kicks water sideways
sim.clear();
for (var sfx = 0; sfx < 32; sfx++) sim.setCell(sfx, 23, MAT.WALL);
// Narrow pool under the drop point
for (var spx = 12; spx <= 16; spx++) {
  sim.setCell(spx, 22, MAT.WATER);
  sim.setCell(spx, 21, MAT.WATER);
}
var waterBeforeSpan = 16 - 12;
// Drop sand into the pool
for (var spdrop = 0; spdrop < 12; spdrop++) {
  if (sim.getCell(14, 5) === MAT.EMPTY) sim.setCell(14, 5, MAT.SAND);
  for (var sps = 0; sps < 4; sps++) sim.step();
}
for (var spsettle = 0; spsettle < 40; spsettle++) sim.step();
var splashMin = 32;
var splashMax = 0;
var waterLeftSplash = 0;
for (var spy = 0; spy < 23; spy++) {
  for (var spx2 = 0; spx2 < 32; spx2++) {
    if (sim.getCell(spx2, spy) === MAT.WATER) {
      waterLeftSplash++;
      if (spx2 < splashMin) splashMin = spx2;
      if (spx2 > splashMax) splashMax = spx2;
    }
  }
}
assertGt(waterLeftSplash, 0, "splash preserves some water");
assertGt(splashMax - splashMin, waterBeforeSpan, "sand splash kicks water wider than original pool");

// Avalanche: a vertical sand tower collapses to a wider base
sim.clear();
for (var avx = 0; avx < 32; avx++) sim.setCell(avx, 23, MAT.WALL);
for (var avy = 8; avy <= 22; avy++) sim.setCell(16, avy, MAT.SAND);
for (var avs = 0; avs < 80; avs++) sim.step();
var avCols = {};
for (var avy2 = 0; avy2 < 23; avy2++) {
  for (var avx2 = 0; avx2 < 32; avx2++) {
    if (sim.getCell(avx2, avy2) === MAT.SAND) avCols[avx2] = true;
  }
}
assertEqual(sim.countMaterial(MAT.SAND), 15, "avalanche conserves sand");
assertGt(Object.keys(avCols).length, 3, "steep sand tower avalanches into a wider pile");

// Horizontal density sort: side-by-side oil|water stripes unmix
sim.clear();
for (var htx = 8; htx <= 23; htx++) {
  sim.setCell(htx, 18, MAT.WALL);
  sim.setCell(htx, 22, MAT.WALL);
}
for (var hty = 19; hty <= 21; hty++) {
  sim.setCell(8, hty, MAT.WALL);
  sim.setCell(23, hty, MAT.WALL);
}
// Alternating columns of oil and water (should sort: water down/right-ish, oil up)
for (var hcx = 9; hcx <= 22; hcx++) {
  for (var hcy = 19; hcy <= 21; hcy++) {
    sim.setCell(hcx, hcy, hcx % 2 === 0 ? MAT.OIL : MAT.WATER);
  }
}
for (var hs = 0; hs < 120; hs++) sim.step();
var oilTop = 0;
var waterBot = 0;
for (var hlx = 10; hlx <= 21; hlx++) {
  if (sim.getCell(hlx, 19) === MAT.OIL) oilTop++;
  if (sim.getCell(hlx, 21) === MAT.WATER) waterBot++;
}
assertGt(oilTop, 4, "horizontal sort lifts oil toward top row");
assertGt(waterBot, 4, "horizontal sort drops water toward bottom row");

// Wind can push steam through residual fire (air-displaceable)
sim.clear();
for (var wwx = 2; wwx <= 20; wwx++) {
  sim.setCell(wwx, 8, MAT.WALL);
  sim.setCell(wwx, 12, MAT.WALL);
}
sim.setCell(2, 9, MAT.WALL);
sim.setCell(2, 10, MAT.WALL);
sim.setCell(2, 11, MAT.WALL);
sim.setCell(20, 9, MAT.WALL);
sim.setCell(20, 10, MAT.WALL);
sim.setCell(20, 11, MAT.WALL);
// Fan on the left blowing east, steam at mid, fire corridor beyond
sim.setCell(3, 10, MAT.FAN, 1); // life 1 = east
sim.setCell(6, 10, MAT.STEAM);
sim.setCell(7, 10, MAT.FIRE);
sim.setCell(8, 10, MAT.FIRE);
sim.setCell(9, 10, MAT.FIRE);
var steamReached = false;
for (var wfs = 0; wfs < 80; wfs++) {
  sim.step();
  for (var wrx = 10; wrx <= 18; wrx++) {
    if (sim.getCell(wrx, 10) === MAT.STEAM || sim.getCell(wrx, 9) === MAT.STEAM || sim.getCell(wrx, 11) === MAT.STEAM) {
      steamReached = true;
    }
  }
}
assert(steamReached, "wind pushes steam through fire corridor");

// --- Physics feel pass 3: pressure, falling solids, crush, bubbles ---
console.log("\n[physics feel 3]");

// Unsupported ice falls (stone does not — terrain)
sim.clear();
sim.setCell(10, 5, MAT.ICE);
sim.setCell(20, 5, MAT.STONE);
for (var fs = 0; fs < 20; fs++) sim.step();
assertEqual(sim.getCell(10, 5), MAT.EMPTY, "unsupported ice left its perch");
assertEqual(sim.countMaterial(MAT.ICE), 1, "ice conserved while falling");
var iceAtBottom = false;
for (var ib = 18; ib < 24; ib++) if (sim.getCell(10, ib) === MAT.ICE) iceAtBottom = true;
assert(iceAtBottom, "unsupported ice falls downward");
assertEqual(sim.getCell(20, 5), MAT.STONE, "stone stays put as terrain (does not fall)");

// Wood stays put as structure (you can build houses); glass still falls
sim.clear();
sim.setCell(8, 4, MAT.WOOD);
sim.setCell(12, 4, MAT.GLASS);
for (var fw = 0; fw < 25; fw++) sim.step();
assertEqual(sim.getCell(8, 4), MAT.WOOD, "wood stays put as buildable structure");
assertEqual(sim.getCell(12, 4), MAT.EMPTY, "unsupported glass falls");
assertEqual(sim.countMaterial(MAT.GLASS), 1, "glass conserved while falling");

// Sand crushes plant beneath it
sim.clear();
for (var cfx = 0; cfx < 32; cfx++) sim.setCell(cfx, 23, MAT.WALL);
sim.setCell(16, 22, MAT.PLANT);
sim.setCell(16, 20, MAT.SAND);
sim.setCell(16, 19, MAT.SAND);
sim.setCell(16, 18, MAT.SAND);
for (var cr = 0; cr < 40; cr++) sim.step();
assertEqual(sim.countMaterial(MAT.PLANT), 0, "sand crushes plant underneath");
assertGt(sim.countMaterial(MAT.SAND), 0, "sand remains after crushing plant");

// Steam bubbles up through oil (any liquid, not only water)
sim.clear();
for (var sbx = 5; sbx <= 15; sbx++) {
  sim.setCell(sbx, 8, MAT.WALL);
  sim.setCell(sbx, 18, MAT.WALL);
}
for (var sby = 9; sby <= 17; sby++) {
  sim.setCell(5, sby, MAT.WALL);
  sim.setCell(15, sby, MAT.WALL);
}
for (var soy = 12; soy <= 17; soy++)
  for (var sox = 6; sox <= 14; sox++) sim.setCell(sox, soy, MAT.OIL);
sim.setCell(10, 16, MAT.STEAM);
var steamTop = false;
for (var sbs = 0; sbs < 60; sbs++) {
  sim.step();
  for (var sty = 9; sty <= 12; sty++) {
    for (var stx = 6; stx <= 14; stx++) {
      if (sim.getCell(stx, sty) === MAT.STEAM) steamTop = true;
    }
  }
}
assert(steamTop, "steam bubbles up through oil");

// Deep water column under pressure spreads wider than a single drop stack would imply
sim.clear();
for (var p3x = 0; p3x < 32; p3x++) sim.setCell(p3x, 23, MAT.WALL);
// Tall sealed-ish pour: many water cells stacked then free to spread
for (var p3y = 5; p3y <= 22; p3y++) sim.setCell(16, p3y, MAT.WATER);
for (var p3s = 0; p3s < 100; p3s++) sim.step();
var p3min = 32;
var p3max = 0;
var p3count = 0;
for (var p3yy = 0; p3yy < 23; p3yy++) {
  for (var p3xx = 0; p3xx < 32; p3xx++) {
    if (sim.getCell(p3xx, p3yy) === MAT.WATER) {
      p3count++;
      if (p3xx < p3min) p3min = p3xx;
      if (p3xx > p3max) p3max = p3xx;
    }
  }
}
assertEqual(p3count, 18, "pressurized water conserved");
assertGt(p3max - p3min, 10, "liquid pressure helps a tall water column spread wide");

// --- Physics feel pass 4: ice slip, ceiling crawl, quench, mercury crush ---
console.log("\n[physics feel 4]");

// Sand slides farther on ice than on stone
sim.clear();
for (var i4x = 0; i4x < 32; i4x++) sim.setCell(i4x, 23, MAT.WALL);
for (var i4i = 4; i4i <= 28; i4i++) sim.setCell(i4i, 22, MAT.ICE);
// Drop a short stack of sand on the ice sheet
for (var i4d = 0; i4d < 12; i4d++) {
  if (sim.getCell(16, 10) === MAT.EMPTY) sim.setCell(16, 10, MAT.SAND);
  for (var i4s = 0; i4s < 3; i4s++) sim.step();
}
for (var i4settle = 0; i4settle < 100; i4settle++) sim.step();
var iceSandMin = 32;
var iceSandMax = 0;
var iceSandN = 0;
for (var i4y = 0; i4y < 23; i4y++) {
  for (var i4x2 = 0; i4x2 < 32; i4x2++) {
    if (sim.getCell(i4x2, i4y) === MAT.SAND) {
      iceSandN++;
      if (i4x2 < iceSandMin) iceSandMin = i4x2;
      if (i4x2 > iceSandMax) iceSandMax = i4x2;
    }
  }
}
var iceSpan = iceSandMax - iceSandMin;
// Control: same pour on stone floor
sim.clear();
for (var st4x = 0; st4x < 32; st4x++) {
  sim.setCell(st4x, 23, MAT.WALL);
  if (st4x >= 4 && st4x <= 28) sim.setCell(st4x, 22, MAT.STONE);
}
for (var st4d = 0; st4d < 12; st4d++) {
  if (sim.getCell(16, 10) === MAT.EMPTY) sim.setCell(16, 10, MAT.SAND);
  for (var st4s = 0; st4s < 3; st4s++) sim.step();
}
for (var st4settle = 0; st4settle < 100; st4settle++) sim.step();
var stoneSandMin = 32;
var stoneSandMax = 0;
for (var st4y = 0; st4y < 23; st4y++) {
  for (var st4x2 = 0; st4x2 < 32; st4x2++) {
    if (sim.getCell(st4x2, st4y) === MAT.SAND) {
      if (st4x2 < stoneSandMin) stoneSandMin = st4x2;
      if (st4x2 > stoneSandMax) stoneSandMax = st4x2;
    }
  }
}
var stoneSpan = stoneSandMax - stoneSandMin;
assertEqual(iceSandN, 12, "sand on ice conserved");
assertGt(iceSpan, stoneSpan, "sand slides farther on ice than on stone (ice=" + iceSpan + " stone=" + stoneSpan + ")");

// Gas crawls under a ceiling instead of staying in one pocket
sim.clear();
for (var g4x = 2; g4x <= 20; g4x++) {
  sim.setCell(g4x, 5, MAT.WALL); // ceiling
  sim.setCell(g4x, 12, MAT.WALL); // floor
}
sim.setCell(2, 6, MAT.WALL);
sim.setCell(2, 7, MAT.WALL);
sim.setCell(2, 8, MAT.WALL);
sim.setCell(2, 9, MAT.WALL);
sim.setCell(2, 10, MAT.WALL);
sim.setCell(2, 11, MAT.WALL);
sim.setCell(20, 6, MAT.WALL);
sim.setCell(20, 7, MAT.WALL);
sim.setCell(20, 8, MAT.WALL);
sim.setCell(20, 9, MAT.WALL);
sim.setCell(20, 10, MAT.WALL);
sim.setCell(20, 11, MAT.WALL);
// Pocket of gas under left side of ceiling
sim.setCell(4, 6, MAT.GAS);
sim.setCell(5, 6, MAT.GAS);
sim.setCell(4, 7, MAT.GAS);
var gasCols = {};
for (var g4s = 0; g4s < 80; g4s++) {
  sim.step();
  for (var g4x2 = 3; g4x2 <= 19; g4x2++) {
    if (sim.getCell(g4x2, 6) === MAT.GAS || sim.getCell(g4x2, 7) === MAT.GAS) gasCols[g4x2] = true;
  }
}
assertGt(Object.keys(gasCols).length, 3, "gas crawls along the ceiling across multiple columns");

// Fire submerged in water is quenched (steam or gone)
sim.clear();
for (var q4x = 5; q4x <= 15; q4x++) {
  for (var q4y = 10; q4y <= 16; q4y++) sim.setCell(q4x, q4y, MAT.WATER);
}
sim.setCell(10, 13, MAT.FIRE);
sim.setCell(10, 12, MAT.FIRE);
for (var q4s = 0; q4s < 25; q4s++) sim.step();
assertEqual(sim.countMaterial(MAT.FIRE), 0, "submerged fire is quenched");
assert(
  sim.countMaterial(MAT.STEAM) > 0 || sim.countMaterial(MAT.WATER) > 0,
  "quench leaves steam and/or water"
);

// Mercury crushes plant underneath
sim.clear();
for (var m4x = 0; m4x < 32; m4x++) sim.setCell(m4x, 23, MAT.WALL);
sim.setCell(16, 22, MAT.PLANT);
sim.setCell(16, 20, MAT.MERCURY);
for (var m4s = 0; m4s < 30; m4s++) sim.step();
assertEqual(sim.countMaterial(MAT.PLANT), 0, "mercury crushes plant underneath");
assertEqual(sim.countMaterial(MAT.MERCURY), 1, "mercury conserved after crush");

// Steam condenses on ice (ice supported so it does not fall away)
sim.clear();
sim.setCell(10, 12, MAT.WALL);
sim.setCell(10, 11, MAT.ICE);
sim.setCell(10, 10, MAT.STEAM); // steam under the ice ceiling
var condensed = false;
for (var c4s = 0; c4s < 40; c4s++) {
  sim.step();
  if (sim.countMaterial(MAT.WATER) > 0) condensed = true;
}
assert(condensed, "steam condenses into water on ice");

// --- paint API ---
console.log("\n[paint]");
sim.clear();
sim.paint(16, 12, MAT.SAND, 2);
assertGt(sim.countMaterial(MAT.SAND), 1, "paint places multiple cells with brush radius");
sim.paint(16, 12, MAT.EMPTY, 5);
assertEqual(sim.countMaterial(MAT.SAND), 0, "erase/paint empty clears cells");

// Overlap off: brush does not replace existing materials
sim.clear();
sim.setCell(10, 10, MAT.WALL);
sim.setCell(11, 10, MAT.WALL);
sim.paint(10, 10, MAT.SAND, 1, undefined, false);
assertEqual(sim.getCell(10, 10), MAT.WALL, "no-overlap paint leaves wall intact");
assertEqual(sim.getCell(11, 10), MAT.WALL, "no-overlap paint leaves nearby wall intact");
// Empty neighbor of the brush should still receive sand
assertEqual(sim.getCell(10, 9), MAT.SAND, "no-overlap paint still fills empty cells");
// Overlap on (default): replaces
sim.paint(10, 10, MAT.SAND, 0, undefined, true);
assertEqual(sim.getCell(10, 10), MAT.SAND, "overlap paint replaces wall with sand");
// Erase always overwrites even when allowOverlap is false
sim.setCell(10, 10, MAT.WALL);
sim.paint(10, 10, MAT.EMPTY, 0, undefined, false);
assertEqual(sim.getCell(10, 10), MAT.EMPTY, "erase clears cells even with overlap off");

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
