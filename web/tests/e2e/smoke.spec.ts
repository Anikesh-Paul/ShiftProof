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
  getFindingRow,
  getShiftStatus,
  getTaskRow,
  hasServerKey,
  latestExecutionId,
  latestJobFor,
  listEventTypesFor,
  listJobIdsFor,
  listStaffDraftIds,
  markShiftScored,
  seedAgentJob,
  seedDraftShift,
  seedFinding,
  seedOpenTask,
  seedSubmittedShift,
  setAgentJobStatus,
} from "../helpers/agentJobs";
import {
  stubRecheckFunction,
  stubRecheckFunctionFailure,
  stubRecheckFunctionPass,
} from "../helpers/recheck";
import {
  addPhotoToPool,
  holdNextEvidenceUpload,
  openSeededDraft,
  removePersistedPhoto,
  TINY_PNG,
  waitUploadIdle,
} from "../helpers/photos";

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
  test("login page renders with normal password placeholder and primary Sign in when idle", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto("/login");

    await expect(page.locator("#email")).toBeVisible();
    const passwordInput = page.locator("#password");
    await expect(passwordInput).toBeVisible();

    // Defect 1: Password placeholder is ordinary hint text, not a long dotted rule
    const placeholder = await passwordInput.getAttribute("placeholder");
    expect(placeholder).toBeTruthy();
    expect(placeholder).not.toMatch(/^\.{3,}$/);
    expect(placeholder).toMatch(/password/i);

    // Defect 2: Sign in is enabled and interactive when idle
    const signInBtn = page.getByRole("button", { name: /^sign in$/i });
    await expect(signInBtn).toBeVisible();
    await expect(signInBtn).toBeEnabled();

    // Unchanged elements: brand name, promise, demo chips
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("ShiftProof");
    await expect(page.getByText("Prove the café opened ready.")).toBeVisible();
    const demoGroup = page.getByRole("group", { name: /demo accounts/i });
    const staffChip = demoGroup.getByRole("button", { name: /staff/i });
    const managerChip = demoGroup.getByRole("button", { name: /manager/i });
    await expect(staffChip).toBeVisible();
    await expect(staffChip).toBeEnabled();
    await expect(managerChip).toBeVisible();
    await expect(managerChip).toBeEnabled();

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

function isShiftList(url: URL): boolean {
  return /\/tablesdb\/[^/]+\/tables\/shifts\/rows\/?$/.test(url.pathname);
}

/** Hold GET /tables/shifts/rows until release — forces the Start gate window. */
async function holdShiftLists(page: import("@playwright/test").Page) {
  const waiting: Array<() => Promise<void>> = [];
  let heldOpen = true;
  let saw!: () => void;
  const held = new Promise<void>((resolve) => {
    saw = resolve;
  });
  await page.route(
    (url) => isShiftList(new URL(url)),
    async (route) => {
      if (route.request().method() !== "GET" || !heldOpen) {
        await route.continue();
        return;
      }
      saw();
      await new Promise<void>((resolve, reject) => {
        waiting.push(async () => {
          try {
            await route.continue();
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });
    },
  );
  return {
    held,
    async release() {
      heldOpen = false;
      await Promise.all(waiting.map((fn) => fn()));
    },
  };
}

test.describe("staff start draft guard", () => {
  test.beforeEach(() => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed a photo-bearing draft",
    );
  });

  test("Start while drafts are held resumes the existing draft, never a duplicate", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const shiftId = await seedDraftShift({
      photoFileIds: ["e2e_start_guard_photo"],
    });
    const beforeIds = await listStaffDraftIds();
    const creates: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && isShiftList(new URL(req.url()))) {
        creates.push(req.url());
      }
    });

    const hold = await holdShiftLists(page);
    await login(page, STAFF.email, STAFF.password);
    await hold.held;
    await expect(page.locator('[data-testid="staff-opening"]')).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.locator('[data-testid="staff-opening"]')).toHaveAttribute(
      "data-drafts-status",
      "loading",
    );
    const start = page.locator('[data-testid="start-opening-check"]');
    await expect(start).toBeDisabled();

    const clickWhileHeld = start.click();
    await expect(page).toHaveURL(/\/staff\/?$/);
    expect(creates, "no draft create while drafts query is held").toEqual([]);

    await hold.release();
    await clickWhileHeld;
    await expect(page).toHaveURL(new RegExp(`/staff/shifts/${shiftId}`), {
      timeout: 20_000,
    });
    expect(creates, "Start must resume, not create").toEqual([]);

    const afterIds = await listStaffDraftIds();
    expect(afterIds.filter((id) => !beforeIds.includes(id))).toEqual([]);
    expect(afterIds).toContain(shiftId);

    await page.getByRole("link", { name: /^history$/i }).click();
    await expect(page.getByRole("heading", { name: /^history$/i })).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.locator(`a[href="/staff/shifts/${shiftId}"]`),
    ).toBeVisible();
    expect(creates).toEqual([]);
    assertNoPageErrors(errors);
  });

  test("a failed drafts query shows retry and does not create", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const shiftId = await seedDraftShift({
      photoFileIds: ["e2e_start_guard_retry_photo"],
    });
    const creates: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && isShiftList(new URL(req.url()))) {
        creates.push(req.url());
      }
    });

    let failLists = true;
    await page.route(
      (url) => isShiftList(new URL(url)),
      async (route) => {
        if (failLists && route.request().method() === "GET") {
          await route.abort("failed");
          return;
        }
        await route.continue();
      },
    );

    await login(page, STAFF.email, STAFF.password);
    await expect(page.locator('[data-testid="drafts-error"]')).toBeVisible({
      timeout: 25_000,
    });
    await expect(
      page.locator('[data-testid="drafts-error"]').getByRole("button", {
        name: /try again/i,
      }),
    ).toBeVisible();
    await expect(page.locator('[data-testid="staff-opening"]')).toHaveAttribute(
      "data-drafts-status",
      "error",
    );
    await expect(page.locator('[data-testid="start-opening-check"]')).toBeDisabled();
    expect(creates).toEqual([]);

    failLists = false;
    await page
      .locator('[data-testid="drafts-error"]')
      .getByRole("button", { name: /try again/i })
      .click();
    await expect(page.locator('[data-testid="staff-opening"]')).toHaveAttribute(
      "data-drafts-status",
      "ready",
      { timeout: 20_000 },
    );
    const start = page.locator('[data-testid="start-opening-check"]');
    await expect(start).toBeEnabled();
    await start.click();
    await expect(page).toHaveURL(new RegExp(`/staff/shifts/${shiftId}`), {
      timeout: 20_000,
    });
    expect(creates).toEqual([]);
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
    for (let i = 0; i < 3; i++) {
      if (await submit.isEnabled()) break;
      const before = (await hint.textContent()) ?? "";
      await input.setInputFiles(TINY_PNG);
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

    const target = rows.filter({ hasNotText: /unclear/i }).first();
    await expect(target.getByRole("button", { name: /^override$/i })).toBeVisible();
    const gallery = page.getByRole("region", { name: /shift evidence photos/i });
    await expect(gallery.locator("img.evidence-img, img").first()).toBeVisible();
    await expect(gallery.getByText(/photo unavailable/i)).toHaveCount(0);
    await expect(page.locator(".evidence-img-missing")).toHaveCount(0);

    await target.getByRole("button", { name: /^override$/i }).click();
    await expect(page.locator(".manager-sticky")).toBeVisible();
    await page.getByLabel(/reason/i).fill("Playwright smoke override");
    await page.getByRole("button", { name: /save override/i }).click();
    await expect(page.getByRole("button", { name: /save override/i })).toBeHidden({
      timeout: 20_000,
    });
    await expect(page.getByText(/overrode to|override:/i).first()).toBeVisible({
      timeout: 20_000,
    });

    await waitForFindings(page);
    const overridden = page
      .locator(".finding-row")
      .filter({ hasText: /Playwright smoke override/i })
      .first();
    const assignBtn = overridden.getByRole("button", { name: /assign fix/i });
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
    await stubRecheckFunctionPass(page, { delayMs: 0 });
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
    if (await markDone.isDisabled()) {
      await stubRecheckFunctionPass(page, { delayMs: 0 });
      await page.locator('[data-testid="recheck-input"]').first().setInputFiles(TINY_PNG);
      await expect(markDone).toBeEnabled({ timeout: 15_000 });
    }
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

test.describe("demo pack attestation", () => {
  test("demo-pack re-check is staff-attested and keeps a pre-placed override", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await login(page, MANAGER.email, MANAGER.password);
    await page.goto("/manager/shifts/demo_shift_a");
    await expect(page.getByText(/sample data/i)).toBeVisible({ timeout: 25_000 });
    await waitForFindings(page);

    const reason = `Demo pack override ${Date.now()}`;
    const target = page
      .locator(".finding-row")
      .filter({ has: page.locator('.finding-chip[data-status="gap"]') })
      .first();
    await target.getByRole("button", { name: /^override$/i }).click();
    await page.getByLabel(/reason/i).fill(reason);
    await page.getByRole("button", { name: /save override/i }).click();
    await expect(page.getByRole("button", { name: /save override/i })).toBeHidden({
      timeout: 20_000,
    });

    await waitForFindings(page);
    const overridden = page.locator(".finding-row").filter({ hasText: reason }).first();
    await overridden.getByRole("button", { name: /assign fix/i }).click();
    await page.locator('[data-testid="create-task-btn"]').click();
    await expect(page.locator(".task-row").first()).toBeVisible({ timeout: 20_000 });

    await page.locator('[data-testid="recheck-input"]').first().setInputFiles(TINY_PNG);
    await expect(page.getByText(/staff attested/i).first()).toBeVisible({
      timeout: 15_000,
    });

    await expect(overridden.locator(".finding-chip")).toHaveAttribute(
      "data-status",
      "pass",
    );
    await expect(overridden.locator('[data-testid="finding-source"]')).toHaveAttribute(
      "data-source",
      "staff_recheck",
    );
    await expect(overridden.getByTestId("override-reason")).toContainText(reason);
    await expect(page.locator('[data-testid="task-mark-done"]').first()).toBeVisible();
    assertNoPageErrors(errors);
  });
});

