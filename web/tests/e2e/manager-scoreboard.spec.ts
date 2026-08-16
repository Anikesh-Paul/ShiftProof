import {
  assertNoPageErrors,
  collectPageErrors,
  login,
  MANAGER,
} from "../helpers/auth";
import { expect, test } from "../helpers/fixtures";
import {
  hasServerKey,
  markShiftScored,
  seedAgentJob,
  seedFinding,
  seedOpenTask,
  seedSubmittedShift,
  setTaskRecheckFileId,
} from "../helpers/agentJobs";

test.describe("manager Scoreboard is staff, time, outcome", () => {
  test.beforeEach(() => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed a scored Gap",
    );
  });

  test("seeded Shift with no photos and one Gap has an honest title and Finding actions", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const shiftId = await seedSubmittedShift({ photoFileIds: [] });
    await seedFinding(shiftId, { itemId: "gloves_worn", status: "gap" });
    await markShiftScored(shiftId);

    await login(page, MANAGER.email, MANAGER.password);
    await page.goto(`/manager/shifts/${shiftId}`);

    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible({ timeout: 25_000 });
    await expect(heading).not.toHaveText(/scoreboard/i);
    await expect(heading).toHaveText(/Priya,\s+\d{1,2}:\d{2}\s+—\s+1 Gap/i);
    await expect(page.getByText(/scoreboard/i)).toHaveCount(0);

    await expect(page.getByRole("heading", { name: /^evidence$/i })).toHaveCount(
      0,
    );
    await expect(page.getByText(/photos appear here/i)).toHaveCount(0);
    await expect(page.getByText(/no photos on this shift/i)).toHaveCount(0);

    const row = page.getByTestId("finding-row").first();
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: /^override$/i })).toBeVisible();
    await expect(row.getByRole("button", { name: /assign fix/i })).toBeVisible();
    const actions = page.getByRole("region", { name: /finding actions/i });
    await expect(actions).toHaveCount(0);

    await expect(page.getByText("runShiftScore")).toHaveCount(0);
    await expect(page.getByText("(C3)")).toHaveCount(0);
    await expect(page.getByText("Seeded e2e finding.")).toHaveCount(0);
    await expect(row.getByText(/^AI$/)).toHaveCount(0);
    await expect(
      page.getByText("All findings carry clause · quote · confidence."),
    ).toHaveCount(0);
    await expect(row.getByText(/86% sure/i)).toHaveCount(1);
    await expect(row.getByText(/FS-01/)).toHaveCount(1);
    await expect(row.getByText(/conf\s*86%/i)).toHaveCount(0);

    const how = page.getByRole("button", { name: /how this was scored/i });
    if ((await how.count()) > 0) {
      await expect(how).toHaveAttribute("aria-expanded", "false");
    }

    await row.getByRole("button", { name: /^override$/i }).click();
    await expect(actions).toBeVisible();
    await expect(actions.getByPlaceholder(/overriding AI/i)).toHaveCount(0);
    await actions.getByRole("button", { name: /cancel/i }).click();

    await row.getByRole("button", { name: /assign fix/i }).click();
    await expect(actions).toBeVisible();
    await expect(actions).not.toContainText(/Fix:\s*Fix:/);
    assertNoPageErrors(errors);
  });

  test("a stuck job does not say scoring is complete or claim citations", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const submittedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const shiftId = await seedSubmittedShift({ submittedAt, photoFileIds: [] });
    await seedAgentJob(shiftId, "failed", {
      errorMessage: "seeded e2e failure (stuck honesty)",
    });

    await login(page, MANAGER.email, MANAGER.password);
    await page.goto(`/manager/shifts/${shiftId}`);

    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible({ timeout: 25_000 });
    await expect(heading).not.toHaveText(/scoreboard/i);

    const status = page.getByTestId("shift-status");
    await expect(status).toBeVisible();
    await expect(status).toHaveText("Scoring failed.");
    await expect(page.getByText(/scoring complete/i)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /waiting on score/i })).toHaveCount(
      0,
    );
    await expect(page.getByText(/scores appear here/i)).toHaveCount(0);
    await expect(
      page.getByText("All findings carry clause · quote · confidence."),
    ).toHaveCount(0);

    const how = page.getByRole("button", { name: /how this was scored/i });
    if ((await how.count()) > 0) {
      await expect(how).toHaveAttribute("aria-expanded", "false");
      await how.click();
      await expect(page.getByText(/clause, quote, and confidence/i)).toHaveCount(0);
      await expect(page.getByText(/mark job done and shift scored/i)).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: /retry scoring/i })).toBeVisible();
    assertNoPageErrors(errors);
  });

  test("Mark done is disabled without a Re-check and enabled once a Re-check file id exists", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const shiftId = await seedSubmittedShift({ photoFileIds: [] });
    const findingId = await seedFinding(shiftId, {
      itemId: "gloves_worn",
      status: "gap",
    });
    await markShiftScored(shiftId);
    const taskId = await seedOpenTask({
      shiftId,
      findingId,
      title: "Fix: Gloves at prep",
    });

    await login(page, MANAGER.email, MANAGER.password);
    await page.goto(`/manager/shifts/${shiftId}`);

    const markDone = page.getByTestId("task-mark-done");
    await expect(markDone).toBeVisible({ timeout: 25_000 });
    await expect(markDone).toBeDisabled();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await setTaskRecheckFileId(taskId, "seeded_recheck_file");
    await page.reload();

    await expect(page.getByTestId("task-mark-done")).toBeEnabled({
      timeout: 25_000,
    });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    assertNoPageErrors(errors);
  });
});
