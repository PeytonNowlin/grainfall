/**
 * Material definitions for Grainfall.
 * Pure data — no DOM. Loaded as a plain browser script; also loadable in Node for tests.
 */
(function (root) {
  "use strict";

  var MAT = {
    EMPTY: 0,
    WALL: 1,
    SAND: 2,
    WATER: 3,
    OIL: 4,
    PLANT: 5,
    FIRE: 6,
    LAVA: 7,
    STEAM: 8,
    NAPALM: 9,
    STONE: 10,
    GUNPOWDER: 11,
    ICE: 12,
    SNOW: 13,
    ACID: 14,
    WOOD: 15,
    SEED: 16,
    GAS: 17,
    GLASS: 18,
    MERCURY: 19,
    CLONE: 20,
    TORCH: 21,
    NITRO: 22,
    VIRUS: 23,
    FAN: 24,
    ANT: 25,
    BIRD: 26,
    FIGHTER: 27,
    METAL: 28,
    LIGHTNING: 29,
  };

  /** RGBA base colors, indexed by material id * 4. */
  var COLORS = new Uint8Array([
    /* EMPTY     */ 12, 14, 20, 255,
    /* WALL      */ 90, 96, 110, 255,
    /* SAND      */ 230, 196, 92, 255,
    /* WATER     */ 64, 156, 255, 255,
    /* OIL       */ 72, 52, 28, 255,
    /* PLANT     */ 52, 168, 72, 255,
    /* FIRE      */ 255, 120, 32, 255,
    /* LAVA      */ 255, 90, 20, 255,
    /* STEAM     */ 180, 190, 210, 255,
    /* NAPALM    */ 255, 56, 24, 255,
    /* STONE     */ 120, 118, 112, 255,
    /* GUNPOWDER */ 70, 70, 74, 255,
    /* ICE       */ 160, 220, 255, 255,
    /* SNOW      */ 235, 240, 250, 255,
    /* ACID      */ 160, 255, 60, 255,
    /* WOOD      */ 128, 88, 48, 255,
    /* SEED      */ 120, 150, 48, 255,
    /* GAS       */ 170, 175, 95, 255,
    /* GLASS     */ 150, 205, 220, 255,
    /* MERCURY   */ 176, 180, 188, 255,
    /* CLONE     */ 184, 184, 48, 255,
    /* TORCH     */ 200, 110, 40, 255,
    /* NITRO     */ 220, 185, 40, 255,
    /* VIRUS     */ 200, 60, 200, 255,
    /* FAN       */ 90, 140, 190, 255,
    /* ANT       */ 180, 90, 45, 255,
    /* BIRD      */ 80, 180, 220, 255,
    /* FIGHTER   */ 220, 70, 70, 255,
    /* METAL     */ 150, 156, 168, 255,
    /* LIGHTNING */ 255, 220, 40, 255,
  ]);

  /** Palette entries in UI order (first 9 get hotkeys 1-9, Erase stays last). */
  var PALETTE = [
    { id: MAT.SAND, name: "Sand", color: "#e6c45c", tool: false },
    { id: MAT.WATER, name: "Water", color: "#409cff", tool: false },
    { id: MAT.WALL, name: "Wall", color: "#5a6070", tool: false },
    { id: MAT.STONE, name: "Stone", color: "#787670", tool: false },
    { id: MAT.OIL, name: "Oil", color: "#48341c", tool: false },
    { id: MAT.PLANT, name: "Plant", color: "#34a848", tool: false },
    { id: MAT.FIRE, name: "Fire", color: "#ff7820", tool: false },
    { id: MAT.LAVA, name: "Lava", color: "#ff5a14", tool: false },
    { id: MAT.NAPALM, name: "Napalm", color: "#ff3818", tool: false },
    { id: MAT.STEAM, name: "Steam", color: "#b4bed2", tool: false },
    { id: MAT.GUNPOWDER, name: "Gunpowder", color: "#46464a", tool: false },
    { id: MAT.NITRO, name: "Nitro", color: "#dcb928", tool: false },
    { id: MAT.GAS, name: "Gas", color: "#aaaf5f", tool: false },
    { id: MAT.ACID, name: "Acid", color: "#a0ff3c", tool: false },
    { id: MAT.ICE, name: "Ice", color: "#a0dcff", tool: false },
    { id: MAT.SNOW, name: "Snow", color: "#ebf0fa", tool: false },
    { id: MAT.WOOD, name: "Wood", color: "#805830", tool: false },
    { id: MAT.SEED, name: "Seed", color: "#789630", tool: false },
    { id: MAT.GLASS, name: "Glass", color: "#96cddc", tool: false },
    { id: MAT.MERCURY, name: "Mercury", color: "#b0b4bc", tool: false },
    { id: MAT.CLONE, name: "Clone", color: "#b8b830", tool: false },
    { id: MAT.TORCH, name: "Torch", color: "#c86e28", tool: false },
    { id: MAT.VIRUS, name: "Virus", color: "#c83cc8", tool: false },
    { id: MAT.FAN, name: "Fan", color: "#5a8cbe", tool: false },
    { id: MAT.ANT, name: "Ant", color: "#b45a2d", tool: false },
    { id: MAT.BIRD, name: "Bird", color: "#50b4dc", tool: false },
    { id: MAT.FIGHTER, name: "Fighter", color: "#dc4646", tool: false },
    { id: MAT.METAL, name: "Metal", color: "#969ca8", tool: false },
    { id: MAT.LIGHTNING, name: "Lightning", color: "#ffdc28", tool: false },
    { id: -1, name: "Erase", color: "#1a1e28", tool: true },
  ];

  /** Flammable materials (burned by fire/lava). */
  var FLAMMABLE = {};
  FLAMMABLE[MAT.OIL] = true;
  FLAMMABLE[MAT.PLANT] = true;
  FLAMMABLE[MAT.NAPALM] = true;
  FLAMMABLE[MAT.WOOD] = true;
  FLAMMABLE[MAT.GUNPOWDER] = true;
  FLAMMABLE[MAT.NITRO] = true;
  FLAMMABLE[MAT.GAS] = true;
  FLAMMABLE[MAT.SEED] = true;
  FLAMMABLE[MAT.VIRUS] = true;
  FLAMMABLE[MAT.ANT] = true;
  FLAMMABLE[MAT.BIRD] = true;
  FLAMMABLE[MAT.FIGHTER] = true;

  /** Solids that block movement (do not fall, block fall-through). */
  var SOLID = {};
  SOLID[MAT.WALL] = true;
  SOLID[MAT.STONE] = true;
  SOLID[MAT.PLANT] = true;
  SOLID[MAT.ICE] = true;
  SOLID[MAT.WOOD] = true;
  SOLID[MAT.GLASS] = true;
  SOLID[MAT.CLONE] = true;
  SOLID[MAT.TORCH] = true;
  SOLID[MAT.FAN] = true;
  SOLID[MAT.METAL] = true;

  /** Liquids (fall + spread). */
  var LIQUID = {};
  LIQUID[MAT.WATER] = true;
  LIQUID[MAT.OIL] = true;
  LIQUID[MAT.LAVA] = true;
  LIQUID[MAT.NAPALM] = true;
  LIQUID[MAT.ACID] = true;
  LIQUID[MAT.MERCURY] = true;
  LIQUID[MAT.NITRO] = true;

  /** Powders (fall + diagonal settle). */
  var POWDER = {};
  POWDER[MAT.SAND] = true;
  POWDER[MAT.GUNPOWDER] = true;
  POWDER[MAT.SNOW] = true;
  POWDER[MAT.SEED] = true;
  POWDER[MAT.VIRUS] = true;

  /** Gases (rise). */
  var GAS = {};
  GAS[MAT.FIRE] = true;
  GAS[MAT.STEAM] = true;
  GAS[MAT.GAS] = true;

  function colorFor(mat) {
    var i = (mat | 0) * 4;
    if (i < 0 || i >= COLORS.length) i = 0;
    return [COLORS[i], COLORS[i + 1], COLORS[i + 2], COLORS[i + 3]];
  }

  function isEmpty(m) {
    return m === MAT.EMPTY;
  }

  function isSolid(m) {
    return !!SOLID[m];
  }

  function isFlammable(m) {
    return !!FLAMMABLE[m];
  }

  function isLiquid(m) {
    return !!LIQUID[m];
  }

  function isPowder(m) {
    return !!POWDER[m];
  }

  function isGas(m) {
    return !!GAS[m];
  }

  var Materials = {
    MAT: MAT,
    COLORS: COLORS,
    PALETTE: PALETTE,
    FLAMMABLE: FLAMMABLE,
    SOLID: SOLID,
    LIQUID: LIQUID,
    POWDER: POWDER,
    GAS: GAS,
    colorFor: colorFor,
    isEmpty: isEmpty,
    isSolid: isSolid,
    isFlammable: isFlammable,
    isLiquid: isLiquid,
    isPowder: isPowder,
    isGas: isGas,
  };

  root.Materials = Materials;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Materials;
  }
})(typeof window !== "undefined" ? window : globalThis);