test.describe("AI re-check", () => {
  test.beforeEach(() => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed a scored Gap",
    );
  });

  test("re-check is scored as AI Pass, clears leftover Override columns, and manager closes the task", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const shiftId = await seedSubmittedShift();
    const jobsBefore = await listJobIdsFor(shiftId);
    const findingId = await seedFinding(shiftId, {
      itemId: "e2e_recheck_gap",
      status: "gap",
    });
    await markShiftScored(shiftId);
    const reason = `Recheck leftover override ${Date.now()}`;

    await login(page, MANAGER.email, MANAGER.password);
    await page.goto(`/manager/shifts/${shiftId}`);
    const row = page.locator(`.finding-row[data-finding-id="${findingId}"]`);
    await expect(row).toBeVisible({ timeout: 25_000 });
    await row.getByRole("button", { name: /^override$/i }).click();
    await page.getByLabel(/reason/i).fill(reason);
    await page.getByRole("button", { name: /save override/i }).click();
    await expect(page.getByRole("button", { name: /save override/i })).toBeHidden({
      timeout: 20_000,
    });

    await page
      .getByRole("button", { name: /^show all$/i })
      .click({ timeout: 3_000 })
      .catch(() => {});
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button", { name: /assign fix/i }).click();
    await page.locator('[data-testid="create-task-btn"]').click();
    await expect(page.locator(".task-row").first()).toBeVisible({ timeout: 20_000 });

    await logout(page);
    await login(page, STAFF.email, STAFF.password);
    await stubRecheckFunctionPass(page);
    await page.goto(`/staff/shifts/${shiftId}`);
    const recheck = page.locator('[data-testid="staff-recheck-input"]');
    await expect(recheck).toBeAttached({ timeout: 25_000 });
    await recheck.setInputFiles(TINY_PNG);
    await expect(page.getByText(/scoring re-check/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/re-check sent · waiting on manager/i)).toBeVisible({
      timeout: 45_000,
    });
    const staffRow = page.locator(`[data-finding-id="${findingId}"]`);
    await expect(staffRow.locator(".finding-chip")).toHaveAttribute(
      "data-status",
      "pass",
    );
    await expect(staffRow.getByTestId("recheck-photo")).toBeVisible();

    expect(await getShiftStatus(shiftId)).toBe("scored");
    expect(await listJobIdsFor(shiftId)).toEqual(jobsBefore);
    const eventTypes = await listEventTypesFor(shiftId);
    expect(eventTypes).toContain("finding.rescored");
    expect(eventTypes).toContain("finding.overridden");
    expect(eventTypes).not.toContain("finding.attested");

    await logout(page);
    await login(page, MANAGER.email, MANAGER.password);
    await page.goto(`/manager/shifts/${shiftId}`);
    await page
      .getByRole("button", { name: /^show all$/i })
      .click({ timeout: 3_000 })
      .catch(() => {});
    await expect(row).toBeVisible({ timeout: 25_000 });
    await expect(row.locator(".finding-chip")).toHaveAttribute("data-status", "pass");
    await expect(row).toHaveAttribute("data-source", "ai");
    await expect(row.getByText(/staff attested/i)).toHaveCount(0);
    await expect(row.getByTestId("override-reason")).toHaveCount(0);
    await expect(page.getByText(/staff attested/i)).toHaveCount(0);
    await expect(page.getByTestId("recheck-photo")).toBeVisible();
    await expect(page.getByText(/^Re-scored$/)).toBeVisible();
    const markDone = page.locator('[data-testid="task-mark-done"]');
    await expect(markDone).toBeEnabled();
    await markDone.click();
    await expect(markDone).toBeHidden({ timeout: 20_000 });

    await page.goto(`/manager/shifts/${shiftId}/export`);
    await expect(page.getByRole("heading", { name: /compliance pack/i })).toBeVisible({
      timeout: 20_000,
    });
    const exportSource = page.locator(
      `[data-testid="export-source"][data-source="ai"]`,
    );
    await expect(exportSource).toBeVisible();
    await expect(exportSource).toHaveText(/^AI$/);
    await expect(page.getByTestId("recheck-photo")).toBeVisible();
    assertNoPageErrors(errors);
  });

  test("Gap re-check stays open, Mark done stays off, and staff can upload again", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const shiftId = await seedSubmittedShift();
    const findingId = await seedFinding(shiftId, {
      itemId: "e2e_recheck_gap_open",
      status: "gap",
    });
    await markShiftScored(shiftId);
    const taskId = await seedOpenTask({
      shiftId,
      findingId,
      title: "Fix: Gloves at prep",
    });

    await login(page, STAFF.email, STAFF.password);
    await stubRecheckFunction(page, { status: "gap" });
    await page.goto(`/staff/shifts/${shiftId}`);
    const staffRow = page.locator(`[data-finding-id="${findingId}"]`);
    const recheck = staffRow.getByTestId("staff-recheck-input");
    await expect(recheck).toBeAttached({ timeout: 25_000 });
    await recheck.setInputFiles(TINY_PNG);
    await expect(page.getByText(/scoring re-check/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/scoring re-check/i)).toBeHidden({
      timeout: 45_000,
    });
    await expect(staffRow.locator(".finding-chip")).toHaveAttribute(
      "data-status",
      "gap",
    );
    await expect(staffRow.getByText(/re-check sent · waiting on manager/i)).toHaveCount(
      0,
    );
    await expect(staffRow.getByTestId("recheck-photo")).toBeVisible();
    await expect(staffRow.getByTestId("staff-recheck-input")).toBeEnabled();
    const afterFirst = await getTaskRow(taskId);
    expect(afterFirst.status).toBe("open");
    expect(afterFirst.recheckFileId).toBeTruthy();
    await staffRow.getByTestId("staff-recheck-input").setInputFiles(TINY_PNG);
    await expect(page.getByText(/scoring re-check/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/scoring re-check/i)).toBeHidden({
      timeout: 45_000,
    });
    await expect(staffRow.locator(".finding-chip")).toHaveAttribute(
      "data-status",
      "gap",
    );
    await expect(staffRow.getByTestId("staff-recheck-input")).toBeEnabled();

    const afterSecond = await getTaskRow(taskId);
    expect(afterSecond.status).toBe("open");
    expect(afterSecond.recheckFileId).toBeTruthy();
    expect(afterSecond.recheckFileId).not.toBe(afterFirst.recheckFileId);
    const scored = await getFindingRow(findingId);
    expect(scored.status).toBe("gap");
    expect(scored.source).toBe("ai");

    await logout(page);
    await login(page, MANAGER.email, MANAGER.password);
    await page.goto(`/manager/shifts/${shiftId}`);
    const row = page.locator(`.finding-row[data-finding-id="${findingId}"]`);
    await page
      .getByRole("button", { name: /^show all$/i })
      .click({ timeout: 3_000 })
      .catch(() => {});
    await expect(row).toBeVisible({ timeout: 25_000 });
    await expect(row.locator(".finding-chip")).toHaveAttribute("data-status", "gap");
    await expect(row).toHaveAttribute("data-source", "ai");
    const markDone = page.locator('[data-testid="task-mark-done"]');
    await expect(markDone).toBeVisible();
    await expect(markDone).toBeDisabled();

    await page.getByTestId("recheck-input").setInputFiles(TINY_PNG);
    await expect(page.getByText(/scoring re-check/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/scoring re-check/i)).toBeHidden({
      timeout: 45_000,
    });
    await expect(row.locator(".finding-chip")).toHaveAttribute("data-status", "gap");
    await expect(markDone).toBeDisabled();
    await expect(page.getByTestId("recheck-photo")).toBeVisible();
    expect((await getTaskRow(taskId)).status).toBe("open");
    assertNoPageErrors(errors);
  });

  test("Unclear re-check stays open; Override to Pass enables Mark done", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const shiftId = await seedSubmittedShift();
    const findingId = await seedFinding(shiftId, {
      itemId: "e2e_recheck_unclear_open",
      status: "gap",
    });
    await markShiftScored(shiftId);
    const taskId = await seedOpenTask({
      shiftId,
      findingId,
      title: "Fix: Gloves at prep",
    });
    const note = "Frame too dark to judge gloves.";

    await login(page, STAFF.email, STAFF.password);
    await stubRecheckFunction(page, {
      status: "unclear",
      evidenceNote: note,
    });
    await page.goto(`/staff/shifts/${shiftId}`);
    const staffRow = page.locator(`[data-finding-id="${findingId}"]`);
    await expect(staffRow.getByTestId("staff-recheck-input")).toBeAttached({
      timeout: 25_000,
    });
    await staffRow.getByTestId("staff-recheck-input").setInputFiles(TINY_PNG);
    await expect(page.getByText(/scoring re-check/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/scoring re-check/i)).toBeHidden({
      timeout: 45_000,
    });
    await expect(staffRow.locator(".finding-chip")).toHaveAttribute(
      "data-status",
      "unclear",
    );
    await expect(staffRow.getByTestId("staff-recheck-input")).toBeEnabled();
    await expect(staffRow.getByText(/re-check sent · waiting on manager/i)).toHaveCount(
      0,
    );

    const scored = await getFindingRow(findingId);
    expect(scored.status).toBe("unclear");
    expect(scored.source).toBe("ai");
    expect(scored.evidenceNote).toBe(note);
    expect((await getTaskRow(taskId)).status).toBe("open");

    await logout(page);
    await login(page, MANAGER.email, MANAGER.password);
    await page.goto(`/manager/shifts/${shiftId}`);
    const row = page.locator(`.finding-row[data-finding-id="${findingId}"]`);
    await page
      .getByRole("button", { name: /^show all$/i })
      .click({ timeout: 3_000 })
      .catch(() => {});
    await expect(row).toBeVisible({ timeout: 25_000 });
    await expect(row.locator(".finding-chip")).toHaveAttribute(
      "data-status",
      "unclear",
    );
    await expect(row).toHaveAttribute("data-source", "ai");
    const markDone = page.locator('[data-testid="task-mark-done"]');
    await expect(markDone).toBeDisabled();

    await row.getByRole("button", { name: /^override$/i }).click();
    await page.getByLabel(/set status/i).selectOption("pass");
    await page.getByLabel(/reason/i).fill("Manager judged the frame a Pass");
    await page.getByRole("button", { name: /save override/i }).click();
    await expect(page.getByRole("button", { name: /save override/i })).toBeHidden({
      timeout: 20_000,
    });
    await expect(row.locator(".finding-chip")).toHaveAttribute("data-status", "pass");
    await expect(markDone).toBeEnabled();
    await markDone.click();
    await expect(markDone).toBeHidden({ timeout: 20_000 });
    expect((await getTaskRow(taskId)).status).toBe("done");
    assertNoPageErrors(errors);
  });

  test("Function-execution failure is staff Attestation and keeps Override columns", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const shiftId = await seedSubmittedShift();
    const reason = `Recheck leftover override ${Date.now()}`;
    const findingId = await seedFinding(shiftId, {
      itemId: "e2e_recheck_fallback",
      status: "gap",
      source: "manager_override",
      overrideReason: reason,
      overriddenBy: "demo_manager",
      overriddenAt: new Date().toISOString(),
    });
    await markShiftScored(shiftId);
    await seedOpenTask({
      shiftId,
      findingId,
      title: "Fix: Gloves at prep",
    });

    await login(page, STAFF.email, STAFF.password);
    await stubRecheckFunctionFailure(page);
    await page.goto(`/staff/shifts/${shiftId}`);
    const recheck = page.locator('[data-testid="staff-recheck-input"]');
    await expect(recheck).toBeAttached({ timeout: 25_000 });
    await recheck.setInputFiles(TINY_PNG);
    await expect(
      page.getByText("AI could not re-score — sent as staff attestation."),
    ).toBeVisible({ timeout: 45_000 });

    const staffRow = page.locator(`[data-finding-id="${findingId}"]`);
    await expect(staffRow.locator(".finding-chip")).toHaveAttribute(
      "data-status",
      "pass",
    );
    await expect(staffRow.getByText(/re-check sent · waiting on manager/i)).toBeVisible();

    const scored = await getFindingRow(findingId);
    expect(scored.status).toBe("pass");
    expect(scored.source).toBe("staff_recheck");
    expect(scored.overrideReason).toBe(reason);
    expect(scored.overriddenBy).toBe("demo_manager");
    expect(scored.evidenceNote).toMatch(
      /^Staff attested after fix\. Re-check photo \S+ is the basis\.$/,
    );

    const eventTypes = await listEventTypesFor(shiftId);
    expect(eventTypes).toContain("finding.attested");
    expect(eventTypes).not.toContain("finding.rescored");
    expect(await getShiftStatus(shiftId)).toBe("scored");

    await logout(page);
    await login(page, MANAGER.email, MANAGER.password);
    await page.goto(`/manager/shifts/${shiftId}`);
    await page
      .getByRole("button", { name: /^show all$/i })
      .click({ timeout: 3_000 })
      .catch(() => {});
    const row = page.locator(`.finding-row[data-finding-id="${findingId}"]`);
    await expect(row).toBeVisible({ timeout: 25_000 });
    await expect(row.locator(".finding-chip")).toHaveAttribute("data-status", "pass");
    await expect(row.getByTestId("finding-source")).toHaveAttribute(
      "data-source",
      "staff_recheck",
    );
    await expect(row.getByTestId("finding-source")).toHaveText(/staff attested/i);
    await expect(row.getByTestId("override-reason")).toContainText(reason);
    await expect(row.getByText(/^AI$/)).toHaveCount(0);

    await page.goto(`/manager/shifts/${shiftId}/export`);
    await expect(page.getByRole("heading", { name: /compliance pack/i })).toBeVisible({
      timeout: 20_000,
    });
    const exportSource = page.locator(
      `[data-testid="export-source"][data-source="staff_recheck"]`,
    );
    await expect(exportSource).toBeVisible();
    await expect(exportSource).toHaveText(/staff attested/i);
    await expect(page.locator('[data-testid="export-source"][data-source="ai"]')).toHaveCount(
      0,
    );
    assertNoPageErrors(errors);
  });
});

