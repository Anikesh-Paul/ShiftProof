/**
 * Assert staff/manager sticky chrome is fully opaque (no glass bleed).
 * node web/scripts/verify-chrome-opaque.mjs [baseUrl]
 */
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("@playwright/test");

const base = process.argv[2] || "http://localhost:5173";
const out = path.resolve("web/playwright-shots/chrome-opaque");
await mkdir(out, { recursive: true });

function parseAlpha(color) {
  const slash = color.match(/\/\s*([\d.]+%?)\s*\)/);
  if (slash) {
    const a = slash[1].endsWith("%")
      ? Number.parseFloat(slash[1]) / 100
      : Number.parseFloat(slash[1]);
    return { raw: color, alpha: a };
  }
  const rgba = color.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/i,
  );
  if (rgba) {
    if (rgba[4] == null) return { raw: color, alpha: 1 };
    const a = rgba[4].endsWith("%")
      ? Number.parseFloat(rgba[4]) / 100
      : Number.parseFloat(rgba[4]);
    return { raw: color, alpha: a };
  }
  if (/^(oklch|oklab|lab|lch|color|rgb|hsl)\(/i.test(color)) {
    return { raw: color, alpha: 1 };
  }
  return { raw: color, alpha: null };
}

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

async function login(page, email, password) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 25000 }),
    page.click('button[type="submit"]'),
  ]);
}

async function chromeStyles(page) {
  return page.locator('[data-testid="shell-chrome"]').evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      backgroundColor: s.backgroundColor,
      backdropFilter: s.backdropFilter,
      webkitBackdropFilter: s.webkitBackdropFilter || "",
    };
  });
}

async function assertOpaque(page, id, shotName) {
  const styles = await chromeStyles(page);
  const parsed = parseAlpha(styles.backgroundColor);
  const blur =
    `${styles.backdropFilter} ${styles.webkitBackdropFilter}`.includes("blur");

  if (parsed.alpha != null && parsed.alpha >= 0.99) {
    pass(`${id}-alpha`, `${parsed.raw} α=${parsed.alpha}`);
  } else {
    fail(`${id}-alpha`, `${parsed.raw} α=${parsed.alpha}`);
  }

  if (!blur) {
    pass(`${id}-no-blur`, styles.backdropFilter);
  } else {
    fail(
      `${id}-no-blur`,
      `backdrop=${styles.backdropFilter} webkit=${styles.webkitBackdropFilter}`,
    );
  }

  const heading = page.locator("h1").first();
  if ((await heading.count()) > 0) {
    await heading.evaluate((el) => {
      const chrome = document.querySelector('[data-testid="shell-chrome"]');
      if (!chrome) return;
      const c = chrome.getBoundingClientRect();
      const h = el.getBoundingClientRect();
      window.scrollBy(0, h.top - c.bottom + h.height * 0.6);
    });
    await page.waitForTimeout(250);
  }

  await page.screenshot({
    path: path.join(out, `${shotName}.png`),
    fullPage: false,
  });
}

try {
  const ctx = await browser.newContext({
    ...devices["iPhone 13"],
    colorScheme: "light",
  });
  const page = await ctx.newPage();
  await login(page, "staff@shiftproof.demo", "DemoStaff123!");
  await page.goto(`${base}/staff`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await assertOpaque(page, "staff-home", "staff-home-scrolled");

  await page.goto(`${base}/staff/shifts`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await assertOpaque(page, "staff-history", "staff-history-scrolled");
  await ctx.close();

  const mgr = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: "light",
  });
  const mPage = await mgr.newPage();
  await login(mPage, "manager@shiftproof.demo", "DemoManager123!");
  await mPage.goto(`${base}/manager`, { waitUntil: "networkidle" });
  await mPage.waitForTimeout(800);
  await assertOpaque(mPage, "manager-home", "manager-home-scrolled");
  await mgr.close();

  const dark = await browser.newContext({
    ...devices["iPhone 13"],
    colorScheme: "dark",
  });
  const dPage = await dark.newPage();
  await login(dPage, "staff@shiftproof.demo", "DemoStaff123!");
  await dPage.goto(`${base}/staff`, { waitUntil: "networkidle" });
  await dPage.waitForTimeout(800);
  await assertOpaque(dPage, "staff-dark", "staff-home-dark-scrolled");
  await dark.close();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  const failed = results.filter((r) => r.status === "fail").length;
  console.log(
    "\nSummary:",
    results.length - failed,
    "pass,",
    failed,
    "fail →",
    out,
  );
  if (failed) process.exitCode = 1;
  await browser.close();
}
