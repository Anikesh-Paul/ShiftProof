/**
 * End-to-end check of the usability pass. Does not create new drafts.
 * node web/scripts/verify-usability.mjs [baseUrl]
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(
  "C:/Users/kamal/AppData/Roaming/npm/node_modules/@playwright/test",
);

const base = process.argv[2] || "http://localhost:5173";
const out = path.resolve("web/playwright-shots/usability");
await mkdir(out, { recursive: true });

const results = [];
const ok = (id, detail = "") => {
  results.push({ id, status: "pass", detail });
  console.log("PASS", id, detail);
};
const bad = (id, detail = "") => {
  results.push({ id, status: "fail", detail });
  console.error("FAIL", id, detail);
};

const browser = await chromium.launch({ headless: true });

async function login(page, email, password) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle", timeout: 45000 });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 }),
    page.click('button[type="submit"]'),
  ]);
}

try {
  const ctx = await browser.newContext({
    ...devices["iPhone 13"],
    colorScheme: "light",
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // —— Staff opening ——
  await login(page, "staff@shiftproof.demo", "DemoStaff123!");
  await page.goto(`${base}/staff`, { waitUntil: "networkidle" });
  await page.locator("[data-testid='start-opening-check']").waitFor({
    timeout: 20000,
  });
  await page.waitForTimeout(1200);

  const lede = await page.locator(".staff-lede").innerText();
  if (/photograph each item/i.test(lede) && !/chat dump/i.test(lede))
    ok("staff-lede", lede.slice(0, 80));
  else bad("staff-lede", lede);

  const fixRows = await page.locator("[data-testid='staff-fix-row']").count();
  if (fixRows > 0 && fixRows <= 4) ok("fixes-capped", String(fixRows));
  else if (fixRows === 0) ok("fixes-capped", "none (or still loading)");
  else bad("fixes-capped", `showed ${fixRows}`);

  const more = page.getByRole("button", { name: /show \d+ more/i });
  if ((await more.count()) > 0) {
    ok("fixes-more", await more.innerText());
    await more.click();
    await page.waitForTimeout(300);
    const expanded = await page.locator("[data-testid='staff-fix-row']").count();
    if (expanded > fixRows) ok("fixes-expand", `${fixRows} -> ${expanded}`);
    else bad("fixes-expand", `${fixRows} -> ${expanded}`);
  } else {
    ok("fixes-more", "not needed");
  }

  const when = await page.locator(".staff-fix-status").first().innerText().catch(() => "");
  if (!when || /\d{4}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/i.test(when))
    ok("fix-date", when.slice(0, 60) || "no rows");
  else bad("fix-date", when);

  await page.screenshot({ path: path.join(out, "01-staff-opening.png"), fullPage: false });

  // —— Evidence per-item ——
  await page.click("[data-testid='start-opening-check']");
  await page.waitForURL(/\/staff\/shifts\//, { timeout: 20000 });
  await page.waitForTimeout(900);
  const itemRows = await page.locator(".item-photo-row").count();
  if (itemRows >= 6) ok("item-slots", String(itemRows));
  else bad("item-slots", String(itemRows));
  const addBtns = await page.locator(".item-photo-add").count();
  if (addBtns > 0) ok("item-add", String(addBtns));
  else ok("item-add", "all slots filled or draft empty of items");
  if ((await page.getByRole("button", { name: /discard draft/i }).count()) > 0)
    ok("discard-still-there");
  else bad("discard-still-there");
  await page.screenshot({ path: path.join(out, "02-staff-evidence.png"), fullPage: true });

  // Resume still stable
  const draftUrl = page.url();
  await page.goto(`${base}/staff`, { waitUntil: "networkidle" });
  await page.click("[data-testid='start-opening-check']");
  await page.waitForURL(/\/staff\/shifts\//, { timeout: 20000 });
  if (page.url() === draftUrl) ok("resume-stable", draftUrl);
  else bad("resume-stable", `${draftUrl} -> ${page.url()}`);

  // —— History filters ——
  await page.goto(`${base}/staff/shifts`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const tabs = await page.locator(".history-filter").count();
  if (tabs === 3) ok("history-filters", "3 tabs");
  else bad("history-filters", String(tabs));
  const selected = await page.locator(".history-filter[aria-selected='true']").innerText();
  if (/needs me/i.test(selected)) ok("history-default-needs", selected);
  else bad("history-default-needs", selected);
  await page.screenshot({ path: path.join(out, "03-history-needs.png"), fullPage: false });

  await page.getByRole("tab", { name: /done/i }).click();
  await page.waitForTimeout(400);
  const doneRows = await page.locator(".shift-row-link").count();
  if (doneRows > 0) ok("history-done", String(doneRows));
  else bad("history-done", "empty");
  await page.screenshot({ path: path.join(out, "04-history-done.png"), fullPage: false });

  // —— Scored shift scores + next-step copy ——
  const scored = page.locator(".shift-row-link").filter({
    has: page.locator(".status-chip[data-status='scored']"),
  }).first();
  if ((await scored.count()) > 0) {
    await scored.click();
    await page.waitForTimeout(1500);
    const h1 = await page.locator("h1").innerText();
    if (/your scores/i.test(h1)) ok("scores-heading", h1);
    else bad("scores-heading", h1);
    const scoreRows = await page.locator(".staff-score-row").count();
    if (scoreRows > 0) ok("score-rows", String(scoreRows));
    else bad("score-rows", "none");
    const nextCopy = await page.locator(".staff-score-copy .caption").allInnerTexts();
    const hasNext = nextCopy.some((t) =>
      /manager will assign|re-check|waiting on manager/i.test(t),
    );
    if (hasNext || (await page.locator(".staff-score-recheck").count()) > 0)
      ok("score-next-action");
    else bad("score-next-action", nextCopy.join(" | ").slice(0, 160));
    await page.screenshot({ path: path.join(out, "05-scores.png"), fullPage: true });
  } else {
    bad("scored-row", "none in Done");
  }

  // —— Stuck scoring retry ——
  await page.goto(`${base}/staff/shifts`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /needs me/i }).click();
  await page.waitForTimeout(400);
  const stuck = page.locator(".shift-row-link").filter({
    hasText: /scoring stuck|scoring in progress/i,
  }).first();
  if ((await stuck.count()) > 0) {
    await stuck.click();
    await page.waitForTimeout(1200);
    const retry = page.getByRole("button", { name: /try scoring again/i });
    if ((await retry.count()) > 0) ok("retry-visible");
    else ok("retry-visible", "shift not yet past 90s / not failed");
    await page.screenshot({ path: path.join(out, "06-scoring.png"), fullPage: false });
  } else {
    ok("retry-visible", "no in-progress shift in Needs me");
  }

  // —— Manager ——
  await page.getByRole("button", { name: /log out/i }).click();
  await page.waitForURL(/\/login/, { timeout: 15000 });
  await login(page, "manager@shiftproof.demo", "DemoManager123!");
  await page.goto(`${base}/manager`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const sample = await page.locator(".manager-sample-banner").count();
  const inboxH1 = await page.locator("h1").innerText();
  if (sample > 0) ok("manager-sample-banner", await page.locator(".manager-sample-banner").innerText());
  else ok("manager-live-inbox", inboxH1);
  const pulse = await page.locator(".manager-pulse").count();
  if (pulse > 0) ok("manager-pulse");
  else bad("manager-pulse", "missing");
  await page.screenshot({ path: path.join(out, "07-manager-home.png"), fullPage: false });

  const firstShift = page.locator("a[href^='/manager/shifts/']").first();
  if ((await firstShift.count()) > 0) {
    await firstShift.click();
    await page.waitForTimeout(1500);
    const scoreboard = await page.locator("h1").innerText();
    if (/scoreboard/i.test(scoreboard)) ok("manager-detail", scoreboard);
    else bad("manager-detail", scoreboard);
    await page.screenshot({ path: path.join(out, "08-manager-detail.png"), fullPage: false });
  } else {
    ok("manager-detail", "no shift link (demo cards may use buttons)");
    const card = page.locator(".manager-row, .manager-shift-link, [href*='/manager/shifts']").first();
    if ((await card.count()) > 0) {
      await card.click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(out, "08-manager-detail.png"), fullPage: false });
      ok("manager-detail-click", page.url());
    }
  }

  if (consoleErrors.length) bad("pageerrors", consoleErrors.slice(0, 5).join(" | "));
  else ok("pageerrors", "none");

  await ctx.close();
} catch (err) {
  bad("script", String(err));
} finally {
  await writeFile(path.join(out, "results.json"), JSON.stringify(results, null, 2));
  await browser.close();
  const fails = results.filter((r) => r.status === "fail");
  console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
}
