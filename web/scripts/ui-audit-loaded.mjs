import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(
  "C:/Users/kamal/AppData/Roaming/npm/node_modules/@playwright/test",
);

const base = process.argv[2] || "http://localhost:5174";
const out = "web/playwright-shots";
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ...devices["iPhone 13"],
  colorScheme: "light",
});
const page = await ctx.newPage();

async function login(email, password) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 25000 }),
    page.click('button[type="submit"]'),
  ]);
}

await login("staff@shiftproof.demo", "DemoStaff123!");
await page.waitForTimeout(5000);
await page.screenshot({ path: `${out}/02b-staff-home-loaded.png`, fullPage: true });
console.log("staff", page.url());
console.log((await page.locator("body").innerText()).slice(0, 700));

await page.getByRole("button", { name: /log out/i }).click();
await page.waitForTimeout(1000);

await login("manager@shiftproof.demo", "DemoManager123!");
// Prefer demo content over hung live API: wait for either gap headline or empty/error
await page.waitForTimeout(10000);
await page.screenshot({
  path: `${out}/04b-manager-home-loaded.png`,
  fullPage: true,
});
console.log("manager", page.url());
console.log((await page.locator("body").innerText()).slice(0, 900));

const link = page.locator('a[href^="/manager/shifts/"]').first();
if ((await link.count()) > 0) {
  await link.click();
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: `${out}/05-manager-scoreboard.png`,
    fullPage: true,
  });
  console.log("scoreboard", page.url());
  console.log((await page.locator("body").innerText()).slice(0, 700));
} else {
  console.log("no shift links");
}

await browser.close();
console.log("done");
