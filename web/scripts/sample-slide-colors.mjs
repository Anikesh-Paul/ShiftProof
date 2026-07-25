import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(
  "C:/Users/kamal/AppData/Roaming/npm/node_modules/@playwright/test",
);

const base = process.argv[2] || "http://localhost:5173";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

await page.goto(`${base}/login`, { waitUntil: "networkidle" });
await page.fill("#email", "manager@shiftproof.demo");
await page.fill("#password", "DemoManager123!");
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 }),
  page.click('button[type="submit"]'),
]);
await page.waitForTimeout(4000);
await page.locator('a[href^="/manager/shifts/"]').first().click();
await page.waitForTimeout(3000);
await page.getByRole("button", { name: /view evidence 1/i }).click();
await page.waitForSelector(".lightbox-scroller");
await page.waitForTimeout(300);

for (let n = 0; n < 3; n++) {
  if (n > 0) {
    await page.getByRole("button", { name: /next photo/i }).click();
    await page.waitForTimeout(450);
  }
  const sample = await page
    .locator(".lightbox-slide")
    .nth(n)
    .locator("img")
    .evaluate((img) => {
      const c = document.createElement("canvas");
      c.width = 1;
      c.height = 1;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return {
        file: img.src.match(/files\/([^/]+)/)?.[1],
        rgba: [d[0], d[1], d[2], d[3]],
        nw: img.naturalWidth,
        nh: img.naturalHeight,
      };
    });
  const count = await page.locator(".lightbox-count").textContent();
  console.log("SLIDE", n, count, sample);
}

// also sample grid thumbnails
const grid = await page.locator(".evidence-grid img").evaluateAll((imgs) =>
  imgs.map((img) => {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    const ctx = c.getContext("2d");
    try {
      ctx.drawImage(img, 0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return {
        file: img.src.match(/files\/([^/]+)/)?.[1],
        rgba: [d[0], d[1], d[2], d[3]],
        nw: img.naturalWidth,
      };
    } catch (e) {
      return { error: String(e), file: img.src };
    }
  }),
);
console.log("GRID_COLORS", grid);

await browser.close();
