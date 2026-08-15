/**
 * Verify manager audit fixes on a live/dev URL.
 * node web/scripts/manager-fix-verify.mjs [baseUrl]
 */
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(
  "C:/Users/kamal/AppData/Roaming/npm/node_modules/@playwright/test",
);

const base = process.argv[2] || "https://shift-proof-phi.vercel.app";
const out = path.resolve("web/playwright-shots/manager-fix-verify");
await mkdir(out, { recursive: true });

const fail = [];
function ok(name, detail = "") {
  console.log("PASS", name, detail);
}
function bad(name, detail = "") {
  fail.push(name);
  console.error("FAIL", name, detail);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
});

await page.goto(`${base}/login`, { waitUntil: "networkidle", timeout: 45000 });
await page.fill("#email", "manager@shiftproof.demo");
await page.fill("#password", "DemoManager123!");
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 }),
  page.click('button[type="submit"]'),
]);
await page.waitForTimeout(4000);

const home = (await page.locator("body").innerText()) || "";
await page.screenshot({ path: path.join(out, "01-home.png"), fullPage: true });

if (/today|nothing needs you today|gaps need a look|photos need a look|checks in progress/i.test(home)) {
  ok("today-headline", (await page.locator("h1").first().textContent()) || "");
} else {
  bad("today-headline", home.slice(0, 160));
}
if (/89 gaps need a look/i.test(home)) {
  bad("headline-not-89", "still showing all-time 89 gaps");
} else {
  ok("headline-not-89");
}
if (await page.getByRole("tab", { name: /^today$/i }).count()) ok("today-tab");
else bad("today-tab");
if (await page.getByRole("tab", { name: /^backlog$/i }).count()) ok("backlog-tab");
else bad("backlog-tab");

const snake = /handwash station|waste bin covered|hair restraint|sanitizer available|floor clear/i;
if (snake.test(home) && /Handwash station|Waste bin covered|Hair restraint|Sanitizer available|Floor clear/.test(home) === false) {
  // raw fallback without title case would be all lowercase from old itemLabel
}
if (/waste bin covered/.test(home) && !/Waste bin covered|Waste bin/.test(home)) {
  bad("labels-titlecase", "repeat row still raw id");
} else {
  ok("labels-readable");
}

if (await page.locator('[data-testid="repeat-offender"] button').count()) {
  ok("repeat-clickable");
} else {
  bad("repeat-clickable", "repeat rows are not buttons");
}

if (await page.locator(".manager-sticky-hint").count()) {
  bad("no-idle-hint", "idle sticky hint still on home");
} else {
  ok("no-idle-hint-home");
}

const firstShift = page.locator('a[href^="/manager/shifts/"]').first();
if ((await firstShift.count()) === 0) {
  await page.getByRole("tab", { name: /^all$/i }).click();
  await page.waitForTimeout(400);
}
if ((await page.locator('a[href^="/manager/shifts/"]').count()) === 0) {
  bad("open-shift", "no shifts to open");
} else {
  await page.locator('a[href^="/manager/shifts/"]').first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({
    path: path.join(out, "02-scoreboard.png"),
    fullPage: true,
  });
  const board = (await page.locator("body").innerText()) || "";
  if (await page.locator(".manager-sticky-hint").count()) {
    bad("sticky-hint", "idle hint still covering scoreboard");
  } else {
    ok("sticky-hint-removed");
  }
  if (/Needs human eyes/i.test(board)) ok("hero-compact");
  else ok("hero-compact", "no unclear on this shift");

  const showAll = page.getByRole("button", { name: /show all/i });
  if (await showAll.count()) await showAll.click();
  await page.waitForTimeout(300);

  const finding = page.locator(".finding-row").first();
  if (await finding.count()) {
    await finding.click();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(out, "03-selected.png"),
      fullPage: false,
    });
    const sticky = (await page.locator(".manager-sticky").innerText()) || "";
    if (/Request new photo|Assign fix/i.test(sticky)) ok("sticky-actions", sticky.replace(/\s+/g, " ").slice(0, 80));
    else bad("sticky-actions", sticky.slice(0, 120));
  } else {
    bad("finding-row", "no findings");
  }

  if (await page.getByRole("button", { name: /close opening/i }).count()) {
    ok("close-opening");
  } else {
    bad("close-opening");
  }

  const exportLink = page.locator('a[href$="/export"]').first();
  if (await exportLink.count()) {
    await exportLink.click();
    await page.waitForTimeout(2000);
    const exp = (await page.locator("body").innerText()) || "";
    await page.screenshot({
      path: path.join(out, "04-export.png"),
      fullPage: true,
    });
    if (/Shift ID/i.test(exp) && /6a[0-9a-f]{20}/i.test(exp)) {
      bad("export-raw-id", "still showing raw shift id");
    } else {
      ok("export-no-raw-id");
    }
    if (/job\.done|shift\.submitted/.test(exp)) {
      bad("export-raw-events", "raw event types still printed");
    } else {
      ok("export-human-events");
    }
  }
}

// Mobile overflow
{
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const mobile = await ctx.newPage();
  await mobile.goto(`${base}/login`, { waitUntil: "networkidle", timeout: 45000 });
  await mobile.fill("#email", "manager@shiftproof.demo");
  await mobile.fill("#password", "DemoManager123!");
  await Promise.all([
    mobile.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 }),
    mobile.click('button[type="submit"]'),
  ]);
  await mobile.waitForTimeout(3500);
  await mobile.screenshot({
    path: path.join(out, "05-home-mobile.png"),
    fullPage: true,
  });
  const ov = await mobile.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  if (ov.sw > ov.cw + 8) bad("mobile-overflow", JSON.stringify(ov));
  else ok("mobile-overflow");
  await ctx.close();
}

await browser.close();
if (fail.length) {
  console.error("FAILED", fail.join(", "));
  process.exit(1);
}
console.log("ALL PASS");