test.describe("staff Unclear evidence note", () => {
  test.beforeEach(() => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed scored Findings",
    );
  });

  test("Your scores shows the stored Unclear note and hides seeded notes", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const stamp = Date.now();
    const realNote = `Frame shows the sink drain, not the glove box. ${stamp}`;
    const passNote = `Gloves visible at the cuff. ${stamp}`;
    const gapNote = `Bare hands at the prep board. ${stamp}`;
    const shiftId = await seedSubmittedShift();
    const unclearId = await seedFinding(shiftId, {
      itemId: "e2e_unclear_real_note",
      status: "unclear",
      evidenceNote: realNote,
    });
    const seededUnclearId = await seedFinding(shiftId, {
      itemId: "e2e_unclear_seeded_note",
      status: "unclear",
    });
    const passId = await seedFinding(shiftId, {
      itemId: "e2e_pass_hidden_note",
      status: "pass",
      evidenceNote: passNote,
    });
    const gapId = await seedFinding(shiftId, {
      itemId: "e2e_gap_hidden_note",
      status: "gap",
      evidenceNote: gapNote,
    });
    await markShiftScored(shiftId);
    await seedOpenTask({
      shiftId,
      findingId: unclearId,
      title: "Retake: Gloves at prep",
    });

    await login(page, STAFF.email, STAFF.password);
    await page.goto(`/staff/shifts/${shiftId}`);
    await expect(page.getByRole("heading", { name: /your scores/i })).toBeVisible({
      timeout: 25_000,
    });

    const unclearRow = page.locator(`[data-finding-id="${unclearId}"]`);
    await expect(unclearRow).toBeVisible();
    await expect(unclearRow.getByTestId("staff-evidence-note")).toHaveText(realNote);

    const seededRow = page.locator(`[data-finding-id="${seededUnclearId}"]`);
    await expect(seededRow).toBeVisible();
    await expect(seededRow.getByTestId("staff-evidence-note")).toHaveCount(0);
    await expect(seededRow.getByText("Seeded e2e finding.")).toHaveCount(0);
    await expect(page.getByText("Seeded e2e finding.")).toHaveCount(0);

    const passRow = page.locator(`[data-finding-id="${passId}"]`);
    await expect(passRow).toBeVisible();
    await expect(passRow.getByTestId("staff-evidence-note")).toHaveCount(0);
    await expect(passRow.getByText(passNote)).toHaveCount(0);

    const gapRow = page.locator(`[data-finding-id="${gapId}"]`);
    await expect(gapRow).toBeVisible();
    await expect(gapRow.getByTestId("staff-evidence-note")).toHaveCount(0);
    await expect(gapRow.getByText(gapNote)).toHaveCount(0);

    await page.goto("/staff");
    await expect(page.getByTestId("staff-opening")).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId("open-fixes")).toBeVisible({ timeout: 25_000 });
    const more = page.getByRole("button", { name: /show \d+ more/i });
    await more.waitFor({ state: "visible", timeout: 8_000 }).then(
      () => more.click(),
      () => undefined,
    );
    const homeRow = page.locator(
      `[data-testid="staff-fix-row"][data-finding-id="${unclearId}"]`,
    );
    if ((await homeRow.count()) > 0) {
      await expect(homeRow.getByTestId("staff-evidence-note")).toHaveCount(0);
    }
    await expect(page.getByText(realNote)).toHaveCount(0);
    await expect(page.getByTestId("staff-evidence-note")).toHaveCount(0);
    assertNoPageErrors(errors);
  });
});

