/**
 * Verify MANAGER-NEXT remaining steps against local Vite.
 * Usage: node web/scripts/verify-manager-next.mjs [baseUrl] [step]
 */
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(
  "C:/Users/kamal/AppData/Roaming/npm/node_modules/@playwright/test",
);

const base = process.argv[2] || "http://localhost:5173";
const step = process.argv[3] || "1";
const REJECT_SHIFT = "6a7079700001a60ae377";
const out = path.resolve("web/playwright-shots/manager-next");
await mkdir(out, { recursive: true });

const results = [];
function ok(name, detail = "") {
  results.push({ name, status: "pass", detail });
  console.log("PASS", name, detail);
}
function bad(name, detail = "") {
  results.push({ name, status: "fail", detail });
  console.error("FAIL", name, detail);
}

const browser = await chromium.launch({ headless: true });

async function login(page, email, password) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 25000 }),
    page.click('button[type="submit"]'),
  ]);
}

const STALE_SHIFT = "6a5b34c1000d010364a5";

if (step === "3") {
  const ctx = await browser.newContext({
    ...devices["iPhone 13"],
    colorScheme: "light",
  });
  const page = await ctx.newPage();
  await login(page, "manager@shiftproof.demo", "DemoManager123!");
  await page.waitForTimeout(3500);

  await page.goto(`${base}/manager?view=all`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const row = page.locator(`a[href="/manager/shifts/${STALE_SHIFT}"]`);
  if ((await row.count()) === 0) {
    bad("stale-row-visible", "July scoring shift not in All");
  } else {
    const text = ((await row.innerText()) || "").replace(/\s+/g, " ");
    const chip = await row.locator('[data-status="failed"]').count();
    if (chip) ok("statuschip-failed");
    else bad("statuschip-failed", text);
    if (text.includes("Score failed")) ok("inbox-score-failed", text);
    else if (text.includes("Waiting on score")) {
      bad("inbox-score-failed", "still Waiting on score…");
    } else {
      bad("inbox-score-failed", text);
    }
  }
  await page.screenshot({
    path: path.join(out, "03-inbox-failed.png"),
    fullPage: true,
  });
  await ctx.close();
}

if (step === "2") {
  const ctx = await browser.newContext({
    ...devices["iPhone 13"],
    colorScheme: "light",
  });
  const page = await ctx.newPage();
  await login(page, "manager@shiftproof.demo", "DemoManager123!");
  await page.waitForSelector('[data-testid="assign-today-gaps"]', {
    timeout: 20000,
  });
  const beforeText = await page
    .locator(".manager-pulse-item")
    .filter({ hasText: "Open fixes" })
    .locator(".manager-pulse-value")
    .innerText();
  const before = Number.parseInt(beforeText, 10);
  ok("open-fixes-before", String(before));
  const showAllBefore = page.locator('[data-testid="open-fixes"] button', {
    hasText: /Show all/,
  });
  if (await showAllBefore.count()) await showAllBefore.click();
  const listedBefore = await page.locator('[data-testid="open-fixes"] li').count();

  await page.screenshot({
    path: path.join(out, "02-before-assign.png"),
    fullPage: true,
  });
  await page.click('[data-testid="assign-today-gaps"]');
  const toast = page.locator(".manager-sop-toast");
  await toast.waitFor({ timeout: 45000 });
  const toastText = (await toast.textContent())?.trim() || "";
  if (/^Assigned \d+ fixes to /.test(toastText)) ok("assign-toast", toastText);
  else bad("assign-toast", toastText);

  const assigned = Number((toastText.match(/Assigned (\d+)/) || [])[1] || 0);
  if (assigned > 0) ok("assigned-count", String(assigned));
  else bad("assigned-count", toastText);

  await page.waitForTimeout(2500);
  const afterText = await page
    .locator(".manager-pulse-item")
    .filter({ hasText: "Open fixes" })
    .locator(".manager-pulse-value")
    .innerText();
  const after = Number.parseInt(afterText, 10);
  if (after >= before + assigned) ok("open-fixes-increased", `${before} → ${after}`);
  else bad("open-fixes-increased", `${before} → ${after}, expected +${assigned}`);

  const showAllAfter = page.locator('[data-testid="open-fixes"] button', {
    hasText: /Show all/,
  });
  if (await showAllAfter.count()) await showAllAfter.click();
  const listedAfter = await page.locator('[data-testid="open-fixes"] li').count();
  if (listedAfter >= listedBefore + assigned) {
    ok("open-fixes-lists-new", `${listedBefore} → ${listedAfter}`);
  } else {
    bad("open-fixes-lists-new", `${listedBefore} → ${listedAfter}`);
  }
  await page.screenshot({
    path: path.join(out, "02-after-assign.png"),
    fullPage: true,
  });
  await ctx.close();
}

if (step === "1") {
  const ctx = await browser.newContext({
    ...devices["iPhone 13"],
    colorScheme: "light",
  });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());

  await login(page, "manager@shiftproof.demo", "DemoManager123!");
  await page.waitForTimeout(2500);
  await page.screenshot({
    path: path.join(out, "01-inbox-before.png"),
    fullPage: true,
  });

  await page.goto(`${base}/manager/shifts/${REJECT_SHIFT}`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(2000);
  const rejectBtn = page.locator('[data-testid="reject-check-btn"]');
  if (await rejectBtn.count()) ok("reject-btn-visible");
  else bad("reject-btn-visible", "missing");

  const closeBtn = page.getByRole("button", { name: "Close opening" });
  if (await closeBtn.count()) ok("close-btn-beside");
  else bad("close-btn-beside", "Close opening missing");

  await page.screenshot({
    path: path.join(out, "01-scoreboard-reject.png"),
    fullPage: true,
  });
  await rejectBtn.click();
  await page.waitForURL((u) => u.pathname === "/manager", { timeout: 20000 });
  await page.waitForTimeout(2500);
  ok("rejected-navigated-inbox", page.url());

  const body = await page.locator("body").innerText();
  if (body.includes(REJECT_SHIFT)) {
    bad("left-inbox-id", "shift id still in DOM");
  } else {
    ok("left-inbox-id");
  }

  for (const view of ["today", "backlog", "all"]) {
    const href =
      view === "today" ? `${base}/manager` : `${base}/manager?view=${view}`;
    await page.goto(href, { waitUntil: "networkidle" });
    await page.waitForTimeout(1800);
    const hrefs = await page
      .locator(`a[href="/manager/shifts/${REJECT_SHIFT}"]`)
      .count();
    if (hrefs === 0) ok(`gone-from-${view}`);
    else bad(`gone-from-${view}`, `${hrefs} links`);
    await page.screenshot({
      path: path.join(out, `01-after-${view}.png`),
      fullPage: true,
    });
  }
  await ctx.close();

  const staffCtx = await browser.newContext({
    ...devices["iPhone 13"],
    colorScheme: "light",
  });
  const staff = await staffCtx.newPage();
  await login(staff, "staff@shiftproof.demo", "DemoStaff123!");
  await staff.waitForTimeout(1500);
  await staff.goto(`${base}/staff/shifts/${REJECT_SHIFT}`, {
    waitUntil: "networkidle",
  });
  await staff.waitForTimeout(2500);
  const reason = staff.locator('[data-testid="invalid-evidence-reason"]');
  const text = (await reason.count())
    ? (await reason.textContent())?.trim()
    : (await staff.locator("body").innerText()).includes(
        "Manager rejected this check — submit a real opening.",
      )
      ? "Manager rejected this check — submit a real opening."
      : "";
  if (text.includes("Manager rejected this check — submit a real opening.")) {
    ok("staff-sees-reason", text);
  } else {
    bad("staff-sees-reason", (await staff.locator("body").innerText()).slice(0, 400));
  }
  await staff.screenshot({
    path: path.join(out, "01-staff-rejected.png"),
    fullPage: true,
  });
  await staffCtx.close();
}

await browser.close();
const failed = results.filter((r) => r.status === "fail");
console.log("\n=== step", step, failed.length ? "FAILED" : "OK", "===");
if (failed.length) process.exit(1);
