/**
 * Headless browser verification for Grainfall graphics overhaul.
 * Serves the static root, loads index.html, exercises WebGL (or fallback),
 * paints via app API, checks pixels / PNG capture / resize.
 */
import { createServer } from "http";
import { readFile } from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const SCRATCH =
  process.env.SCRATCH ||
  path.join(__dirname, "..", ".scratch-browser");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
};

function log(line, lines) {
  console.log(line);
  lines.push(line);
}

async function startServer() {
  const server = createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      if (urlPath === "/") urlPath = "/index.html";
      const filePath = path.join(root, urlPath.replace(/^\//, ""));
      if (!filePath.startsWith(root)) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      const data = await readFile(filePath);
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, port };
}

async function runOnce(browser, baseUrl, lines, tag, viewport) {
  const page = await browser.newPage({ viewport });
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto(baseUrl + "/", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForFunction(() => window.GrainfallApp && window.GrainfallApp.sim && window.GrainfallApp.renderer, {
    timeout: 10000,
  });

  const boot = await page.evaluate(() => {
    const app = window.GrainfallApp;
    const c = app.canvas;
    const o = app.overlay;
    return {
      mode: app.renderer.mode,
      quality: app.renderer.getQuality(),
      width: c.width,
      height: c.height,
      cssW: c.getBoundingClientRect().width,
      cssH: c.getBoundingClientRect().height,
      gridW: app.GRID_W,
      gridH: app.GRID_H,
      overlay: !!(o && o.width === app.GRID_W),
      hasGfxSelect: !!document.getElementById("gfx-quality"),
    };
  });
  log(
    `[${tag}] mode=${boot.mode} quality=${boot.quality} buffer ${boot.width}x${boot.height} css ${boot.cssW.toFixed(0)}x${boot.cssH.toFixed(0)}`,
    lines
  );
  if (boot.width < 100 || boot.height < 100) throw new Error("Canvas dimensions too small");
  if (boot.cssW < 50 || boot.cssH < 50) throw new Error("Canvas CSS size too small");
  if (!boot.overlay) throw new Error("Overlay canvas missing or wrong size");
  if (!boot.hasGfxSelect) throw new Error("Graphics quality select missing");

  // Paint sand, step, let the real renderer draw, sample via readback helpers
  const paintResult = await page.evaluate(async () => {
    const app = window.GrainfallApp;
    const MAT = window.Materials.MAT;
    app.sim.clear();
    app.renderer.resetTemporal();
    app.setSelected(MAT.SAND);
    app.setBrushSize(8);
    app.sim.paint((app.GRID_W / 2) | 0, 40, MAT.SAND, 8);
    for (let i = 0; i < 40; i++) app.sim.step();
    app.renderer.renderFrame({});

    // CPU reference path still available for pixel accounting
    const rgba = new Uint8ClampedArray(app.GRID_W * app.GRID_H * 4);
    app.sim.renderTo(rgba);
    let nonBg = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i],
        g = rgba[i + 1],
        b = rgba[i + 2];
      if (Math.abs(r - 12) > 8 || Math.abs(g - 14) > 8 || Math.abs(b - 20) > 8) nonBg++;
    }

    // PNG capture from renderer (no overlays)
    const png = app.renderer.capturePNG();
    const pngOk = typeof png === "string" && png.indexOf("data:image/png") === 0 && png.length > 500;

    return {
      nonBg,
      total: rgba.length / 4,
      sand: app.sim.countMaterial(MAT.SAND),
      fraction: nonBg / (rgba.length / 4),
      pngOk,
      mode: app.renderer.mode,
    };
  });

  log(
    `[${tag}] after paint+step: sand=${paintResult.sand} nonBgPixels=${paintResult.nonBg} fraction=${(paintResult.fraction * 100).toFixed(2)}% png=${paintResult.pngOk}`,
    lines
  );
  if (paintResult.sand < 10) throw new Error("Paint did not place enough sand");
  if (paintResult.fraction < 0.001) {
    throw new Error("Sim render appears blank after paint+step (fraction " + paintResult.fraction + ")");
  }
  if (!paintResult.pngOk) throw new Error("renderer.capturePNG failed");

  // Fire/lava showcase: ensure emissive materials don't crash the pipeline
  const hotScene = await page.evaluate(() => {
    const app = window.GrainfallApp;
    const MAT = window.Materials.MAT;
    app.sim.clear();
    app.renderer.resetTemporal();
    app.sim.paint(80, 200, MAT.LAVA, 10);
    app.sim.paint(120, 180, MAT.FIRE, 6);
    app.sim.paint(200, 100, MAT.WATER, 8);
    for (let i = 0; i < 20; i++) app.sim.step();
    const events = app.sim.drainVisualEvents();
    app.renderer.renderFrame({});
    // quality switch
    app.setGfxQuality("performance");
    app.renderer.renderFrame({});
    app.setGfxQuality("ultra");
    app.renderer.renderFrame({});
    app.setGfxQuality("high");
    return {
      lava: app.sim.countMaterial(MAT.LAVA),
      fire: app.sim.countMaterial(MAT.FIRE),
      events: events.length,
      quality: app.renderer.getQuality(),
    };
  });
  log(
    `[${tag}] hot scene lava=${hotScene.lava} fire=${hotScene.fire} drainedEvents=${hotScene.events} quality=${hotScene.quality}`,
    lines
  );
  if (hotScene.lava + hotScene.fire < 1) throw new Error("Hot scene failed to place materials");

  // Pointer mapping corners + paint/readback orientation (WebGL must not be Y-flipped)
  const mapping = await page.evaluate(() => {
    const app = window.GrainfallApp;
    const el = app.overlay || app.canvas;
    const rect = el.getBoundingClientRect();
    const tl = app.clientToGrid(rect.left + 1, rect.top + 1);
    const br = app.clientToGrid(rect.right - 1, rect.bottom - 1);
    const mid = app.clientToGrid(rect.left + rect.width / 2, rect.top + rect.height / 2);

    // Place a unique marker near the top of the grid and confirm renderTo
    // (CPU, y-down) still matches where the app thinks "top" is after WebGL.
    const MAT = window.Materials.MAT;
    app.sim.clear();
    app.renderer.resetTemporal();
    app.sim.setCell(10, 5, MAT.SAND);
    app.sim.setCell(10, app.GRID_H - 6, MAT.WATER);
    const g = app.clientToGrid(
      rect.left + (10.5 / app.GRID_W) * rect.width,
      rect.top + (5.5 / app.GRID_H) * rect.height
    );
    return {
      tl,
      br,
      mid,
      gridW: app.GRID_W,
      gridH: app.GRID_H,
      mappedTop: g,
      topCell: app.sim.getCell(10, 5),
      bottomCell: app.sim.getCell(10, app.GRID_H - 6),
    };
  });
  log(
    `[${tag}] map tl=${mapping.tl.x},${mapping.tl.y} mid=${mapping.mid.x},${mapping.mid.y} br=${mapping.br.x},${mapping.br.y} topMap=${mapping.mappedTop.x},${mapping.mappedTop.y}`,
    lines
  );
  if (mapping.tl.x > 2 || mapping.tl.y > 2) throw new Error("Top-left mapping wrong");
  if (mapping.br.x < mapping.gridW - 4 || mapping.br.y < mapping.gridH - 4) {
    throw new Error("Bottom-right mapping wrong");
  }
  if (Math.abs(mapping.mid.x - (mapping.gridW / 2 | 0)) > 4) throw new Error("Mid X mapping wrong");
  if (Math.abs(mapping.mappedTop.x - 10) > 1 || Math.abs(mapping.mappedTop.y - 5) > 1) {
    throw new Error("Overlay mapping does not hit expected top-grid cell");
  }
  if (mapping.topCell !== 2 || mapping.bottomCell !== 3) {
    throw new Error("Grid orientation markers missing");
  }

  // Water paint via API
  const waterChange = await page.evaluate(() => {
    const app = window.GrainfallApp;
    const MAT = window.Materials.MAT;
    const before = app.sim.countMaterial(MAT.WATER);
    app.setSelected(MAT.WATER);
    app.sim.paint(100, 50, MAT.WATER, 5);
    const after = app.sim.countMaterial(MAT.WATER);
    return { before, after, selected: app.selected };
  });
  log(`[${tag}] water paint before=${waterChange.before} after=${waterChange.after}`, lines);
  if (waterChange.after <= waterChange.before) {
    throw new Error("Selecting water then painting did not change grid");
  }

  const paletteCount = await page.locator("#palette .mat-btn").count();
  log(`[${tag}] palette buttons: ${paletteCount}`, lines);
  if (paletteCount < 8) throw new Error("Palette too sparse");

  await page.locator(".mat-btn", { hasText: "Lava" }).click();
  const selectedLava = await page.evaluate(() => window.GrainfallApp.selected === window.Materials.MAT.LAVA);
  if (!selectedLava) throw new Error("Lava button did not select lava");
  log(`[${tag}] lava palette selection OK`, lines);

  // Resize smoke
  await page.setViewportSize({ width: Math.max(390, viewport.width - 200), height: Math.max(700, viewport.height) });
  await page.waitForTimeout(100);
  const afterResize = await page.evaluate(() => {
    const c = window.GrainfallApp.canvas;
    const r = c.getBoundingClientRect();
    return { cssW: r.width, cssH: r.height, bufW: c.width, bufH: c.height };
  });
  log(
    `[${tag}] after resize css ${afterResize.cssW.toFixed(0)}x${afterResize.cssH.toFixed(0)} buf ${afterResize.bufW}x${afterResize.bufH}`,
    lines
  );
  if (afterResize.cssW < 40) throw new Error("Canvas collapsed after resize");

  const shotPath = path.join(SCRATCH, `screenshot-${tag}.png`);
  await page.screenshot({ path: shotPath, fullPage: true });
  log(`[${tag}] screenshot: ${shotPath}`, lines);

  // Showcase baselines (paused fixed scenes)
  const showcasePath = path.join(SCRATCH, `showcase-${tag}.png`);
  await page.evaluate(() => {
    const app = window.GrainfallApp;
    const MAT = window.Materials.MAT;
    app.sim.clear();
    app.renderer.resetTemporal();
    // sand dune
    for (let x = 40; x < 140; x++) {
      for (let y = 220; y < 280; y++) {
        if ((x + y) % 3 !== 0) app.sim.setCell(x, y, MAT.SAND);
      }
    }
    // water pool
    for (let x = 180; x < 260; x++) {
      for (let y = 240; y < 300; y++) app.sim.setCell(x, y, MAT.WATER);
    }
    // fire + lava
    app.sim.paint(320, 250, MAT.LAVA, 12);
    app.sim.paint(360, 200, MAT.FIRE, 8);
    app.sim.paint(400, 180, MAT.METAL, 4);
    for (let i = 0; i < 15; i++) app.sim.step();
    app.renderer.renderFrame({});
  });
  await page.locator("#sim-canvas").screenshot({ path: showcasePath });
  log(`[${tag}] showcase: ${showcasePath}`, lines);

  if (pageErrors.length) {
    throw new Error("Page errors: " + pageErrors.join("; "));
  }
  const realConsole = consoleErrors.filter((e) => !/favicon/i.test(e));
  if (realConsole.length) {
    log(`[${tag}] console errors: ${realConsole.join(" | ")}`, lines);
    throw new Error("Console errors: " + realConsole.join("; "));
  }

  await page.close();
  return { paintResult, boot };
}