function isAgentJobList(url: URL): boolean {
  return /\/tablesdb\/[^/]+\/tables\/agent_jobs\/rows\/?$/.test(url.pathname);
}

function isAgentJobCreate(url: URL): boolean {
  return isAgentJobList(url);
}

function isEventCreate(url: URL): boolean {
  return /\/tablesdb\/[^/]+\/tables\/events\/rows\/?$/.test(url.pathname);
}

function isFunctionExecution(url: URL): boolean {
  return /\/functions\/[^/]+\/executions\/?$/.test(url.pathname);
}

/** Abort POSTs that create an Agent job or submit event — the mid-submit strand. */
async function blockJobAndEventCreates(page: import("@playwright/test").Page) {
  let blocked = true;
  await page.route(
    (url) => isAgentJobCreate(new URL(url)) || isEventCreate(new URL(url)),
    async (route) => {
      if (blocked && route.request().method() === "POST") {
        await route.abort("failed");
        return;
      }
      await route.continue();
    },
  );
  return {
    unblock() {
      blocked = false;
    },
  };
}

test.describe("staff interrupted submission", () => {
  test.beforeEach(() => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed a photo-bearing draft",
    );
  });

  test("blocked job/event create shows Retry immediately, then Retry recovers", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const shiftId = await seedDraftShift({
      photoFileIds: ["e2e_interrupt_a", "e2e_interrupt_b", "e2e_interrupt_c"],
    });
    const jobPosts: string[] = [];
    const executions: string[] = [];
    page.on("request", (req) => {
      if (req.method() !== "POST") return;
      const url = new URL(req.url());
      if (isAgentJobCreate(url)) jobPosts.push(req.url());
      if (isFunctionExecution(url)) executions.push(req.url());
    });

    const gate = await blockJobAndEventCreates(page);
    await login(page, STAFF.email, STAFF.password);
    await page.goto(`/staff/shifts/${shiftId}`);
    const submit = page.getByRole("button", { name: /submit proof/i });
    await expect(submit).toBeEnabled({ timeout: 25_000 });
    await submit.click();

    const alert = page.getByRole("alert");
    await expect(alert).toContainText(/scoring did not start/i, {
      timeout: 15_000,
    });
    const retry = page.getByRole("button", { name: /try scoring again/i });
    await expect(retry).toBeVisible();
    await expect(page.locator("[data-job-status]")).toHaveAttribute(
      "data-job-status",
      "none",
    );
    expect(await getShiftStatus(shiftId)).toBe("submitted");
    expect(await listJobIdsFor(shiftId), "aborted job POSTs must not land a row").toEqual(
      [],
    );
    expect(jobPosts.length, "submit did attempt a job create").toBeGreaterThan(0);

    gate.unblock();
    const execBefore = await latestExecutionId();
    await retry.click();

    await expect
      .poll(async () => (await listJobIdsFor(shiftId)).length, {
        timeout: 15_000,
      })
      .toBe(1);
    await expect
      .poll(async () => await latestExecutionId(), { timeout: 20_000 })
      .not.toBe(execBefore);
    await expect(page.locator("[data-job-status]")).not.toHaveAttribute(
      "data-job-status",
      "none",
      { timeout: 15_000 },
    );

    const status = await getShiftStatus(shiftId);
    expect(["submitted", "scoring", "scored"]).toContain(status);
    expect(status).not.toBe("draft");
    expect(executions.length).toBeGreaterThan(0);

    await expect
      .poll(() => page.locator("[data-job-status]").getAttribute("data-job-status"), {
        timeout: 60_000,
      })
      .toMatch(/waiting|running|done|failed/);

    assertNoPageErrors(errors);
  });

  test("Retry does not create a duplicate when a live job already exists", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const shiftId = await seedDraftShift({
      photoFileIds: ["e2e_idem_a", "e2e_idem_b", "e2e_idem_c"],
    });

    const gate = await blockJobAndEventCreates(page);
    await login(page, STAFF.email, STAFF.password);
    await page.goto(`/staff/shifts/${shiftId}`);
    const submit = page.getByRole("button", { name: /submit proof/i });
    await expect(submit).toBeEnabled({ timeout: 25_000 });
    await submit.click();
    const retry = page.getByRole("button", { name: /try scoring again/i });
    await expect(retry).toBeVisible({ timeout: 15_000 });
    expect(await listJobIdsFor(shiftId)).toEqual([]);

    gate.unblock();
    const liveId = await seedAgentJob(shiftId, "waiting");
    const execBefore = await latestExecutionId();
    await retry.click();

    await expect
      .poll(async () => await latestExecutionId(), { timeout: 20_000 })
      .not.toBe(execBefore);
    const ids = await listJobIdsFor(shiftId);
    expect(ids).toEqual([liveId]);
    expect(await getShiftStatus(shiftId)).not.toBe("draft");
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

  test("Evidence lists Checklist items as cover-only rows: no per-item Add, no photo owned by a row", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await openSeededDraft(page);

    const coverItems = page.locator('[data-testid="cover-item"]');
    await expect(coverItems.first()).toBeVisible({ timeout: 20_000 });
    expect(await coverItems.count()).toBeGreaterThanOrEqual(3);

    // No per-item Add buttons or slots
    await expect(page.locator(".item-photo-add, [data-testid=\"photo-slot\"]")).toHaveCount(0);
    await expect(coverItems.first().locator("button, img")).toHaveCount(0);

    // Single Add control
    await expect(page.locator('[data-testid="add-photo-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="add-photo-btn"]')).toHaveText(/add photos/i);

    // Hint & submit
    await expect(page.locator(".photo-hint")).toHaveText("0 / 3");
    await expect(page.getByRole("button", { name: /submit proof/i })).toBeDisabled();
    assertNoPageErrors(errors);
  });

  test("Staff add and remove photos from a single pool; a ninth photo is refused; Submit enables at 3 and stays enabled through 8", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await openSeededDraft(page);
    const submit = page.getByRole("button", { name: /submit proof/i });
    const photos = page.locator('[data-testid="persisted-photo"]');

    // Add 1 photo
    await addPhotoToPool(page);
    await waitUploadIdle(page);
    await expect(photos).toHaveCount(1);
    await expect(page.locator(".photo-hint")).toHaveText("1 / 3");
    await expect(submit).toBeDisabled();

    // Add 2nd photo
    await addPhotoToPool(page);
    await waitUploadIdle(page);
    await expect(photos).toHaveCount(2);
    await expect(page.locator(".photo-hint")).toHaveText("2 / 3");
    await expect(submit).toBeDisabled();

    // Add 3rd photo -> enables submit!
    await addPhotoToPool(page);
    await waitUploadIdle(page);
    await expect(photos).toHaveCount(3);
    await expect(page.locator(".photo-hint")).toHaveText("3 photos · min 3");
    await expect(submit).toBeEnabled();

    // Add 4th, 5th, 6th, 7th, 8th photos -> stays enabled
    for (let i = 4; i <= 8; i++) {
      await addPhotoToPool(page);
      await waitUploadIdle(page);
      await expect(photos).toHaveCount(i);
      await expect(page.locator(".photo-hint")).toHaveText(`${i} photos · min 3`);
      await expect(submit).toBeEnabled();
    }

    // Attempt 9th photo -> refused with Maximum 8 photos
    await addPhotoToPool(page);
    await expect(page.locator(".error-banner")).toContainText(/Maximum 8 photos/i);
    await expect(photos).toHaveCount(8);
    await expect(submit).toBeEnabled();

    // Remove 1 photo -> count is 7, still enabled
    await removePersistedPhoto(page, 0);
    await expect(photos).toHaveCount(7);
    await expect(page.locator(".photo-hint")).toHaveText("7 photos · min 3");
    await expect(submit).toBeEnabled();

    assertNoPageErrors(errors);
  });

  test("While count is under 3 the hint is count / 3; at 3 and above the bar stays full and hint is N photos · min 3", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await openSeededDraft(page);
    const fill = page.locator(".photo-progress-fill");
    const hint = page.locator(".photo-hint");

    await expect(hint).toHaveText("0 / 3");
    await expect(fill).toHaveCSS("transform", "matrix(0, 0, 0, 1, 0, 0)");

    await addPhotoToPool(page);
    await waitUploadIdle(page);
    await expect(hint).toHaveText("1 / 3");

    await addPhotoToPool(page);
    await waitUploadIdle(page);
    await expect(hint).toHaveText("2 / 3");

    await addPhotoToPool(page);
    await waitUploadIdle(page);
    await expect(hint).toHaveText("3 photos · min 3");
    await expect(hint).not.toHaveText("3 / 3");
    await expect(fill).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");

    await addPhotoToPool(page);
    await waitUploadIdle(page);
    await expect(hint).toHaveText("4 photos · min 3");
    await expect(hint).not.toHaveText("4 / 3");
    // Bar stays full (scaleX(1))
    await expect(fill).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");

    assertNoPageErrors(errors);
  });

  test("remove during an in-flight upload does not resurrect the removed photo", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await openSeededDraft(page);
    const photos = page.locator('[data-testid="persisted-photo"]');

    await addPhotoToPool(page);
    await waitUploadIdle(page);
    await expect(photos).toHaveCount(1);
    const firstId = await photos.first().getAttribute("data-file-id");

    const hold = await holdNextEvidenceUpload(page);
    await addPhotoToPool(page);
    await hold.held;
    await expect(page.locator(".photo-hint")).toContainText(/Uploading/i);

    const removeFirst = photos.first().locator(".photo-remove");
    await expect(removeFirst).toBeEnabled();
    await removeFirst.click();
    await expect(photos).toHaveCount(0, { timeout: 20_000 });

    await hold.release();
    await waitUploadIdle(page);

    await expect(photos).toHaveCount(1);
    const secondId = await photos.first().getAttribute("data-file-id");
    expect(secondId).toBeTruthy();
    expect(secondId).not.toBe(firstId);

    await page.reload();
    await expect(page.getByRole("heading", { name: /evidence/i })).toBeVisible({
      timeout: 20_000,
    });
    const afterReload = page.locator('[data-testid="persisted-photo"]');
    await expect(afterReload).toHaveCount(1);
    expect(await afterReload.first().getAttribute("data-file-id")).toBe(secondId);
    assertNoPageErrors(errors);
  });

  test("a draft with old empty-slot sentinels loads as a pool of non-empty files", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await openSeededDraft(page, {
      photoFileIds: ["seeded_p1", "", "seeded_p2", "", "seeded_p3"],
    });

    const photos = page.locator('[data-testid="persisted-photo"]');
    await expect(photos).toHaveCount(3);
    await expect(page.locator(".photo-hint")).toHaveText("3 photos · min 3");
    await expect(page.getByRole("button", { name: /submit proof/i })).toBeEnabled();

    // Verify empty slot sentinels are not in the DOM or state
    expect(await photos.nth(0).getAttribute("data-file-id")).toBe("seeded_p1");
    expect(await photos.nth(1).getAttribute("data-file-id")).toBe("seeded_p2");
    expect(await photos.nth(2).getAttribute("data-file-id")).toBe("seeded_p3");
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
    await addPhotoToPool(page);
    await waitUploadIdle(page);
    await expect(page.locator('[data-testid="persisted-photo"]')).toHaveCount(1);
    assertNoPageErrors(errors);
  });
});

