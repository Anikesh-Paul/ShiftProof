/**
 * Full Playwright UI audit after polish.
 * node web/scripts/ui-audit-full.mjs [baseUrl]
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(
  "C:/Users/kamal/AppData/Roaming/npm/node_modules/@playwright/test",
);

const base = process.argv[2] || "http://localhost:5174";
const out = path.resolve("web/playwright-shots/v2");
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = [];

async function capture(label, page) {
  const file = path.join(out, `${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const text = (await page.locator("body").innerText()).slice(0, 900);
  results.push({ label, url: page.url(), text, file });
  console.log("OK", label, page.url());
}

async function login(page, email, password) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 25000 }),
    page.click('button[type="submit"]'),
  ]);
}

// Mobile
{
  const ctx = await browser.newContext({
    ...devices["iPhone 13"],
    colorScheme: "light",
  });
  const page = await ctx.newPage();

  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await capture("01-login-mobile", page);

  await login(page, "staff@shiftproof.demo", "DemoStaff123!");
  await page.waitForTimeout(4000);
  await capture("02-staff-home", page);

  await page.locator('a[href="/staff/shifts"]').click();
  await page.waitForTimeout(1500);
  await capture("03-staff-history", page);

  await page.getByRole("button", { name: /log out/i }).click();
  await page.waitForTimeout(800);

  await login(page, "manager@shiftproof.demo", "DemoManager123!");
  await page.waitForTimeout(5000);
  await capture("04-manager-home", page);

  const shift = page.locator('a[href^="/manager/shifts/"]').first();
  if ((await shift.count()) > 0) {
    await shift.click();
    await page.waitForTimeout(2000);
    await capture("05-manager-scoreboard", page);
    // select first finding
    const finding = page.locator(".finding-row").first();
    if ((await finding.count()) > 0) {
      await finding.click();
      await page.waitForTimeout(400);
      await capture("06-manager-finding-selected", page);
    }
  } else {
    console.log("WARN no manager shift links");
  }

  await ctx.close();
}

// Desktop
{
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: "light",
  });
  const page = await ctx.newPage();
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await capture("07-login-desktop", page);

  await login(page, "manager@shiftproof.demo", "DemoManager123!");
  await page.waitForTimeout(5000);
  await capture("08-manager-desktop", page);

  await page.getByRole("button", { name: /log out/i }).click();
  await page.waitForTimeout(600);
  await login(page, "staff@shiftproof.demo", "DemoStaff123!");
  await page.waitForTimeout(4000);
  await capture("09-staff-desktop", page);

  await ctx.close();
}

await browser.close();
await writeFile(
  path.join(out, "report.json"),
  JSON.stringify({ base, at: new Date().toISOString(), results }, null, 2),
);
console.log("report", path.join(out, "report.json"));
console.log("shots", out);
