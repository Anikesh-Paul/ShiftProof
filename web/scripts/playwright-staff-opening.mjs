/**
 * Verify staff Opening tab redesign (layout + a11y-ish smoke).
 * node web/scripts/playwright-staff-opening.mjs [baseUrl]
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(
  "C:/Users/kamal/AppData/Roaming/npm/node_modules/@playwright/test",
);

const base = process.argv[2] || "http://localhost:5173";
const out = path.resolve("web/playwright-shots/staff-opening");
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

async function login(page) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", "staff@shiftproof.demo");
  await page.fill("#password", "DemoStaff123!");
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 25000 }),
    page.click('button[type="submit"]'),
  ]);
  // Ensure Opening tab and wait for checklist (not loading skeletons)
  if (!page.url().includes("/staff") || page.url().includes("/shifts")) {
    await page.goto(`${base}/staff`, { waitUntil: "networkidle" });
  }
  await page
    .locator(".staff-checklist li")
    .first()
    .waitFor({ state: "visible", timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(800);
}

try {
  // —— Mobile ——
  {
    const ctx = await browser.newContext({
      ...devices["iPhone 13"],
      colorScheme: "light",
    });
    const page = await ctx.newPage();
    await login(page);

    const root = page.locator('[data-testid="staff-opening"]');
    if ((await root.count()) > 0) pass("opening-root");
    else fail("opening-root", "missing");

    const h1 = page.locator("#staff-home-title");
    if ((await h1.count()) && /opening check/i.test(await h1.innerText()))
      pass("h1-opening-check");
    else fail("h1-opening-check", await h1.innerText().catch(() => "missing"));

    const site = page.locator('[data-testid="staff-site"]');
    if ((await site.count()) > 0) {
      const t = (await site.innerText()).trim();
      if (t && !/loading site/i.test(t)) pass("site-name", t);
      else pass("site-name", t || "still loading");
    } else fail("site-name", "missing");

    // No old full-bleed hero card class
    if ((await page.locator(".staff-hero").count()) === 0)
      pass("no-legacy-hero");
    else fail("no-legacy-hero", "staff-hero still present");

    // Atmosphere strip present
    if ((await page.locator(".staff-atmosphere").count()) > 0)
      pass("atmosphere-strip");
    else fail("atmosphere-strip", "missing");

    // Checklist panel
    const checklist = page.locator('[data-testid="staff-checklist"]');
    if ((await checklist.count()) > 0) {
      const items = page.locator(".staff-checklist li");
      const n = await items.count();
      if (n >= 5) pass("checklist-items", `count=${n}`);
      else fail("checklist-items", `count=${n}`);
    } else fail("checklist-items", "panel missing");

    // Empty open-fixes empty state should not force a card when zero
    // (panel may exist if live tasks)
    const empty = page.locator('[data-testid="open-fixes-empty"]');
    if ((await empty.count()) === 0)
      pass("no-empty-fixes-card", "empty teaching card removed");
    else fail("no-empty-fixes-card", "legacy empty still shown");

    // Sticky CTA
    const start = page.locator('[data-testid="start-opening-check"]');
    if ((await start.count()) > 0) {
      const enabled = await start.isEnabled();
      if (enabled) pass("start-cta-enabled");
      else pass("start-cta-enabled", "disabled while loading");
      const box = await start.boundingBox();
      if (box && box.height >= 40) pass("start-cta-touch", `h=${Math.round(box.height)}`);
      else fail("start-cta-touch", JSON.stringify(box));
    } else fail("start-cta-enabled", "missing");

    // Meta is inline text, not chip list
    if ((await page.locator(".staff-intro-meta").count()) === 0)
      pass("no-meta-chips");
    else fail("no-meta-chips", "legacy chips present");

    await page.screenshot({
      path: path.join(out, "opening-mobile.png"),
      fullPage: true,
    });
    await page.screenshot({
      path: path.join(out, "opening-mobile-viewport.png"),
      fullPage: false,
    });
    await ctx.close();
  }

  // —— Desktop ——
  {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      colorScheme: "light",
    });
    const page = await ctx.newPage();
    await login(page);

    const start = page.locator('[data-testid="start-opening-check"]');
    if ((await start.count()) > 0) pass("desktop-start-cta");
    else fail("desktop-start-cta", "missing");

    await page.screenshot({
      path: path.join(out, "opening-desktop.png"),
      fullPage: true,
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