test.describe("manager shift detail live", () => {
  test.beforeEach(() => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed agent jobs",
    );
  });

  test("stuck banner clears once Retry has a live Agent job", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const submittedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const shiftId = await seedSubmittedShift({ submittedAt });
    await seedAgentJob(shiftId, "failed", {
      errorMessage: "seeded e2e failure (stuck banner)",
    });

    await login(page, MANAGER.email, MANAGER.password);
    await page.goto(`/manager/shifts/${shiftId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByRole("heading", { name: /scoreboard/i })).toHaveCount(
      0,
    );
    await expect(page.locator('[data-testid="shift-status"]')).toHaveAttribute(
      "data-status",
      "failed",
    );
    const banner = page.locator('[data-testid="stuck-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/scoring failed|scoring is stuck/i);

    await page.getByRole("button", { name: /retry scoring/i }).click();
    await expect(banner).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(/scoring started again/i)).toBeVisible();
    assertNoPageErrors(errors);
  });

  test("scoreboard updates live when scoring completes, without a reload", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const shiftId = await seedSubmittedShift();
    const jobId = await seedAgentJob(shiftId, "running");

    await login(page, MANAGER.email, MANAGER.password);
    await page.goto(`/manager/shifts/${shiftId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByRole("heading", { name: /waiting on score/i })).toBeVisible();
    await expect(page.locator('[data-testid="shift-status"]')).toHaveAttribute(
      "data-status",
      "submitted",
    );
    await expect(page.locator(".finding-row")).toHaveCount(0);

    // Realtime subscribe is created after the live load; give the socket a beat.
    await page.waitForTimeout(1_500);

    await seedFinding(shiftId, { itemId: "gloves_worn", status: "gap" });
    await setAgentJobStatus(jobId, "done");
    await markShiftScored(shiftId);

    await expect(page.locator(".finding-row").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-testid="shift-status"]')).toHaveAttribute(
      "data-status",
      "scored",
    );
    await expect(page).toHaveURL(new RegExp(`/manager/shifts/${shiftId}`));
    assertNoPageErrors(errors);
  });
});

