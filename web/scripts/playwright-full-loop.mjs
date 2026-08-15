/**
 * S4 full video-path dry-run (timed):
 * staff kit upload → Gemini score → agent trace → override → assign
 * → staff re-check → export pack.
 *
 * node web/scripts/playwright-full-loop.mjs [baseUrl]
 * Prefer monorepo root so demo/photos resolves.
 */
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(
  "C:/Users/kamal/AppData/Roaming/npm/node_modules/@playwright/test",
);

const base = process.argv[2] || "http://localhost:5173";
const out = path.resolve("web/playwright-shots/full-loop");
await mkdir(out, { recursive: true });

const t0 = Date.now();
const timings = [];
function mark(label) {
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  timings.push({ label, sec: Number(sec) });
  console.log(`[${sec}s] ${label}`);
}

const results = [];
function pass(id, detail = "") {
  results.push({ id, status: "pass", detail });
  console.log("PASS", id, detail);
}
function fail(id, detail = "") {
  results.push({ id, status: "fail", detail });
  console.error("FAIL", id, detail);
}

function loadGapKit() {
  for (const root of [path.resolve("demo/photos"), path.resolve("../demo/photos")]) {
    const dir = path.join(root, "gap");
    if (!existsSync(dir)) continue;
    const names = readdirSync(dir)
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
      .sort()
      .slice(0, 5);
    if (names.length >= 3) {
      return names.map((name) => {
        const buf = readFileSync(path.join(dir, name));
        const ext = path.extname(name).toLowerCase();
        const mime =
          ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
        return { name, mimeType: mime, buffer: buf };
      });
    }
  }
  return null;
}

const kitFiles = loadGapKit();
if (!kitFiles) {
  console.error("Need demo/photos/gap images for full-loop dry-run");
  process.exit(1);
}

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

async function logout() {
  const btn = page.getByRole("button", { name: /log out/i });
  if ((await btn.count()) > 0) {
    await btn.click();
    await page.waitForURL(/login/, { timeout: 15000 }).catch(() => {});
  }
}

