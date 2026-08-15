import { test as base, expect, type Page } from "@playwright/test";

/** page.goto defaults to domcontentloaded — Realtime sockets never go networkidle. */
export const test = base.extend({
  page: async ({ page }, use) => {
    const orig = page.goto.bind(page);
    page.goto = ((url: Parameters<Page["goto"]>[0], options?: Parameters<Page["goto"]>[1]) =>
      orig(url, { waitUntil: "domcontentloaded", ...options })) as Page["goto"];
    await use(page);
  },
});

export { expect };
export type { Page };