function isTaskList(url: URL): boolean {
  return /\/tablesdb\/[^/]+\/tables\/tasks\/rows\/?$/.test(url.pathname);
}

test.describe("manager assign task durability", () => {
  test.beforeEach(() => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed scored gaps",
    );
  });

  test("assign-all-gaps tasks stay in Open fixes across the silent refresh", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const shiftId = await seedSubmittedShift();
    const findingA = await seedFinding(shiftId, {
      itemId: "e2e_assign_durability_alpha",
      status: "gap",
    });
    const findingB = await seedFinding(shiftId, {
      itemId: "e2e_assign_durability_beta",
      status: "gap",
    });
    await markShiftScored(shiftId);

    await login(page, MANAGER.email, MANAGER.password);
    await expect(page.getByRole("tab", { name: /^today$/i })).toBeVisible({
      timeout: 25_000,
    });
    const assignBtn = page.locator('[data-testid="assign-today-gaps"]');
    await expect(assignBtn).toBeVisible({ timeout: 25_000 });

    // After the first inbox load, fail later open-task lists so the silent
    // reload after assign cannot be the thing that paints the panel.
    let failTaskLists = false;
    await page.route(
      (url) => isTaskList(new URL(url)) && failTaskLists,
      async (route) => {
        if (route.request().method() === "GET") {
          await route.abort("failed");
          return;
        }
        await route.continue();
      },
    );
    failTaskLists = true;

    await assignBtn.click();
    const toast = page.getByText(/Assigned \d+ fixes/i);
    await expect(toast).toBeVisible({ timeout: 45_000 });
    const toastText = (await toast.textContent()) ?? "";
    const created = Number(/Assigned (\d+)/i.exec(toastText)?.[1] ?? 0);
    expect(created).toBeGreaterThanOrEqual(2);

    const openFixes = page.locator('[data-testid="open-fixes"]');
    await expect(openFixes).toBeVisible();
    const expandFixes = openFixes.getByRole("button", { name: /open fix/i });
    if (await expandFixes.count()) await expandFixes.click();

    const rowA = openFixes.locator(`[data-finding-id="${findingA}"]`);
    const rowB = openFixes.locator(`[data-finding-id="${findingB}"]`);
    await expect(rowA).toBeVisible();
    await expect(rowB).toBeVisible();
    await expect(rowA).toHaveCount(1);
    await expect(rowB).toHaveCount(1);

    // Silent reload + realtime debounce fire after the toast.
    await expect(assignBtn).toBeEnabled({ timeout: 15_000 });
    await page.waitForTimeout(2_000);
    await expect(
      page.locator(".manager-live-pill", { hasText: /Updating/i }),
    ).toHaveCount(0, { timeout: 15_000 });
    await expect(rowA).toBeVisible();
    await expect(rowB).toBeVisible();
    await expect(rowA).toHaveCount(1);
    await expect(rowB).toHaveCount(1);

    await assignBtn.click();
    await expect(page.getByText(/Assigned 0 fixes/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(rowA).toBeVisible();
    await expect(rowB).toBeVisible();
    await expect(rowA).toHaveCount(1);
    await expect(rowB).toHaveCount(1);
    assertNoPageErrors(errors);
  });
});

