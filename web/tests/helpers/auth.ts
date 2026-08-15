import { expect, type Page } from "@playwright/test";

export const STAFF = {
  email: "staff@shiftproof.demo",
  password: "DemoStaff123!",
} as const;

export const MANAGER = {
  email: "manager@shiftproof.demo",
  password: "DemoManager123!",
} as const;

export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => {
    errors.push(err.message);
  });
  return errors;
}

export function assertNoPageErrors(errors: string[]) {
  expect(errors, errors.join("\n")).toEqual([]);
}

export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 25_000 }),
    page.locator('button[type="submit"]').click(),
  ]);
}

export async function logout(page: Page) {
  const btn = page.getByRole("button", { name: /log out/i });
  if ((await btn.count()) === 0) return;
  await btn.click();
  await page.waitForURL(/login/, { timeout: 15_000 });
}
