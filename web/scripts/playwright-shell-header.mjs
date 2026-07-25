/**
 * Verify staff shell chrome is a single horizontal row (not two stacked lines).
 * node web/scripts/playwright-shell-header.mjs [baseUrl]
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(
  "C:/Users/kamal/AppData/Roaming/npm/node_modules/@playwright/test",
);

const base = process.argv[2] || "http://localhost:5173";
const out = path.resolve("playwright-shots/shell-header");
await mkdir(out, { recursive: true });

const results = [];
function pass(id, detail = "") {
  results.push({ id, status: "pass", detail });
  console.log("PASS", id, detail);
}
function fail(id, detail = "") {
  results.push({ id, status: "fail", detail });
  console.error("FAIL", id, detail);
}

const browser = await chromium.launch({ headless: true });

async function loginStaff(page) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", "staff@shiftproof.demo");
  await page.fill("#password", "DemoStaff123!");
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 25000 }),
    page.click('button[type="submit"]'),
  ]);
  await page.goto(`${base}/staff`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
}

try {
  for (const [label, contextOpts] of [
    ["mobile", { ...devices["iPhone 13"], colorScheme: "light" }],
    ["desktop", { viewport: { width: 1280, height: 800 }, colorScheme: "light" }],
  ]) {
    const ctx = await browser.newContext(contextOpts);
    const page = await ctx.newPage();
    await loginStaff(page);

    const chrome = page.locator('[data-testid="shell-chrome"]');
    const nav = page.locator('[data-testid="shell-nav"]');
    const wordmark = page.locator(".shell-wordmark");
    const opening = page.getByRole("link", { name: /^opening$/i });
    const history = page.getByRole("link", { name: /^history$/i });

    if ((await chrome.count()) !== 1) {
      fail(`${label}-chrome`, "missing chrome");
      await ctx.close();
      continue;
    }
    pass(`${label}-chrome`);

    if ((await nav.count()) !== 1) fail(`${label}-nav`, "missing");
    else pass(`${label}-nav`);

    const chromeBox = await chrome.boundingBox();
    const navBox = await nav.boundingBox();
    const wmBox = await wordmark.boundingBox();
    const openBox = await opening.boundingBox();
    const histBox = await history.boundingBox();

    if (!chromeBox || !navBox || !wmBox || !openBox || !histBox) {
      fail(`${label}-boxes`, "missing bounding boxes");
    } else {
      // Single row: chrome height stays compact (not two stacked toolbars)
      if (chromeBox.height <= 72) {
        pass(`${label}-chrome-height`, `h=${Math.round(chromeBox.height)}`);
      } else {
        fail(
          `${label}-chrome-height`,
          `too tall h=${Math.round(chromeBox.height)} (expected single row ≤72)`,
        );
      }

      // Brand + Opening + History share roughly the same vertical center
      const centers = [wmBox, openBox, histBox].map(
        (b) => b.y + b.height / 2,
      );
      const maxDelta = Math.max(...centers) - Math.min(...centers);
      if (maxDelta <= 12) {
        pass(`${label}-vertical-align`, `Δy=${maxDelta.toFixed(1)}px`);
      } else {
        fail(
          `${label}-vertical-align`,
          `Δy=${maxDelta.toFixed(1)}px (stacked rows)`,
        );
      }

      // Nav is to the right of wordmark (same row flow)
      if (openBox.x > wmBox.x + wmBox.width * 0.5) {
        pass(`${label}-nav-after-brand`);
      } else {
        fail(`${label}-nav-after-brand`, "nav not after brand");
      }
    }

    await page.screenshot({
      path: path.join(out, `header-${label}.png`),
      fullPage: false,
    });
    await ctx.close();
  }

  const failed = results.filter((r) => r.status === "fail");
  await writeFile(
    path.join(out, "report.json"),
    JSON.stringify({ base, results, failed: failed.length }, null, 2),
  );
  console.log(
    "\nSummary:",
    results.length - failed.length,
    "pass,",
    failed.length,
    "fail",
  );
  if (failed.length) process.exitCode = 1;
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
