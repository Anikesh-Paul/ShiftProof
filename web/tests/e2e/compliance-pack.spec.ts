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
  seedFinding,
  seedOpenTask,
  seedSubmittedShift,
} from "../helpers/agentJobs";

test.describe("Compliance pack is an operational proof", () => {
  test.beforeEach(() => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed a scored Shift",
    );
  });

  test("pack is reachable from Scoreboard and shows site, staff, time, human status, and Gaps with clause and quote", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const shiftId = await seedSubmittedShift({ photoFileIds: [] });
    await seedFinding(shiftId, { itemId: "gloves_worn", status: "gap" });
    await seedFinding(shiftId, { itemId: "fridge_temp", status: "pass" });
    await markShiftScored(shiftId);

    await login(page, MANAGER.email, MANAGER.password);
    await page.goto(`/manager/shifts/${shiftId}`);

    // Reachable from Scoreboard overflow
    await page.getByTestId("scoreboard-overflow").click();
    const exportLink = page.getByRole("link", { name: /export pack/i });
    await expect(exportLink).toBeVisible();
    await exportLink.click();

    await expect(page).toHaveURL(new RegExp(`/manager/shifts/${shiftId}/export`));

    // Heading and Print / Save PDF primary CTA
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible({ timeout: 25_000 });
    await expect(heading).toHaveText(/compliance pack/i);

    const printBtn = page.getByRole("button", { name: /print \/ save pdf/i });
    await expect(printBtn).toBeVisible();
    await expect(printBtn).toBeEnabled();

    // Summary metadata: site, staff, time, human status (never raw "scored")
    const meta = page.getByTestId("export-meta");
    await expect(meta).toBeVisible();
    await expect(meta).toContainText(/demo café/i);
    await expect(meta).toContainText(/priya/i);

    // Status is human "Scored" (never raw lowercase "scored")
    const statusText = await meta.locator("div", { hasText: /^Status/ }).locator("p").textContent();
    expect(statusText?.trim()).toBe("Scored");

    // Findings table lists Gaps with clause, quote, and plain-language confidence
    const scoreboard = page.getByTestId("export-scoreboard");
    await expect(scoreboard).toBeVisible();
    await expect(scoreboard).toContainText(/gloves/i);
    await expect(scoreboard).toContainText(/FS-01/);
    await expect(scoreboard).toContainText(/handlers must wear clean/i);
    await expect(scoreboard).toContainText(/86% sure/i);

    assertNoPageErrors(errors);
  });

  test("pack excludes seed/e2e strings and has no certification framing", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const shiftId = await seedSubmittedShift({ photoFileIds: [] });
    const findingId = await seedFinding(shiftId, { itemId: "gloves_worn", status: "gap" });
    await markShiftScored(shiftId);
    await seedOpenTask({
      shiftId,
      findingId,
      title: "E2e Assign Durability Harness Fix",
    });

    await login(page, MANAGER.email, MANAGER.password);
    await page.goto(`/manager/shifts/${shiftId}/export`);

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 25_000,
    });

    // Copy denylist checks
    await expect(page.getByText("Seeded e2e finding.")).toHaveCount(0);
    await expect(page.getByText(/runShiftScore/i)).toHaveCount(0);
    await expect(page.getByText("(C3)")).toHaveCount(0);
    await expect(page.getByText(/E2e Assign Durability/i)).toHaveCount(0);
    await expect(page.getByText(/Why are you overriding AI\?/i)).toHaveCount(0);

    // Title and footer have no certification claim
    const pageText = await page.textContent("body");
    expect(pageText).not.toMatch(/certificate/i);
    expect(pageText).not.toMatch(/inspection pass document/i);

    const footer = page.locator(".export-footer");
    await expect(footer).toBeVisible();
    await expect(footer).toContainText(/operational record/i);
    await expect(footer).not.toContainText(/certification/i);

    assertNoPageErrors(errors);
  });

  test("findings table stacks on narrow mobile viewport instead of wrapping mid-word", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "mobile viewport stacking test");

    const errors = collectPageErrors(page);
    const shiftId = await seedSubmittedShift({ photoFileIds: [] });
    await seedFinding(shiftId, { itemId: "gloves_worn", status: "gap" });
    await markShiftScored(shiftId);

    await login(page, MANAGER.email, MANAGER.password);
    await page.goto(`/manager/shifts/${shiftId}/export`);

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 25_000,
    });

    const quoteCell = page.locator(".export-note").first();
    await expect(quoteCell).toBeVisible();

    // Verify quote text contains full words like "handlers" and "disposable" without being broken
    await expect(quoteCell).toContainText(/handlers/);
    await expect(quoteCell).toContainText(/disposable/);

    // Table header is hidden on mobile stacked layout
    await expect(page.locator(".export-table thead")).toBeHidden();

    // Finding rows have stacked block layout
    const row = page.locator(".export-table tbody tr").first();
    await expect(row).toBeVisible();

    assertNoPageErrors(errors);
  });

  test("pack header names this Shift’s two Gaps and omits Unclear", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const shiftId = await seedSubmittedShift({
      submittedAt: "2026-08-17T12:00:00.000Z",
      photoFileIds: [],
    });
    await seedFinding(shiftId, { itemId: "gloves_worn", status: "gap" });
    await seedFinding(shiftId, { itemId: "fridge_temp", status: "gap" });
    await seedFinding(shiftId, { itemId: "handwash_station", status: "unclear" });
    await markShiftScored(shiftId);

    await login(page, MANAGER.email, MANAGER.password);
    await page.goto(`/manager/shifts/${shiftId}/export`);

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 25_000,
    });

    const line = page.getByTestId("pack-gap-sentence");
    await expect(line).toBeVisible();
    await expect(line).toHaveText(/^17 Aug: 2 Gaps — /);
    await expect(line).toContainText(/glove/i);
    await expect(line).toContainText(/cold storage|fridge/i);
    await expect(line).not.toContainText(/handwash|Unclear/i);

    const tally = page.locator(".export-tally");
    await expect(tally).toContainText("2");
    await expect(tally).toContainText("Gap");
    await expect(tally).toContainText("1");
    await expect(tally).toContainText("Unclear");

    const scoreboard = page.getByTestId("export-scoreboard");
    await expect(scoreboard).toContainText(/Handwash/i);
    await expect(scoreboard).toContainText(/Unclear/i);

    assertNoPageErrors(errors);
  });

  test("pack header says no Gaps when this Shift has none", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const shiftId = await seedSubmittedShift({
      submittedAt: "2026-08-17T12:00:00.000Z",
      photoFileIds: [],
    });
    await seedFinding(shiftId, { itemId: "gloves_worn", status: "pass" });
    await markShiftScored(shiftId);

    await login(page, MANAGER.email, MANAGER.password);
    await page.goto(`/manager/shifts/${shiftId}/export`);

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 25_000,
    });

    const line = page.getByTestId("pack-gap-sentence");
    await expect(line).toBeVisible();
    await expect(line).toHaveText("17 Aug: no Gaps");
    await expect(line).not.toContainText(/Gloves|—/);

    const tally = page.locator(".export-tally");
    await expect(tally).toContainText("1");
    await expect(tally).toContainText("Pass");
    await expect(tally).toContainText("0");
    await expect(tally).toContainText("Gap");

    assertNoPageErrors(errors);
  });
});
