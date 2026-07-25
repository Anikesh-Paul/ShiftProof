/**
 * Screenshot staff home after login.
 * Usage: node web/scripts/shot-staff-home.mjs [baseUrl] [tag]
 */
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(
  "C:/Users/kamal/AppData/Roaming/npm/node_modules/@playwright/test",
);

const base = process.argv[2] || "http://localhost:5173";
const tag = process.argv[3] || "shot";
const out = path.resolve("web/playwright-shots");
await mkdir(out, { recursive: true });

async function login(page) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", "staff@shiftproof.demo");
  await page.fill("#password", "DemoStaff123!");
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 25000 }),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(4000);
}

const browser = await chromium.launch({ headless: true });

{
  const ctx = await browser.newContext({
    ...devices["iPhone 13"],
    colorScheme: "light",
  });
  const page = await ctx.newPage();
  await login(page);
  const file = path.join(out, `staff-home-${tag}-mobile.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log("saved", file, page.url());
  await ctx.close();
}

{
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: "light",
  });
  const page = await ctx.newPage();
  await login(page);
  const file = path.join(out, `staff-home-${tag}-desktop.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log("saved", file, page.url());
  await ctx.close();
}

await browser.close();
