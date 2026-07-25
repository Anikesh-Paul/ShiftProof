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
await page.waitForTimeout(500);
await page.screenshot({
  path: "web/playwright-shots/v2/06b-sticky-fixed.png",
  fullPage: true,
});
console.log("saved");
await browser.close();
