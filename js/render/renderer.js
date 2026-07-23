/**
 * Grainfall renderer: WebGL2 multi-pass pipeline with Canvas2D fallback.
 * Plain script — attaches window.GrainfallRenderer.
 */
(function (root) {
  "use strict";

  var QUALITY = {
    ultra: {
      id: "ultra",
      dprCap: 2,
      bloom: true,
      bloomScale: 0.5,
      bloomPasses: 2,
      heatHaze: 1.0,
      bloomStrength: 1.1,
      grain: 0.025,
      vignette: 0.22,
      effects: true,
      lighting: true,
    },
    high: {
      id: "high",
      dprCap: 2,
      bloom: true,
      bloomScale: 0.5,
      bloomPasses: 1,
      heatHaze: 0.7,
      bloomStrength: 0.9,
      grain: 0.018,
      vignette: 0.2,
      effects: true,
      lighting: true,
    },
    performance: {
      id: "performance",
      dprCap: 1.25,
      bloom: true,
      bloomScale: 0.5,
      bloomPasses: 1,
      heatHaze: 0,
      bloomStrength: 0.65,
      grain: 0,
      vignette: 0.18,
      effects: true,
      lighting: true,
    },
  };

  function createFallbackRenderer(canvas, sim, materials) {
    var ctx = canvas.getContext("2d", { alpha: false });
    ctx.imageSmoothingEnabled = false;
    var w = sim.width;
    var h = sim.height;
    canvas.width = w;
    canvas.height = h;
    var imageData = ctx.createImageData(w, h);
    var rgba = imageData.data;
    var quality = QUALITY.high;
    var effects =
      root.GrainfallEffects && root.GrainfallEffects.createEffects
        ? root.GrainfallEffects.createEffects({ width: w, height: h })
        : null;
    var fxBuf = effects ? new Uint8ClampedArray(w * h * 4) : null;
    var reducedMotion = false;
    var cssW = w;
    var cssH = h;

    function resize(displayW, displayH, dpr) {
      cssW = displayW;
      cssH = displayH;
      canvas.style.width = Math.floor(displayW) + "px";
      canvas.style.height = Math.floor(displayH) + "px";
      // Logical buffer stays at sim resolution for fallback
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        imageData = ctx.createImageData(w, h);
        rgba = imageData.data;
      }
    }

    function renderFrame(opts) {
      opts = opts || {};
      var events = sim.drainVisualEvents ? sim.drainVisualEvents() : [];
      if (effects && quality.effects) {
        effects.setReducedMotion(reducedMotion);
        effects.ingestEvents(events);
        effects.step(1, sim.wind);
      } else if (sim.drainVisualEvents) {
        // still drain so queue doesn't grow
      }
      sim.renderTo(rgba);
      if (effects && quality.effects && fxBuf) {
        effects.renderTo(fxBuf);
        for (var i = 0; i < rgba.length; i += 4) {
          rgba[i] = Math.min(255, rgba[i] + fxBuf[i]);
          rgba[i + 1] = Math.min(255, rgba[i + 1] + fxBuf[i + 1]);
          rgba[i + 2] = Math.min(255, rgba[i + 2] + fxBuf[i + 2]);
        }
      }
      ctx.putImageData(imageData, 0, 0);
    }

    function capturePNG() {
      sim.renderTo(rgba);
      ctx.putImageData(imageData, 0, 0);
      return canvas.toDataURL("image/png");
    }

    function resetTemporal() {
      if (effects) effects.reset();
    }

    return {
      mode: "canvas2d",
      resize: resize,
      renderFrame: renderFrame,
      capturePNG: capturePNG,
      resetTemporal: resetTemporal,
      setQuality: function (id) {
        quality = QUALITY[id] || QUALITY.high;
      },
      getQuality: function () {
        return quality.id;
      },
      setReducedMotion: function (v) {
        reducedMotion = !!v;
        if (effects) effects.setReducedMotion(reducedMotion);
      },
      destroy: function () {},
      getShakeCSS: function () {
        if (!effects) return { x: 0, y: 0 };
        var s = effects.getShake();
        return { x: s.x * cssW, y: s.y * cssH };
      },
    };
  }

  function createWebGLRenderer(canvas, sim, materials) {
    var GL = root.GrainfallGL;
    var S = root.GrainfallShaders;
    if (!GL || !S) return null;

    var gl = GL.createGL(canvas, { preserveDrawingBuffer: false });
    if (!gl) return null;

    var w = sim.width;
    var h = sim.height;
    var quality = QUALITY.high;
    var reducedMotion = false;
    var cssW = w;
    var cssH = h;
    var dpr = 1;
    var displayW = w;
    var displayH = h;

    var programs = {};
    try {
      programs.cell = GL.createProgram(gl, S.VERT, S.CELL_FRAG);
      programs.light = GL.createProgram(gl, S.VERT, S.LIGHT_FRAG);
      programs.bloomThresh = GL.createProgram(gl, S.VERT, S.BLOOM_THRESH_FRAG);
      programs.bloomBlur = GL.createProgram(gl, S.VERT, S.BLOOM_BLUR_FRAG);
      programs.thermal = GL.createProgram(gl, S.VERT, S.THERMAL_FRAG);
      programs.composite = GL.createProgram(gl, S.VERT, S.COMPOSITE_FRAG);
      programs.present = GL.createProgram(gl, S.VERT, S.PRESENT_FRAG);
      programs.fx = GL.createProgram(gl, S.VERT, S.FX_FRAG);
    } catch (e) {
      console.warn("Grainfall: shader compile failed, falling back to Canvas2D", e);
      return null;
    }

    var quad = GL.createFullscreenQuad(gl);
    var tables = materials.buildRenderTextures();

    var texGrid = GL.createTexture(gl, {
      width: w,
      height: h,
      internalFormat: gl.R8,
      format: gl.RED,
      type: gl.UNSIGNED_BYTE,
      filter: gl.NEAREST,
    });
    var texLife = GL.createTexture(gl, {
      width: w,
      height: h,
      internalFormat: gl.R8,
      format: gl.RED,
      type: gl.UNSIGNED_BYTE,
      filter: gl.NEAREST,
    });
    var state = sim.getRenderState();
    var texNoise = GL.createTexture(gl, {
      width: w,
      height: h,
      internalFormat: gl.R8,
      format: gl.RED,
      type: gl.UNSIGNED_BYTE,
      filter: gl.NEAREST,
      data: state.noise,
    });
    var texPalette = GL.createTexture(gl, {
      width: 256,
      height: 1,
      filter: gl.NEAREST,
      data: tables.palette,
    });
    var texProps = GL.createTexture(gl, {
      width: 256,
      height: 1,
      filter: gl.NEAREST,
      data: tables.props,
    });
    var texExtras = GL.createTexture(gl, {
      width: 256,
      height: 1,
      filter: gl.NEAREST,
      data: tables.extras,
    });
    var texFx = GL.createTexture(gl, {
      width: w,
      height: h,
      filter: gl.NEAREST,
    });

    var fboCell = GL.createFBO(gl, w, h, { colorCount: 3, filter: gl.NEAREST });
    var fboLit = GL.createFBO(gl, w, h, { colorCount: 2, filter: gl.NEAREST });
    var bloomW = Math.max(1, (w * quality.bloomScale) | 0);
    var bloomH = Math.max(1, (h * quality.bloomScale) | 0);
    var fboBloomA = GL.createFBO(gl, bloomW, bloomH, { colorCount: 1, filter: gl.LINEAR });
    var fboBloomB = GL.createFBO(gl, bloomW, bloomH, { colorCount: 1, filter: gl.LINEAR });
    var fboThermalA = GL.createFBO(gl, w, h, { colorCount: 1, filter: gl.NEAREST });
    var fboThermalB = GL.createFBO(gl, w, h, { colorCount: 1, filter: gl.NEAREST });
    var thermalFlip = false;
    var fboComposite = GL.createFBO(gl, w, h, { colorCount: 1, filter: gl.NEAREST });
    var fboFxScene = GL.createFBO(gl, w, h, { colorCount: 1, filter: gl.NEAREST });

    var effects = root.GrainfallEffects.createEffects({ width: w, height: h });
    var fxPixels = new Uint8Array(w * h * 4);
    var lost = false;

    canvas.addEventListener(
      "webglcontextlost",
      function (e) {
        e.preventDefault();
        lost = true;
      },
      false
    );
    canvas.addEventListener(
      "webglcontextrestored",
      function () {
        lost = true; // force recreation via recreate path from app
      },
      false
    );

    function bindCommonCellUniforms(prog) {
      GL.setUniform1i(gl, prog.uniforms.uGrid, 0);
      GL.setUniform1i(gl, prog.uniforms.uLife, 1);
      GL.setUniform1i(gl, prog.uniforms.uNoise, 2);
      GL.setUniform1i(gl, prog.uniforms.uPalette, 3);
      GL.setUniform1i(gl, prog.uniforms.uProps, 4);
      GL.setUniform1i(gl, prog.uniforms.uExtras, 5);
      GL.setUniform2f(gl, prog.uniforms.uTexel, 1 / w, 1 / h);
      GL.setUniform1f(gl, prog.uniforms.uFrame, state.frame);
      GL.setUniform1f(gl, prog.uniforms.uReducedMotion, reducedMotion ? 1 : 0);
      GL.bindTextureUnit(gl, 0, texGrid.tex);
      GL.bindTextureUnit(gl, 1, texLife.tex);
      GL.bindTextureUnit(gl, 2, texNoise.tex);
      GL.bindTextureUnit(gl, 3, texPalette.tex);
      GL.bindTextureUnit(gl, 4, texProps.tex);
      GL.bindTextureUnit(gl, 5, texExtras.tex);
    }

    function drawPass(prog, fbo, viewportW, viewportH) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo ? fbo.fbo : null);
      gl.viewport(0, 0, viewportW, viewportH);
      if (fbo && fbo.colorCount > 1) {
        var bufs = [];
        for (var i = 0; i < fbo.colorCount; i++) bufs.push(gl.COLOR_ATTACHMENT0 + i);
        gl.drawBuffers(bufs);
      } else if (fbo) {
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      }
      gl.useProgram(prog.program);
      GL.bindQuad(gl, prog, quad);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function ensureBloomSize() {
      var bw = Math.max(1, (w * quality.bloomScale) | 0);
      var bh = Math.max(1, (h * quality.bloomScale) | 0);
      if (fboBloomA.width === bw && fboBloomA.height === bh) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      var nextA = null;
      var nextB = null;
      var filters = [gl.LINEAR, gl.NEAREST];
      for (var fi = 0; fi < filters.length; fi++) {
        try {
          nextA = GL.createFBO(gl, bw, bh, { colorCount: 1, filter: filters[fi] });
          nextB = GL.createFBO(gl, bw, bh, { colorCount: 1, filter: filters[fi] });
          GL.destroyFBO(gl, fboBloomA);
          GL.destroyFBO(gl, fboBloomB);
          fboBloomA = nextA;
          fboBloomB = nextB;
          bloomW = bw;
          bloomH = bh;
          return;
        } catch (eBloom) {
          if (nextA) GL.destroyFBO(gl, nextA);
          if (nextB) GL.destroyFBO(gl, nextB);
          nextA = null;
          nextB = null;
          if (fi === filters.length - 1) {
            console.warn("Grainfall: bloom resize failed; keeping previous bloom buffers", eBloom);
          }
        }
      }
    }

    function resize(displayCssW, displayCssH, devicePixelRatio) {
      cssW = displayCssW;
      cssH = displayCssH;
      dpr = Math.min(devicePixelRatio || 1, quality.dprCap);
      // Integer-ish scale for crisp cells when possible
      var scale = Math.max(1, Math.min(Math.floor(cssW / w), Math.floor(cssH / h), 3));
      if (scale < 1) scale = 1;
      // Prefer DPR-aware size but keep aspect; use CSS size * dpr for framebuffer
      displayW = Math.max(w, Math.round(cssW * dpr));
      displayH = Math.max(h, Math.round(cssH * dpr));
      // Snap to multiple of sim res when close (reduces shimmer)
      if (Math.abs(displayW / w - Math.round(displayW / w)) < 0.08) {
        displayW = Math.round(displayW / w) * w;
        displayH = Math.round(displayH / h) * h;
      }
      if (canvas.width !== displayW || canvas.height !== displayH) {
        canvas.width = displayW;
        canvas.height = displayH;
      }
      canvas.style.width = Math.floor(cssW) + "px";
      canvas.style.height = Math.floor(cssH) + "px";
    }

    function renderFrame(opts) {
      if (lost) return;
      opts = opts || {};
      state = sim.getRenderState();
      var events = sim.drainVisualEvents();

      effects.setReducedMotion(reducedMotion);
      effects.setEnabled(quality.effects);
      if (quality.effects) {
        effects.ingestEvents(events);
        effects.step(1, {
          x: state.windX,
          y: state.windY,
          w: state.windW,
          h: state.windH,
        });
        effects.renderTo(fxPixels);
        GL.uploadRGBA(gl, texFx, fxPixels, w, h);
      } else {
        fxPixels.fill(0);
        GL.uploadRGBA(gl, texFx, fxPixels, w, h);
      }

      GL.uploadR8(gl, texGrid, state.grid, w, h);
      GL.uploadR8(gl, texLife, state.life, w, h);

      // Pass 1: cell shade → scene + emissive + thermal
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboCell.fbo);
      gl.viewport(0, 0, w, h);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
      gl.useProgram(programs.cell.program);
      GL.bindQuad(gl, programs.cell, quad);
      bindCommonCellUniforms(programs.cell);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Pass 2: lighting
      var sceneTex = fboCell.colors[0].tex;
      var emisTex = fboCell.colors[1].tex;
      if (quality.lighting) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboLit.fbo);
        gl.viewport(0, 0, w, h);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        gl.useProgram(programs.light.program);
        GL.bindQuad(gl, programs.light, quad);
        bindCommonCellUniforms(programs.light);
        GL.setUniform1i(gl, programs.light.uniforms.uScene, 6);
        GL.setUniform1i(gl, programs.light.uniforms.uEmissive, 7);
        GL.bindTextureUnit(gl, 6, fboCell.colors[0].tex);
        GL.bindTextureUnit(gl, 7, fboCell.colors[1].tex);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        sceneTex = fboLit.colors[0].tex;
        emisTex = fboLit.colors[1].tex;
      }

      // Thermal persistence ping-pong
      var prevThermal = thermalFlip ? fboThermalB : fboThermalA;
      var nextThermal = thermalFlip ? fboThermalA : fboThermalB;
      gl.bindFramebuffer(gl.FRAMEBUFFER, nextThermal.fbo);
      gl.viewport(0, 0, w, h);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.useProgram(programs.thermal.program);
      GL.bindQuad(gl, programs.thermal, quad);
      GL.setUniform1i(gl, programs.thermal.uniforms.uPrev, 0);
      GL.setUniform1i(gl, programs.thermal.uniforms.uThermal, 1);
      GL.setUniform1f(gl, programs.thermal.uniforms.uDecay, 0.92);
      GL.bindTextureUnit(gl, 0, prevThermal.colors[0].tex);
      GL.bindTextureUnit(gl, 1, fboCell.colors[2].tex);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      thermalFlip = !thermalFlip;
      var thermalTex = nextThermal.colors[0].tex;

      // Bloom
      ensureBloomSize();
      if (quality.bloom) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboBloomA.fbo);
        gl.viewport(0, 0, bloomW, bloomH);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        gl.useProgram(programs.bloomThresh.program);
        GL.bindQuad(gl, programs.bloomThresh, quad);
        GL.setUniform1i(gl, programs.bloomThresh.uniforms.uEmissive, 0);
        GL.setUniform1f(gl, programs.bloomThresh.uniforms.uThreshold, 0.35);
        GL.bindTextureUnit(gl, 0, emisTex);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        var src = fboBloomA;
        var dst = fboBloomB;
        for (var p = 0; p < quality.bloomPasses; p++) {
          // H
          gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
          gl.viewport(0, 0, bloomW, bloomH);
          gl.useProgram(programs.bloomBlur.program);
          GL.bindQuad(gl, programs.bloomBlur, quad);
          GL.setUniform1i(gl, programs.bloomBlur.uniforms.uTex, 0);
          GL.setUniform2f(gl, programs.bloomBlur.uniforms.uDirection, 1, 0);
          GL.setUniform2f(gl, programs.bloomBlur.uniforms.uTexel, 1 / bloomW, 1 / bloomH);
          GL.bindTextureUnit(gl, 0, src.colors[0].tex);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          // V
          var tmp = src;
          src = dst;
          dst = tmp;
          gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
          GL.setUniform2f(gl, programs.bloomBlur.uniforms.uDirection, 0, 1);
          GL.bindTextureUnit(gl, 0, src.colors[0].tex);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          tmp = src;
          src = dst;
          dst = tmp;
        }
        var bloomTex = src.colors[0].tex;

        // Composite
        var shake = effects.getShake();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboComposite.fbo);
        gl.viewport(0, 0, w, h);
        gl.useProgram(programs.composite.program);
        GL.bindQuad(gl, programs.composite, quad);
        GL.setUniform1i(gl, programs.composite.uniforms.uScene, 0);
        GL.setUniform1i(gl, programs.composite.uniforms.uBloom, 1);
        GL.setUniform1i(gl, programs.composite.uniforms.uThermal, 2);
        GL.setUniform1i(gl, programs.composite.uniforms.uNoise, 3);
        GL.setUniform1f(gl, programs.composite.uniforms.uBloomStrength, quality.bloomStrength);
        GL.setUniform1f(
          gl,
          programs.composite.uniforms.uHeatHaze,
          reducedMotion ? 0 : quality.heatHaze
        );
        GL.setUniform1f(gl, programs.composite.uniforms.uFrame, state.frame);
        GL.setUniform1f(gl, programs.composite.uniforms.uReducedMotion, reducedMotion ? 1 : 0);
        GL.setUniform1f(gl, programs.composite.uniforms.uVignette, quality.vignette);
        GL.setUniform1f(gl, programs.composite.uniforms.uGrain, quality.grain);
        GL.setUniform2f(gl, programs.composite.uniforms.uShake, shake.x, shake.y);
        GL.bindTextureUnit(gl, 0, sceneTex);
        GL.bindTextureUnit(gl, 1, bloomTex);
        GL.bindTextureUnit(gl, 2, thermalTex);
        GL.bindTextureUnit(gl, 3, texNoise.tex);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      } else {
        // Copy scene to composite
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboComposite.fbo);
        gl.viewport(0, 0, w, h);
        gl.useProgram(programs.present.program);
        GL.bindQuad(gl, programs.present, quad);
        GL.setUniform1i(gl, programs.present.uniforms.uTex, 0);
        GL.bindTextureUnit(gl, 0, sceneTex);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }

      // FX additive
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboFxScene.fbo);
      gl.viewport(0, 0, w, h);
      gl.useProgram(programs.fx.program);
      GL.bindQuad(gl, programs.fx, quad);
      GL.setUniform1i(gl, programs.fx.uniforms.uScene, 0);
      GL.setUniform1i(gl, programs.fx.uniforms.uFx, 1);
      GL.bindTextureUnit(gl, 0, fboComposite.colors[0].tex);
      GL.bindTextureUnit(gl, 1, texFx.tex);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Present NEAREST to screen
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, displayW, displayH);
      gl.useProgram(programs.present.program);
      GL.bindQuad(gl, programs.present, quad);
      GL.setUniform1i(gl, programs.present.uniforms.uTex, 0);
      GL.bindTextureUnit(gl, 0, fboFxScene.colors[0].tex);
      // Ensure NEAREST on present source
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function capturePNG() {
      // Render once into a temporary preserve buffer via readPixels
      renderFrame({});
      var pixels = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboFxScene.fbo);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // Flip Y for canvas
      var off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      var octx = off.getContext("2d");
      var img = octx.createImageData(w, h);
      for (var y = 0; y < h; y++) {
        var src = (h - 1 - y) * w * 4;
        var dst = y * w * 4;
        img.data.set(pixels.subarray(src, src + w * 4), dst);
      }
      octx.putImageData(img, 0, 0);
      return off.toDataURL("image/png");
    }

    function resetTemporal() {
      effects.reset();
      // Clear thermal FBOs
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboThermalA.fbo);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboThermalB.fbo);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      thermalFlip = false;
    }

    function destroy() {
      GL.destroyFBO(gl, fboCell);
      GL.destroyFBO(gl, fboLit);
      GL.destroyFBO(gl, fboBloomA);
      GL.destroyFBO(gl, fboBloomB);
      GL.destroyFBO(gl, fboThermalA);
      GL.destroyFBO(gl, fboThermalB);
      GL.destroyFBO(gl, fboComposite);
      GL.destroyFBO(gl, fboFxScene);
    }

    return {
      mode: "webgl2",
      resize: resize,
      renderFrame: renderFrame,
      capturePNG: capturePNG,
      resetTemporal: resetTemporal,
      setQuality: function (id) {
        quality = QUALITY[id] || QUALITY.high;
        ensureBloomSize();
      },
      getQuality: function () {
        return quality.id;
      },
      setReducedMotion: function (v) {
        reducedMotion = !!v;
        effects.setReducedMotion(reducedMotion);
      },
      destroy: destroy,
      getShakeCSS: function () {
        var s = effects.getShake();
        return { x: s.x * cssW, y: s.y * cssH };
      },
      lost: function () {
        return lost;
      },
    };
  }

  function replaceCanvasNode(canvas) {
    if (!canvas || !canvas.parentNode) return canvas;
    var clone = canvas.cloneNode(false);
    clone.width = canvas.width;
    clone.height = canvas.height;
    if (canvas.id) clone.id = canvas.id;
    if (canvas.className) clone.className = canvas.className;
    canvas.parentNode.replaceChild(clone, canvas);
    return clone;
  }

  function createRenderer(opts) {
    opts = opts || {};
    var canvas = opts.canvas;
    var sim = opts.sim;
    var materials = opts.materials || root.Materials;
    if (!canvas || !sim || !materials) {
      throw new Error("createRenderer requires canvas, sim, materials");
    }

    var preferGL = opts.forceCanvas !== true;
    var renderer = null;
    if (preferGL) {
      try {
        renderer = createWebGLRenderer(canvas, sim, materials);
      } catch (e) {
        console.warn("Grainfall: WebGL2 init failed", e);
        renderer = null;
      }
    }
    if (!renderer) {
      // A failed WebGL init can still bind the canvas; swap in a fresh node for 2D.
      var probe2d = null;
      try {
        probe2d = canvas.getContext("2d", { alpha: false });
      } catch (e2) {
        probe2d = null;
      }
      if (!probe2d) {
        canvas = replaceCanvasNode(canvas);
        opts.canvas = canvas;
      }
      renderer = createFallbackRenderer(canvas, sim, materials);
      renderer.canvas = canvas;
    } else {
      renderer.canvas = canvas;
    }
    if (opts.quality) renderer.setQuality(opts.quality);
    if (opts.reducedMotion) renderer.setReducedMotion(true);
    return renderer;
  }

  var GrainfallRenderer = {
    createRenderer: createRenderer,
    QUALITY: QUALITY,
  };

  root.GrainfallRenderer = GrainfallRenderer;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = GrainfallRenderer;
  }
})(typeof window !== "undefined" ? window : globalThis);