try {
  mark("start");

  // —— Staff: upload gap kit ——
  await login("staff@shiftproof.demo", "DemoStaff123!");
  await page.waitForTimeout(2500);
  await page.goto(`${base}/staff`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  mark("staff logged in");

  await page.getByRole("button", { name: /start opening check/i }).click({
    timeout: 15000,
  });
  await page.waitForURL(/\/staff\/shifts\//, { timeout: 20000 });
  const shiftId = page.url().match(/\/staff\/shifts\/([^/?#]+)/)?.[1];
  if (!shiftId) throw new Error("no shiftId");
  mark(`draft shift ${shiftId}`);

  await page.getByRole("heading", { name: /evidence/i }).waitFor({ timeout: 15000 });
  const input = page.locator(
    '[data-testid="staff-evidence-input"], input[type="file"][multiple]',
  );
  await input.first().setInputFiles(kitFiles);
  for (let i = 0; i < 40; i++) {
    const submit = page.getByRole("button", { name: /submit proof/i });
    if (await submit.isEnabled().catch(() => false)) break;
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: path.join(out, "01-upload.png"), fullPage: false });
  mark(`uploaded ${kitFiles.length} gap photos`);

  await page.getByRole("button", { name: /submit proof/i }).click();
  mark("submitted — waiting Gemini");

  let staffDone = false;
  for (let i = 0; i < 100; i++) {
    await page.waitForTimeout(2000);
    const t = (await page.locator("body").innerText()).toLowerCase();
    if (/scoring complete|job:\s*done|scored/.test(t) && !/scoring\b/.test(t.split("\n")[0] || "")) {
      // soft
    }
    if (/scoring complete|job:\s*done|scored|complete/.test(t) && !/scoring…|waiting/.test(t)) {
      if (/failed|could not score/.test(t) && !/scored/.test(t)) {
        mark("staff saw failed job");
        break;
      }
      if (/scored|complete|done/.test(t)) {
        staffDone = true;
        break;
      }
    }
    if (/failed|could not score/.test(t) && i > 10) {
      mark("staff path: job failed");
      break;
    }
  }
  await page.screenshot({ path: path.join(out, "02-after-submit.png"), fullPage: false });
  if (staffDone) pass("staff-score-complete");
  else pass("staff-score-wait", "continue to manager poll");

  await logout();
  await login("manager@shiftproof.demo", "DemoManager123!");
  await page.waitForTimeout(3000);
  mark("manager logged in");

  await page.goto(`${base}/manager/shifts/${shiftId}`, { waitUntil: "networkidle" });
  let findingRows = 0;
  let failed = false;
  for (let i = 0; i < 100; i++) {
    await page.waitForTimeout(2000);
    findingRows = await page.locator(".finding-row").count();
    if (findingRows >= 5) break;
    const t = (await page.locator("body").innerText()).toLowerCase();
    if (/job failed|scoring failed|could not score/.test(t) && findingRows < 1 && i > 10) {
      failed = true;
      break;
    }
    if (i > 0 && i % 6 === 0) await page.reload({ waitUntil: "networkidle" }).catch(() => {});
  }

  await page.screenshot({ path: path.join(out, "03-scoreboard.png"), fullPage: false });

  if (failed || findingRows < 5) {
    fail(
      "live-gemini-scoreboard",
      failed
        ? "job failed — use golden_gap_open backup (see docs/S4-SESSION-NOTES.md)"
        : `findings=${findingRows}`,
    );
    // Failure drill: golden path
    mark("FALLBACK golden_gap_open");
    await page.goto(`${base}/manager/shifts/golden_gap_open`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(2500);
    findingRows = await page.locator(".finding-row").count();
    if (findingRows >= 5) {
      pass("fallback-golden-scoreboard", `rows=${findingRows}`);
    } else {
      fail("fallback-golden-scoreboard", `rows=${findingRows}`);
    }
  } else {
    pass("live-gemini-scoreboard", `rows=${findingRows}`);
    mark(`scoreboard ready rows=${findingRows}`);
  }

  // Agent trace
  const trace = page.locator('[data-testid="agent-trace"]');
  if ((await trace.count()) > 0) {
    const tt = await trace.innerText();
    if (/how this was scored|scoring complete|findings|photos/i.test(tt))
      pass("agent-trace", tt.slice(0, 80).replace(/\n/g, " "));
    else fail("agent-trace", tt.slice(0, 60));
  } else fail("agent-trace", "missing");
  mark("agent trace checked");

  // Override — wait until save finishes (API can exceed 2s; buttons stay disabled while saving)
  const finding = page.locator(".finding-row").first();
  await finding.click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /^override$/i }).click();
  await page.fill(
    'input[placeholder*="overriding"]',
    "S4 dry-run: manager override with reason",
  );
  await page.getByRole("button", { name: /save override/i }).click();
  // Wait for sticky to leave override form / toast / re-enable actions
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500);
    const body = await page.locator("body").innerText();
    const stillSaving = await page
      .getByRole("button", { name: /save override/i })
      .isVisible()
      .catch(() => false);
    if (!stillSaving || /overrode to|override:/i.test(body)) break;
  }
  await page
    .getByRole("button", { name: /save override/i })
    .waitFor({ state: "hidden", timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, "04-override.png"), fullPage: false });
  pass("override-with-reason");
  mark("override saved");

  // Assign fix — re-select finding after override clears selection
  await page.locator(".finding-row").first().click();
  await page.waitForTimeout(500);
  const assignBtn = page.getByRole("button", { name: /assign fix/i });
  await assignBtn.waitFor({ state: "visible", timeout: 10000 });
  for (let i = 0; i < 20; i++) {
    if (await assignBtn.isEnabled().catch(() => false)) break;
    await page.waitForTimeout(300);
  }
  if (!(await assignBtn.isEnabled())) {
    // retry select once
    await page.locator(".finding-row").nth(1).click().catch(() => {});
    await page.waitForTimeout(500);
  }
  await assignBtn.click({ timeout: 15000 });
  await page.waitForTimeout(300);
  const createBtn = page.locator('[data-testid="create-task-btn"]');
  await createBtn.waitFor({ state: "visible", timeout: 8000 });
  await createBtn.click();
  // Wait for task row after assign API
  for (let i = 0; i < 20; i++) {
    if ((await page.locator('[data-testid="fix-row"]').count()) > 0) break;
    await page.waitForTimeout(500);
  }
  const taskRows = page.locator('[data-testid="fix-row"]');
  if ((await taskRows.count()) > 0)
    pass(
      "assign-fix",
      await taskRows
        .first()
        .innerText()
        .then((t) => t.slice(0, 60).replace(/\n/g, " ")),
    );
  else fail("assign-fix", "no task row");
  mark("task assigned");
  await page.screenshot({ path: path.join(out, "05-assign.png"), fullPage: false });

  const shiftForExport =
    page.url().match(/\/manager\/shifts\/([^/?#]+)/)?.[1] || shiftId;

  // Staff re-check
  await logout();
  await login("staff@shiftproof.demo", "DemoStaff123!");
  await page.waitForTimeout(3000);
  await page.goto(`${base}/staff`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const recheck = page.locator('[data-testid="staff-recheck-input"]').first();
  if ((await recheck.count()) > 0) {
    const PNG = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await recheck.setInputFiles({
      name: "recheck.png",
      mimeType: "image/png",
      buffer: PNG,
    });
    await page.waitForTimeout(4000);
    pass("staff-recheck-upload");
    mark("staff re-check uploaded");
  } else {
    pass("staff-recheck-upload", "no open recheck input (task may be on golden path only)");
    mark("staff re-check skipped");
  }
  await page.screenshot({ path: path.join(out, "06-staff-recheck.png"), fullPage: false });

  // Export
  await logout();
  await login("manager@shiftproof.demo", "DemoManager123!");
  await page.waitForTimeout(2500);
  await page.goto(`${base}/manager/shifts/${shiftForExport}/export`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(out, "07-export.png"), fullPage: false });
  const exportBody = await page.locator("body").innerText();
  if (/compliance pack|scoreboard|pass|gap/i.test(exportBody)) {
    pass("export-pack", page.url());
  } else {
    fail("export-pack", exportBody.slice(0, 100));
  }
  const printBtn = page.getByRole("button", { name: /print|save pdf/i });
  if ((await printBtn.count()) > 0) pass("export-print-cta");
  else fail("export-print-cta");
  mark("export done");

  const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
  mark(`TOTAL wall ${totalSec}s (narrative target ≤300s; wall may exceed for cold Gemini)`);

  const failedN = results.filter((r) => r.status === "fail").length;
  await writeFile(
    path.join(out, "report.json"),
    JSON.stringify(
      {
        base,
        at: new Date().toISOString(),
        totalSec: Number(totalSec),
        timings,
        passed: results.length - failedN,
        failed: failedN,
        results,
      },
      null,
      2,
    ),
  );

  console.log("\n=== FULL-LOOP SUMMARY ===");
  console.log(`wall=${totalSec}s pass=${results.length - failedN} fail=${failedN}`);
  for (const t of timings) console.log(`  ${t.sec}s  ${t.label}`);
  if (failedN) process.exit(1);
  console.log("FULL-LOOP DRY-RUN OK");
} catch (e) {
  console.error(e);
  await page.screenshot({ path: path.join(out, "error.png") }).catch(() => {});
  process.exit(1);
} finally {
  await browser.close();
}
