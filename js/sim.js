/**
 * Pure falling-sand simulation grid.
 * No DOM — unit tests call createSim / step / setCell / getCell directly.
 *
 * Single grid + per-frame "moved" flags (classic falling-sand approach):
 * each cell acts at most once per step, so particles never clone or vanish.
 * Movement is density-driven; reactions are checked before motion.
 */
(function (root) {
  "use strict";

  var M = root.Materials;
  if (!M) {
    throw new Error("Materials must load before sim.js");
  }
  var MAT = M.MAT;

  // Relative density: heavier sinks below lighter. 255 = immovable solid.
  var DENSITY = new Uint8Array(32);
  DENSITY[MAT.STEAM] = 1;
  DENSITY[MAT.FIRE] = 2;
  DENSITY[MAT.GAS] = 3;
  DENSITY[MAT.SNOW] = 30;
  DENSITY[MAT.OIL] = 40;
  DENSITY[MAT.NAPALM] = 45;
  DENSITY[MAT.NITRO] = 46;
  DENSITY[MAT.WATER] = 50;
  DENSITY[MAT.ACID] = 52;
  DENSITY[MAT.SEED] = 60;
  DENSITY[MAT.VIRUS] = 70;
  DENSITY[MAT.LAVA] = 80;
  DENSITY[MAT.GUNPOWDER] = 85;
  DENSITY[MAT.SAND] = 90;
  DENSITY[MAT.MERCURY] = 200;
  DENSITY[MAT.WALL] = 255;
  DENSITY[MAT.STONE] = 255;
  DENSITY[MAT.PLANT] = 255;
  DENSITY[MAT.ICE] = 255;
  DENSITY[MAT.WOOD] = 255;
  DENSITY[MAT.GLASS] = 255;
  DENSITY[MAT.CLONE] = 255;
  DENSITY[MAT.TORCH] = 255;
  DENSITY[MAT.FAN] = 255;
  DENSITY[MAT.ANT] = 255;
  DENSITY[MAT.BIRD] = 255;
  DENSITY[MAT.FIGHTER] = 255;
  DENSITY[MAT.METAL] = 255;
  DENSITY[MAT.THUNDER] = 2;

  // Chance per frame that adjacent heat ignites the material (0 = not flammable).
  var IGNITE = new Float32Array(32);
  IGNITE[MAT.OIL] = 0.3;
  IGNITE[MAT.PLANT] = 0.25;
  IGNITE[MAT.NAPALM] = 0.9;
  IGNITE[MAT.WOOD] = 0.04;
  IGNITE[MAT.GUNPOWDER] = 1; // explosives pop on contact, like the classic
  IGNITE[MAT.NITRO] = 1;
  IGNITE[MAT.GAS] = 0.9;
  IGNITE[MAT.SEED] = 0.4;
  IGNITE[MAT.VIRUS] = 0.5;
  IGNITE[MAT.ANT] = 0.4;
  IGNITE[MAT.BIRD] = 0.4;
  IGNITE[MAT.FIGHTER] = 0.4;

  // Base flame lifetime when this fuel catches fire (napalm burns long and hot).
  var FUEL_LIFE = new Uint8Array(32);
  FUEL_LIFE[MAT.OIL] = 45;
  FUEL_LIFE[MAT.PLANT] = 35;
  FUEL_LIFE[MAT.NAPALM] = 120;
  FUEL_LIFE[MAT.WOOD] = 100;
  FUEL_LIFE[MAT.GAS] = 18;
  FUEL_LIFE[MAT.SEED] = 12;
  FUEL_LIFE[MAT.VIRUS] = 15;
  FUEL_LIFE[MAT.ANT] = 20;
  FUEL_LIFE[MAT.BIRD] = 20;
  FUEL_LIFE[MAT.FIGHTER] = 20;

  // Blast radius when ignited (0 = burns normally).
  var EXPLOSIVE = new Uint8Array(32);
  EXPLOSIVE[MAT.GUNPOWDER] = 4;
  EXPLOSIVE[MAT.NITRO] = 7;

  // Sideways flow distance per frame (lava is viscous, water is runny).
  var SPREAD = new Uint8Array(32);
  SPREAD[MAT.WATER] = 4;
  SPREAD[MAT.OIL] = 3;
  SPREAD[MAT.NAPALM] = 2;
  SPREAD[MAT.LAVA] = 1;
  SPREAD[MAT.ACID] = 3;
  SPREAD[MAT.MERCURY] = 2;
  SPREAD[MAT.NITRO] = 2;

  // Per-material shade variation for rendering (grainy look).
  var VARI = new Uint8Array(32);
  VARI[MAT.SAND] = 40;
  VARI[MAT.WALL] = 16;
  VARI[MAT.STONE] = 26;
  VARI[MAT.OIL] = 14;
  VARI[MAT.PLANT] = 36;
  VARI[MAT.NAPALM] = 24;
  VARI[MAT.GUNPOWDER] = 30;
  VARI[MAT.ICE] = 18;
  VARI[MAT.SNOW] = 12;
  VARI[MAT.WOOD] = 34;
  VARI[MAT.SEED] = 24;
  VARI[MAT.GLASS] = 12;
  VARI[MAT.CLONE] = 20;
  VARI[MAT.TORCH] = 40;
  VARI[MAT.NITRO] = 16;
  VARI[MAT.VIRUS] = 30;
  VARI[MAT.FAN] = 14;
  VARI[MAT.ANT] = 20;
  VARI[MAT.FIGHTER] = 16;
  VARI[MAT.METAL] = 18;

  // 8 directions, E clockwise to NE (y grows downward). Fan/bird headings.
  var DIRS8 = [
    [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
  ];

  // What ants can tunnel through.
  var DIGGABLE = {};
  DIGGABLE[MAT.SAND] = true;
  DIGGABLE[MAT.PLANT] = true;
  DIGGABLE[MAT.WOOD] = true;
  DIGGABLE[MAT.SNOW] = true;
  DIGGABLE[MAT.GUNPOWDER] = true;

  /**
   * @param {number} width
   * @param {number} height
   * @param {{seed?: number}} [opts]
   */
  function createSim(width, height, opts) {
    opts = opts || {};
    var w = width | 0;
    var h = height | 0;
    if (w < 1 || h < 1) throw new Error("Invalid sim size");

    var grid = new Uint8Array(w * h);
    /** Per-cell remaining lifetime for fire/steam (0 = none). */
    var life = new Uint8Array(w * h);
    /** Cells that already acted this frame. */
    var moved = new Uint8Array(w * h);
    /** Static per-cell shade noise for grainy rendering. */
    var noise = new Uint8Array(w * h);
    var rngState = (opts.seed != null ? opts.seed : 0x9e3779b9) >>> 0;
    var frame = 0;

    // Coarse wind velocity field (1 cell per 4x4 sim pixels).
    // Fans and explosions inject velocity; it diffuses and decays each frame.
    var wW = (w + 3) >> 2;
    var wH = (h + 3) >> 2;
    var windX = new Float32Array(wW * wH);
    var windY = new Float32Array(wW * wH);
    var windX2 = new Float32Array(wW * wH);
    var windY2 = new Float32Array(wW * wH);

    // Electricity: charge state rides in life[] on conductors (metal/water).
    // WireWorld-style: 0 neutral, 2 head (live), 1 tail (refractory).
    var chargeNext = new Uint8Array(w * h);
    var hasCharge = false;

    function rand() {
      // xorshift32
      rngState ^= rngState << 13;
      rngState ^= rngState >>> 17;
      rngState ^= rngState << 5;
      return (rngState >>> 0) / 4294967296;
    }

    function randBool() {
      return rand() < 0.5;
    }

    for (var ni = 0; ni < noise.length; ni++) {
      noise[ni] = (rand() * 256) | 0;
    }

    function idx(x, y) {
      return y * w + x;
    }

    function inBounds(x, y) {
      return x >= 0 && y >= 0 && x < w && y < h;
    }

    function cellAt(x, y) {
      if (!inBounds(x, y)) return MAT.WALL;
      return grid[idx(x, y)];
    }

    function getCell(x, y) {
      return cellAt(x, y);
    }

    function setCell(x, y, mat, lifeVal) {
      if (!inBounds(x, y)) return;
      var i = idx(x, y);
      grid[i] = mat & 0xff;
      if (lifeVal != null) {
        life[i] = lifeVal & 0xff;
      } else if (mat === MAT.FIRE) {
        life[i] = 30 + ((rand() * 30) | 0);
      } else if (mat === MAT.STEAM) {
        life[i] = 90 + ((rand() * 60) | 0);
      } else {
        life[i] = 0;
      }
    }

    function clear() {
      grid.fill(0);
      life.fill(0);
      windX.fill(0);
      windY.fill(0);
      hasCharge = false;
    }

    /** Diffuse (5-point blur) + decay the wind field. */
    function stepWind() {
      for (var cy = 0; cy < wH; cy++) {
        for (var cx = 0; cx < wW; cx++) {
          var c = cy * wW + cx;
          var l = cx > 0 ? c - 1 : c;
          var r = cx < wW - 1 ? c + 1 : c;
          var u = cy > 0 ? c - wW : c;
          var d = cy < wH - 1 ? c + wW : c;
          // center*4 + 4 neighbors, /8, ~0.93 decay; clamp against blast runaway
          var nx = (windX[c] * 4 + windX[l] + windX[r] + windX[u] + windX[d]) * 0.116;
          var ny = (windY[c] * 4 + windY[l] + windY[r] + windY[u] + windY[d]) * 0.116;
          windX2[c] = nx > 6 ? 6 : nx < -6 ? -6 : nx;
          windY2[c] = ny > 6 ? 6 : ny < -6 ? -6 : ny;
        }
      }
      var t = windX; windX = windX2; windX2 = t;
      t = windY; windY = windY2; windY2 = t;
    }

    /**
     * Push particle at (x,y) with the local wind. Returns true if it moved.
     * factor scales susceptibility (gases ~1, powders ~0.5, liquids ~0.3).
     */
    function windPush(x, y, factor) {
      var wi = (y >> 2) * wW + (x >> 2);
      var vx = windX[wi] * factor;
      var vy = windY[wi] * factor;
      var pushed = false;
      var ax = vx < 0 ? -vx : vx;
      var ay = vy < 0 ? -vy : vy;
      if (ax > 0.2 && rand() < ax) {
        pushed = tryMoveEmpty(x, y, x + (vx > 0 ? 1 : -1), y);
        if (pushed) x += vx > 0 ? 1 : -1;
      }
      if (ay > 0.2 && rand() < ay) {
        pushed = tryMoveEmpty(x, y, x, y + (vy > 0 ? 1 : -1)) || pushed;
      }
      return pushed;
    }

    function paint(cx, cy, mat, radius, lifeVal) {
      var r = Math.max(0, radius | 0);
      var r2 = r * r;
      var m = mat === -1 ? MAT.EMPTY : mat;
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r2) continue;
          setCell(cx + dx, cy + dy, m, lifeVal);
        }
      }
    }

    function swapCells(i, j) {
      var t = grid[i];
      grid[i] = grid[j];
      grid[j] = t;
      var tl = life[i];
      life[i] = life[j];
      life[j] = tl;
      moved[i] = 1;
      moved[j] = 1;
    }

    function become(i, mat, lifeVal) {
      grid[i] = mat;
      life[i] = lifeVal || 0;
      moved[i] = 1;
    }

    /** Move into empty space (or through gas) only. */
    function tryMoveEmpty(x, y, nx, ny) {
      if (!inBounds(nx, ny)) return false;
      var j = idx(nx, ny);
      if (grid[j] !== MAT.EMPTY) return false;
      swapCells(idx(x, y), j);
      return true;
    }

    /** Gravity move: into empty/gas always, through lighter liquid by density. */
    function trySink(x, y, nx, ny, prob) {
      if (!inBounds(nx, ny)) return false;
      var i = idx(x, y);
      var j = idx(nx, ny);
      var src = grid[i];
      var dst = grid[j];
      if (dst === MAT.EMPTY || M.isGas(dst)) {
        swapCells(i, j);
        return true;
      }
      if (M.isLiquid(dst) && DENSITY[src] > DENSITY[dst]) {
        if (prob == null || rand() < prob) {
          swapCells(i, j);
          return true;
        }
      }
      return false;
    }

    /** Fire/lava attempts to ignite (x,y). Returns true if it's fuel at all. */
    function tryIgnite(x, y) {
      var m = cellAt(x, y);
      if (!IGNITE[m]) return false;
      if (rand() < IGNITE[m]) {
        if (EXPLOSIVE[m]) {
          explode(x, y, EXPLOSIVE[m]);
        } else {
          become(idx(x, y), MAT.FIRE, FUEL_LIFE[m] + ((rand() * 40) | 0));
        }
      }
      return true;
    }

    /**
     * Detonation: fireball radius r. Inner half vaporizes (walls survive),
     * water flashes to steam, other explosives become fire and chain-detonate
     * next frame so blasts visibly propagate.
     */
    function explode(cx, cy, r) {
      var r2 = r * r;
      var core = r2 >> 1;
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          var d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          var x = cx + dx;
          var y = cy + dy;
          if (!inBounds(x, y)) continue;
          var j = idx(x, y);
          var m = grid[j];
          // Bedrock: only wall and clone survive a blast intact
          if (m === MAT.WALL || m === MAT.CLONE) continue;
          if (EXPLOSIVE[m] && d2 > 0) {
            become(j, MAT.FIRE, 30 + ((rand() * 20) | 0)); // chain detonation
          } else if (m === MAT.WATER) {
            become(j, MAT.STEAM, 60 + ((rand() * 40) | 0));
          } else if (m === MAT.MERCURY) {
            continue; // too heavy to vaporize
          } else if (d2 <= core) {
            // Inner core: everything is vaporized into fire, ice and all
            become(j, MAT.FIRE, 20 + ((rand() * 25) | 0));
          } else if (m === MAT.EMPTY || IGNITE[m]) {
            become(j, MAT.FIRE, 10 + ((rand() * 20) | 0));
          } else if (m === MAT.ICE || m === MAT.GLASS) {
            // Brittle: shatter, leaving a little debris for the shockwave to fling
            become(j, m === MAT.ICE && rand() < 0.3 ? MAT.SNOW : MAT.EMPTY, 0);
          } else if (m === MAT.STONE || m === MAT.SAND) {
            become(j, rand() < 0.5 ? MAT.SAND : MAT.EMPTY, 0);
          } else if (m !== MAT.METAL) {
            // Everything else in the outer ring is blown away
            become(j, MAT.EMPTY, 0);
          }
        }
      }
      // Shockwave: radial wind burst so debris gets thrown around
      var ccx = cx >> 2;
      var ccy = cy >> 2;
      var cr = (r >> 2) + 3;
      for (var wy = ccy - cr; wy <= ccy + cr; wy++) {
        for (var wx = ccx - cr; wx <= ccx + cr; wx++) {
          if (wx < 0 || wy < 0 || wx >= wW || wy >= wH) continue;
          var ex = wx - ccx;
          var ey = wy - ccy;
          var dist = Math.sqrt(ex * ex + ey * ey) || 1;
          var fall = 1 - dist / (cr + 1);
          if (fall <= 0) continue;
          var c = wy * wW + wx;
          windX[c] += (ex / dist) * 9 * fall;
          windY[c] += (ey / dist) * 9 * fall - 2 * fall; // slight upward bias
        }
      }
    }

    /** Water vs adjacent fire/lava. Returns true if it reacted. */
    function waterReact(x, y) {
      var i = idx(x, y);
      var dirs = [x, y + 1, x - 1, y, x + 1, y, x, y - 1];
      for (var d = 0; d < 8; d += 2) {
        var nx = dirs[d];
        var ny = dirs[d + 1];
        var m = cellAt(nx, ny);
        if (m === MAT.FIRE) {
          become(i, MAT.STEAM, 60 + ((rand() * 40) | 0));
          become(idx(nx, ny), MAT.EMPTY, 0);
          return true;
        }
        if (m === MAT.LAVA) {
          become(i, MAT.STEAM, 70 + ((rand() * 40) | 0));
          become(idx(nx, ny), MAT.STONE, 0);
          return true;
        }
      }
      return false;
    }

    /** Lava vs neighbors: cool on water, ignite fuel, spit sparks. */
    function lavaReact(x, y) {
      var i = idx(x, y);
      var dirs = [x, y + 1, x - 1, y, x + 1, y, x, y - 1];
      for (var d = 0; d < 8; d += 2) {
        var nx = dirs[d];
        var ny = dirs[d + 1];
        var m = cellAt(nx, ny);
        if (m === MAT.WATER) {
          become(idx(nx, ny), MAT.STEAM, 70 + ((rand() * 40) | 0));
          become(i, MAT.STONE, 0);
          return true;
        }
        if (IGNITE[m]) tryIgnite(nx, ny);
        // Lava melts sand into glass, ice into water
        if (m === MAT.SAND && rand() < 0.03) become(idx(nx, ny), MAT.GLASS, 0);
        if (m === MAT.SNOW && rand() < 0.4) become(idx(nx, ny), MAT.WATER, 0);
      }
      // Occasional spark above for a molten look
      if (cellAt(x, y - 1) === MAT.EMPTY && rand() < 0.008) {
        become(idx(x, y - 1), MAT.FIRE, 8 + ((rand() * 8) | 0));
      }
      return false;
    }

    /** Acid eats solids and powders (not wall/glass/other liquids). */
    function acidReact(x, y) {
      var i = idx(x, y);
      var dirs = [x, y + 1, x - 1, y, x + 1, y, x, y - 1];
      for (var d = 0; d < 8; d += 2) {
        var nx = dirs[d];
        var ny = dirs[d + 1];
        var m = cellAt(nx, ny);
        if (m === MAT.EMPTY || m === MAT.WALL || m === MAT.GLASS || m === MAT.ACID) continue;
        if (M.isLiquid(m) || M.isGas(m)) continue;
        if (rand() < 0.12) {
          become(idx(nx, ny), MAT.EMPTY, 0);
          if (rand() < 0.4) {
            become(i, MAT.EMPTY, 0);
            return true;
          }
        }
      }
      return false;
    }

    function updateIce(x, y) {
      var i = idx(x, y);
      var dirs = [x, y + 1, x - 1, y, x + 1, y, x, y - 1];
      for (var d = 0; d < 8; d += 2) {
        var nx = dirs[d];
        var ny = dirs[d + 1];
        var m = cellAt(nx, ny);
        if ((m === MAT.FIRE || m === MAT.LAVA) && rand() < 0.55) {
          become(i, MAT.WATER, 0);
          return;
        }
        // Ice slowly freezes water it touches
        if (m === MAT.WATER && rand() < 0.01) {
          become(idx(nx, ny), MAT.ICE, 0);
        }
      }
    }

    /** Snow melts near heat, slowly dissolves in water. Returns true if melted. */
    function snowMelt(x, y) {
      var i = idx(x, y);
      var dirs = [x, y + 1, x - 1, y, x + 1, y, x, y - 1];
      for (var d = 0; d < 8; d += 2) {
        var m = cellAt(dirs[d], dirs[d + 1]);
        if ((m === MAT.FIRE || m === MAT.LAVA) && rand() < 0.5) {
          become(i, MAT.WATER, 0);
          return true;
        }
        if (m === MAT.WATER && rand() < 0.02) {
          become(i, MAT.WATER, 0);
          return true;
        }
      }
      return false;
    }

    /** Seed sprouts into plant on water contact. Returns true if sprouted. */
    function seedSprout(x, y) {
      var dirs = [x, y + 1, x - 1, y, x + 1, y, x, y - 1];
      for (var d = 0; d < 8; d += 2) {
        if (cellAt(dirs[d], dirs[d + 1]) === MAT.WATER) {
          become(idx(x, y), MAT.PLANT, 0);
          return true;
        }
      }
      return false;
    }

    /** Virus infects neighbors, occasionally dies. Returns true if it died. */
    function updateVirus(x, y) {
      var i = idx(x, y);
      if (rand() < 0.004) {
        become(i, MAT.EMPTY, 0);
        return true;
      }
      var dirs = [x, y + 1, x - 1, y, x + 1, y, x, y - 1];
      for (var d = 0; d < 8; d += 2) {
        var m = cellAt(dirs[d], dirs[d + 1]);
        if (m !== MAT.EMPTY && m !== MAT.WALL && m !== MAT.VIRUS && m !== MAT.FIRE && rand() < 0.04) {
          become(idx(dirs[d], dirs[d + 1]), MAT.VIRUS, 0);
        }
      }
      return false;
    }

    /** Clone learns the first material that touches it, then emits it forever. */
    function updateClone(x, y) {
      var i = idx(x, y);
      var dirs = [x, y + 1, x - 1, y, x + 1, y, x, y - 1];
      if (!life[i]) {
        for (var d = 0; d < 8; d += 2) {
          var m = cellAt(dirs[d], dirs[d + 1]);
          if (m !== MAT.EMPTY && m !== MAT.CLONE && m !== MAT.WALL) {
            life[i] = m;
            break;
          }
        }
      } else if (rand() < 0.12) {
        var pick = (rand() * 4) | 0;
        var nx = dirs[pick * 2];
        var ny = dirs[pick * 2 + 1];
        if (cellAt(nx, ny) === MAT.EMPTY) {
          setCell(nx, ny, life[i]);
          moved[idx(nx, ny)] = 1;
        }
      }
    }

    /** Fan blows wind in its stored direction (life = 1..8 into DIRS8). */
    function updateFan(x, y) {
      var i = idx(x, y);
      if (!life[i]) life[i] = 7; // default: blow up
      var d = DIRS8[life[i] - 1];
      var c = (y >> 2) * wW + (x >> 2);
      windX[c] += d[0] * 1.2;
      windY[c] += d[1] * 1.2;
    }

    /** Ant crawls along surfaces, climbs, tunnels through soft materials. */
    function updateAnt(x, y) {
      var i = idx(x, y);
      if (!life[i]) life[i] = randBool() ? 1 : 2; // 1=right, 2=left
      var dir = life[i] === 1 ? 1 : -1;
      if (cellAt(x, y + 1) === MAT.EMPTY) {
        swapCells(i, idx(x, y + 1));
        return;
      }
      if (rand() < 0.01) {
        life[i] = life[i] === 1 ? 2 : 1;
        return;
      }
      var fwd = cellAt(x + dir, y);
      if (fwd === MAT.EMPTY) {
        swapCells(i, idx(x + dir, y));
      } else if (DIGGABLE[fwd] && rand() < 0.35) {
        become(idx(x + dir, y), MAT.EMPTY, 0); // tunnel
      } else if (cellAt(x + dir, y - 1) === MAT.EMPTY && cellAt(x, y - 1) === MAT.EMPTY) {
        swapCells(i, idx(x + dir, y - 1)); // climb a step
      } else {
        life[i] = life[i] === 1 ? 2 : 1;
      }
    }

    /** Bird flies in its heading, picks a new one when blocked or bored. */
    function updateBird(x, y) {
      var i = idx(x, y);
      if (!life[i]) life[i] = 1 + ((rand() * 8) | 0);
      if (rand() < 0.08) life[i] = 1 + ((rand() * 8) | 0);
      if (rand() < 0.15) return; // hover beat
      var d = DIRS8[life[i] - 1];
      if (!tryMoveEmpty(x, y, x + d[0], y + d[1])) {
        life[i] = 1 + ((rand() * 8) | 0);
      }
    }

    /** Fighter walks, climbs, and lobs fire ahead of itself. */
    function updateFighter(x, y) {
      var i = idx(x, y);
      if (!life[i]) life[i] = randBool() ? 1 : 2;
      var dir = life[i] === 1 ? 1 : -1;
      if (cellAt(x, y + 1) === MAT.EMPTY) {
        swapCells(i, idx(x, y + 1));
        return;
      }
      if (rand() < 0.03) {
        // Lob a flame burst ahead — starts 2 cells out so it doesn't torch itself
        for (var s = 2; s <= 5; s++) {
          var tx = x + dir * s;
          if (cellAt(tx, y - 1) !== MAT.EMPTY) {
            tryIgnite(tx, y - 1);
            break;
          }
          become(idx(tx, y - 1), MAT.FIRE, 12 + ((rand() * 8) | 0));
        }
      }
      var fwd = cellAt(x + dir, y);
      if (fwd === MAT.EMPTY) {
        swapCells(i, idx(x + dir, y));
      } else if (cellAt(x + dir, y - 1) === MAT.EMPTY && cellAt(x, y - 1) === MAT.EMPTY) {
        swapCells(i, idx(x + dir, y - 1));
      } else {
        life[i] = life[i] === 1 ? 2 : 1;
      }
      if (rand() < 0.005) life[i] = life[i] === 1 ? 2 : 1;
    }

    /** Torch never burns out; it keeps spawning fire around itself. */
    function updateTorch(x, y) {
      var dirs = [x, y - 1, x - 1, y, x + 1, y, x, y + 1];
      for (var d = 0; d < 8; d += 2) {
        if (cellAt(dirs[d], dirs[d + 1]) === MAT.EMPTY && rand() < 0.08) {
          become(idx(dirs[d], dirs[d + 1]), MAT.FIRE, 15 + ((rand() * 20) | 0));
        }
      }
    }

    function isConductor(m) {
      return m === MAT.METAL || m === MAT.WATER;
    }

    /** Thunder is an impulse: it charges nearby conductors, zaps, then flashes out. */
    function updateThunder(x, y) {
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          var nx = x + dx;
          var ny = y + dy;
          if (!inBounds(nx, ny)) continue;
          var j = idx(nx, ny);
          var m = grid[j];
          if (isConductor(m)) {
            if (life[j] === 0) life[j] = 2; // inject a charge head
          } else if (IGNITE[m]) {
            tryIgnite(nx, ny);
          }
        }
      }
      become(idx(x, y), MAT.FIRE, 2 + ((rand() * 3) | 0)); // visible flash
    }

    /** A live conductor cell (charge head) zaps its neighbors. */
    function electrify(x, y) {
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          var nx = x + dx;
          var ny = y + dy;
          if (!inBounds(nx, ny)) continue;
          var j = idx(nx, ny);
          var m = grid[j];
          if (m === MAT.ANT || m === MAT.BIRD || m === MAT.FIGHTER) {
            become(j, MAT.FIRE, 8 + ((rand() * 6) | 0)); // electrocuted
          } else if (IGNITE[m]) {
            tryIgnite(nx, ny); // sparks ignite fuel / set off bombs
          }
        }
      }
    }

    /**
     * WireWorld-style charge propagation on conductors (metal + water).
     * head(2) -> tail(1) -> neutral(0); a neutral conductor becomes a head
     * when any 8-neighbour conductor is currently a head. One cell/frame.
     */
    function stepElectric() {
      var n = w * h;
      var active = false;
      for (var i = 0; i < n; i++) {
        var m = grid[i];
        if (!isConductor(m)) continue;
        var s = life[i];
        if (s === 2) {
          chargeNext[i] = 1;
          electrify(i % w, (i / w) | 0);
          active = true;
        } else if (s === 1) {
          chargeNext[i] = 0;
        } else {
          var x = i % w;
          var y = (i / w) | 0;
          var head = false;
          for (var dy = -1; dy <= 1 && !head; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              var nx = x + dx;
              var ny = y + dy;
              if (!inBounds(nx, ny)) continue;
              var k = idx(nx, ny);
              if (isConductor(grid[k]) && life[k] === 2) {
                head = true;
                break;
              }
            }
          }
          chargeNext[i] = head ? 2 : 0;
          if (head) active = true;
        }
      }
      if (!active && !hasCharge) return; // nothing to write back
      for (var b = 0; b < n; b++) {
        if (isConductor(grid[b])) life[b] = chargeNext[b];
      }
      hasCharge = active;
    }

    function updatePowder(x, y) {
      if (windPush(x, y, 0.5)) return;
      if (trySink(x, y, x, y + 1)) return;
      var dir = randBool() ? 1 : -1;
      if (trySink(x, y, x + dir, y + 1)) return;
      trySink(x, y, x - dir, y + 1);
    }

    function flowSideways(x, y, spread) {
      var dir = randBool() ? 1 : -1;
      for (var attempt = 0; attempt < 2; attempt++) {
        var dist = 0;
        for (var s = 1; s <= spread; s++) {
          if (cellAt(x + dir * s, y) !== MAT.EMPTY) break;
          dist = s;
          // Stop at a ledge so it falls off next frame
          if (cellAt(x + dir * s, y + 1) === MAT.EMPTY) break;
        }
        if (dist > 0) {
          swapCells(idx(x, y), idx(x + dir * dist, y));
          return true;
        }
        dir = -dir;
      }
      return false;
    }

    function updateLiquid(x, y, m) {
      if (m === MAT.WATER && waterReact(x, y)) return;
      if (m === MAT.LAVA && lavaReact(x, y)) return;
      if (m === MAT.ACID && acidReact(x, y)) return;
      if (windPush(x, y, 0.3)) return;

      // Buoyancy: lighter liquid trapped under a heavier one bubbles up
      var above = cellAt(x, y - 1);
      if (M.isLiquid(above) && DENSITY[above] > DENSITY[m] && rand() < 0.3) {
        swapCells(idx(x, y), idx(x, y - 1));
        return;
      }

      if (trySink(x, y, x, y + 1, 0.4)) return;

      var dir = randBool() ? 1 : -1;
      if (tryMoveEmpty(x, y, x + dir, y + 1)) return;
      if (tryMoveEmpty(x, y, x - dir, y + 1)) return;

      if (m === MAT.LAVA && rand() < 0.6) return; // viscous
      flowSideways(x, y, SPREAD[m]);
    }

    function updatePlant(x, y) {
      // Powder-game plant: grows by converting the water it touches
      var dirs = [x + 1, y, x - 1, y, x, y + 1, x, y - 1];
      for (var d = 0; d < 8; d += 2) {
        var nx = dirs[d];
        var ny = dirs[d + 1];
        if (cellAt(nx, ny) === MAT.WATER && rand() < 0.2) {
          become(idx(nx, ny), MAT.PLANT, 0);
        }
      }
    }

    function updateFire(x, y) {
      var i = idx(x, y);
      if (life[i] > 0) life[i]--;
      if (life[i] === 0) {
        become(i, MAT.EMPTY, 0);
        return;
      }

      // Spread to fuel; flames anchored to fuel mostly stay put and burn
      var fuel = false;
      if (tryIgnite(x + 1, y)) fuel = true;
      if (tryIgnite(x - 1, y)) fuel = true;
      if (tryIgnite(x, y + 1)) fuel = true;
      if (tryIgnite(x, y - 1)) fuel = true;
      if (fuel && rand() < 0.85) return;

      if (windPush(x, y, 1.2)) return;
      var dir = randBool() ? 1 : -1;
      if (rand() < 0.8) {
        if (tryMoveEmpty(x, y, x, y - 1)) return;
        if (tryMoveEmpty(x, y, x + dir, y - 1)) return;
      }
      if (rand() < 0.4) tryMoveEmpty(x, y, x + dir, y);
    }

    function updateSteam(x, y) {
      var i = idx(x, y);
      if (life[i] > 0) life[i]--;
      if (life[i] === 0) {
        become(i, rand() < 0.35 ? MAT.WATER : MAT.EMPTY, 0);
        return;
      }
      // Bubble up through water
      if (cellAt(x, y - 1) === MAT.WATER && rand() < 0.5) {
        swapCells(i, idx(x, y - 1));
        return;
      }
      if (windPush(x, y, 1.2)) return;
      var dir = randBool() ? 1 : -1;
      if (rand() < 0.75) {
        if (tryMoveEmpty(x, y, x, y - 1)) return;
        if (tryMoveEmpty(x, y, x + dir, y - 1)) return;
      }
      if (rand() < 0.5) tryMoveEmpty(x, y, x + dir, y);
    }

    function updateGas(x, y) {
      var i = idx(x, y);
      // Bubble up through liquid
      if (M.isLiquid(cellAt(x, y - 1)) && rand() < 0.4) {
        swapCells(i, idx(x, y - 1));
        return;
      }
      if (windPush(x, y, 1.2)) return;
      var dir = randBool() ? 1 : -1;
      if (rand() < 0.6) {
        if (tryMoveEmpty(x, y, x, y - 1)) return;
        if (tryMoveEmpty(x, y, x + dir, y - 1)) return;
      }
      if (rand() < 0.7 && tryMoveEmpty(x, y, x + dir, y)) return;
      tryMoveEmpty(x, y, x - dir, y);
    }

    function processCell(x, y) {
      var i = idx(x, y);
      if (moved[i]) return;
      var m = grid[i];
      switch (m) {
        case MAT.EMPTY:
        case MAT.WALL:
        case MAT.STONE:
        case MAT.WOOD:
        case MAT.GLASS:
        case MAT.METAL:
          return;
        case MAT.FIRE:
        case MAT.STEAM:
        case MAT.GAS:
          return; // gas pass handles these
        case MAT.THUNDER:
          updateThunder(x, y);
          return;
        case MAT.PLANT:
          updatePlant(x, y);
          return;
        case MAT.ICE:
          updateIce(x, y);
          return;
        case MAT.CLONE:
          updateClone(x, y);
          return;
        case MAT.TORCH:
          updateTorch(x, y);
          return;
        case MAT.FAN:
          updateFan(x, y);
          return;
        case MAT.ANT:
          updateAnt(x, y);
          return;
        case MAT.BIRD:
          updateBird(x, y);
          return;
        case MAT.FIGHTER:
          updateFighter(x, y);
          return;
      }
      if (M.isPowder(m)) {
        if (m === MAT.SNOW && snowMelt(x, y)) return;
        if (m === MAT.SEED && seedSprout(x, y)) return;
        if (m === MAT.VIRUS && updateVirus(x, y)) return;
        updatePowder(x, y);
      } else if (M.isLiquid(m)) {
        updateLiquid(x, y, m);
      }
    }

    function processGas(x, y) {
      var i = idx(x, y);
      if (moved[i]) return;
      var m = grid[i];
      if (m === MAT.FIRE) updateFire(x, y);
      else if (m === MAT.STEAM) updateSteam(x, y);
      else if (m === MAT.GAS) updateGas(x, y);
    }

    /** Advance simulation by one frame. */
    function step() {
      frame++;
      moved.fill(0);
      stepWind();
      var ltr = (frame & 1) === 0; // alternate scan direction for fairness

      // Bottom-up: powders, liquids, plants (gravity)
      for (var y = h - 1; y >= 0; y--) {
        if (ltr) {
          for (var x = 0; x < w; x++) processCell(x, y);
        } else {
          for (var x2 = w - 1; x2 >= 0; x2--) processCell(x2, y);
        }
      }

      // Top-down: fire and steam (rise)
      for (var y2 = 0; y2 < h; y2++) {
        if (ltr) {
          for (var x3 = 0; x3 < w; x3++) processGas(x3, y2);
        } else {
          for (var x4 = w - 1; x4 >= 0; x4--) processGas(x4, y2);
        }
      }

      // Electricity travels along conductors after everything has settled
      stepElectric();
    }

    /**
     * Fill ImageData buffer (RGBA) from grid.
     * Per-particle shade noise + animated fire/lava/water/steam.
     * @param {Uint8ClampedArray|Uint8Array} rgba length w*h*4
     */
    function renderTo(rgba) {
      var colors = M.COLORS;
      var n = w * h;
      for (var i = 0; i < n; i++) {
        var m = grid[i];
        var o = i * 4;
        var ci = m * 4;
        var r, g, b;

        if (m === MAT.EMPTY) {
          rgba[o] = colors[ci];
          rgba[o + 1] = colors[ci + 1];
          rgba[o + 2] = colors[ci + 2];
          rgba[o + 3] = 255;
          continue;
        }

        if (m === MAT.FIRE) {
          // Hotter (more life) = whiter; flicker via noise + frame
          var t = life[i];
          var fl = (noise[i] + frame * 11) & 31;
          r = 255;
          g = Math.min(255, 60 + t * 3 + fl);
          b = Math.max(0, t * 2 - 40 + (fl >> 1));
        } else if (m === MAT.LAVA) {
          // Slow per-cell glow pulse
          var p = (noise[i] + frame) & 63;
          if (p > 31) p = 63 - p;
          r = Math.min(255, 205 + p + (noise[i] & 15));
          g = 40 + p + (noise[i] & 7);
          b = 14;
        } else if (m === MAT.WATER) {
          if (life[i]) {
            // Electrified water: bright arc-blue
            r = 150;
            g = 230;
            b = 255;
          } else {
            // Static grain + gentle shimmer
            var wv = (noise[i] * 3 + frame * 2) & 31;
            if (wv > 15) wv = 31 - wv;
            var dv = (noise[i] % 20) - 10 + wv - 8;
            r = Math.max(0, colors[ci] + (dv >> 1));
            g = Math.max(0, Math.min(255, colors[ci + 1] + dv));
            b = Math.max(0, Math.min(255, colors[ci + 2] + dv));
          }
        } else if (m === MAT.METAL) {
          if (life[i]) {
            // Charged: white-hot at the head, cyan in the tail
            var head = life[i] === 2;
            r = head ? 235 : 120;
            g = head ? 250 : 220;
            b = 255;
          } else {
            var mvv = (noise[i] % 18) - 9;
            r = Math.max(0, Math.min(255, colors[ci] + mvv));
            g = Math.max(0, Math.min(255, colors[ci + 1] + mvv));
            b = Math.max(0, Math.min(255, colors[ci + 2] + mvv));
          }
        } else if (m === MAT.THUNDER) {
          var tf = (noise[i] + frame * 7) & 31;
          r = 235;
          g = 245;
          b = 255 - (tf >> 2);
        } else if (m === MAT.STEAM) {
          // Fades toward background as it dissipates
          var st = life[i];
          var k = 0.25 + Math.min(0.55, st / 140);
          r = (12 + (168 * k)) | 0;
          g = (14 + (176 * k)) | 0;
          b = (20 + (190 * k)) | 0;
        } else if (m === MAT.ACID) {
          // Toxic bubbling pulse
          var ap = (noise[i] * 5 + frame * 3) & 31;
          if (ap > 15) ap = 31 - ap;
          r = 130 + ap * 3;
          g = Math.min(255, 225 + ap);
          b = 40 + ap;
        } else if (m === MAT.MERCURY) {
          // Metallic shimmer
          var mp = (noise[i] + frame * 2) & 31;
          if (mp > 15) mp = 31 - mp;
          r = 180 + mp * 2;
          g = 185 + mp * 2;
          b = 195 + mp * 2;
        } else if (m === MAT.GAS) {
          // Faint drifting wisps
          var gp = (noise[i] * 3 + frame) & 31;
          if (gp > 15) gp = 31 - gp;
          r = 70 + gp;
          g = 86 + gp;
          b = 70 + gp;
        } else {
          var vr = VARI[m];
          var v = vr ? (noise[i] % vr) - (vr >> 1) : 0;
          r = Math.max(0, Math.min(255, colors[ci] + v));
          g = Math.max(0, Math.min(255, colors[ci + 1] + v));
          b = Math.max(0, Math.min(255, colors[ci + 2] + v));
        }

        rgba[o] = r;
        rgba[o + 1] = g;
        rgba[o + 2] = b;
        rgba[o + 3] = 255;
      }
    }

    /** Flood-fill the contiguous region of the clicked material with mat. */
    function fill(cx, cy, mat) {
      if (!inBounds(cx, cy)) return;
      var m = mat === -1 ? MAT.EMPTY : mat & 0xff;
      var target = grid[idx(cx, cy)];
      if (target === m) return;
      var stack = [cx, cy];
      while (stack.length) {
        var y = stack.pop();
        var x = stack.pop();
        if (!inBounds(x, y)) continue;
        var k = idx(x, y);
        if (grid[k] !== target) continue;
        grid[k] = m;
        life[k] = 0;
        stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
      }
    }

    function countMaterial(mat) {
      var c = 0;
      for (var i = 0; i < grid.length; i++) if (grid[i] === mat) c++;
      return c;
    }

    /** Snapshot grid as plain array (for tests). */
    function snapshot() {
      return Array.from(grid);
    }

    return {
      width: w,
      height: h,
      getCell: getCell,
      setCell: setCell,
      /** Charge on a conductor cell (0 neutral, 1 tail, 2 head); 0 elsewhere. */
      getCharge: function (x, y) {
        if (!inBounds(x, y)) return 0;
        var i = idx(x, y);
        return isConductor(grid[i]) ? life[i] : 0;
      },
      paint: paint,
      fill: fill,
      clear: clear,
      step: step,
      renderTo: renderTo,
      countMaterial: countMaterial,
      snapshot: snapshot,
      get frame() {
        return frame;
      },
      /** Direct buffer access for advanced tests */
      get grid() {
        return grid;
      },
      /** Coarse wind field (read-only view for tests/debug). */
      get wind() {
        return { x: windX, y: windY, w: wW, h: wH };
      },
    };
  }

  var Sim = { createSim: createSim, MAT: MAT };
  root.GrainfallSim = Sim;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Sim;
  }
})(typeof window !== "undefined" ? window : globalThis);
