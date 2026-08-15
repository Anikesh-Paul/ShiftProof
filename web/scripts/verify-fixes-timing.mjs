/**
 * Assert Fix needed appears quickly after staff login (not after a long stall).
 * node web/scripts/verify-fixes-timing.mjs [baseUrl]
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(
  "C:/Users/kamal/AppData/Roaming/npm/node_modules/@playwright/test",
);

const base = process.argv[2] || "http://localhost:5173";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ...devices["iPhone 13"] });
const page = await ctx.newPage();

await page.goto(`${base}/login`, { waitUntil: "networkidle", timeout: 45000 });
await page.fill("#email", "staff@shiftproof.demo");
await page.fill("#password", "DemoStaff123!");
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 }),
  page.click('button[type="submit"]'),
]);

await page.goto(`${base}/staff`, { waitUntil: "domcontentloaded" });
const start = Date.now();

const skeleton = page.locator(".staff-fixes-skeleton-block");
const fixes = page.locator("[data-testid='open-fixes']");

await Promise.race([
  skeleton.waitFor({ state: "visible", timeout: 4000 }),
  fixes.waitFor({ state: "visible", timeout: 4000 }),
]).catch(() => {});

const firstMs = Date.now() - start;
const sawSkeleton = (await skeleton.count()) > 0 && (await skeleton.isVisible());
const sawFixesEarly = (await fixes.count()) > 0 && (await fixes.isVisible());

await fixes.waitFor({ state: "visible", timeout: 8000 });
const fixesMs = Date.now() - start;
const rows = await page.locator("[data-testid='staff-fix-row']").count();

console.log(
  JSON.stringify(
    { firstMs, fixesMs, sawSkeleton, sawFixesEarly, rows },
    null,
    2,
  ),
);

const fail = [];
if (firstMs > 2500) fail.push(`placeholder too late: ${firstMs}ms`);
if (fixesMs > 4000) fail.push(`fixes too late: ${fixesMs}ms`);
if (rows < 1) fail.push("no fix rows");

await browser.close();
if (fail.length) {
  console.error("FAIL", fail.join("; "));
  process.exit(1);
}
console.log("PASS fixes appear without a long stall");
