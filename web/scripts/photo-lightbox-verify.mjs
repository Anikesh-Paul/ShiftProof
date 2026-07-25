import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(
  "C:/Users/kamal/AppData/Roaming/npm/node_modules/@playwright/test",
);

const base = process.argv[2] || "http://localhost:5173";
const out = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../playwright-shots/photo-click",
);
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ ...devices["iPhone 13"] });

await page.goto(`${base}/login`, { waitUntil: "networkidle" });
await page.fill("#email", "staff@shiftproof.demo");
await page.fill("#password", "DemoStaff123!");
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 }),
  page.click('button[type="submit"]'),
]);
await page.waitForTimeout(2000);
await page.goto(`${base}/staff/shifts`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.getByRole("link", { name: /view photos/i }).first().click();
await page.waitForTimeout(2000);

await page.getByRole("button", { name: /view evidence 1/i }).click();
await page.waitForSelector('[role="dialog"] .lightbox-img, .lightbox-img', {
  timeout: 5000,
});
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(out, "05-lightbox.png"), fullPage: true });

const dialog = page.locator('[role="dialog"]');
const imgSrc = await dialog.locator("img").getAttribute("src");
const box = await dialog.locator("img").boundingBox();
console.log("LIGHTBOX_SRC", imgSrc?.slice(0, 120));
console.log("LIGHTBOX_BOX", box);

// close via Escape
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
const stillOpen = await dialog.count();
console.log("AFTER_ESC", stillOpen === 0 ? "closed" : "still open");

await browser.close();
console.log("OK");
