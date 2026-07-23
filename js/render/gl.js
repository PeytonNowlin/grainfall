/**
 * WebGL2 helpers for Grainfall: context, programs, textures, FBOs.
 * Plain script — attaches window.GrainfallGL.
 */
(function (root) {
  "use strict";

  function createGL(canvas, opts) {
    opts = opts || {};
    var gl = null;
    try {
      gl = canvas.getContext("webgl2", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
        powerPreference: "high-performance",
      });
    } catch (e) {
      gl = null;
    }
    if (!gl) return null;

    // R8 uploads need unpack alignment 1
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);

    return gl;
  }

  function compileShader(gl, type, source) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var info = gl.getShaderInfoLog(sh) || "shader compile failed";
      gl.deleteShader(sh);
      throw new Error(info);
    }
    return sh;
  }

  function createProgram(gl, vertSrc, fragSrc) {
    var vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
    var fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      var info = gl.getProgramInfoLog(prog) || "program link failed";
      gl.deleteProgram(prog);
      throw new Error(info);
    }
    var uniforms = {};
    var uCount = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < uCount; i++) {
      var u = gl.getActiveUniform(prog, i);
      if (!u) continue;
      uniforms[u.name] = gl.getUniformLocation(prog, u.name);
    }
    var attribs = {};
    var aCount = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES);
    for (var j = 0; j < aCount; j++) {
      var a = gl.getActiveAttrib(prog, j);
      if (!a) continue;
      attribs[a.name] = gl.getAttribLocation(prog, a.name);
    }
    return { program: prog, uniforms: uniforms, attribs: attribs };
  }

  function createTexture(gl, opts) {
    opts = opts || {};
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.filter || gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, opts.filter || gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var w = opts.width || 1;
    var h = opts.height || 1;
    var internal = opts.internalFormat != null ? opts.internalFormat : gl.RGBA8;
    var format = opts.format != null ? opts.format : gl.RGBA;
    var type = opts.type != null ? opts.type : gl.UNSIGNED_BYTE;
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, opts.data || null);
    return { tex: tex, width: w, height: h, internal: internal, format: format, type: type };
  }

  function uploadR8(gl, texObj, data, width, height) {
    gl.bindTexture(gl.TEXTURE_2D, texObj.tex);
    if (texObj.width !== width || texObj.height !== height) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data);
      texObj.width = width;
      texObj.height = height;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.UNSIGNED_BYTE, data);
    }
  }

  function uploadRGBA(gl, texObj, data, width, height) {
    gl.bindTexture(gl.TEXTURE_2D, texObj.tex);
    if (texObj.width !== width || texObj.height !== height) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      texObj.width = width;
      texObj.height = height;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }
  }

  function createFBO(gl, width, height, opts) {
    opts = opts || {};
    var colorCount = opts.colorCount || 1;
    var filter = opts.filter || gl.NEAREST;
    var colors = [];
    for (var i = 0; i < colorCount; i++) {
      colors.push(
        createTexture(gl, {
          width: width,
          height: height,
          filter: filter,
          internalFormat: gl.RGBA8,
          format: gl.RGBA,
          type: gl.UNSIGNED_BYTE,
        })
      );
    }
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    var drawBuffers = [];
    for (var c = 0; c < colorCount; c++) {
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0 + c,
        gl.TEXTURE_2D,
        colors[c].tex,
        0
      );
      drawBuffers.push(gl.COLOR_ATTACHMENT0 + c);
    }
    if (colorCount > 1) gl.drawBuffers(drawBuffers);
    var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Incomplete framebuffer: 0x" + status.toString(16));
    }
    return { fbo: fbo, colors: colors, width: width, height: height, colorCount: colorCount };
  }

  function resizeFBO(gl, target, width, height, opts) {
    if (target && target.width === width && target.height === height) return target;
    if (target) destroyFBO(gl, target);
    return createFBO(gl, width, height, opts);
  }

  function destroyFBO(gl, target) {
    if (!target) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (var i = 0; i < target.colors.length; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.deleteTexture(target.colors[i].tex);
    }
    gl.deleteFramebuffer(target.fbo);
  }

  function createFullscreenQuad(gl) {
    // Triangle covering clip space
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );
    return buf;
  }

  function bindQuad(gl, prog, quadBuf) {
    var loc = prog.attribs.aPos;
    if (loc == null || loc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }

  function setUniform1i(gl, loc, v) {
    if (loc) gl.uniform1i(loc, v);
  }
  function setUniform1f(gl, loc, v) {
    if (loc) gl.uniform1f(loc, v);
  }
  function setUniform2f(gl, loc, x, y) {
    if (loc) gl.uniform2f(loc, x, y);
  }
  function setUniform3f(gl, loc, x, y, z) {
    if (loc) gl.uniform3f(loc, x, y, z);
  }

  function bindTextureUnit(gl, unit, tex) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  var GrainfallGL = {
    createGL: createGL,
    createProgram: createProgram,
    createTexture: createTexture,
    uploadR8: uploadR8,
    uploadRGBA: uploadRGBA,
    createFBO: createFBO,
    resizeFBO: resizeFBO,
    destroyFBO: destroyFBO,
    createFullscreenQuad: createFullscreenQuad,
    bindQuad: bindQuad,
    setUniform1i: setUniform1i,
    setUniform1f: setUniform1f,
    setUniform2f: setUniform2f,
    setUniform3f: setUniform3f,
    bindTextureUnit: bindTextureUnit,
  };

  root.GrainfallGL = GrainfallGL;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = GrainfallGL;
  }
})(typeof window !== "undefined" ? window : globalThis);
