import {
  assertNoPageErrors,
  collectPageErrors,
  login,
  MANAGER,
  STAFF,
} from "../helpers/auth";
import { expect, test } from "../helpers/fixtures";
import {
  hasServerKey,
  markShiftScored,
  seedFinding,
  seedSubmittedShift,
} from "../helpers/agentJobs";

test.describe("Scoreboard overflow", () => {
  test.beforeEach(() => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed a scored Gap",
    );
  });

  test("Export pack, Reject check, and Close opening live in an overflow", async ({
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

    await expect(page.getByRole("link", { name: /export pack/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /reject check/i })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: /close opening/i })).toHaveCount(
      0,
    );

    await page.getByTestId("scoreboard-overflow").click();

    const exportPack = page.getByRole("link", { name: /export pack/i });
    await expect(exportPack).toBeVisible();
    await expect(page.getByRole("button", { name: /reject check/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /close opening/i })).toBeVisible();

    await exportPack.click();
    await expect(page).toHaveURL(new RegExp(`/manager/shifts/${shiftId}/export`));
    assertNoPageErrors(errors);
  });

  test("Close opening asks for confirmation before closing", async ({ page }) => {
    const errors = collectPageErrors(page);
    const shiftId = await seedSubmittedShift({ photoFileIds: [] });
    await seedFinding(shiftId, { itemId: "gloves_worn", status: "gap" });
    await markShiftScored(shiftId);

    await login(page, MANAGER.email, MANAGER.password);
    await page.goto(`/manager/shifts/${shiftId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 25_000,
    });

    await page.getByTestId("scoreboard-overflow").click();
    const closeBtn = page.getByRole("button", { name: /close opening/i });
    await expect(closeBtn).toBeVisible();

    const firstDialog = page.waitForEvent("dialog");
    const firstClick = closeBtn.click();
    const first = await firstDialog;
    expect(first.type()).toBe("confirm");
    await first.dismiss();
    await firstClick;
    await expect(page).toHaveURL(new RegExp(`/manager/shifts/${shiftId}$`));

    const closeAgain = page.getByRole("button", { name: /close opening/i });
    if (!(await closeAgain.isVisible())) {
      await page.getByTestId("scoreboard-overflow").click();
    }
    const secondDialog = page.waitForEvent("dialog");
    const secondClick = closeAgain.click();
    const second = await secondDialog;
    await second.accept();
    await secondClick;
    await expect(page).toHaveURL(/\/manager$/);
    assertNoPageErrors(errors);
  });

  test("Reject check keeps its existing confirm", async ({ page }) => {
    const errors = collectPageErrors(page);
    const shiftId = await seedSubmittedShift({ photoFileIds: [] });
    await seedFinding(shiftId, { itemId: "gloves_worn", status: "gap" });
    await markShiftScored(shiftId);

    await login(page, MANAGER.email, MANAGER.password);
    await page.goto(`/manager/shifts/${shiftId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 25_000,
    });

    await page.getByTestId("scoreboard-overflow").click();
    const rejectBtn = page.getByRole("button", { name: /reject check/i });
    await expect(rejectBtn).toBeVisible();

    const dialogP = page.waitForEvent("dialog");
    const clickP = rejectBtn.click();
    const dialog = await dialogP;
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toBe("Photos are not an opening check.");
    await dialog.dismiss();
    await clickP;
    await expect(page).toHaveURL(new RegExp(`/manager/shifts/${shiftId}$`));
    assertNoPageErrors(errors);
  });
});

test.describe("manager shell", () => {
  test("narrow phone chrome is wordmark plus overflow", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "phone chrome only");
    const errors = collectPageErrors(page);
    await login(page, MANAGER.email, MANAGER.password);
    await expect(page).toHaveURL(/\/manager/);

    const chrome = page.getByTestId("shell-chrome");
    await expect(chrome.getByText("ShiftProof", { exact: true })).toBeVisible();
    await expect(chrome.getByText("Manager", { exact: true })).toBeHidden();
    await expect(chrome.getByText(/Demo Manager/i)).toBeHidden();
    await expect(chrome.getByRole("button", { name: /log out/i })).toHaveCount(0);

    await page.getByTestId("shell-overflow").click();
    await expect(page.getByText("Manager", { exact: true })).toBeVisible();
    await expect(page.getByText(/Demo Manager/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /log out/i })).toBeVisible();
    assertNoPageErrors(errors);
  });

  test("desktop chrome keeps name and Log out", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop chrome only");
    const errors = collectPageErrors(page);
    await login(page, MANAGER.email, MANAGER.password);
    await expect(page).toHaveURL(/\/manager/);

    const chrome = page.getByTestId("shell-chrome");
    await expect(chrome.getByText("ShiftProof", { exact: true })).toBeVisible();
    await expect(chrome.getByText(/Demo Manager/i)).toBeVisible();
    await expect(chrome.getByRole("button", { name: /log out/i })).toBeVisible();
    assertNoPageErrors(errors);
  });

  test("staff Opening / History nav is unchanged", async ({ page }) => {
    const errors = collectPageErrors(page);
    await login(page, STAFF.email, STAFF.password);
    await expect(page).toHaveURL(/\/staff/);

    const nav = page.getByTestId("shell-nav");
    await expect(nav.getByRole("link", { name: /^opening$/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /^history$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /log out/i })).toBeVisible();
    assertNoPageErrors(errors);
  });
});
