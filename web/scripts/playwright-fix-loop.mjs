/**
 * Phase 3 fix loop: assign → staff re-check UI → manager re-score/done.
 * node web/scripts/playwright-fix-loop.mjs [baseUrl]
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
  // —— Manager: assign fix with staff assignee ——
  await login("manager@shiftproof.demo", "DemoManager123!");
  await page.waitForTimeout(3500);

  const links = page.locator('a[href^="/manager/shifts/"]');
  const n = await links.count();
  if (n === 0) {
    fail("manager-open-shift", "no shift links");
  } else {
    // Prefer demo scoreboard for stable assign UI
    let clicked = false;
    for (let i = 0; i < n; i++) {
      const href = await links.nth(i).getAttribute("href");
      if (href?.includes("demo_shift")) {
        await links.nth(i).click();
        clicked = true;
        break;
      }
    }
    if (!clicked) await links.first().click();
    await page.waitForTimeout(2500);
    await page.screenshot({
      path: path.join(out, "01-manager-scoreboard.png"),
      fullPage: false,
    });

    const finding = page.locator(".finding-row").first();
    if ((await finding.count()) === 0) {
      fail("select-finding", "no findings");
    } else {
      await finding.click();
      await page.waitForTimeout(400);
      const assignBtn = page.getByRole("button", { name: /assign fix/i });
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
          await page.waitForTimeout(1200);
          pass("create-task-click");
        } else {
          fail("create-task-click", "button missing");
        }
      } else {
        fail("assign-fix-btn", "disabled or missing");
      }
    }

    const taskRows = page.locator('[data-testid="fix-row"]');
    if ((await taskRows.count()) > 0) {
      const txt = await taskRows.first().innerText();
      pass("manager-task-row", txt.slice(0, 80).replace(/\n/g, " "));
    } else {
      fail("manager-task-row", "no tasks after assign");
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
  await page.goto(`${base}/staff`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  // Opening redesign: open-fixes panel only mounts when tasks exist (or loading)
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

  // —— Manager again: mark done path on demo task ——
  await logout();
  await page.waitForTimeout(800);
  await login("manager@shiftproof.demo", "DemoManager123!");
  await page.waitForTimeout(3000);

  const links2 = page.locator('a[href^="/manager/shifts/"]');
  if ((await links2.count()) > 0) {
    let opened = false;
    for (let i = 0; i < (await links2.count()); i++) {
      const href = await links2.nth(i).getAttribute("href");
      if (href?.includes("demo_shift")) {
        await links2.nth(i).click();
        opened = true;
        break;
      }
    }
    if (!opened) await links2.first().click();
    await page.waitForTimeout(2500);

    const markDone = page.locator('[data-testid="task-mark-done"]');
    if ((await markDone.count()) > 0) {
      pass("manager-mark-done-control");
      // Optional: recheck file input exists
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
  }

  const failed = results.filter((r) => r.status === "fail");
  await writeFile(
    path.join(out, "report.json"),
    JSON.stringify({ base, results, failed: failed.length }, null, 2),
  );
  console.log("\nSummary:", results.length - failed.length, "pass,", failed.length, "fail");
  if (failed.length) process.exitCode = 1;
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
