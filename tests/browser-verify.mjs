/**
 * Headless browser verification for Grainfall.
 * Serves the static root, loads index.html twice, paints via app API, checks pixels.
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
  "/var/folders/vj/bxy_kc3d0f74cd4z9xtq27g00000gn/T/grok-goal-bdbaf8cbd1d3/implementer";

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

async function runOnce(browser, baseUrl, lines, tag) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto(baseUrl + "/", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForFunction(() => window.GrainfallApp && window.GrainfallApp.sim, {
    timeout: 10000,
  });

  const dims = await page.evaluate(() => {
    const c = document.getElementById("sim-canvas");
    const app = window.GrainfallApp;
    return {
      width: c.width,
      height: c.height,
      cssW: c.getBoundingClientRect().width,
      cssH: c.getBoundingClientRect().height,
      gridW: app.GRID_W,
      gridH: app.GRID_H,
    };
  });
  log(`[${tag}] canvas buffer ${dims.width}x${dims.height} css ${dims.cssW.toFixed(0)}x${dims.cssH.toFixed(0)}`, lines);
  if (dims.width < 100 || dims.height < 100) {
    throw new Error("Canvas dimensions too small");
  }
  if (dims.cssW < 50 || dims.cssH < 50) {
    throw new Error("Canvas CSS size too small");
  }

  // Pause sim for stable paint measurement, clear, paint sand, step, render
  const paintResult = await page.evaluate(() => {
    const app = window.GrainfallApp;
    const MAT = window.Materials.MAT;
    app.sim.clear();
    // Force a render tick by stepping and calling render path via canvas
    app.setSelected(MAT.SAND);
    app.setBrushSize(8);
    // Paint at center of grid via sim API (same code path as brush)
    app.sim.paint((app.GRID_W / 2) | 0, 40, MAT.SAND, 8);
    for (let i = 0; i < 40; i++) app.sim.step();
    // Blit using same renderTo
    const canvas = app.canvas;
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(app.GRID_W, app.GRID_H);
    app.sim.renderTo(imageData.data);
    ctx.putImageData(imageData, 0, 0);
    const data = imageData.data;
    let nonBg = 0;
    // Background EMPTY color is approx 12,14,20
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      if (Math.abs(r - 12) > 8 || Math.abs(g - 14) > 8 || Math.abs(b - 20) > 8) nonBg++;
    }
    return {
      nonBg,
      total: data.length / 4,
      sand: app.sim.countMaterial(MAT.SAND),
      fraction: nonBg / (data.length / 4),
    };
  });

  log(
    `[${tag}] after paint+step: sand=${paintResult.sand} nonBgPixels=${paintResult.nonBg} fraction=${(paintResult.fraction * 100).toFixed(2)}%`,
    lines
  );

  if (paintResult.sand < 10) {
    throw new Error("Paint did not place enough sand");
  }
  if (paintResult.fraction < 0.001) {
    throw new Error("Canvas appears blank after paint+step (fraction " + paintResult.fraction + ")");
  }

  // Select water and paint — surface should change
  const waterChange = await page.evaluate(() => {
    const app = window.GrainfallApp;
    const MAT = window.Materials.MAT;
    const before = app.sim.countMaterial(MAT.WATER);
    app.setSelected(MAT.WATER);
    app.sim.paint(100, 50, MAT.WATER, 5);
    const after = app.sim.countMaterial(MAT.WATER);
    return { before, after, selected: app.selected };
  });
  log(`[${tag}] water paint before=${waterChange.before} after=${waterChange.after} selected=${waterChange.selected}`, lines);
  if (waterChange.after <= waterChange.before) {
    throw new Error("Selecting water then painting did not change grid");
  }

  // Palette UI exists and has buttons
  const paletteCount = await page.locator("#palette .mat-btn").count();
  log(`[${tag}] palette buttons: ${paletteCount}`, lines);
  if (paletteCount < 8) throw new Error("Palette too sparse");

  // Click lava button
  await page.locator(".mat-btn", { hasText: "Lava" }).click();
  const selectedLava = await page.evaluate(() => window.GrainfallApp.selected === window.Materials.MAT.LAVA);
  if (!selectedLava) throw new Error("Lava button did not select lava");
  log(`[${tag}] lava palette selection OK`, lines);

  const shotPath = path.join(SCRATCH, `screenshot-${tag}.png`);
  await page.screenshot({ path: shotPath, fullPage: true });
  log(`[${tag}] screenshot: ${shotPath}`, lines);

  if (pageErrors.length) {
    throw new Error("Page errors: " + pageErrors.join("; "));
  }
  // Filter benign console noise
  const realConsole = consoleErrors.filter((e) => !/favicon/i.test(e));
  if (realConsole.length) {
    log(`[${tag}] console errors: ${realConsole.join(" | ")}`, lines);
    throw new Error("Console errors: " + realConsole.join("; "));
  }

  await page.close();
  return { paintResult, dims };
}

async function main() {
  const lines = [];
  let server;
  try {
    const srv = await startServer();
    server = srv.server;
    const baseUrl = `http://127.0.0.1:${srv.port}`;
    log(`Server at ${baseUrl}`, lines);

    const browser = await chromium.launch({ headless: true });
    try {
      await runOnce(browser, baseUrl, lines, "run1");
      await runOnce(browser, baseUrl, lines, "run2");
      log("Browser verification PASSED", lines);
    } finally {
      await browser.close();
    }
  } catch (e) {
    log("Browser verification FAILED: " + e.message, lines);
    log(String(e.stack || e), lines);
    const out = path.join(SCRATCH, "launch-env.log");
    await writeLog(out, lines);
    // Also write console log
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
