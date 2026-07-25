import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, devices } = require(
  "C:/Users/kamal/AppData/Roaming/npm/node_modules/@playwright/test",
);

const base = process.argv[2] || "http://localhost:5174";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ...devices["iPhone 13"] });
const page = await ctx.newPage();
await page.goto(`${base}/login`, { waitUntil: "networkidle" });
await page.fill("#email", "manager@shiftproof.demo");
await page.fill("#password", "DemoManager123!");
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes("/login")),
  page.click('button[type="submit"]'),
]);
await page.waitForTimeout(4000);
await page.locator('a[href^="/manager/shifts/"]').first().click();
await page.waitForTimeout(1500);
await page.locator(".finding-row").first().click();
await page.waitForTimeout(400);
// viewport only — fixed bar should pin to bottom
await page.screenshot({
  path: "web/playwright-shots/v2/06c-sticky-viewport.png",
  fullPage: false,
});
// scroll down then capture again
await page.evaluate(() => window.scrollBy(0, 400));
await page.waitForTimeout(200);
await page.screenshot({
  path: "web/playwright-shots/v2/06d-sticky-scrolled.png",
  fullPage: false,
});
console.log("saved viewport shots");
await browser.close();
