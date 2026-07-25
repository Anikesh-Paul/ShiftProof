/**
 * Playwright UI capture for ShiftProof login / staff / manager.
 * Usage: node web/scripts/ui-audit.mjs [baseUrl]
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(
  "C:/Users/kamal/AppData/Roaming/npm/node_modules/@playwright/test",
);

const base = process.argv[2] || "http://localhost:5174";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "playwright-shots");

const CREDS = {
  staff: { email: "staff@shiftproof.demo", password: "DemoStaff123!" },
  manager: { email: "manager@shiftproof.demo", password: "DemoManager123!" },
};

async function shot(page, name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log("saved", file);
  return file;
}

async function login(page, email, password) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 20000,
  });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    colorScheme: "light",
  });
  const page = await context.newPage();
  const notes = [];

  // Login empty
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await shot(page, "01-login");
  notes.push({
    screen: "login",
    url: page.url(),
    title: await page.title(),
    h1: await page.locator("h1").first().textContent().catch(() => null),
  });

  // Staff flow
  await login(page, CREDS.staff.email, CREDS.staff.password);
  await page.waitForTimeout(800);
  await shot(page, "02-staff-home");
  notes.push({
    screen: "staff-home",
    url: page.url(),
    h1: await page.locator("h1").first().textContent().catch(() => null),
    bodyText: (await page.locator("main, body").first().innerText()).slice(0, 400),
  });

  // Staff history if nav exists
  const history = page.locator('a[href="/staff/shifts"]');
  if (await history.count()) {
    await history.first().click();
    await page.waitForTimeout(800);
    await shot(page, "03-staff-history");
    notes.push({
      screen: "staff-history",
      url: page.url(),
      h1: await page.locator("h1").first().textContent().catch(() => null),
    });
  }

  // Logout via ghost button if present
  const logout = page.getByRole("button", { name: /log out/i });
  if (await logout.count()) {
    await logout.first().click();
    await page.waitForTimeout(600);
  } else {
    await context.clearCookies();
    await page.goto(`${base}/login`);
  }

  // Manager flow
  await login(page, CREDS.manager.email, CREDS.manager.password);
  await page.waitForTimeout(1000);
  await shot(page, "04-manager-home");
  notes.push({
    screen: "manager-home",
    url: page.url(),
    h1: await page.locator("h1").first().textContent().catch(() => null),
    bodyText: (await page.locator("main, body").first().innerText()).slice(0, 500),
  });

  const firstShift = page.locator('a[href^="/manager/shifts/"]').first();
  if (await firstShift.count()) {
    await firstShift.click();
    await page.waitForTimeout(1000);
    await shot(page, "05-manager-scoreboard");
    notes.push({
      screen: "manager-scoreboard",
      url: page.url(),
      h1: await page.locator("h1").first().textContent().catch(() => null),
      bodyText: (await page.locator("main, body").first().innerText()).slice(0, 500),
    });
  }

  // Desktop login for comparison
  await browser.close();

  const desktop = await chromium.launch({ headless: true });
  const dCtx = await desktop.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: "light",
  });
  const dPage = await dCtx.newPage();
  await dPage.goto(`${base}/login`, { waitUntil: "networkidle" });
  await dPage.waitForTimeout(400);
  await dPage.screenshot({
    path: path.join(outDir, "06-login-desktop.png"),
    fullPage: true,
  });
  console.log("saved", path.join(outDir, "06-login-desktop.png"));

  await login(dPage, CREDS.manager.email, CREDS.manager.password);
  await dPage.waitForTimeout(800);
  await dPage.screenshot({
    path: path.join(outDir, "07-manager-desktop.png"),
    fullPage: true,
  });
  console.log("saved", path.join(outDir, "07-manager-desktop.png"));
  await desktop.close();

  const reportPath = path.join(outDir, "report.json");
  await writeFile(reportPath, JSON.stringify({ base, notes, at: new Date().toISOString() }, null, 2));
  console.log("report", reportPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
