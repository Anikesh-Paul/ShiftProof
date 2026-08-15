/**
 * Check evidence thumbs do not show "Unavailable" when images load.
 * node web/scripts/playwright-evidence-overlay.mjs [baseUrl] [shiftId]
 */
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(
  "C:/Users/kamal/AppData/Roaming/npm/node_modules/@playwright/test",
);

const base = process.argv[2] || "https://shift-proof-phi.vercel.app";
const shiftId = process.argv[3] || "6a801978002cd0e6eec4";
const out = path.resolve("web/playwright-shots/evidence-overlay");
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

await page.goto(`${base}/login`, { waitUntil: "networkidle" });
await page.fill("#email", "manager@shiftproof.demo");
await page.fill("#password", "DemoManager123!");
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 25000 }),
  page.click('button[type="submit"]'),
]);

await page.goto(`${base}/manager/shifts/${shiftId}`, {
  waitUntil: "networkidle",
  timeout: 45000,
});
await page.waitForTimeout(2500);

const imgs = page.locator(".evidence-img");
const missing = page.locator(".evidence-missing");
const imgCount = await imgs.count();
const visibleMissing = await missing.evaluateAll((els) =>
  els.filter((el) => {
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  }).length,
);
const visibleImgs = await imgs.evaluateAll((els) =>
  els.filter((el) => {
    const style = getComputedStyle(el);
    return style.display !== "none" && el.naturalWidth > 0;
  }).length,
);
const body = await page.locator("body").innerText();
const unavailableInText = /\bUnavailable\b/.test(body);

await page.screenshot({
  path: path.join(out, `${shiftId}.png`),
  fullPage: false,
});

console.log(
  JSON.stringify(
    {
      shiftId,
      imgCount,
      visibleImgs,
      visibleMissing,
      unavailableInText,
    },
    null,
    2,
  ),
);

const ok = imgCount > 0 && visibleImgs === imgCount && visibleMissing === 0;
await browser.close();
process.exit(ok ? 0 : 1);
