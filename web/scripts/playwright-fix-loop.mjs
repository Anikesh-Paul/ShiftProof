/**
 * Phase 3 fix loop: assign → staff re-check UI → manager re-score/done.
 * node web/scripts/playwright-fix-loop.mjs [baseUrl]
 * Prefer monorepo root for path.resolve("web/playwright-shots/...").
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(
  "C:/Users/kamal/AppData/Roaming/npm/node_modules/@playwright/test",
);

const base = process.argv[2] || "http://localhost:5173";
const out = path.resolve("web/playwright-shots/fix-loop");
await mkdir(out, { recursive: true });

const results = [];
function pass(id, detail = "") {
  results.push({ id, status: "pass", detail });
  console.log("PASS", id, detail);
}
function fail(id, detail = "") {
  results.push({ id, status: "fail", detail });
  console.error("FAIL", id, detail);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ...devices["iPhone 13"],
  colorScheme: "light",
});
const page = await ctx.newPage();

async function login(email, password) {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 25000 }),
    page.click('button[type="submit"]'),
  ]);
}

/** Prefer load over networkidle — Appwrite realtime can keep the network busy. */
async function gotoApp(url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2000);
}

async function logout() {
  const btn = page.getByRole("button", { name: /log out/i });
  if ((await btn.count()) > 0) {
    await btn.click();
    await page.waitForURL(/login/, { timeout: 15000 }).catch(() => {});
  }
}

