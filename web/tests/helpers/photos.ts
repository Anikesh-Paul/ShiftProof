import type { Page } from "@playwright/test";
import { expect } from "./fixtures";
import { login, STAFF } from "./auth";
import { seedDraftShift } from "./agentJobs";

export const TINY_PNG = {
  name: "race.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
};

export function isEvidenceUpload(url: URL): boolean {
  return /\/storage\/buckets\/evidence\/files\/?$/.test(url.pathname);
}

export function isEvidenceDelete(url: URL): boolean {
  return /\/storage\/buckets\/evidence\/files\/[^/]+\/?$/.test(url.pathname);
}

export function isShiftWrite(url: URL): boolean {
  return /\/(tables|collections)\/shifts\//.test(url.pathname);
}

export async function openSeededDraft(
  page: Page,
  opts?: { photoFileIds?: string[] | string },
): Promise<string> {
  const shiftId = await seedDraftShift(opts);
  await login(page, STAFF.email, STAFF.password);
  await page.goto(`/staff/shifts/${shiftId}`);
  await expect(page.getByRole("heading", { name: /evidence/i })).toBeVisible({
    timeout: 20_000,
  });
  return shiftId;
}

export async function addPhotoToPool(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer } = TINY_PNG,
) {
  const input = page.locator('[data-testid="staff-evidence-input"]');
  await input.setInputFiles(file);
}

export async function removePersistedPhoto(page: Page, index = 0) {
  const tile = page.locator('[data-testid="persisted-photo"]').nth(index);
  await tile.locator(".photo-remove").click();
}

export async function waitUploadIdle(page: Page) {
  await expect(page.locator(".photo-hint")).not.toContainText(/Uploading/i, {
    timeout: 45_000,
  });
}

/** Hold the next evidence Storage POST until `release` is called. */
export async function holdNextEvidenceUpload(page: Page) {
  let continueHeld: (() => Promise<void>) | undefined;
  let saw!: () => void;
  const held = new Promise<void>((resolve) => {
    saw = resolve;
  });
  let captured = false;
  await page.route(
    (url) => isEvidenceUpload(url),
    async (route) => {
      if (route.request().method() !== "POST" || captured) {
        await route.continue();
        return;
      }
      captured = true;
      saw();
      await new Promise<void>((resolve, reject) => {
        continueHeld = async () => {
          try {
            await route.continue();
            resolve();
          } catch (err) {
            reject(err);
          }
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
