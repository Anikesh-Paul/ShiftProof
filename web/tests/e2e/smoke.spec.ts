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
  getShiftStatus,
  hasServerKey,
  latestExecutionId,
  latestJobFor,
  listJobIdsFor,
  listStaffDraftIds,
  markShiftScored,
  seedAgentJob,
  seedDraftShift,
  seedFinding,
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

    const target = rows.filter({ hasNotText: /unclear/i }).first();
    await target.click();
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
    const overridden = page
      .locator(".finding-row")
      .filter({ hasText: /Playwright smoke override/i })
      .first();
    await overridden.click();
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
    await target.click();
    await page.getByRole("button", { name: /^override$/i }).click();
    await page.locator('input[placeholder*="overriding"]').fill(reason);
    await page.getByRole("button", { name: /save override/i }).click();
    await expect(page.getByRole("button", { name: /save override/i })).toBeHidden({
      timeout: 20_000,
    });

    await waitForFindings(page);
    const overridden = page.locator(".finding-row").filter({ hasText: reason }).first();
    await overridden.click();
    await page.getByRole("button", { name: /assign fix/i }).click();
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

test.describe("staff attestation", () => {
  test.beforeEach(() => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed a scored Gap",
    );
  });

  test("re-check is staff-attested, keeps override, and manager closes the task", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const shiftId = await seedSubmittedShift();
    const findingId = await seedFinding(shiftId, {
      itemId: "e2e_attestation_gap",
      status: "gap",
    });
    await markShiftScored(shiftId);
    const reason = `Attestation override ${Date.now()}`;

    await login(page, MANAGER.email, MANAGER.password);
    await page.goto(`/manager/shifts/${shiftId}`);
    const row = page.locator(`.finding-row[data-finding-id="${findingId}"]`);
    await expect(row).toBeVisible({ timeout: 25_000 });
    await row.click();
    await page.getByRole("button", { name: /^override$/i }).click();
    await page.locator('input[placeholder*="overriding"]').fill(reason);
    await page.getByRole("button", { name: /save override/i }).click();
    await expect(page.getByRole("button", { name: /save override/i })).toBeHidden({
      timeout: 20_000,
    });

    await page
      .getByRole("button", { name: /^show all$/i })
      .click({ timeout: 3_000 })
      .catch(() => {});
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    await page.getByRole("button", { name: /assign fix/i }).click();
    await page.locator('[data-testid="create-task-btn"]').click();
    await expect(page.locator(".task-row").first()).toBeVisible({ timeout: 20_000 });

    await logout(page);
    await login(page, STAFF.email, STAFF.password);
    await page.goto(`/staff/shifts/${shiftId}`);
    const recheck = page.locator('[data-testid="staff-recheck-input"]');
    await expect(recheck).toBeAttached({ timeout: 25_000 });
    await recheck.setInputFiles(TINY_PNG);
    await expect(page.getByText(/re-check sent/i)).toBeVisible({ timeout: 45_000 });

    await logout(page);
    await login(page, MANAGER.email, MANAGER.password);
    await page.goto(`/manager/shifts/${shiftId}`);
    await page
      .getByRole("button", { name: /^show all$/i })
      .click({ timeout: 3_000 })
      .catch(() => {});
    await expect(row).toBeVisible({ timeout: 25_000 });
    await expect(row.locator(".finding-chip")).toHaveAttribute("data-status", "pass");
    await expect(row.locator('[data-testid="finding-source"]')).toHaveAttribute(
      "data-source",
      "staff_recheck",
    );
    await expect(row.locator('[data-testid="finding-source"]')).toHaveText(
      /staff attested/i,
    );
    await expect(row.getByTestId("override-reason")).toContainText(reason);
    await expect(page.getByText(/staff attested — close when ready/i)).toBeVisible();
    const markDone = page.locator('[data-testid="task-mark-done"]');
    await expect(markDone).toBeVisible();
    await markDone.click();
    await expect(markDone).toBeHidden({ timeout: 20_000 });

    await page.goto(`/manager/shifts/${shiftId}/export`);
    await expect(page.getByRole("heading", { name: /compliance pack/i })).toBeVisible({
      timeout: 20_000,
    });
    const exportSource = page.locator(
      '[data-testid="export-source"][data-source="staff_recheck"]',
    );
    await expect(exportSource).toBeVisible();
    await expect(exportSource).toHaveText(/staff attested/i);
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
    await expect(page.getByRole("heading", { name: /scoreboard/i })).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.locator(".status-chip")).toHaveAttribute(
      "data-status",
      "failed",
    );
    const banner = page.locator('[data-testid="stuck-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/scoring is stuck/i);

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
    await expect(page.getByRole("heading", { name: /scoreboard/i })).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByRole("heading", { name: /waiting on score/i })).toBeVisible();
    await expect(page.locator(".status-chip")).toHaveAttribute(
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
    await expect(page.locator(".status-chip")).toHaveAttribute(
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

    // Silent reload + realtime debounce (400ms) fire after the toast.
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

  test("missing evidence files still show Unavailable", async ({ page }) => {
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
    await expect(evidence.getByText("Unavailable")).toBeVisible({ timeout: 15_000 });
    await expect(evidence.locator("img")).toHaveCount(0);
    await expect(evidence.locator('[data-evidence="missing"]')).toHaveCount(1);
    await expect(page.getByRole("button", { name: /print|save pdf/i })).toBeEnabled();
    assertNoPageErrors(errors);
  });
});