async function main() {
  const lines = [];
  let server;
  try {
    const { mkdir } = await import("fs/promises");
    await mkdir(SCRATCH, { recursive: true });
    const srv = await startServer();
    server = srv.server;
    const baseUrl = `http://127.0.0.1:${srv.port}`;
    log(`Server at ${baseUrl}`, lines);

    const browser = await chromium.launch({ headless: true });
    try {
      const r1 = await runOnce(browser, baseUrl, lines, "desktop", { width: 1100, height: 800 });
      await runOnce(browser, baseUrl, lines, "mobile", { width: 390, height: 844 });
      if (r1.boot.mode !== "webgl2" && r1.boot.mode !== "canvas2d") {
        throw new Error("Unknown renderer mode " + r1.boot.mode);
      }
      log(`Primary renderer mode: ${r1.boot.mode}`, lines);
      log("Browser verification PASSED", lines);
    } finally {
      await browser.close();
    }
  } catch (e) {
    log("Browser verification FAILED: " + e.message, lines);
    log(String(e.stack || e), lines);
    await writeLog(path.join(SCRATCH, "launch-env.log"), lines);
    await writeLog(path.join(SCRATCH, "browser-console.log"), lines);
    process.exitCode = 1;
    return;
  } finally {
    if (server) server.close();
  }
  await writeLog(path.join(SCRATCH, "browser-console.log"), lines);
}

function writeLog(file, lines) {
  return new Promise((resolve, reject) => {
    const ws = createWriteStream(file);
    ws.on("error", reject);
    ws.on("finish", resolve);
    ws.write(lines.join("\n") + "\n");
    ws.end();
  });
}

main();
