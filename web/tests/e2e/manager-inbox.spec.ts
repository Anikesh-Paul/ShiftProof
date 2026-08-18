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
  markShiftScored,
  seedDraftShift,
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

  test("live clause set and Replace show when the PDF is on file", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await mockSopOnFile(page);
    await mockChecklist(page, PREVIOUS_LIVE_SET);
    await login(page, MANAGER.email, MANAGER.password);
    await expect(page.getByRole("tab", { name: /^today$/i })).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(
      /Checking shifts/i,
      { timeout: 25_000 },
    );
    const sop = page.getByTestId("sop-upload");
    await expect(sop).toBeVisible({ timeout: 25_000 });
    await expect(sop.getByRole("button", { name: /^replace$/i })).toBeVisible();
    await expect(sop.getByRole("button", { name: /^upload$/i })).toHaveCount(0);
    await expect(sop).not.toContainText(/missing/i);
    await expect(page.getByRole("heading", { name: /opening sop/i })).toHaveCount(
      0,
    );
    await expect(sop.locator("summary")).toContainText(/Opening check · 3 items/i);
    await expect(page.getByTestId("live-clause-set")).toBeHidden();
    await sop.locator("summary").click();
    const live = page.getByTestId("live-clause-set");
    await expect(live).toBeVisible();
    await expect(live).toContainText("Gloves worn at food-prep station");
    await expect(live).toContainText("Handwash station stocked");
    await expect(live).toContainText("Sanitizer available and filled");
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
    await expect(sop.getByRole("button", { name: /^replace$/i })).toHaveCount(0);
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

test.describe("manager Inbox rows name the work", () => {
  test("a Today row is one Shift: staff, time, open items, Gap/Unclear", async ({
    page,
  }) => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed openings",
    );
    const errors = collectPageErrors(page);
    const shiftId = await seedSubmittedShift();
    await seedFinding(shiftId, { itemId: "gloves_worn", status: "gap" });
    await seedFinding(shiftId, { itemId: "handwash_station", status: "gap" });
    await seedFinding(shiftId, { itemId: "counter_clean", status: "unclear" });
    await seedFinding(shiftId, { itemId: "fridge_temp", status: "pass" });
    await markShiftScored(shiftId);

    await login(page, MANAGER.email, MANAGER.password);
    await expect(page.getByRole("tab", { name: /^today$/i })).toBeVisible({
      timeout: 25_000,
    });
    const row = page.locator(`a[href="/manager/shifts/${shiftId}"]`);
    await expect(row).toBeVisible({ timeout: 25_000 });
    await expect(row).toContainText(/Priya/i);
    await expect(row).not.toContainText(/· Opening/);
    await expect(row.locator("time")).toBeVisible();
    await expect(row).toContainText(/gloves/i);
    await expect(row).toContainText(/handwash/i);
    await expect(row).toContainText("+1");
    await expect(row).toContainText(/2\s*Gap/i);
    await expect(row).toContainText(/1\s*Unclear/i);
    await expect(row).not.toContainText(/\d+\s*Pass/i);
    await expect(row).not.toContainText(/^Review$|Review/);
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/manager/shifts/${shiftId}`));
    assertNoPageErrors(errors);
  });

  test("Today lists every seeded opening, Gaps then Unclear then scoring", async ({
    page,
  }) => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed openings",
    );
    const errors = collectPageErrors(page);
    const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    const backlogId = await seedSubmittedShift({ submittedAt: yesterday });
    await seedFinding(backlogId, { itemId: "gloves_worn", status: "gap" });
    await markShiftScored(backlogId);

    const gapId = await seedSubmittedShift();
    await seedFinding(gapId, { itemId: "gloves_worn", status: "gap" });
    await markShiftScored(gapId);

    const unclearId = await seedSubmittedShift();
    await seedFinding(unclearId, { itemId: "fridge_temp", status: "unclear" });
    await markShiftScored(unclearId);

    const scoringId = await seedSubmittedShift();

    await login(page, MANAGER.email, MANAGER.password);
    await expect(page.getByRole("tab", { name: /^today$/i })).toBeVisible({
      timeout: 25_000,
    });
    const gapRow = page.locator(`a[href="/manager/shifts/${gapId}"]`);
    const unclearRow = page.locator(`a[href="/manager/shifts/${unclearId}"]`);
    const scoringRow = page.locator(`a[href="/manager/shifts/${scoringId}"]`);
    await expect(gapRow).toBeVisible({ timeout: 25_000 });
    await expect(unclearRow).toBeVisible();
    await expect(scoringRow).toBeVisible();

    const hrefs = await page
      .getByRole("region", { name: /^inbox$/i })
      .getByRole("link")
      .evaluateAll((els) => els.map((el) => el.getAttribute("href") || ""));
    expect(hrefs.indexOf(`/manager/shifts/${gapId}`)).toBeLessThan(
      hrefs.indexOf(`/manager/shifts/${unclearId}`),
    );
    expect(hrefs.indexOf(`/manager/shifts/${unclearId}`)).toBeLessThan(
      hrefs.indexOf(`/manager/shifts/${scoringId}`),
    );

    await page.getByRole("tab", { name: /^backlog$/i }).click();
    await expect(gapRow).toHaveCount(0);
    const backlogRow = page.locator(`a[href="/manager/shifts/${backlogId}"]`);
    if ((await backlogRow.count()) > 0) {
      await expect(backlogRow).toBeVisible();
    }
    assertNoPageErrors(errors);
  });

  test("stuck openings collapse to one Retry all banner", async ({ page }) => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed openings",
    );
    const errors = collectPageErrors(page);
    const stuckAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const stuckId = await seedSubmittedShift({ submittedAt: stuckAt });
    const gapId = await seedSubmittedShift();
    await seedFinding(gapId, { itemId: "gloves_worn", status: "gap" });
    await markShiftScored(gapId);

    await login(page, MANAGER.email, MANAGER.password);
    await expect(page.getByRole("tab", { name: /^today$/i })).toBeVisible({
      timeout: 25_000,
    });
    const banner = page.getByTestId("inbox-jobs");
    await expect(banner).toBeVisible({ timeout: 25_000 });
    await expect(banner).toContainText(/stuck/i);
    await expect(banner.getByRole("button", { name: /retry all/i })).toBeVisible();
    await expect(
      page.locator(`a[href="/manager/shifts/${stuckId}"]`),
    ).toHaveCount(0);
    await expect(
      page.locator(`a[href="/manager/shifts/${gapId}"]`),
    ).toBeVisible();
    assertNoPageErrors(errors);
  });

  test("Repeat chips sit under the tabs and toggle an item filter", async ({
    page,
  }) => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed openings",
    );
    const errors = collectPageErrors(page);
    const otherId = await seedSubmittedShift();
    await seedFinding(otherId, { itemId: "counter_clean", status: "gap" });
    await markShiftScored(otherId);

    const unclearId = await seedSubmittedShift();
    await seedFinding(unclearId, { itemId: "gloves_worn", status: "unclear" });
    await markShiftScored(unclearId);

    const gapId = await seedSubmittedShift();
    await seedFinding(gapId, { itemId: "gloves_worn", status: "gap" });
    await markShiftScored(gapId);

    await login(page, MANAGER.email, MANAGER.password);
    await expect(page.getByRole("tab", { name: /^today$/i })).toBeVisible({
      timeout: 25_000,
    });
    const inbox = page.getByRole("region", { name: /^inbox$/i });
    const chips = inbox.getByTestId("repeat-offender");
    await expect(chips).toBeVisible({ timeout: 25_000 });
    await expect(
      page.getByRole("heading", { name: /repeat gaps/i }),
    ).toHaveCount(0);

    const otherRow = page.locator(`a[href="/manager/shifts/${otherId}"]`);
    const gapRow = page.locator(`a[href="/manager/shifts/${gapId}"]`);
    const unclearRow = page.locator(`a[href="/manager/shifts/${unclearId}"]`);
    await expect(otherRow).toBeVisible({ timeout: 25_000 });
    await expect(gapRow).toBeVisible();
    await expect(unclearRow).toBeVisible();

    const glovesChip = chips.getByRole("button", { name: /gloves/i });
    await expect(glovesChip).toBeVisible();
    await glovesChip.click();
    await expect(gapRow).toBeVisible();
    await expect(unclearRow).toBeVisible();
    await expect(otherRow).toHaveCount(0);

    await glovesChip.click();
    await expect(otherRow).toBeVisible({ timeout: 25_000 });
    assertNoPageErrors(errors);
  });

  test("All uses the same Shift row and may show Pass counts", async ({
    page,
  }) => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed openings",
    );
    const errors = collectPageErrors(page);
    const shiftId = await seedSubmittedShift();
    await seedFinding(shiftId, { itemId: "gloves_worn", status: "gap" });
    await seedFinding(shiftId, { itemId: "fridge_temp", status: "pass" });
    await markShiftScored(shiftId);

    await login(page, MANAGER.email, MANAGER.password);
    await expect(page.getByRole("tab", { name: /^today$/i })).toBeVisible({
      timeout: 25_000,
    });
    const row = page.locator(`a[href="/manager/shifts/${shiftId}"]`);
    await expect(row).toBeVisible({ timeout: 25_000 });
    await expect(row).toContainText(/gloves/i);
    await expect(row).not.toContainText(/\d+\s*Pass/i);

    await page.getByRole("tab", { name: /^all$/i }).click();
    await expect(row).toBeVisible();
    await expect(row).toContainText(/gloves/i);
    await expect(row).toContainText(/1\s*Pass/i);
    await expect(row).not.toContainText(/· Opening/);
    await expect(row).not.toContainText(/Review/);
    assertNoPageErrors(errors);
  });
});

function isSopRow(url: URL): boolean {
  return /\/tablesdb\/[^/]+\/tables\/sops\/rows\/[^/]+\/?$/.test(url.pathname);
}

function isChecklistRow(url: URL): boolean {
  return /\/tablesdb\/[^/]+\/tables\/checklists\/rows\/[^/]+\/?$/.test(
    url.pathname,
  );
}

function isSopUpload(url: URL): boolean {
  return /\/storage\/buckets\/sop_files\/files\/?$/.test(url.pathname);
}

function isFunctionExecution(url: URL): boolean {
  return /\/functions\/[^/]+\/executions\/?$/.test(url.pathname);
}

const PREVIOUS_LIVE_SET = [
  {
    id: "gloves_worn",
    label: "Gloves worn at food-prep station",
    requiredPhoto: false,
    relatedClauseIds: ["FS-01"],
    quote: "Food handlers must wear clean disposable gloves at the prep station.",
  },
  {
    id: "handwash_station",
    label: "Handwash station stocked",
    requiredPhoto: false,
    relatedClauseIds: ["FS-02"],
    quote: "Handwash station must be stocked and accessible before service.",
  },
  {
    id: "sanitizer_available",
    label: "Sanitizer available and filled",
    requiredPhoto: false,
    relatedClauseIds: ["FS-03"],
    quote: "Sanitizer must be available and filled at open.",
  },
];

const EXTRACTED_LIVE_SET = [
  {
    id: "gloves_worn",
    label: "Gloves at the prep line",
    requiredPhoto: false,
    relatedClauseIds: ["FS-01"],
    quote: "Wear clean disposable gloves at the food-prep station.",
  },
  {
    id: "handwash_station",
    label: "Stocked handwash station",
    requiredPhoto: false,
    relatedClauseIds: ["FS-02"],
    quote: "Handwash must be stocked before service.",
  },
  {
    id: "floor_clear",
    label: "Floor clear of slip hazards",
    requiredPhoto: false,
    relatedClauseIds: ["FS-07"],
    quote: "Service floor should be clear of slip hazards at open.",
  },
  {
    id: "fs-09",
    label: "Allergen board posted",
    requiredPhoto: false,
    relatedClauseIds: ["FS-09"],
    quote: "Allergen board must be posted at the pass.",
  },
];

const TINY_PDF = {
  name: "cafe-sop.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"),
};

async function mockSopOnFile(
  page: import("@playwright/test").Page,
  fileId = "sop_on_file",
) {
  await page.route(
    (url) => isSopRow(new URL(url)),
    async (route) => {
      const method = route.request().method();
      if (method === "PATCH") {
        let patch: { data?: { fileId?: string }; fileId?: string } = {};
        try {
          patch = JSON.parse(route.request().postData() || "{}") as {
            data?: { fileId?: string };
            fileId?: string;
          };
        } catch {
          patch = {};
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          json: {
            $id: "cafe_sop_v1",
            siteId: "demo_cafe",
            title: "Café Food-Safety Opening SOP v1",
            fileId: patch.data?.fileId || patch.fileId || fileId,
            clauseCount: 12,
            version: "1",
          },
        });
        return;
      }
      if (method !== "GET") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const json = (await response.json()) as { fileId?: string };
      await route.fulfill({
        response,
        json: { ...json, fileId },
      });
    },
  );
}

function checklistRow(items: typeof PREVIOUS_LIVE_SET) {
  return {
    $id: "opening_fs",
    siteId: "demo_cafe",
    title: "Opening food-safety",
    itemsJson: JSON.stringify(items),
  };
}

async function mockChecklist(
  page: import("@playwright/test").Page,
  items: typeof PREVIOUS_LIVE_SET,
) {
  await page.route(
    (url) => isChecklistRow(new URL(url)),
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: checklistRow(items),
      });
    },
  );
}

async function mockSopUpload(page: import("@playwright/test").Page) {
  await page.route(
    (url) => isSopUpload(new URL(url)),
    async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        json: {
          $id: "sop_file_new",
          name: "cafe-sop.pdf",
          mimeType: "application/pdf",
        },
      });
    },
  );
}

function executionPayload(
  ok: boolean,
  items?: typeof EXTRACTED_LIVE_SET,
): Record<string, unknown> {
  return {
    $id: "exec_extract",
    $createdAt: new Date().toISOString(),
    $updatedAt: new Date().toISOString(),
    $permissions: [],
    functionId: "runShiftScore",
    trigger: "http",
    status: "completed",
    requestMethod: "POST",
    requestPath: "/",
    requestHeaders: [],
    responseStatusCode: ok ? 200 : 500,
    responseBody: JSON.stringify(
      ok
        ? { ok: true, items: items ?? EXTRACTED_LIVE_SET }
        : { ok: false, error: "Could not read SOP" },
    ),
    responseHeaders: [],
    logs: "",
    errors: "",
    duration: 0.4,
  };
}

async function holdExtractExecution(
  page: import("@playwright/test").Page,
  result: "ok" | "fail",
) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => isFunctionExecution(new URL(url)),
    async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await held;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        json: executionPayload(result === "ok"),
      });
    },
  );
  return { release };
}

test.describe("manager Inbox SOP extract", () => {
  test("failed extract shows an error and keeps the previous live set", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await mockSopOnFile(page);
    await mockChecklist(page, PREVIOUS_LIVE_SET);
    await mockSopUpload(page);
    const extract = await holdExtractExecution(page, "fail");

    await login(page, MANAGER.email, MANAGER.password);
    const sop = page.getByTestId("sop-upload");
    await expect(sop).toBeVisible({ timeout: 25_000 });
    await sop.locator("summary").click();
    await expect(sop).toContainText("Gloves worn at food-prep station");

    await sop.locator('input[type="file"]').setInputFiles(TINY_PDF);
    await expect(sop).toContainText(/reading the sop/i);
    extract.release();

    await expect(sop.getByRole("alert")).toContainText(
      /new file was not read/i,
    );
    await expect(sop.getByRole("alert")).toContainText(
      /previous opening check is still in force/i,
    );
    await expect(sop.locator("summary")).toContainText(/Opening check/i);
    const liveAfterFail = page.getByTestId("live-clause-set");
    if (!(await liveAfterFail.isVisible())) {
      await sop.locator("summary").click();
    }
    await expect(sop).toContainText("Gloves worn at food-prep station");
    await expect(sop).toContainText("Handwash station stocked");
    await expect(sop).toContainText("Sanitizer available and filled");
    await expect(sop).not.toContainText("Allergen board posted");
    await expect(sop.getByRole("button", { name: /^replace$/i })).toBeVisible();
    assertNoPageErrors(errors);
  });

  test("successful extract shows the new live set on Inbox and staff cover list", async ({
    page,
  }) => {
    test.skip(
      !hasServerKey(),
      "root .env APPWRITE_API_KEY absent — cannot seed a staff draft",
    );
    const errors = collectPageErrors(page);
    let liveItems = PREVIOUS_LIVE_SET;
    await mockSopOnFile(page);
    await page.route(
      (url) => isChecklistRow(new URL(url)),
      async (route) => {
        if (route.request().method() !== "GET") {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          json: checklistRow(liveItems),
        });
      },
    );
    await mockSopUpload(page);
    const extract = await holdExtractExecution(page, "ok");

    await login(page, MANAGER.email, MANAGER.password);
    const sop = page.getByTestId("sop-upload");
    await expect(sop).toBeVisible({ timeout: 25_000 });
    await sop.locator("summary").click();
    await expect(sop).toContainText("Gloves worn at food-prep station");

    await sop.locator('input[type="file"]').setInputFiles(TINY_PDF);
    await expect(sop).toContainText(/reading the sop/i);
    liveItems = EXTRACTED_LIVE_SET;
    extract.release();

    const live = page.getByTestId("live-clause-set");
    if (!(await live.isVisible())) {
      await sop.locator("summary").click();
    }
    await expect(live).toContainText("Gloves at the prep line");
    await expect(live).toContainText("Stocked handwash station");
    await expect(live).toContainText("Floor clear of slip hazards");
    await expect(live).toContainText("Allergen board posted");
    await expect(live).not.toContainText("Sanitizer available and filled");
    await expect(sop.getByRole("button", { name: /^replace$/i })).toBeVisible();

    const draftId = await seedDraftShift();
    await logout(page);
    await login(page, STAFF.email, STAFF.password);
    await page.goto(`/staff/shifts/${draftId}`);
    await expect(page.getByRole("heading", { name: /evidence/i })).toBeVisible({
      timeout: 20_000,
    });
    const cover = page.getByTestId("cover-item");
    await expect(cover).toHaveCount(4);
    await expect(cover.nth(0)).toContainText("Gloves at the prep line");
    await expect(cover.nth(1)).toContainText("Stocked handwash station");
    await expect(cover.nth(2)).toContainText("Floor clear of slip hazards");
    await expect(cover.nth(3)).toContainText("Allergen board posted");
    await expect(page.getByLabel("What to cover")).not.toContainText(
      "Sanitizer available and filled",
    );
    assertNoPageErrors(errors);
  });
});