/** Hold the next GET of agent_jobs rows until `release` is called. */
async function holdNextAgentJobList(page: import("@playwright/test").Page) {
  let continueHeld: (() => Promise<void>) | undefined;
  let saw!: () => void;
  const held = new Promise<void>((resolve) => {
    saw = resolve;
  });
  let captured = false;
  await page.route(
    (url) => isAgentJobList(new URL(url)),
    async (route) => {
      if (route.request().method() !== "GET" || captured) {
        await route.continue();
        return;
      }
      captured = true;
      saw();
      await new Promise<void>((resolve) => {
        continueHeld = async () => {
          try {
            await route.continue();
          } catch {
            /* navigated away — request may already be gone */
          }
          resolve();
        };
      });
    },
  );
  return {
    held,
    async release() {
      await continueHeld?.();
    },
  };
}

test.describe("staff scoring poll abort", () => {
  test.beforeEach(() => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed a waiting Agent job",
    );
  });

  test("navigating away mid-poll stops further job-status requests", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const shiftId = await seedSubmittedShift();
    await seedAgentJob(shiftId, "waiting");

    await login(page, STAFF.email, STAFF.password);
    await page.goto(`/staff/shifts/${shiftId}`);
    await expect(page.locator("[data-job-status]")).toHaveAttribute(
      "data-job-status",
      "waiting",
      { timeout: 25_000 },
    );

    const hold = await holdNextAgentJobList(page);
    await expect.poll(() => hold.held.then(() => true), { timeout: 15_000 }).toBe(
      true,
    );

    await page.locator("a.back-link").click();
    await expect(page).toHaveURL(/\/staff\/shifts\/?$/);

    const afterNav: string[] = [];
    page.on("request", (req) => {
      if (req.method() !== "GET") return;
      if (isAgentJobList(new URL(req.url()))) afterNav.push(req.url());
    });

    await hold.release();
    // Two poll intervals (2s) plus slack — a live loop would fire again.
    await page.waitForTimeout(5_000);
    expect(
      afterNav,
      "job-status GETs must stop after navigate-away",
    ).toEqual([]);
    assertNoPageErrors(errors);
  });
});

