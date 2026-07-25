import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(
  "C:/Users/kamal/AppData/Roaming/npm/node_modules/@playwright/test",
);

const base = process.argv[2] || "http://localhost:5173";
const out = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../playwright-shots/manager-home-redesign",
);
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true });

async function login(page, email, password) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 }),
    page.click('button[type="submit"]'),
  ]);
}

// Mobile
{
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await login(page, "manager@shiftproof.demo", "DemoManager123!");
  await page.waitForTimeout(4500);
  await page.screenshot({
    path: path.join(out, "manager-home-mobile.png"),
    fullPage: true,
  });
  console.log("mobile", page.url());
  await ctx.close();
}

// Desktop
{
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  await login(page, "manager@shiftproof.demo", "DemoManager123!");
  await page.waitForTimeout(4500);
  await page.screenshot({
    path: path.join(out, "manager-home-desktop.png"),
    fullPage: true,
  });
  console.log("desktop", page.url());
  // viewport above fold
  await page.screenshot({
    path: path.join(out, "manager-home-desktop-viewport.png"),
    fullPage: false,
  });
  await ctx.close();
}

await browser.close();
console.log("shots →", out);
