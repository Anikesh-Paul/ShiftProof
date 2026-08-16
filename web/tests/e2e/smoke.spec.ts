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
import {
  hasServerKey,
  latestExecutionId,
  latestJobFor,
  seedAgentJob,
  seedSubmittedShift,
  setAgentJobStatus,
} from "../helpers/agentJobs";
import {
  addPhotoToSlot,
  holdNextEvidenceUpload,
  isEvidenceDelete,
  isEvidenceUpload,
  isShiftWrite,
  openSeededDraft,
  replaceSlotPhoto,
  waitUploadIdle,
} from "../helpers/photos";

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
  // Exact name — /show all/i plus a default 20s click can hang the 180s test
  // when the filter label is "Hide passes" or another "Show …" control is busy.
  await page
    .getByRole("button", { name: /^show all$/i })
    .click({ timeout: 3_000 })
    .catch(() => {});
  const rows = page.locator(".finding-row");
  await rows.first().waitFor({ state: "attached", timeout: 25_000 });
  await expect
    .poll(async () => rows.count(), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(5);
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

  test("staff shift page shows Failed chip when the Agent job fails", async ({
    page,
  }) => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed agent jobs",
    );
    const errors = collectPageErrors(page);

    const shiftId = await seedSubmittedShift();
    const jobId = await seedAgentJob(shiftId, "running");

    await login(page, STAFF.email, STAFF.password);
    await page.goto(`/staff/shifts/${shiftId}`);
    const chip = page.locator(".status-chip");
    await expect(chip).toHaveAttribute("data-status", "submitted", {
      timeout: 25_000,
    });
    await expect(page.locator("[data-job-status]")).toHaveAttribute(
      "data-job-status",
      "running",
    );

    await setAgentJobStatus(jobId, "failed", {
      errorMessage: "seeded e2e failure (quota-shaped)",
    });

    // No reload: the page's own polling must surface the failure within seconds.
    await expect(chip).toHaveAttribute("data-status", "failed", {
      timeout: 15_000,
    });
    const retry = page.getByRole("button", { name: /try scoring again/i });
    await expect(retry).toBeVisible();

    // Retry behaves as today: a fresh Agent job plus a re-triggered execution.
    // (Chip-level "leaves failed" is racy here: this photo-less shift's retry
    // fails within ~200ms, so assert at the DB seam instead.)
    const execBefore = await latestExecutionId();
    await retry.click();
    await expect
      .poll(async () => (await latestJobFor(shiftId))?.id, { timeout: 15_000 })
      .not.toBe(jobId);
    await expect
      .poll(async () => await latestExecutionId(), { timeout: 20_000 })
      .not.toBe(execBefore);
    assertNoPageErrors(errors);
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

    // Settle on the Agent job status, not the Shift status — a quota/503
    // failure must fail loudly here, not time out as a 180s hang.
    const jobStatus = page.locator("[data-job-status]");
    await expect
      .poll(() => jobStatus.getAttribute("data-job-status"), {
        timeout: 180_000,
      })
      .toMatch(/done|failed/);
    const settled = await jobStatus.getAttribute("data-job-status");
    expect(
      settled,
      `Agent job ended "${settled}" — scoring did not complete (quota/503/timeout); Retry is available on the page`,
    ).toBe("done");

    const chip = page.locator(".status-chip");
    await expect
      .poll(() => chip.getAttribute("data-status"), { timeout: 30_000 })
      .toBe("scored");
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

test.describe("staff photo upload races", () => {
  test.beforeEach(() => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed a clean draft",
    );
  });

  test("remove during an in-flight upload does not resurrect the removed photo", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await openSeededDraft(page);
    const slots = page.locator('[data-testid="photo-slot"]');

    await addPhotoToSlot(page, 0);
    await waitUploadIdle(page);
    await expect(slots.nth(0)).toHaveAttribute("data-has-file", "true");

    const hold = await holdNextEvidenceUpload(page);
    await addPhotoToSlot(page, 1);
    await hold.held;
    await expect(page.locator(".photo-hint")).toContainText(/Uploading/i);

    const removeFirst = slots.nth(0).locator(".photo-remove");
    const removeLocal = slots.nth(1).locator(".photo-remove");
    await expect(removeFirst).toBeEnabled();
    await expect(removeLocal).toBeEnabled();

    await removeFirst.click();
    await expect(slots.nth(0)).toHaveAttribute("data-has-file", "false", {
      timeout: 20_000,
    });

    await hold.release();
    await waitUploadIdle(page);

    await expect(slots.nth(0)).toHaveAttribute("data-has-file", "false");
    await expect(slots.nth(1)).toHaveAttribute("data-has-file", "true");
    await expect(slots.nth(0).locator('[data-testid="persisted-slot"]')).toHaveCount(0);
    await expect(slots.nth(0).locator("img")).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("heading", { name: /evidence/i })).toBeVisible({
      timeout: 20_000,
    });
    const after = page.locator('[data-testid="photo-slot"]');
    await expect(after.nth(0)).toHaveAttribute("data-has-file", "false");
    await expect(after.nth(1)).toHaveAttribute("data-has-file", "true");
    await expect(after.nth(0).locator("img")).toHaveCount(0);
    assertNoPageErrors(errors);
  });

  test("replace persists the new reference before deleting the old file", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await openSeededDraft(page);
    const slot = page.locator('[data-testid="photo-slot"]').nth(0);

    await addPhotoToSlot(page, 0);
    await waitUploadIdle(page);
    await expect(slot).toHaveAttribute("data-has-file", "true");
    const oldId = await slot.locator("[data-file-id]").getAttribute("data-file-id");
    expect(oldId).toBeTruthy();

    const order: string[] = [];
    page.on("request", (req) => {
      const url = new URL(req.url());
      const method = req.method();
      if (method === "POST" && isEvidenceUpload(url)) order.push("upload");
      if ((method === "PATCH" || method === "PUT") && isShiftWrite(url)) {
        order.push("persist");
      }
      if (method === "DELETE" && isEvidenceDelete(url)) order.push("delete");
    });

    await replaceSlotPhoto(page, 0);
    await waitUploadIdle(page);

    await expect(slot).toHaveAttribute("data-has-file", "true");
    await expect
      .poll(async () => slot.locator("[data-file-id]").getAttribute("data-file-id"), {
        timeout: 20_000,
      })
      .not.toBe(oldId);

    const fromReplace = order.slice(order.lastIndexOf("upload"));
    expect(fromReplace, fromReplace.join(" → ")).toContain("persist");
    expect(fromReplace, fromReplace.join(" → ")).toContain("delete");
    expect(fromReplace.indexOf("persist")).toBeLessThan(fromReplace.indexOf("delete"));
    assertNoPageErrors(errors);
  });

  test("a failed replace persist keeps the old file referenced", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await openSeededDraft(page);
    const slot = page.locator('[data-testid="photo-slot"]').nth(0);

    await addPhotoToSlot(page, 0);
    await waitUploadIdle(page);
    const oldId = await slot.locator("[data-file-id]").getAttribute("data-file-id");
    expect(oldId).toBeTruthy();

    let blockPersist = false;
    const deletes: string[] = [];
    await page.route(
      (url) => isShiftWrite(url),
      async (route) => {
        const method = route.request().method();
        if (blockPersist && (method === "PATCH" || method === "PUT")) {
          await route.abort("failed");
          return;
        }
        await route.continue();
      },
    );
    page.on("request", (req) => {
      if (req.method() === "DELETE" && isEvidenceDelete(new URL(req.url()))) {
        deletes.push(req.url());
      }
    });

    blockPersist = true;
    await replaceSlotPhoto(page, 0);
    await expect(page.locator(".error-banner")).toBeVisible({ timeout: 20_000 });
    await expect(slot.locator("[data-file-id]")).toHaveAttribute(
      "data-file-id",
      oldId!,
    );
    expect(deletes, "old evidence must not be deleted when persist fails").toEqual([]);
    assertNoPageErrors(errors);
  });

  test("upload works when crypto.randomUUID is missing", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        delete (globalThis.crypto as { randomUUID?: unknown }).randomUUID;
      } catch {
        Object.defineProperty(globalThis.crypto, "randomUUID", {
          value: undefined,
          configurable: true,
        });
      }
    });
    const errors = collectPageErrors(page);
    await openSeededDraft(page);
    await addPhotoToSlot(page, 0);
    await waitUploadIdle(page);
    await expect(page.locator('[data-testid="photo-slot"]').nth(0)).toHaveAttribute(
      "data-has-file",
      "true",
    );
    assertNoPageErrors(errors);
  });
});