function isShiftRowDelete(url: URL, shiftId: string): boolean {
  return (
    /\/(tables|collections)\/shifts\//.test(url.pathname) &&
    new RegExp(`/(rows|documents)/${shiftId}/?$`).test(url.pathname)
  );
}

function leftoverIdsFrom(
  raw: string | null,
): string[] {
  return raw ? raw.split(/\s+/).filter(Boolean) : [];
}

test.describe("staff history discard", () => {
  test.beforeEach(() => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed leftover drafts",
    );
  });

  test("partial discard keeps the failed leftover and drops the deleted one", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const failId = await seedDraftShift();
    const okId = await seedDraftShift();
    const resumeId = await seedDraftShift({
      photoFileIds: ["e2e_history_discard"],
    });

    let blockFailId = true;
    await page.route(
      (url) => isShiftRowDelete(new URL(url), failId),
      async (route) => {
        if (blockFailId && route.request().method() === "DELETE") {
          await route.abort("failed");
          return;
        }
        await route.continue();
      },
    );

    await login(page, STAFF.email, STAFF.password);
    await page.goto("/staff/shifts");
    await expect(page.getByRole("heading", { name: /^history$/i })).toBeVisible({
      timeout: 20_000,
    });
    const leftover = page.locator('[data-testid="history-leftover"]');
    await expect(leftover).toBeVisible({ timeout: 25_000 });
    await expect
      .poll(async () => leftoverIdsFrom(await leftover.getAttribute("data-leftover-ids")))
      .toEqual(expect.arrayContaining([failId, okId]));

    await leftover.getByRole("button", { name: /^discard$/i }).click();

    await expect(page.getByRole("alert")).toContainText(
      /not everything could be discarded/i,
      { timeout: 15_000 },
    );
    await expect(leftover).toBeVisible();
    await expect(leftover.getByRole("button", { name: /^discard$/i })).toBeEnabled();
    const remaining = leftoverIdsFrom(await leftover.getAttribute("data-leftover-ids"));
    expect(remaining).toContain(failId);
    expect(remaining).not.toContain(okId);

    const draftIds = await listStaffDraftIds();
    expect(draftIds).toContain(failId);
    expect(draftIds).toContain(resumeId);
    expect(draftIds).not.toContain(okId);
    await expect(page.locator(`a[href="/staff/shifts/${resumeId}"]`)).toBeVisible();
    await expect(page.locator(`a[href="/staff/shifts/${okId}"]`)).toHaveCount(0);

    blockFailId = false;
    await leftover.getByRole("button", { name: /^discard$/i }).click();
    await expect(leftover).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator(`a[href="/staff/shifts/${resumeId}"]`)).toBeVisible();

    const afterRetry = await listStaffDraftIds();
    expect(afterRetry).not.toContain(failId);
    expect(afterRetry).toContain(resumeId);
    assertNoPageErrors(errors);
  });
});

function evidenceDecoded(imgs: import("@playwright/test").Locator) {
  return imgs.evaluateAll((els) =>
    els.every(
      (el) =>
        el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0,
    ),
  );
}

test.describe("compliance export evidence", () => {
  test("print waits until evidence images are decoded", async ({ page }) => {
    const errors = collectPageErrors(page);
    await login(page, MANAGER.email, MANAGER.password);
    await page.goto("/manager/shifts/golden_gap_open/export");
    await expect(page.getByRole("heading", { name: /compliance pack/i })).toBeVisible({
      timeout: 20_000,
    });

    const evidence = page.locator('[data-testid="export-evidence"]');
    await expect(evidence).toBeVisible();
    const imgs = evidence.locator("img");
    await expect.poll(async () => imgs.count()).toBeGreaterThan(0);
    for (const img of await imgs.all()) {
      await expect(img).toHaveAttribute("loading", "eager");
    }

    await expect.poll(async () => evidenceDecoded(imgs)).toBe(true);

    const printBtn = page.getByRole("button", { name: /print|save pdf/i });
    await expect(printBtn).toBeEnabled();
    await expect(printBtn).toHaveAttribute("data-print-ready", "true");

    await page.evaluate(() => {
      const w = window as Window & { __exportPrinted?: boolean };
      w.__exportPrinted = false;
      w.print = () => {
        w.__exportPrinted = true;
      };
    });
    await printBtn.click();
    await expect
      .poll(() =>
        page.evaluate(
          () => Boolean((window as Window & { __exportPrinted?: boolean }).__exportPrinted),
        ),
      )
      .toBe(true);
    expect(await evidenceDecoded(imgs)).toBe(true);

    await page.goto("/manager/shifts/golden_gap_open");
    const lazy = page.locator(".evidence-grid img, .finding-photo-img").first();
    await expect(lazy).toBeVisible({ timeout: 25_000 });
    await expect(lazy).toHaveAttribute("loading", "lazy");
    assertNoPageErrors(errors);
  });

  test("missing evidence files still show photo unavailable", async ({ page }) => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed a missing-file shift",
    );
    const errors = collectPageErrors(page);
    const shiftId = await seedSubmittedShift({
      photoFileIds: ["e2e_missing_export_evidence"],
    });
    await login(page, MANAGER.email, MANAGER.password);
    await page.goto(`/manager/shifts/${shiftId}/export`);
    await expect(page.getByRole("heading", { name: /compliance pack/i })).toBeVisible({
      timeout: 20_000,
    });
    const evidence = page.locator('[data-testid="export-evidence"]');
    await expect(evidence).toBeVisible();
    await expect(evidence.getByText(/photo unavailable/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(evidence.locator("img")).toHaveCount(0);
    await expect(evidence.locator('[data-evidence="missing"]')).toHaveCount(1);
    await expect(page.getByRole("button", { name: /print|save pdf/i })).toBeEnabled();
    assertNoPageErrors(errors);
  });
});
