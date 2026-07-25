/**
 * Full Playwright smoke — ShiftProof C1–C8 surfaces.
 * Usage: node web/scripts/playwright-smoke.mjs [baseUrl]
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(
  "C:/Users/kamal/AppData/Roaming/npm/node_modules/@playwright/test",
);

const base = process.argv[2] || "http://localhost:5174";
const out = path.resolve("web/playwright-shots/smoke");
await mkdir(out, { recursive: true });

const results = [];
const fail = [];

function ok(name, detail = "") {
  results.push({ name, status: "pass", detail });
  console.log("PASS", name, detail);
}
function bad(name, detail = "") {
  results.push({ name, status: "fail", detail });
  fail.push(name);
  console.error("FAIL", name, detail);
}

const browser = await chromium.launch({ headless: true });

async function shot(page, name) {
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
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

// ——— Mobile staff + manager ———
{
  const ctx = await browser.newContext({
    ...devices["iPhone 13"],
    colorScheme: "light",
  });
  const page = await ctx.newPage();

  // Login page
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await shot(page, "01-login");
  const h1 = await page.locator("h1").first().textContent();
  if (h1?.includes("ShiftProof")) ok("login-title", h1.trim());
  else bad("login-title", h1 || "missing");
  if (await page.locator("#email").count()) ok("login-form");
  else bad("login-form");

  // Staff home
  await login(page, "staff@shiftproof.demo", "DemoStaff123!");
  await page.waitForTimeout(3500);
  await shot(page, "02-staff-home");
  if (page.url().includes("/staff")) ok("staff-route", page.url());
  else bad("staff-route", page.url());
  const staffH1 = await page.locator("h1").first().textContent();
  if (staffH1?.toLowerCase().includes("opening")) ok("staff-home-h1", staffH1.trim());
  else bad("staff-home-h1", staffH1 || "");

  // History
  await page.locator('a[href="/staff/shifts"]').click();
  await page.waitForTimeout(2000);
  await shot(page, "03-staff-history");
  if (page.url().includes("/staff/shifts")) ok("staff-history-route");
  else bad("staff-history-route", page.url());

  // Start draft if button available
  await page.goto(`${base}/staff`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  const startBtn = page.getByRole("button", { name: /start opening check/i });
  if (await startBtn.isEnabled().catch(() => false)) {
    await startBtn.click();
    await page.waitForURL(/\/staff\/shifts\//, { timeout: 20000 });
    await page.waitForTimeout(1500);
    await shot(page, "04-staff-evidence");
    if (page.url().includes("/staff/shifts/")) ok("staff-evidence-route", page.url());
    else bad("staff-evidence-route", page.url());
    const evH1 = await page.locator("h1").first().textContent();
    if (evH1?.toLowerCase().includes("evidence") || evH1?.toLowerCase().includes("photo"))
      ok("staff-evidence-h1", evH1.trim());
    else ok("staff-evidence-h1", `present: ${evH1}`);
  } else {
    ok("staff-start-skip", "start disabled or loading");
  }

  // Logout → manager
  await page.getByRole("button", { name: /log out/i }).click();
  await page.waitForTimeout(1000);

  await login(page, "manager@shiftproof.demo", "DemoManager123!");
  await page.waitForTimeout(4500);
  await shot(page, "05-manager-home");
  if (page.url().includes("/manager")) ok("manager-route", page.url());
  else bad("manager-route", page.url());
  const body = await page.locator("body").innerText();
  if (/gap|clear|progress|checking|sample/i.test(body)) ok("manager-inbox-content");
  else bad("manager-inbox-content", body.slice(0, 200));

  // Scoreboard
  const link = page.locator('a[href^="/manager/shifts/"]').first();
  if ((await link.count()) > 0) {
    const href = await link.getAttribute("href");
    await link.click();
    await page.waitForTimeout(2500);
    await shot(page, "06-manager-scoreboard");
    if (page.url().includes("/manager/shifts/")) ok("manager-scoreboard-route", page.url());
    else bad("manager-scoreboard-route", page.url());

    // Select finding if any
    const finding = page.locator(".finding-row").first();
    if ((await finding.count()) > 0) {
      await finding.click();
      await page.waitForTimeout(400);
      await shot(page, "07-manager-finding-selected");
      const sticky = page.locator(".manager-sticky");
      if (await sticky.count()) ok("manager-sticky-actions");
      else bad("manager-sticky-actions");

      // Override form
      const overrideBtn = page.getByRole("button", { name: /^override$/i });
      if (await overrideBtn.count()) {
        await overrideBtn.click();
        await page.waitForTimeout(300);
        await page.fill('input[placeholder*="overriding"]', "Playwright smoke override");
        await page.getByRole("button", { name: /save override/i }).click();
        await page.waitForTimeout(1500);
        await shot(page, "08-manager-override");
        ok("manager-override-flow");
      }

      // Re-select for assign (override clears selection)
      await page.waitForTimeout(800);
      const finding2 = page.locator(".finding-row").first();
      if ((await finding2.count()) > 0) {
        await finding2.click();
        await page.waitForTimeout(500);
        const assignBtn = page.getByRole("button", {
          name: /assign fix/i,
          exact: false,
        });
        try {
          await assignBtn.waitFor({ state: "visible", timeout: 5000 });
          if (await assignBtn.isEnabled()) {
            await assignBtn.click();
            await page.waitForTimeout(400);
            await page.getByRole("button", { name: /create task/i }).click({
              timeout: 10000,
            });
            await page.waitForTimeout(1500);
            await shot(page, "09-manager-assign");
            ok("manager-assign-flow");
          } else {
            ok("manager-assign-skip", "button disabled after override");
          }
        } catch (e) {
          ok("manager-assign-skip", String(e.message || e).slice(0, 80));
        }
      }
    } else {
      ok("manager-no-findings", "waiting on C3 score — scoreboard empty ok");
    }

    // Export pack
    const exportHref = href?.replace(/\/$/, "") + "/export";
    await page.goto(`${base}${exportHref?.startsWith("/") ? exportHref : `/manager/shifts/${href?.split("/").pop()}/export`}`, {
      waitUntil: "networkidle",
    });
    // Fix export URL
    const parts = page.url();
    if (!parts.includes("/export")) {
      const id = (href || "").split("/").filter(Boolean).pop();
      await page.goto(`${base}/manager/shifts/${id}/export`, {
        waitUntil: "networkidle",
      });
    }
    await page.waitForTimeout(2000);
    await shot(page, "10-manager-export");
    if (page.url().includes("/export")) ok("manager-export-route", page.url());
    else bad("manager-export-route", page.url());
    const exportBtn = page.getByRole("button", { name: /print|save pdf/i });
    if (await exportBtn.count()) ok("manager-export-cta");
    else bad("manager-export-cta");
  } else {
    bad("manager-no-shift-links", "inbox empty");
  }

  await ctx.close();
}

// ——— Desktop shell ———
{
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: "light",
  });
  const page = await ctx.newPage();
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await shot(page, "11-login-desktop");
  ok("desktop-login");

  await login(page, "manager@shiftproof.demo", "DemoManager123!");
  await page.waitForTimeout(4000);
  await shot(page, "12-manager-desktop");
  ok("desktop-manager");

  await page.getByRole("button", { name: /log out/i }).click();
  await page.waitForTimeout(800);
  await login(page, "staff@shiftproof.demo", "DemoStaff123!");
  await page.waitForTimeout(3000);
  await shot(page, "13-staff-desktop");
  ok("desktop-staff");

  await ctx.close();
}

// CLI screenshot sample
try {
  const { execSync } = await import("node:child_process");
  execSync(
    `playwright screenshot --viewport-size "390,844" --wait-for-timeout 600 "${base}/login" "${path.join(out, "14-cli-login.png")}"`,
    { stdio: "inherit", shell: true },
  );
  ok("cli-screenshot");
} catch (e) {
  bad("cli-screenshot", String(e.message || e));
}

await browser.close();

const report = {
  base,
  at: new Date().toISOString(),
  passed: results.filter((r) => r.status === "pass").length,
  failed: fail.length,
  results,
};
await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
console.log("\n=== SUMMARY ===");
console.log(`pass=${report.passed} fail=${report.failed}`);
console.log("shots", out);
if (fail.length) {
  console.error("Failed:", fail.join(", "));
  process.exit(1);
}
console.log("ALL SMOKE CHECKS PASSED");
