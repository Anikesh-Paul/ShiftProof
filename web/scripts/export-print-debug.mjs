/**
 * Measure compliance export print layout for left-shift.
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(
  "C:/Users/kamal/AppData/Roaming/npm/node_modules/@playwright/test",
);

const base = process.argv[2] || "http://localhost:5173";
const out = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../playwright-shots/export-print",
);
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1024, height: 1400 },
});

await page.goto(`${base}/login`, { waitUntil: "networkidle" });
await page.fill("#email", "manager@shiftproof.demo");
await page.fill("#password", "DemoManager123!");
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 }),
  page.click('button[type="submit"]'),
]);
await page.waitForTimeout(4500);

const href = await page
  .locator('a[href^="/manager/shifts/"]')
  .first()
  .getAttribute("href");
if (!href) throw new Error("no shift link");
await page.goto(`${base}${href}/export`, { waitUntil: "networkidle" });
await page.waitForSelector(".export-page", { timeout: 30000 });
await page.waitForTimeout(600);

await page.screenshot({
  path: path.join(out, "01-screen.png"),
  fullPage: true,
});

function measure() {
  return page.evaluate(() => {
    const article = document.querySelector(".export-page");
    const shell = document.querySelector(".export-shell");
    const chrome = document.querySelector(".shell-chrome");
    const toolbar = document.querySelector(".export-toolbar");
    const vw = document.documentElement.clientWidth;
    const a = article?.getBoundingClientRect();
    const s = shell?.getBoundingClientRect();
    return {
      vw,
      article: a
        ? {
            left: +a.left.toFixed(2),
            right: +a.right.toFixed(2),
            width: +a.width.toFixed(2),
            offsetLeft: +a.left.toFixed(2),
            offsetRight: +(vw - a.right).toFixed(2),
            deltaLR: +(a.left - (vw - a.right)).toFixed(2),
          }
        : null,
      shell: s
        ? {
            left: +s.left.toFixed(2),
            width: +s.width.toFixed(2),
            padding: getComputedStyle(shell).padding,
          }
        : null,
      chromeDisplay: chrome ? getComputedStyle(chrome).display : null,
      toolbarDisplay: toolbar ? getComputedStyle(toolbar).display : null,
      pageStyles: article
        ? {
            margin: getComputedStyle(article).margin,
            padding: getComputedStyle(article).padding,
            maxWidth: getComputedStyle(article).maxWidth,
            width: getComputedStyle(article).width,
            boxSizing: getComputedStyle(article).boxSizing,
          }
        : null,
    };
  });
}

const screenMetrics = await measure();
console.log("SCREEN", JSON.stringify(screenMetrics, null, 2));

await page.emulateMedia({ media: "print" });
await page.waitForTimeout(400);
await page.screenshot({
  path: path.join(out, "02-print-media.png"),
  fullPage: true,
});

const printMetrics = await measure();
console.log("PRINT", JSON.stringify(printMetrics, null, 2));

// A4-ish page box simulation (794x1123 CSS px ≈ 96dpi A4)
await page.setViewportSize({ width: 794, height: 1123 });
await page.waitForTimeout(200);
const a4Metrics = await measure();
console.log("PRINT_A4", JSON.stringify(a4Metrics, null, 2));
await page.screenshot({
  path: path.join(out, "03-print-a4.png"),
  fullPage: true,
});

await writeFile(
  path.join(out, "metrics.json"),
  JSON.stringify({ screenMetrics, printMetrics, a4Metrics }, null, 2),
);

const bad =
  Math.abs(printMetrics.article?.deltaLR ?? 0) > 2 ||
  Math.abs(a4Metrics.article?.deltaLR ?? 0) > 2 ||
  Math.abs(screenMetrics.article?.deltaLR ?? 0) > 4;

await browser.close();
if (bad) {
  console.error("ASYMMETRY_DETECTED");
  process.exit(1);
}
console.log("OK symmetric");
