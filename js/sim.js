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
  DENSITY[MAT.LIGHTNING] = 95;

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
  SPREAD[MAT.WATER] = 6;
  SPREAD[MAT.OIL] = 4;
  SPREAD[MAT.NAPALM] = 2;
  SPREAD[MAT.LAVA] = 1;
  SPREAD[MAT.ACID] = 4;
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

  // Solids that fall when unsupported (wood/stone/metal/wall stay as buildable structure).
  var FALLING_SOLID = {};
  FALLING_SOLID[MAT.ICE] = true;
  FALLING_SOLID[MAT.GLASS] = true;

  // Soft materials crushed by heavy powders / dense liquids.
  var CRUSHABLE = {};
  CRUSHABLE[MAT.PLANT] = true;
  CRUSHABLE[MAT.SEED] = true;
  CRUSHABLE[MAT.SNOW] = true;

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

    // Electricity: charge state rides in life[] on conductors (metal/water/mercury).
    // WireWorld-style: 0 neutral, 2 head (live), 1 tail (refractory).
    var chargeNext = new Uint8Array(w * h);
    var hasCharge = false;
    var chargeAge = 0; // consecutive frames with live charge; used to kill loops

    // Visual event ring: append-only facts for the renderer. Never affects RNG/grid.
    // Each event: { type, x, y, r?, mat? }. Bounded to avoid unbounded growth.
    var VISUAL_EVENT_CAP = 256;
    var visualEvents = [];

    function pushVisualEvent(ev) {
      if (visualEvents.length >= VISUAL_EVENT_CAP) return;
      visualEvents.push(ev);
    }

    function drainVisualEvents() {
      if (!visualEvents.length) return [];
      var out = visualEvents;
      visualEvents = [];
      return out;
    }

    function clearVisualEvents() {
      visualEvents.length = 0;
    }

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
      chargeAge = 0;
      clearVisualEvents();
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
     * Move into empty or gas/fire/steam (swap). Used by wind and blast fling so
     * residual fireball air doesn't brick particle motion.
     */
    function tryMoveAir(x, y, nx, ny) {
      if (!inBounds(nx, ny)) return false;
      var j = idx(nx, ny);
      var d = grid[j];
      if (d !== MAT.EMPTY && !M.isGas(d)) return false;
      swapCells(idx(x, y), j);
      return true;
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
        pushed = tryMoveAir(x, y, x + (vx > 0 ? 1 : -1), y);
        if (pushed) x += vx > 0 ? 1 : -1;
      }
      if (ay > 0.2 && rand() < ay) {
        pushed = tryMoveAir(x, y, x, y + (vy > 0 ? 1 : -1)) || pushed;
      }
      return pushed;
    }

    /**
     * Paint a circular brush dab.
     * @param {boolean} [allowOverlap=true] when false, only write into EMPTY cells
     *   (erase / EMPTY always overwrites so right-drag erase still works).
     */
    function paint(cx, cy, mat, radius, lifeVal, allowOverlap) {
      var r = Math.max(0, radius | 0);
      var r2 = r * r;
      var m = mat === -1 ? MAT.EMPTY : mat;
      var replace = allowOverlap !== false || m === MAT.EMPTY;
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r2) continue;
          var nx = cx + dx;
          var ny = cy + dy;
          if (!inBounds(nx, ny)) continue;
          if (!replace && grid[idx(nx, ny)] !== MAT.EMPTY) continue;
          setCell(nx, ny, m, lifeVal);
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

    /**
     * Gravity move: into empty/gas always, through lighter liquid by density.
     * Powders splash: kick the liquid sideways into empty/air when possible.
     */
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
          // Splash: powder (or denser liquid) displaces liquid sideways
          if (M.isPowder(src) || M.isLiquid(src)) {
            var sdir = randBool() ? 1 : -1;
            for (var sa = 0; sa < 2; sa++) {
              var sx1 = nx + sdir;
              var sx2 = nx + sdir;
              // Side at liquid row, or one row up (spray)
              if (inBounds(sx1, ny) && (grid[idx(sx1, ny)] === MAT.EMPTY || M.isGas(grid[idx(sx1, ny)]))) {
                var side = idx(sx1, ny);
                var liqLife = life[j];
                grid[side] = dst;
                life[side] = liqLife;
                grid[j] = src;
                life[j] = life[i];
                grid[i] = MAT.EMPTY;
                life[i] = 0;
                moved[i] = 1;
                moved[j] = 1;
                moved[side] = 1;
                return true;
              }
              if (inBounds(sx2, ny - 1) && (grid[idx(sx2, ny - 1)] === MAT.EMPTY || M.isGas(grid[idx(sx2, ny - 1)]))) {
                var sideUp = idx(sx2, ny - 1);
                var liqLife2 = life[j];
                grid[sideUp] = dst;
                life[sideUp] = liqLife2;
                grid[j] = src;
                life[j] = life[i];
                grid[i] = MAT.EMPTY;
                life[i] = 0;
                moved[i] = 1;
                moved[j] = 1;
                moved[sideUp] = 1;
                return true;
              }
              sdir = -sdir;
            }
          }
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
     * Solid debris is ejected past the blast radius so grit sprays out of the crater.
     */
    function explode(cx, cy, r) {
      // Record for FX after we have the blast parameters (no RNG / no sim branch).
      pushVisualEvent({ type: "explosion", x: cx, y: cy, r: r });
      var r2 = r * r;
      var core = r2 >> 1;
      // Deferred ejecta: [fromX, fromY, mat] — placed after the fireball so paths are clear
      var ejecta = [];

      function queueDebris(x, y, mat) {
        // Mark source as fire/empty later; remember to spit debris outward
        ejecta.push(x, y, mat);
      }

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
            // Inner core: vaporize into fire; outer-core edge becomes ejecta
            if (d2 > core * 0.55 && (m === MAT.STONE || m === MAT.SAND || m === MAT.WOOD) && rand() < 0.4) {
              queueDebris(x, y, MAT.SAND);
              become(j, MAT.FIRE, 12 + ((rand() * 12) | 0));
            } else {
              become(j, MAT.FIRE, 20 + ((rand() * 25) | 0));
            }
          } else if (m === MAT.EMPTY || IGNITE[m]) {
            become(j, MAT.FIRE, 10 + ((rand() * 20) | 0));
          } else if (m === MAT.ICE || m === MAT.GLASS) {
            if (m === MAT.ICE && rand() < 0.65) {
              queueDebris(x, y, MAT.SNOW);
              become(j, MAT.FIRE, 8 + ((rand() * 8) | 0));
            } else if (m === MAT.GLASS && rand() < 0.45) {
              queueDebris(x, y, MAT.SAND);
              become(j, MAT.FIRE, 8 + ((rand() * 8) | 0));
            } else {
              become(j, MAT.EMPTY, 0);
            }
          } else if (m === MAT.STONE || m === MAT.SAND || m === MAT.WOOD || m === MAT.PLANT || m === MAT.SNOW) {
            if (m === MAT.SNOW && rand() < 0.45) {
              queueDebris(x, y, MAT.SNOW);
            } else if (rand() < 0.75) {
              queueDebris(x, y, MAT.SAND);
            }
            become(j, MAT.FIRE, 8 + ((rand() * 10) | 0));
          } else if (m !== MAT.METAL) {
            if (rand() < 0.2) queueDebris(x, y, MAT.SAND);
            become(j, MAT.EMPTY, 0);
          }
        }
      }

      // Spit queued debris past the fireball along radial rays into free air
      for (var ei = 0; ei < ejecta.length; ei += 3) {
        var ex0 = ejecta[ei];
        var ey0 = ejecta[ei + 1];
        var em = ejecta[ei + 2];
        var edx = ex0 - cx;
        var edy = ey0 - cy;
        if (edx === 0 && edy === 0) {
          edx = randBool() ? 1 : -1;
        }
        var edist = Math.sqrt(edx * edx + edy * edy) || 1;
        var eux = edx / edist;
        var euy = edy / edist - 0.4;
        // Land outside the blast radius when possible
        var minOut = r + 1;
        var maxOut = r + 5;
        var placed = false;
        for (var es = maxOut; es >= minOut; es--) {
          var tx = cx + Math.round(eux * es);
          var ty = cy + Math.round(euy * es);
          if (!inBounds(tx, ty)) continue;
          var ti = idx(tx, ty);
          var td = grid[ti];
          if (td === MAT.EMPTY || M.isGas(td)) {
            become(ti, em, 0);
            placed = true;
            break;
          }
        }
        // Fallback: walk outward from the source cell through air; land at farthest free pad
        if (!placed) {
          var bestX = -1;
          var bestY = -1;
          for (var es2 = 1; es2 <= maxOut; es2++) {
            var tx2 = ex0 + Math.round(eux * es2);
            var ty2 = ey0 + Math.round(euy * es2);
            if (!inBounds(tx2, ty2)) break;
            var td2 = grid[idx(tx2, ty2)];
            if (td2 === MAT.EMPTY || M.isGas(td2)) {
              bestX = tx2;
              bestY = ty2;
            } else if (M.isSolid(td2) || td2 === MAT.WALL) {
              break;
            } else {
              break;
            }
          }
          if (bestX >= 0) {
            become(idx(bestX, bestY), em, 0);
            placed = true;
          }
        }
        // Last resort: leave grit at the crater rim
        if (!placed && inBounds(ex0, ey0) && (grid[idx(ex0, ey0)] === MAT.EMPTY || M.isGas(grid[idx(ex0, ey0)]))) {
          become(idx(ex0, ey0), em, 0);
        }
      }

      // Shockwave: stronger short-range radial wind so remaining grit keeps moving
      var ccx = cx >> 2;
      var ccy = cy >> 2;
      var cr = (r >> 2) + 4;
      for (var wy = ccy - cr; wy <= ccy + cr; wy++) {
        for (var wx = ccx - cr; wx <= ccx + cr; wx++) {
          if (wx < 0 || wy < 0 || wx >= wW || wy >= wH) continue;
          var ex = wx - ccx;
          var ey = wy - ccy;
          var dist = Math.sqrt(ex * ex + ey * ey) || 1;
          var fall = 1 - dist / (cr + 1);
          if (fall <= 0) continue;
          var c = wy * wW + wx;
          windX[c] += (ex / dist) * 13 * fall;
          windY[c] += (ey / dist) * 13 * fall - 3 * fall; // slight upward bias
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
          pushVisualEvent({ type: "steam_puff", x: x, y: y });
          return true;
        }
        if (m === MAT.LAVA) {
          become(i, MAT.STEAM, 70 + ((rand() * 40) | 0));
          become(idx(nx, ny), MAT.STONE, 0);
          pushVisualEvent({ type: "steam_puff", x: x, y: y });
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
        pushVisualEvent({ type: "spark", x: x, y: y - 1 });
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
      // Mercury is a metallic liquid — it conducts like metal/water.
      return m === MAT.METAL || m === MAT.WATER || m === MAT.MERCURY;
    }

    /**
     * Lightning bolt: falls fast, then strikes.
     * Real-ish effects: charges conductors, fuses sand into glass (fulgurites),
     * cracks ice/glass, flash-melts snow, ignites fuels, electrocutes creatures.
     */
    function lightningShouldArc(x, y) {
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          var m = cellAt(x + dx, y + dy);
          if (
            isConductor(m) ||
            m === MAT.ICE ||
            m === MAT.ANT ||
            m === MAT.BIRD ||
            m === MAT.FIGHTER
          ) {
            return true;
          }
        }
      }
      return false;
    }

    /** Apply strike effects to one cell; d2 is squared distance from bolt. */
    function lightningHitCell(nx, ny, d2) {
      if (!inBounds(nx, ny)) return;
      var j = idx(nx, ny);
      var m = grid[j];
      if (m === MAT.EMPTY || m === MAT.WALL || m === MAT.CLONE || m === MAT.LIGHTNING) return;

      if (isConductor(m)) {
        if (life[j] === 0) life[j] = 2;
        hasCharge = true;
        // Strike heat flashes some surface water to steam
        if (m === MAT.WATER && d2 <= 1 && rand() < 0.2) {
          become(j, MAT.STEAM, 50 + ((rand() * 40) | 0));
        }
        return;
      }

      if (m === MAT.SAND) {
        // Fulgurites: lightning fuses sand into glass
        if (d2 <= 1 || rand() < 0.75) become(j, MAT.GLASS, 0);
        else if (rand() < 0.4) become(j, MAT.GLASS, 0);
        return;
      }

      if (m === MAT.ICE) {
        var roll = rand();
        if (roll < 0.5) become(j, MAT.WATER, 0);
        else if (roll < 0.85) become(j, MAT.SNOW, 0);
        else become(j, MAT.EMPTY, 0);
        return;
      }

      if (m === MAT.SNOW) {
        become(j, rand() < 0.8 ? MAT.WATER : MAT.EMPTY, 0);
        return;
      }

      if (m === MAT.GLASS) {
        // Thermal shock shatters glass
        if (d2 <= 2 || rand() < 0.6) become(j, rand() < 0.35 ? MAT.SAND : MAT.EMPTY, 0);
        return;
      }

      if (m === MAT.STONE && d2 <= 2 && rand() < 0.25) {
        // Close strike can spall stone into sand grit
        become(j, MAT.SAND, 0);
        return;
      }

      if (m === MAT.ANT || m === MAT.BIRD || m === MAT.FIGHTER) {
        if (d2 <= 4) become(j, MAT.FIRE, 8 + ((rand() * 6) | 0));
        return;
      }

      if (IGNITE[m]) {
        tryIgnite(nx, ny);
      }
    }

    function dischargeLightning(x, y) {
      pushVisualEvent({ type: "lightning", x: x, y: y, r: 2 });
      var R = 2;
      for (var dy = -R; dy <= R; dy++) {
        for (var dx = -R; dx <= R; dx++) {
          if (dx === 0 && dy === 0) continue;
          var d2 = dx * dx + dy * dy;
          if (d2 > R * R) continue;
          lightningHitCell(x + dx, y + dy, d2);
        }
      }
    }

    function updateLightning(x, y) {
      var cx = x;
      var cy = y;
      // Fall several cells per frame so bolts feel snappy, not like rising fire.
      for (var n = 0; n < 3; n++) {
        if (lightningShouldArc(cx, cy)) {
          dischargeLightning(cx, cy);
          become(idx(cx, cy), MAT.EMPTY, 0);
          return;
        }
        var below = cellAt(cx, cy + 1);
        if (below === MAT.EMPTY || M.isGas(below)) {
          swapCells(idx(cx, cy), idx(cx, cy + 1));
          cy++;
          continue;
        }
        // Ground strike — fuse, crack, ignite, then vanish
        dischargeLightning(cx, cy);
        become(idx(cx, cy), MAT.EMPTY, 0);
        return;
      }
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
            pushVisualEvent({ type: "zap", x: nx, y: ny });
          } else if (IGNITE[m]) {
            tryIgnite(nx, ny); // sparks ignite fuel / set off bombs
          }
        }
      }
    }

    /**
     * WireWorld-style charge on conductors (metal / water / mercury).
     * head(2) -> tail(1) -> neutral(0). A neutral cell becomes a head only when
     * exactly 1 or 2 neighbouring conductors are heads (classic WireWorld).
     * Using "any neighbour" made solid metal blobs self-excite forever.
     * chargeAge caps runaway loops (e.g. metal rings) so charge always dies out.
     */
    function stepElectric() {
      var n = w * h;
      var active = false;
      chargeNext.fill(0);

      // Hard dissipate: nothing stays electrified permanently
      if (chargeAge > 48) {
        for (var c = 0; c < n; c++) {
          if (isConductor(grid[c])) life[c] = 0;
        }
        hasCharge = false;
        chargeAge = 0;
        return;
      }

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
          active = true; // still settling
        } else {
          var x = i % w;
          var y = (i / w) | 0;
          var heads = 0;
          for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              var nx = x + dx;
              var ny = y + dy;
              if (!inBounds(nx, ny)) continue;
              var k = idx(nx, ny);
              if (isConductor(grid[k]) && life[k] === 2) heads++;
            }
          }
          // Classic WireWorld: birth only with 1 or 2 head neighbours
          if (heads === 1 || heads === 2) {
            chargeNext[i] = 2;
            active = true;
          } else {
            chargeNext[i] = 0;
          }
        }
      }

      if (!active && !hasCharge) {
        chargeAge = 0;
        return;
      }

      for (var b = 0; b < n; b++) {
        if (isConductor(grid[b])) life[b] = chargeNext[b];
      }
      hasCharge = active;
      chargeAge = active ? chargeAge + 1 : 0;
    }

    /** True if sand is adjacent to water (damp piles settle instead of tumbling). */
    function sandIsDamp(x, y) {
      return (
        cellAt(x - 1, y) === MAT.WATER ||
        cellAt(x + 1, y) === MAT.WATER ||
        cellAt(x, y - 1) === MAT.WATER ||
        cellAt(x, y + 1) === MAT.WATER ||
        cellAt(x - 1, y + 1) === MAT.WATER ||
        cellAt(x + 1, y + 1) === MAT.WATER
      );
    }

    /** Lateral neighbor of same powder or a solid — used to decide stickiness. */
    function powderHasSupport(x, y, m) {
      var l = cellAt(x - 1, y);
      var r = cellAt(x + 1, y);
      return l === m || r === m || M.isSolid(l) || M.isSolid(r);
    }

    /** True if diagonal (dx) drops at least 2 free cells — steep face should avalanche. */
    function steepDrop(x, y, dx) {
      var c1 = cellAt(x + dx, y + 1);
      var c2 = cellAt(x + dx, y + 2);
      var free1 = c1 === MAT.EMPTY || M.isGas(c1);
      var free2 = c2 === MAT.EMPTY || M.isGas(c2);
      // Also count sinking into liquid as free for avalanche purposes
      if (!free1 && M.isLiquid(c1) && DENSITY[grid[idx(x, y)]] > DENSITY[c1]) free1 = true;
      if (!free2 && M.isLiquid(c2) && DENSITY[grid[idx(x, y)]] > DENSITY[c2]) free2 = true;
      return free1 && free2;
    }

    function updatePowder(x, y) {
      var i = idx(x, y);
      var m = grid[i];
      var damp = m === MAT.SAND && sandIsDamp(x, y);

      // Damp sand barely feels wind; dry powder is normal.
      if (windPush(x, y, damp ? 0.12 : 0.5)) return;
      // Free fall always wins.
      if (trySink(x, y, x, y + 1)) return;

      // Heavy powders crush soft materials and settle into the gap
      var below = cellAt(x, y + 1);
      if (
        CRUSHABLE[below] &&
        (m === MAT.SAND || m === MAT.GUNPOWDER || m === MAT.VIRUS) &&
        rand() < 0.55
      ) {
        become(idx(x, y + 1), MAT.EMPTY, 0);
        if (trySink(x, y, x, y + 1)) return;
      }

      // Avalanche: steep faces (2+ cell diagonal drop) always slide — overrides stick.
      var leftSteep = steepDrop(x, y, -1);
      var rightSteep = steepDrop(x, y, 1);
      if (leftSteep || rightSteep) {
        var avDir;
        if (leftSteep && rightSteep) avDir = randBool() ? -1 : 1;
        else avDir = leftSteep ? -1 : 1;
        if (trySink(x, y, x + avDir, y + 1)) return;
        if (trySink(x, y, x - avDir, y + 1)) return;
        return;
      }

      // Unsupported 1-wide columns always tumble (prevents thin spires).
      // Supported grains stick more often so piles form stable slopes.
      // Ice is slick — powders barely stick and slide off.
      var onIce = below === MAT.ICE;
      var supported = powderHasSupport(x, y, m);
      if (supported && !onIce) {
        var stick =
          damp ? 0.8 : m === MAT.SAND ? 0.42 : m === MAT.SNOW ? 0.5 : 0.22;
        if (rand() < stick) return;
      }

      // Prefer the diagonal that packs against existing powder (wider base).
      var dir = randBool() ? 1 : -1;
      if (onIce) {
        // Always prefer the open diagonal when on ice
        dir = randBool() ? 1 : -1;
      } else {
        var leftPack =
          cellAt(x - 1, y) === m ||
          cellAt(x - 1, y + 1) === m ||
          cellAt(x - 2, y + 1) === m;
        var rightPack =
          cellAt(x + 1, y) === m ||
          cellAt(x + 1, y + 1) === m ||
          cellAt(x + 2, y + 1) === m;
        if (leftPack && !rightPack) dir = -1;
        else if (rightPack && !leftPack) dir = 1;
      }

      // Damp sand slips less often even when unsupported (ice overrides).
      if (damp && !onIce && rand() < 0.45) return;

      if (trySink(x, y, x + dir, y + 1)) return;
      trySink(x, y, x - dir, y + 1);
      // Ice: also try pure sideways slip along the surface
      if (onIce) {
        if (tryMoveEmpty(x, y, x + dir, y)) return;
        tryMoveEmpty(x, y, x - dir, y);
      }
    }

    function flowSideways(x, y, spread) {
      // Grounded liquids level farther so tanks fill flat instead of columns.
      var below = cellAt(x, y + 1);
      var above = cellAt(x, y - 1);
      if (below !== MAT.EMPTY && !M.isGas(below)) {
        spread = spread + 2;
      }
      // Hydrostatic pressure: liquid stacked above pushes harder sideways.
      if (M.isLiquid(above)) {
        spread = spread + 2;
        if (M.isLiquid(cellAt(x, y - 2))) spread = spread + 1;
      }
      var dir = randBool() ? 1 : -1;
      for (var attempt = 0; attempt < 2; attempt++) {
        var dist = 0;
        for (var s = 1; s <= spread; s++) {
          if (cellAt(x + dir * s, y) !== MAT.EMPTY) break;
          dist = s;
          // Under pressure, keep flowing across shallow ledges instead of dripping early
          if (!M.isLiquid(above) && cellAt(x + dir * s, y + 1) === MAT.EMPTY) break;
          if (M.isLiquid(above) && cellAt(x + dir * s, y + 1) === MAT.EMPTY && s >= 2) break;
        }
        if (dist > 0) {
          swapCells(idx(x, y), idx(x + dir * dist, y));
          return true;
        }
        dir = -dir;
      }
      return false;
    }

    /**
     * Ice / glass fall when unsupported. Wood, stone, metal, wall stay as buildable structure.
     * Falls into empty/gas; slowly sinks through liquids; diagonal slip off ledges.
     */
    function updateFallingSolid(x, y) {
      var i = idx(x, y);
      var m = grid[i];
      var below = cellAt(x, y + 1);
      if (below === MAT.EMPTY || M.isGas(below)) {
        swapCells(i, idx(x, y + 1));
        return;
      }
      if (M.isLiquid(below) && rand() < 0.45) {
        swapCells(i, idx(x, y + 1));
        return;
      }
      // Crush soft stuff underneath (ice/glass landing on plants)
      if (CRUSHABLE[below] && rand() < 0.5) {
        become(idx(x, y + 1), MAT.EMPTY, 0);
        swapCells(i, idx(x, y + 1));
        return;
      }
      // Diagonal tumble off an edge when fully unsupported below
      if (below !== MAT.EMPTY && !M.isGas(below) && !M.isLiquid(below) && !CRUSHABLE[below]) {
        return; // resting on solid/powder
      }
      var dir = randBool() ? 1 : -1;
      if (tryMoveEmpty(x, y, x + dir, y + 1)) return;
      tryMoveEmpty(x, y, x - dir, y + 1);
    }

    function updateLiquid(x, y, m) {
      if (m === MAT.WATER && waterReact(x, y)) return;
      if (m === MAT.LAVA && lavaReact(x, y)) return;
      if (m === MAT.ACID && acidReact(x, y)) return;
      if (windPush(x, y, 0.3)) return;

      // Dense liquids crush soft materials beneath them (mercury almost always wins)
      var belowSoft = cellAt(x, y + 1);
      if (CRUSHABLE[belowSoft] && DENSITY[m] >= DENSITY[MAT.WATER]) {
        var crushChance = DENSITY[m] >= 150 ? 0.95 : 0.55;
        if (rand() < crushChance) {
          become(idx(x, y + 1), MAT.EMPTY, 0);
          swapCells(idx(x, y), idx(x, y + 1));
          return;
        }
      }

      // Buoyancy: lighter liquid trapped under a heavier one bubbles up (oil on water).
      var above = cellAt(x, y - 1);
      if (M.isLiquid(above) && DENSITY[above] > DENSITY[m] && rand() < 0.6) {
        swapCells(idx(x, y), idx(x, y - 1));
        return;
      }

      // Density sink through lighter liquids (water under oil, mercury under water).
      if (trySink(x, y, x, y + 1, 0.55)) return;

      // Horizontal density percolation: denser liquid drifts under lighter side-neighbors
      var hdir = randBool() ? 1 : -1;
      for (var ha = 0; ha < 2; ha++) {
        var hx = x + hdir;
        var hm = cellAt(hx, y);
        if (M.isLiquid(hm) && DENSITY[m] > DENSITY[hm] && rand() < 0.4) {
          var underLight = cellAt(hx, y + 1);
          if (
            underLight === MAT.EMPTY ||
            M.isGas(underLight) ||
            underLight === hm ||
            (M.isLiquid(underLight) && DENSITY[underLight] < DENSITY[m])
          ) {
            swapCells(idx(x, y), idx(hx, y));
            return;
          }
        }
        hdir = -hdir;
      }

      // Oil film: prefer spreading across the free surface of water
      if (m === MAT.OIL) {
        var odir = randBool() ? 1 : -1;
        for (var oa = 0; oa < 2; oa++) {
          if (
            cellAt(x + odir, y) === MAT.EMPTY &&
            cellAt(x + odir, y + 1) === MAT.WATER &&
            rand() < 0.55
          ) {
            swapCells(idx(x, y), idx(x + odir, y));
            return;
          }
          odir = -odir;
        }
      }

      var dir = randBool() ? 1 : -1;
      if (tryMoveEmpty(x, y, x + dir, y + 1)) return;
      if (tryMoveEmpty(x, y, x - dir, y + 1)) return;

      if (m === MAT.LAVA && rand() < 0.6) return; // viscous
      flowSideways(x, y, SPREAD[m] || 2);
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

    /** Crawl under a solid ceiling when blocked from rising. */
    function ceilingCrawl(x, y) {
      var above = cellAt(x, y - 1);
      if (!(M.isSolid(above) || above === MAT.WALL)) return false;
      var dir = randBool() ? 1 : -1;
      if (tryMoveEmpty(x, y, x + dir, y)) return true;
      if (tryMoveEmpty(x, y, x - dir, y)) return true;
      // Slip into a gap under the ceiling
      if (tryMoveEmpty(x, y, x + dir, y - 1)) return true;
      if (tryMoveEmpty(x, y, x - dir, y - 1)) return true;
      return false;
    }

    function updateFire(x, y) {
      var i = idx(x, y);
      if (life[i] > 0) life[i]--;
      if (life[i] === 0) {
        become(i, MAT.EMPTY, 0);
        return;
      }

      // Submerged flames die fast (water/oil/etc. smother)
      var submerged = 0;
      if (M.isLiquid(cellAt(x + 1, y))) submerged++;
      if (M.isLiquid(cellAt(x - 1, y))) submerged++;
      if (M.isLiquid(cellAt(x, y + 1))) submerged++;
      if (M.isLiquid(cellAt(x, y - 1))) submerged++;
      if (submerged >= 2 && rand() < 0.45) {
        // Wet quench → steam if water is involved
        var makeSteam =
          cellAt(x + 1, y) === MAT.WATER ||
          cellAt(x - 1, y) === MAT.WATER ||
          cellAt(x, y + 1) === MAT.WATER ||
          cellAt(x, y - 1) === MAT.WATER;
        become(i, makeSteam ? MAT.STEAM : MAT.EMPTY, makeSteam ? 40 + ((rand() * 30) | 0) : 0);
        return;
      }

      // Spread to fuel; flames anchored to fuel mostly stay put and burn
      var fuel = false;
      if (tryIgnite(x + 1, y)) fuel = true;
      if (tryIgnite(x - 1, y)) fuel = true;
      if (tryIgnite(x, y + 1)) fuel = true;
      if (tryIgnite(x, y - 1)) fuel = true;
      if (fuel && rand() < 0.85) return;

      // Fire is light: bubble up through liquids
      if (M.isLiquid(cellAt(x, y - 1)) && rand() < 0.35) {
        swapCells(i, idx(x, y - 1));
        return;
      }

      if (windPush(x, y, 1.2)) return;
      if (ceilingCrawl(x, y)) return;
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
      // Condenses quickly on cold surfaces
      if (
        (cellAt(x, y - 1) === MAT.ICE ||
          cellAt(x, y + 1) === MAT.ICE ||
          cellAt(x - 1, y) === MAT.ICE ||
          cellAt(x + 1, y) === MAT.ICE) &&
        rand() < 0.2
      ) {
        become(i, MAT.WATER, 0);
        return;
      }
      // Bubble up through any liquid (not only water)
      if (M.isLiquid(cellAt(x, y - 1)) && rand() < 0.55) {
        swapCells(i, idx(x, y - 1));
        return;
      }
      // Diagonal bubble through liquid when blocked above
      if (M.isLiquid(cellAt(x, y - 1))) {
        var sdir = randBool() ? 1 : -1;
        if (M.isLiquid(cellAt(x + sdir, y - 1)) || cellAt(x + sdir, y - 1) === MAT.EMPTY) {
          if (M.isLiquid(cellAt(x + sdir, y - 1)) && rand() < 0.4) {
            swapCells(i, idx(x + sdir, y - 1));
            return;
          }
          if (tryMoveEmpty(x, y, x + sdir, y - 1)) return;
        }
      }
      if (windPush(x, y, 1.2)) return;
      if (ceilingCrawl(x, y)) return;
      var dir = randBool() ? 1 : -1;
      if (rand() < 0.75) {
        if (tryMoveEmpty(x, y, x, y - 1)) return;
        if (tryMoveEmpty(x, y, x + dir, y - 1)) return;
      }
      if (rand() < 0.5) tryMoveEmpty(x, y, x + dir, y);
    }

    function updateGas(x, y) {
      var i = idx(x, y);
      // Bubble up through any liquid
      if (M.isLiquid(cellAt(x, y - 1)) && rand() < 0.5) {
        swapCells(i, idx(x, y - 1));
        return;
      }
      if (windPush(x, y, 1.2)) return;
      if (ceilingCrawl(x, y)) return;
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
        case MAT.METAL:
        case MAT.WOOD:
          return;
        case MAT.GLASS:
          updateFallingSolid(x, y);
          return;
        case MAT.FIRE:
        case MAT.STEAM:
        case MAT.GAS:
          return; // gas pass handles these
        case MAT.LIGHTNING:
          updateLightning(x, y);
          return;
        case MAT.PLANT:
          updatePlant(x, y);
          return;
        case MAT.ICE:
          updateIce(x, y);
          // Still ice after melt checks → gravity on unsupported ice
          if (grid[i] === MAT.ICE) updateFallingSolid(x, y);
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
        var n0 = noise[i];

        if (m === MAT.EMPTY) {
          // Soft grain on the void so the stage does not read as flat
          var eg = (n0 & 7) - 3;
          rgba[o] = Math.max(0, colors[ci] + eg);
          rgba[o + 1] = Math.max(0, colors[ci + 1] + eg);
          rgba[o + 2] = Math.max(0, colors[ci + 2] + eg + ((n0 >> 3) & 1));
          rgba[o + 3] = 255;
          continue;
        }

        if (m === MAT.FIRE) {
          // Hotter (more life) = whiter; flicker via noise + frame
          var t = life[i];
          var fl = (n0 + frame * 11) & 31;
          r = 255;
          g = Math.min(255, 60 + t * 3 + fl);
          b = Math.max(0, t * 2 - 40 + (fl >> 1));
        } else if (m === MAT.LAVA) {
          // Slow per-cell glow pulse with occasional bright sparks
          var p = (n0 + frame) & 63;
          if (p > 31) p = 63 - p;
          r = Math.min(255, 205 + p + (n0 & 15));
          g = 40 + p + (n0 & 7);
          b = 14;
          if (((n0 + frame * 3) & 63) < 2) {
            r = 255;
            g = Math.min(255, 180 + (n0 & 31));
            b = 40;
          }
        } else if (m === MAT.NAPALM) {
          // Sticky fuel: deep red with hot orange flecks
          var np = (n0 * 3 + frame * 4) & 31;
          if (np > 15) np = 31 - np;
          r = 255;
          g = 28 + np * 3;
          b = 18 + np;
          if ((n0 & 15) < 2) {
            g = Math.min(255, 120 + np * 4);
            b = 30;
          }
        } else if (m === MAT.WATER) {
          if (life[i]) {
            // Electrified water: bright arc-blue with white core
            var wh = life[i] === 2;
            r = wh ? 200 : 120;
            g = wh ? 245 : 210;
            b = 255;
          } else {
            // Static grain + gentle shimmer
            var wv = (n0 * 3 + frame * 2) & 31;
            if (wv > 15) wv = 31 - wv;
            var dv = (n0 % 20) - 10 + wv - 8;
            r = Math.max(0, colors[ci] + (dv >> 1));
            g = Math.max(0, Math.min(255, colors[ci + 1] + dv));
            b = Math.max(0, Math.min(255, colors[ci + 2] + dv));
          }
        } else if (m === MAT.OIL) {
          // Dark amber with rare iridescent flecks
          var ov = (n0 % 16) - 8;
          r = Math.max(0, Math.min(255, 88 + ov));
          g = Math.max(0, Math.min(255, 62 + ov));
          b = Math.max(0, Math.min(255, 36 + (ov >> 1)));
          if (((n0 + frame) & 63) < 3) {
            r = Math.min(255, r + 50);
            g = Math.min(255, g + 30);
            b = Math.min(255, b + 70);
          }
        } else if (m === MAT.METAL || (m === MAT.MERCURY && life[i])) {
          if (life[i]) {
            // Charged: white-hot at the head, cyan in the tail
            var head = life[i] === 2;
            r = head ? 235 : 120;
            g = head ? 250 : 220;
            b = 255;
          } else {
            var mvv = (n0 % 18) - 9;
            r = Math.max(0, Math.min(255, colors[ci] + mvv));
            g = Math.max(0, Math.min(255, colors[ci + 1] + mvv));
            b = Math.max(0, Math.min(255, colors[ci + 2] + mvv));
          }
        } else if (m === MAT.MERCURY) {
          // Heavy liquid metal shimmer (neutral silver, not glassy blue)
          var mp = (n0 + frame * 2) & 31;
          if (mp > 15) mp = 31 - mp;
          r = 165 + mp * 2;
          g = 168 + mp * 2;
          b = 175 + mp * 2;
          if ((n0 & 31) < 2) {
            r = g = b = 230;
          }
        } else if (m === MAT.LIGHTNING) {
          var tf = (n0 + frame * 7) & 31;
          r = 255;
          g = Math.min(255, 210 + tf);
          b = 40 + (tf >> 1);
          if ((frame + n0) & 2) {
            r = g = b = 255;
          }
        } else if (m === MAT.STEAM) {
          // Fades toward background as it dissipates
          var st = life[i];
          var k = 0.25 + Math.min(0.55, st / 140);
          r = (12 + (168 * k)) | 0;
          g = (14 + (176 * k)) | 0;
          b = (20 + (190 * k)) | 0;
        } else if (m === MAT.ACID) {
          // Toxic bubbling pulse
          var ap = (n0 * 5 + frame * 3) & 31;
          if (ap > 15) ap = 31 - ap;
          r = 130 + ap * 3;
          g = Math.min(255, 225 + ap);
          b = 40 + ap;
        } else if (m === MAT.GAS) {
          // Pale yellow-green fumes (not plant-colored)
          var gp = (n0 * 3 + frame) & 31;
          if (gp > 15) gp = 31 - gp;
          r = 145 + gp;
          g = 150 + gp;
          b = 70 + (gp >> 1);
        } else if (m === MAT.ICE) {
          // Cold blue crystal with occasional white sparkle
          var iv = (n0 % 20) - 10;
          r = Math.max(0, Math.min(255, 145 + iv));
          g = Math.max(0, Math.min(255, 205 + iv));
          b = 255;
          if (((n0 * 3 + frame * 2) & 63) < 3) {
            r = 230;
            g = 245;
            b = 255;
          }
        } else if (m === MAT.SNOW) {
          var sv = (n0 % 14) - 7;
          r = Math.max(0, Math.min(255, 230 + sv));
          g = Math.max(0, Math.min(255, 235 + sv));
          b = Math.max(0, Math.min(255, 245 + sv));
        } else if (m === MAT.PLANT) {
          // Leafy variation — darker veins via noise bands
          var pv = (n0 % 36) - 18;
          r = Math.max(0, Math.min(255, 48 + pv));
          g = Math.max(0, Math.min(255, 155 + pv));
          b = Math.max(0, Math.min(255, 58 + (pv >> 1)));
          if ((n0 & 15) === 0) {
            r = Math.max(0, r - 20);
            g = Math.max(0, g - 30);
          }
        } else if (m === MAT.VIRUS) {
          var vp = (n0 + frame * 5) & 31;
          if (vp > 15) vp = 31 - vp;
          r = Math.min(255, 180 + vp * 3);
          g = 40 + vp;
          b = Math.min(255, 190 + vp * 2);
        } else if (m === MAT.CLONE) {
          // Soft gold pulse once it has learned a material
          var cp = (n0 + frame * 2) & 31;
          if (cp > 15) cp = 31 - cp;
          var learned = life[i] ? 1 : 0;
          r = 160 + cp + learned * 30;
          g = 155 + cp + learned * 25;
          b = 40 + (cp >> 1);
        } else if (m === MAT.TORCH) {
          var tp = (n0 + frame * 9) & 31;
          if (tp > 15) tp = 31 - tp;
          r = 220 + (tp >> 1);
          g = 90 + tp * 2;
          b = 30 + tp;
        } else if (m === MAT.NITRO) {
          // Unstable warning pulse
          var ntp = (n0 + frame * 6) & 31;
          if (ntp > 15) ntp = 31 - ntp;
          r = 200 + ntp;
          g = 200 + ntp;
          b = 40 + ntp;
        } else if (m === MAT.GLASS) {
          // Cool translucent sheen
          var gv = (n0 % 16) - 8;
          r = Math.max(0, Math.min(255, 175 + gv));
          g = Math.max(0, Math.min(255, 200 + gv));
          b = Math.max(0, Math.min(255, 215 + gv));
          if ((n0 & 31) < 2) {
            r = g = b = 245;
          }
        } else if (m === MAT.WOOD) {
          // Vertical-ish grain from noise bands
          var wd = (n0 % 34) - 17;
          r = Math.max(0, Math.min(255, 120 + wd));
          g = Math.max(0, Math.min(255, 80 + wd));
          b = Math.max(0, Math.min(255, 42 + (wd >> 1)));
          if ((n0 & 7) === 0) {
            r = Math.max(0, r - 25);
            g = Math.max(0, g - 18);
          }
        } else if (m === MAT.GUNPOWDER) {
          var gu = (n0 % 28) - 14;
          r = Math.max(0, Math.min(255, 62 + gu));
          g = Math.max(0, Math.min(255, 62 + gu));
          b = Math.max(0, Math.min(255, 68 + gu));
        } else if (m === MAT.SAND) {
          // Warm grain with slight sun-sparkle so dunes read alive
          var sdv = (n0 % 40) - 20;
          r = Math.max(0, Math.min(255, 230 + sdv));
          g = Math.max(0, Math.min(255, 196 + sdv));
          b = Math.max(0, Math.min(255, 92 + (sdv >> 1)));
          if (((n0 + (frame >> 2)) & 63) < 2) {
            r = Math.min(255, r + 25);
            g = Math.min(255, g + 20);
            b = Math.min(255, b + 10);
          }
        } else if (m === MAT.STONE) {
          var sk = (n0 % 26) - 13;
          r = Math.max(0, Math.min(255, 118 + sk));
          g = Math.max(0, Math.min(255, 116 + sk));
          b = Math.max(0, Math.min(255, 110 + sk));
          if ((n0 & 15) === 0) {
            r = Math.max(0, r - 18);
            g = Math.max(0, g - 16);
            b = Math.max(0, b - 14);
          }
        } else if (m === MAT.WALL) {
          var wv2 = (n0 % 16) - 8;
          r = Math.max(0, Math.min(255, 90 + wv2));
          g = Math.max(0, Math.min(255, 96 + wv2));
          b = Math.max(0, Math.min(255, 110 + wv2));
        } else {
          var vr = VARI[m];
          var v = vr ? (n0 % vr) - (vr >> 1) : 0;
          r = Math.max(0, Math.min(255, colors[ci] + v));
          g = Math.max(0, Math.min(255, colors[ci + 1] + v));
          b = Math.max(0, Math.min(255, colors[ci + 2] + v));
        }

        rgba[o] = r > 255 ? 255 : r < 0 ? 0 : r;
        rgba[o + 1] = g > 255 ? 255 : g < 0 ? 0 : g;
        rgba[o + 2] = b > 255 ? 255 : b < 0 ? 0 : b;
        rgba[o + 3] = 255;
      }
    }

    /**
     * Flood-fill the contiguous region of the clicked material with mat.
     * @param {boolean} [allowOverlap=true] when false, only fill EMPTY regions
     *   (cannot replace existing materials; erase still works).
     */
    function fill(cx, cy, mat, allowOverlap) {
      if (!inBounds(cx, cy)) return;
      var m = mat === -1 ? MAT.EMPTY : mat & 0xff;
      var target = grid[idx(cx, cy)];
      if (target === m) return;
      // No-overlap: only paint into empty space (erase may still replace).
      if (allowOverlap === false && m !== MAT.EMPTY && target !== MAT.EMPTY) return;
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

    /**
     * Replace the whole grid from a same-sized byte buffer (save/load).
     * Resets transient state (life, wind, charge); regenerates fire/steam
     * lifetimes so loaded flames don't burn forever or die instantly.
     */
    function loadGrid(src) {
      if (!src || src.length !== grid.length) return false;
      grid.set(src);
      life.fill(0);
      windX.fill(0);
      windY.fill(0);
      hasCharge = false;
      chargeAge = 0;
      clearVisualEvents();
      for (var i = 0; i < grid.length; i++) {
        if (grid[i] === MAT.FIRE) life[i] = 30 + ((rand() * 30) | 0);
        else if (grid[i] === MAT.STEAM) life[i] = 90 + ((rand() * 60) | 0);
      }
      return true;
    }

    /**
     * Read-only view of buffers the renderer needs. Do not mutate.
     * Returned object is reused each call — copy fields if retaining across frames.
     */
    var renderStateView = {
      width: w,
      height: h,
      grid: grid,
      life: life,
      noise: noise,
      windX: windX,
      windY: windY,
      windW: wW,
      windH: wH,
      frame: 0,
    };

    function getRenderState() {
      renderStateView.frame = frame;
      // Wind buffers may swap each stepWind(); keep getters current.
      renderStateView.windX = windX;
      renderStateView.windY = windY;
      return renderStateView;
    }

    return {
      width: w,
      height: h,
      getCell: getCell,
      setCell: setCell,
      loadGrid: loadGrid,
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
      getRenderState: getRenderState,
      drainVisualEvents: drainVisualEvents,
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
