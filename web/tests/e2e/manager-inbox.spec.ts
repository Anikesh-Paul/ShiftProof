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

test.describe("manager Inbox first fold", () => {
  test("after login the Inbox has a sentence headline and no pulse counts", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await login(page, MANAGER.email, MANAGER.password);
    await expect(page).toHaveURL(/\/manager/);
    await expect(page.getByRole("tab", { name: /^today$/i })).toBeVisible({
      timeout: 25_000,
    });

    const headline = page.getByRole("heading", { level: 1 });
    await expect(headline).toBeVisible();
    await expect(headline).not.toHaveText(/Checking shifts/i, {
      timeout: 25_000,
    });
    await expect(headline).toHaveText(
      /need a look|Nothing needs you today|Checks in progress/i,
    );

    await expect(page.getByLabel("Inbox summary")).toHaveCount(0);
    await expect(page.getByText("Stuck / scoring")).toHaveCount(0);
    assertNoPageErrors(errors);
  });

  test("Today / Backlog / All are tabs, not a second heading", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await login(page, MANAGER.email, MANAGER.password);
    await expect(page.getByRole("tab", { name: /^today$/i })).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByRole("tab", { name: /^backlog$/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /^all$/i })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /^(today|backlog|all|all shifts)$/i }),
    ).toHaveCount(0);
    assertNoPageErrors(errors);
  });

  test("Today is this local day and Backlog is not redefined as unread", async ({
    page,
  }) => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed openings",
    );
    const errors = collectPageErrors(page);
    const todayId = await seedSubmittedShift();
    await seedFinding(todayId, { itemId: "gloves_worn", status: "gap" });
    await markShiftScored(todayId);

    await login(page, MANAGER.email, MANAGER.password);
    await expect(page.getByRole("tab", { name: /^today$/i })).toBeVisible({
      timeout: 25_000,
    });
    const todayRow = page.locator(`a[href="/manager/shifts/${todayId}"]`);
    await expect(todayRow).toBeVisible({ timeout: 25_000 });

    await page.getByRole("tab", { name: /^backlog$/i }).click();
    await expect(todayRow).toHaveCount(0);
    assertNoPageErrors(errors);
  });

  test("Open fixes is one summary line until expanded", async ({ page }) => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed a Task",
    );
    const errors = collectPageErrors(page);
    const shiftId = await seedSubmittedShift();
    const findingId = await seedFinding(shiftId, {
      itemId: "gloves_worn",
      status: "gap",
    });
    await markShiftScored(shiftId);
    await seedOpenTask({
      shiftId,
      findingId,
      title: "E2e Assign Durability Alpha",
    });

    await login(page, MANAGER.email, MANAGER.password);
    const openFixes = page.locator('[data-testid="open-fixes"]');
    await expect(openFixes).toBeVisible({ timeout: 25_000 });
    await expect(openFixes).toContainText(/\d+ open fix/i);
    await expect(openFixes).toContainText(/waiting on staff/i);
    await expect(openFixes.getByRole("listitem")).toHaveCount(0);

    await openFixes.getByRole("button", { name: /open fix/i }).click();
    await expect(openFixes.getByRole("listitem").first()).toBeVisible();
    await expect(openFixes).not.toContainText(/E2e Assign Durability/i);
    await expect(openFixes.getByRole("listitem").first()).toContainText(
      /gloves/i,
    );
    assertNoPageErrors(errors);
  });

  test("Opening SOP is absent when the PDF is on file", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.route(
      (url) => isSopRow(new URL(url)),
      async (route) => {
        if (route.request().method() !== "GET") {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        const json = (await response.json()) as { fileId?: string };
        await route.fulfill({
          response,
          json: { ...json, fileId: json.fileId || "sop_on_file" },
        });
      },
    );
    await login(page, MANAGER.email, MANAGER.password);
    await expect(page.getByRole("tab", { name: /^today$/i })).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(
      /Checking shifts/i,
      { timeout: 25_000 },
    );
    await expect(page.getByRole("heading", { name: /opening sop/i })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: /replace pdf/i })).toHaveCount(
      0,
    );
    await expect(page.getByTestId("sop-upload")).toHaveCount(0);
    assertNoPageErrors(errors);
  });

  test("missing SOP is one Missing + Upload line", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.route(
      (url) => isSopRow(new URL(url)),
      async (route) => {
        if (route.request().method() !== "GET") {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        const json = (await response.json()) as { fileId?: string };
        await route.fulfill({
          response,
          json: { ...json, fileId: "" },
        });
      },
    );
    await login(page, MANAGER.email, MANAGER.password);
    await expect(page.getByRole("tab", { name: /^today$/i })).toBeVisible({
      timeout: 25_000,
    });
    const sop = page.getByTestId("sop-upload");
    await expect(sop).toBeVisible({ timeout: 25_000 });
    await expect(sop).toContainText(/missing/i);
    await expect(sop.getByRole("button", { name: /^upload$/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /opening sop/i })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: /replace pdf/i })).toHaveCount(
      0,
    );
    assertNoPageErrors(errors);
  });

  test("Assign today’s gaps is under the tabs, only on Today, only with a Gap", async ({
    page,
  }) => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed a Gap",
    );
    const errors = collectPageErrors(page);
    const shiftId = await seedSubmittedShift();
    await seedFinding(shiftId, { itemId: "gloves_worn", status: "gap" });
    await markShiftScored(shiftId);

    await login(page, MANAGER.email, MANAGER.password);
    await expect(page.getByRole("tab", { name: /^today$/i })).toBeVisible({
      timeout: 25_000,
    });
    const inbox = page.getByRole("region", { name: /^inbox$/i });
    const assign = inbox.locator('[data-testid="assign-today-gaps"]');
    await expect(assign).toBeVisible({ timeout: 25_000 });
    await expect(inbox.getByRole("tablist", { name: /^inbox$/i })).toBeVisible();

    await page.getByRole("tab", { name: /^backlog$/i }).click();
    await expect(assign).toHaveCount(0);
    await page.getByRole("tab", { name: /^all$/i }).click();
    await expect(assign).toHaveCount(0);
    assertNoPageErrors(errors);
  });
});

function isSopRow(url: URL): boolean {
  return /\/tablesdb\/[^/]+\/tables\/sops\/rows\/[^/]+\/?$/.test(url.pathname);
}
