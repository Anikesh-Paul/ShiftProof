import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(
  "C:/Users/kamal/AppData/Roaming/npm/node_modules/@playwright/test",
);

const base = process.argv[2] || "http://localhost:5173";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ...devices["iPhone 13"],
  colorScheme: "light",
});
const page = await ctx.newPage();
await page.goto(`${base}/login`, { waitUntil: "networkidle" });
await page.fill("#email", "staff@shiftproof.demo");
await page.fill("#password", "DemoStaff123!");
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 25000 }),
  page.click('button[type="submit"]'),
]);
await page.waitForSelector("h1", { timeout: 15000 });
await page.waitForTimeout(2500);

const report = {
  url: page.url(),
  h1: (await page.locator("h1").first().textContent())?.trim(),
  heroImg: await page.locator(".staff-hero-photo").count(),
  heroLines: await page.locator(".staff-hero-copy > *").count(),
  intro: await page.locator(".staff-intro").count(),
  sticky: await page.locator(".staff-cta-bar").count(),
  items: await page.locator(".staff-checklist li").count(),
  enabled: await page
    .getByRole("button", { name: /start opening check/i })
    .isEnabled(),
};

console.log(JSON.stringify(report, null, 2));
if (
  !report.url.includes("/staff") ||
  report.heroImg < 1 ||
  report.heroLines < 2 ||
  report.heroLines > 3 ||
  report.intro < 1 ||
  report.sticky < 1 ||
  report.items < 1 ||
  !report.enabled
) {
  process.exitCode = 1;
}
await browser.close();
