/**
 * Transient visual effects pool for Grainfall.
 * Driven by sim visual events + wind field. Never mutates simulation.
 */
(function (root) {
  "use strict";

  var MAX_PARTICLES = 512;
  var MAX_RINGS = 32;
  var MAX_FLASHES = 16;

  function createEffects(opts) {
    opts = opts || {};
    var gridW = opts.width || 480;
    var gridH = opts.height || 320;

    var particles = new Array(MAX_PARTICLES);
    for (var i = 0; i < MAX_PARTICLES; i++) {
      particles[i] = {
        alive: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 1,
        r: 1,
        g: 1,
        b: 1,
        size: 1,
      };
    }
    var pHead = 0;

    var rings = new Array(MAX_RINGS);
    for (var ri = 0; ri < MAX_RINGS; ri++) {
      rings[ri] = { alive: false, x: 0, y: 0, radius: 0, maxRadius: 1, life: 0, maxLife: 1, strength: 1 };
    }
    var ringHead = 0;

    var flashes = new Array(MAX_FLASHES);
    for (var fi = 0; fi < MAX_FLASHES; fi++) {
      flashes[fi] = { alive: false, x: 0, y: 0, life: 0, maxLife: 1, r: 1, g: 1, b: 1, strength: 1, radius: 20 };
    }
    var flashHead = 0;

    var shakeX = 0;
    var shakeY = 0;
    var shakeDecay = 0.85;
    var reducedMotion = false;
    var enabled = true;

    function spawnParticle(x, y, vx, vy, life, r, g, b, size) {
      if (!enabled || reducedMotion) return;
      var p = particles[pHead];
      pHead = (pHead + 1) % MAX_PARTICLES;
      p.alive = true;
      p.x = x;
      p.y = y;
      p.vx = vx;
      p.vy = vy;
      p.life = life;
      p.maxLife = life;
      p.r = r;
      p.g = g;
      p.b = b;
      p.size = size || 1;
    }

    function spawnRing(x, y, maxRadius, life, strength) {
      if (!enabled || reducedMotion) return;
      var rg = rings[ringHead];
      ringHead = (ringHead + 1) % MAX_RINGS;
      rg.alive = true;
      rg.x = x;
      rg.y = y;
      rg.radius = 0;
      rg.maxRadius = maxRadius;
      rg.life = life;
      rg.maxLife = life;
      rg.strength = strength || 1;
    }

    function spawnFlash(x, y, life, r, g, b, strength, radius) {
      if (!enabled) return;
      var f = flashes[flashHead];
      flashHead = (flashHead + 1) % MAX_FLASHES;
      f.alive = true;
      f.x = x;
      f.y = y;
      f.life = life;
      f.maxLife = life;
      f.r = r;
      f.g = g;
      f.b = b;
      f.strength = strength || 1;
      f.radius = radius || 24;
    }

    function addShake(mag) {
      if (!enabled || reducedMotion) return;
      shakeX += (Math.random() - 0.5) * mag;
      shakeY += (Math.random() - 0.5) * mag;
    }

    function ingestEvents(events) {
      if (!events || !events.length) return;
      for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        var x = ev.x;
        var y = ev.y;
        if (ev.type === "explosion") {
          var rad = Math.max(4, ev.r || 4);
          spawnFlash(x, y, 10, 1.0, 0.55, 0.2, 0.9, rad * 6);
          spawnRing(x, y, rad * 3.5, 18, 1.0);
          addShake(Math.min(6, rad * 0.7));
          var count = Math.min(40, 8 + rad * 4);
          for (var s = 0; s < count; s++) {
            var ang = Math.random() * Math.PI * 2;
            var sp = 0.8 + Math.random() * 2.5;
            spawnParticle(
              x,
              y,
              Math.cos(ang) * sp,
              Math.sin(ang) * sp - 0.6,
              12 + ((Math.random() * 20) | 0),
              1.0,
              0.45 + Math.random() * 0.4,
              0.1,
              1 + ((Math.random() * 2) | 0)
            );
          }
        } else if (ev.type === "lightning") {
          spawnFlash(x, y, 8, 0.85, 0.95, 1.0, 0.85, 36);
          addShake(1.5);
          for (var L = 0; L < 10; L++) {
            spawnParticle(
              x + (Math.random() - 0.5) * 6,
              y + (Math.random() - 0.5) * 6,
              (Math.random() - 0.5) * 1.5,
              -0.5 - Math.random(),
              8 + ((Math.random() * 10) | 0),
              0.9,
              0.95,
              1.0,
              1
            );
          }
        } else if (ev.type === "steam_puff") {
          for (var st = 0; st < 4; st++) {
            spawnParticle(
              x + (Math.random() - 0.5) * 2,
              y,
              (Math.random() - 0.5) * 0.4,
              -0.4 - Math.random() * 0.5,
              20 + ((Math.random() * 20) | 0),
              0.7,
              0.75,
              0.85,
              1 + ((Math.random() * 2) | 0)
            );
          }
        } else if (ev.type === "spark") {
          spawnParticle(x, y, (Math.random() - 0.5) * 0.8, -1.2 - Math.random(), 10, 1.0, 0.7, 0.2, 1);
          spawnParticle(x, y, (Math.random() - 0.5) * 0.6, -0.8, 8, 1.0, 0.5, 0.1, 1);
        } else if (ev.type === "zap") {
          spawnFlash(x, y, 5, 0.6, 0.9, 1.0, 0.45, 14);
          spawnParticle(x, y, (Math.random() - 0.5), -0.5, 8, 0.7, 0.95, 1.0, 1);
        }
      }
    }

    function step(dt, wind) {
      if (!enabled) return;
      var damp = Math.pow(0.92, dt);
      for (var i = 0; i < MAX_PARTICLES; i++) {
        var p = particles[i];
        if (!p.alive) continue;
        // Wind advection from coarse field
        if (wind && wind.x && wind.y) {
          var wx = Math.max(0, Math.min(wind.w - 1, (p.x / 4) | 0));
          var wy = Math.max(0, Math.min(wind.h - 1, (p.y / 4) | 0));
          var wi = wy * wind.w + wx;
          p.vx += wind.x[wi] * 0.04 * dt;
          p.vy += wind.y[wi] * 0.04 * dt;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 0.04 * dt; // light gravity
        p.vx *= damp;
        p.vy *= damp;
        p.life -= dt;
        if (p.life <= 0 || p.x < -4 || p.y < -4 || p.x > gridW + 4 || p.y > gridH + 4) {
          p.alive = false;
        }
      }
      for (var r = 0; r < MAX_RINGS; r++) {
        var rg = rings[r];
        if (!rg.alive) continue;
        rg.life -= dt;
        var t = 1.0 - rg.life / rg.maxLife;
        rg.radius = rg.maxRadius * Math.min(1, t * 1.2);
        if (rg.life <= 0) rg.alive = false;
      }
      for (var f = 0; f < MAX_FLASHES; f++) {
        var fl = flashes[f];
        if (!fl.alive) continue;
        fl.life -= dt;
        if (fl.life <= 0) fl.alive = false;
      }
      shakeX *= Math.pow(shakeDecay, dt);
      shakeY *= Math.pow(shakeDecay, dt);
      if (Math.abs(shakeX) < 0.01) shakeX = 0;
      if (Math.abs(shakeY) < 0.01) shakeY = 0;
    }

    /**
     * Rasterize FX into an RGBA buffer (gridW * gridH * 4).
     * Additive-friendly bright colors on black.
     */
    function renderTo(rgba) {
      rgba.fill(0);
      if (!enabled) return;

      function addPixel(px, py, r, g, b, a) {
        if (px < 0 || py < 0 || px >= gridW || py >= gridH) return;
        var o = (py * gridW + px) * 4;
        rgba[o] = Math.min(255, rgba[o] + (r * a * 255) | 0);
        rgba[o + 1] = Math.min(255, rgba[o + 1] + (g * a * 255) | 0);
        rgba[o + 2] = Math.min(255, rgba[o + 2] + (b * a * 255) | 0);
        rgba[o + 3] = 255;
      }

      for (var i = 0; i < MAX_PARTICLES; i++) {
        var p = particles[i];
        if (!p.alive) continue;
        var a = Math.max(0, p.life / p.maxLife);
        var px = p.x | 0;
        var py = p.y | 0;
        addPixel(px, py, p.r, p.g, p.b, a);
        if (p.size > 1) {
          addPixel(px + 1, py, p.r, p.g, p.b, a * 0.5);
          addPixel(px, py - 1, p.r, p.g, p.b, a * 0.5);
        }
      }

      for (var r = 0; r < MAX_RINGS; r++) {
        var rg = rings[r];
        if (!rg.alive) continue;
        var alpha = Math.max(0, rg.life / rg.maxLife) * rg.strength * 0.7;
        var rad = Math.max(1, rg.radius);
        var steps = Math.max(12, (rad * 6) | 0);
        for (var s = 0; s < steps; s++) {
          var ang = (s / steps) * Math.PI * 2;
          addPixel(
            (rg.x + Math.cos(ang) * rad) | 0,
            (rg.y + Math.sin(ang) * rad) | 0,
            1.0,
            0.7,
            0.35,
            alpha
          );
        }
      }

      for (var f = 0; f < MAX_FLASHES; f++) {
        var fl = flashes[f];
        if (!fl.alive) continue;
        var fa = Math.max(0, fl.life / fl.maxLife) * fl.strength;
        var R = fl.radius | 0;
        for (var dy = -R; dy <= R; dy += 2) {
          for (var dx = -R; dx <= R; dx += 2) {
            var d2 = dx * dx + dy * dy;
            if (d2 > R * R) continue;
            var fall = 1 - Math.sqrt(d2) / (R + 1);
            addPixel((fl.x + dx) | 0, (fl.y + dy) | 0, fl.r, fl.g, fl.b, fa * fall * 0.35);
          }
        }
      }
    }

    function reset() {
      for (var i = 0; i < MAX_PARTICLES; i++) particles[i].alive = false;
      for (var r = 0; r < MAX_RINGS; r++) rings[r].alive = false;
      for (var f = 0; f < MAX_FLASHES; f++) flashes[f].alive = false;
      shakeX = 0;
      shakeY = 0;
    }

    function getShake() {
      // Convert to UV offset for composite shader (grid-normalized)
      return {
        x: shakeX / gridW,
        y: shakeY / gridH,
      };
    }

    return {
      ingestEvents: ingestEvents,
      step: step,
      renderTo: renderTo,
      reset: reset,
      getShake: getShake,
      setReducedMotion: function (v) {
        reducedMotion = !!v;
        if (reducedMotion) {
          shakeX = 0;
          shakeY = 0;
        }
      },
      setEnabled: function (v) {
        enabled = !!v;
        if (!enabled) reset();
      },
      resize: function (w, h) {
        gridW = w;
        gridH = h;
        reset();
      },
    };
  }

  var GrainfallEffects = { createEffects: createEffects };
  root.GrainfallEffects = GrainfallEffects;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = GrainfallEffects;
  }
})(typeof window !== "undefined" ? window : globalThis);