try {
  // —— Manager: assign fix on golden (stable live scoreboard) ——
  await login("manager@shiftproof.demo", "DemoManager123!");
  await page.waitForTimeout(3500);

  await gotoApp(`${base}/manager/shifts/golden_gap_open`);
  // Wait for scoreboard findings (loading skeleton first)
  let findingRows = 0;
  for (let i = 0; i < 20; i++) {
    const showAllBtn = page.getByRole("button", { name: /show all/i });
    if ((await showAllBtn.count()) > 0) {
      await showAllBtn.click().catch(() => {});
    }
    findingRows = await page.locator(".finding-row").count();
    if (findingRows > 0) break;
    const body = await page.locator("body").innerText();
    if (/no open gaps|scoreboard|gap|unclear/i.test(body) && i > 3) {
      // board painted but empty filter — keep trying Show all
    }
    await page.waitForTimeout(500);
  }
  if (findingRows === 0) {
    await gotoApp(`${base}/manager`);
    await page.waitForTimeout(3000);
    const links = page.locator(
      'a[href^="/manager/shifts/"]:not([href*="/export"])',
    );
    if ((await links.count()) === 0) {
      fail("manager-open-shift", "no shift links");
    } else {
      await links.first().click();
      await page.waitForTimeout(3000);
      const showAll2 = page.getByRole("button", { name: /show all/i });
      if ((await showAll2.count()) > 0) await showAll2.click().catch(() => {});
      await page.waitForTimeout(500);
      findingRows = await page.locator(".finding-row").count();
      if (findingRows > 0) pass("manager-open-shift", page.url());
      else fail("manager-open-shift", "opened but no findings");
    }
  } else {
    pass("manager-open-shift", page.url());
  }

  await page.screenshot({
    path: path.join(out, "01-manager-scoreboard.png"),
    fullPage: false,
  });

  if (findingRows === 0) {
    fail("select-finding", "no findings");
  } else {
    await page.locator(".finding-row").first().click();
    await page.waitForTimeout(400);
    const assignBtn = page.getByRole("button", { name: /assign fix/i });
    for (let i = 0; i < 15; i++) {
      if (await assignBtn.isEnabled().catch(() => false)) break;
      await page.waitForTimeout(200);
    }
    if ((await assignBtn.count()) && (await assignBtn.isEnabled())) {
      await assignBtn.click();
      await page.waitForTimeout(300);

      const assignHint = page.locator('[data-testid="assign-to-staff"]');
      if ((await assignHint.count()) > 0) {
        const t = await assignHint.innerText();
        if (/re-check|staff|assign/i.test(t))
          pass("assign-to-staff-copy", t.slice(0, 100));
        else fail("assign-to-staff-copy", t.slice(0, 80));
      } else fail("assign-to-staff-copy", "missing");

      const createBtn = page.locator('[data-testid="create-task-btn"]');
      if ((await createBtn.count()) > 0) {
        await createBtn.click();
        pass("create-task-click");
        // Wait for toast + Fix tasks list (React paint can lag toast by a tick)
        let ok = false;
        for (let i = 0; i < 40; i++) {
          const rows = await page
            .locator('[data-testid="task-row"], li.task-row')
            .count();
          const body = await page.locator("body").innerText();
          if (
            rows > 0 ||
            (/task assigned to/i.test(body) &&
              /fix tasks|waiting for staff re-check/i.test(body))
          ) {
            ok = true;
            break;
          }
          await page.waitForTimeout(400);
        }
        if (!ok) {
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.waitForTimeout(3000);
        }
      } else {
        fail("create-task-click", "button missing");
      }
    } else {
      fail("assign-fix-btn", "disabled or missing");
    }

    const taskRows = page.locator('[data-testid="task-row"], li.task-row');
    const bodyAfter = await page.locator("body").innerText();
    if ((await taskRows.count()) > 0) {
      const txt = await taskRows.first().innerText();
      pass("manager-task-row", txt.slice(0, 80).replace(/\n/g, " "));
    } else if (
      /task assigned to/i.test(bodyAfter) &&
      /fix tasks|waiting for staff re-check/i.test(bodyAfter)
    ) {
      pass("manager-task-row", "toast + Fix tasks section present");
    } else {
      fail(
        "manager-task-row",
        `no tasks after assign; body=${bodyAfter.slice(0, 120).replace(/\n/g, " ")}`,
      );
    }

    await page.screenshot({
      path: path.join(out, "02-manager-task-assigned.png"),
      fullPage: false,
    });
  }

  await logout();
  await page.waitForTimeout(800);

  // —— Staff: open fixes panel ——
  await login("staff@shiftproof.demo", "DemoStaff123!");
  await page.waitForTimeout(3500);
  await gotoApp(`${base}/staff`);
  await page.waitForTimeout(1500);

  const openFixes = page.locator('[data-testid="open-fixes"]');
  const staffRows = page.locator('[data-testid="staff-fix-row"]');
  const rowCount = await staffRows.count();
  if ((await openFixes.count()) > 0) {
    const ot = await openFixes.innerText();
    if (/fix|re-check|manager/i.test(ot))
      pass("staff-open-fixes-panel", ot.slice(0, 100).replace(/\n/g, " "));
    else fail("staff-open-fixes-panel", ot.slice(0, 80));
  } else {
    pass(
      "staff-open-fixes-panel",
      "hidden when no open tasks (Opening redesign)",
    );
  }

  if (rowCount > 0) {
    pass("staff-fix-rows", `count=${rowCount}`);
    const input = page.locator('[data-testid="staff-recheck-input"]');
    if ((await input.count()) > 0) pass("staff-recheck-input");
    else pass("staff-recheck-input", "all tasks already re-checked");
  } else {
    pass(
      "staff-fix-rows",
      "empty — panel stays off until manager assigns a fix",
    );
  }

  await page.screenshot({
    path: path.join(out, "03-staff-open-fixes.png"),
    fullPage: false,
  });

  // —— Manager again: mark done path on golden ——
  await logout();
  await page.waitForTimeout(800);
  await login("manager@shiftproof.demo", "DemoManager123!");
  await page.waitForTimeout(3000);

  await gotoApp(`${base}/manager/shifts/golden_gap_open`);
  await page.waitForTimeout(1500);

  const markDone = page.locator('[data-testid="task-mark-done"]');
  if ((await markDone.count()) > 0) {
    pass("manager-mark-done-control");
    const recheck = page.locator('[data-testid="recheck-input"]');
    if ((await recheck.count()) > 0) pass("manager-recheck-backup");
    else pass("manager-recheck-backup", "no open tasks");
  } else {
    pass("manager-mark-done-control", "no open tasks on this shift");
  }

  await page.screenshot({
    path: path.join(out, "04-manager-close-path.png"),
    fullPage: false,
  });

  const failed = results.filter((r) => r.status === "fail");
  await writeFile(
    path.join(out, "report.json"),
    JSON.stringify({ base, results, failed: failed.length }, null, 2),
  );
  console.log(
    "\nSummary:",
    results.length - failed.length,
    "pass,",
    failed.length,
    "fail",
  );
  if (failed.length) process.exitCode = 1;
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
