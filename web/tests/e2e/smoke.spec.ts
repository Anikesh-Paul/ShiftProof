import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoPageErrors,
  collectPageErrors,
  login,
  logout,
  MANAGER,
  STAFF,
} from "../helpers/auth";
import { expect, test } from "../helpers/fixtures";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const GAP_PHOTOS = ["01-bare-hands.jpg", "02-dirty-counter.jpg", "03-open-waste-bin.jpg"].map(
  (name) => path.join(REPO_ROOT, "demo/photos/gap", name),
);

const TINY_PNG = {
  name: "recheck.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
};

async function openGoldenScoreboard(page: import("@playwright/test").Page) {
  await page.getByRole("tab", { name: /^all$/i }).click().catch(() => {});
  const golden = page.locator('a[href*="/manager/shifts/golden_gap_open"]').first();
  const found = await golden
    .waitFor({ state: "visible", timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (found) {
    await golden.click();
  } else {
    await page.goto("/manager/shifts/golden_gap_open");
  }
  await expect(page).toHaveURL(/\/manager\/shifts\/golden_gap_open/);
}

async function waitForFindings(page: import("@playwright/test").Page) {
  const showAll = page.getByRole("button", { name: /show all/i });
  for (let i = 0; i < 20; i++) {
    if ((await showAll.count()) > 0) {
      await showAll.click().catch(() => {});
    }
    if ((await page.locator(".finding-row").count()) >= 5) return;
    await page.waitForTimeout(500);
  }
  expect(
    await page.locator(".finding-row").count(),
    "expected ≥5 findings on golden_gap_open",
  ).toBeGreaterThanOrEqual(5);
}

test.describe("login", () => {
  test("login page renders", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto("/login");
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    await expect(page.locator("h1, h2").first()).toBeVisible();
    assertNoPageErrors(errors);
  });

  test("staff login lands on staff home", async ({ page }) => {
    const errors = collectPageErrors(page);
    await login(page, STAFF.email, STAFF.password);
    await expect(page).toHaveURL(/\/staff/);
    await expect(page.locator('[data-testid="staff-opening"]')).toBeVisible({
      timeout: 25_000,
    });
    assertNoPageErrors(errors);
  });

  test("manager login lands on manager home", async ({ page }) => {
    const errors = collectPageErrors(page);
    await login(page, MANAGER.email, MANAGER.password);
    await expect(page).toHaveURL(/\/manager/);
    await expect(page.getByRole("tab", { name: /^today$/i })).toBeVisible({
      timeout: 25_000,
    });
    assertNoPageErrors(errors);
  });
});

test.describe("staff opening", () => {
  test("Opening tab shows checklist and start/continue", async ({ page }) => {
    const errors = collectPageErrors(page);
    await login(page, STAFF.email, STAFF.password);
    await page.goto("/staff");
    await expect(page.locator('[data-testid="staff-opening"]')).toBeVisible();
    await expect(page.getByRole("link", { name: /^opening$/i })).toBeVisible();
    await expect(page.locator('[data-testid="staff-checklist"]')).toBeVisible({
      timeout: 25_000,
    });
    const items = page.locator(".staff-checklist li");
    await expect(items.first()).toBeVisible({ timeout: 25_000 });
    expect(await items.count()).toBeGreaterThanOrEqual(5);
    await expect(page.locator('[data-testid="start-opening-check"]')).toBeVisible();
    await expect(page.locator('[data-testid="start-opening-check"]')).toBeEnabled({
      timeout: 25_000,
    });
    assertNoPageErrors(errors);
  });
});

test.describe("staff scoring + manager golden + fix loop", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "once per run");
  });

  test("staff full scoring loop", async ({ page }) => {
    test.setTimeout(240_000);
    const errors = collectPageErrors(page);
    await login(page, STAFF.email, STAFF.password);
    await page.goto("/staff");
    const start = page.locator('[data-testid="start-opening-check"]');
    await expect(start).toBeEnabled({ timeout: 25_000 });
    await start.click();
    await page.waitForURL(/\/staff\/shifts\//, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /evidence/i })).toBeVisible({
      timeout: 20_000,
    });

    const submit = page.getByRole("button", { name: /submit proof/i });
    const input = page.locator('[data-testid="staff-evidence-input"]');
    const hint = page.locator(".photo-hint");
    for (const file of GAP_PHOTOS) {
      if (await submit.isEnabled()) break;
      const before = (await hint.textContent()) ?? "";
      await input.setInputFiles(file);
      await expect(hint).not.toHaveText(before, { timeout: 45_000 });
      await expect(hint).not.toContainText(/Uploading/i, { timeout: 45_000 });
    }
    await expect(submit).toBeEnabled({ timeout: 45_000 });
    await submit.click();

    const chip = page.locator(".status-chip");
    await expect
      .poll(async () => chip.getAttribute("data-status"), { timeout: 180_000 })
      .toMatch(/scored|failed|closed/);
    expect(await chip.getAttribute("data-status")).toBe("scored");
    await expect(page.getByRole("heading", { name: /your scores/i })).toBeVisible();
    assertNoPageErrors(errors);
  });

  test("manager inbox, golden findings, evidence, override, assign", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await login(page, MANAGER.email, MANAGER.password);
    await page.goto("/manager");
    await expect(page.getByRole("tab", { name: /^today$/i })).toBeVisible({
      timeout: 25_000,
    });
    // Inbox may be empty on Today; All / live rows are noisy — just confirm it painted.
    await expect(page.locator(".manager-inbox").first()).toBeVisible({
      timeout: 25_000,
    });

    await openGoldenScoreboard(page);
    await waitForFindings(page);
    const rows = page.locator(".finding-row");
    expect(await rows.count()).toBeGreaterThanOrEqual(5);

    await rows.first().click();
    await expect(page.locator(".manager-sticky")).toBeVisible();
    const gallery = page.getByRole("region", { name: /shift evidence photos/i });
    await expect(gallery.locator("img.evidence-img, img").first()).toBeVisible();
    await expect(gallery.getByText("Unavailable")).toHaveCount(0);
    await expect(page.locator(".evidence-img-missing")).toHaveCount(0);

    await page.getByRole("button", { name: /^override$/i }).click();
    await page.locator('input[placeholder*="overriding"]').fill("Playwright smoke override");
    await page.getByRole("button", { name: /save override/i }).click();
    await expect(page.getByRole("button", { name: /save override/i })).toBeHidden({
      timeout: 20_000,
    });
    await expect(page.getByText(/overrode to|override:/i).first()).toBeVisible({
      timeout: 20_000,
    });

    await waitForFindings(page);
    const assignable = rows.filter({ hasNotText: /unclear/i }).first();
    await assignable.click();
    const assignBtn = page.getByRole("button", { name: /assign fix/i });
    await expect(assignBtn).toBeVisible({ timeout: 10_000 });
    await expect(assignBtn).toBeEnabled({ timeout: 10_000 });
    await assignBtn.click();
    const createBtn = page.locator('[data-testid="create-task-btn"]');
    await expect(createBtn).toBeVisible();
    await createBtn.click();
    await expect(page.locator(".task-row").first()).toBeVisible({ timeout: 20_000 });
    assertNoPageErrors(errors);
  });

  test("staff fixes panel shows task and accepts re-check upload", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await login(page, STAFF.email, STAFF.password);
    await page.goto("/staff");
    await expect(page.locator('[data-testid="open-fixes"]')).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.locator('[data-testid="staff-fix-row"]').first()).toBeVisible();
    const more = page.getByRole("button", { name: /show \d+ more/i });
    if ((await more.count()) > 0) await more.click();
    const recheck = page.locator('[data-testid="staff-recheck-input"]').first();
    await expect(recheck).toBeAttached({ timeout: 15_000 });
    await recheck.setInputFiles(TINY_PNG);
    await expect(
      page.locator('[data-testid="staff-recheck-done"], [data-testid="fix-toast"]').first(),
    ).toBeVisible({ timeout: 45_000 });
    assertNoPageErrors(errors);
  });

  test("manager mark-done and export print CTA", async ({ page }) => {
    const errors = collectPageErrors(page);
    await login(page, MANAGER.email, MANAGER.password);
    await page.goto("/manager/shifts/golden_gap_open");
    await expect(page.locator(".task-row").first()).toBeVisible({ timeout: 25_000 });
    const markDone = page.locator('[data-testid="task-mark-done"]').first();
    await expect(markDone).toBeVisible();
    const before = await page.locator('[data-testid="task-mark-done"]').count();
    await markDone.click();
    await expect
      .poll(async () => page.locator('[data-testid="task-mark-done"]').count(), {
        timeout: 20_000,
      })
      .toBeLessThan(before);

    await page.goto("/manager/shifts/golden_gap_open/export");
    await expect(page.getByRole("heading", { name: /compliance pack/i })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: /print|save pdf/i })).toBeVisible();
    assertNoPageErrors(errors);
  });
});
