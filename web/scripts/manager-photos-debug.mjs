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
await page.waitForTimeout(4500);
const shiftLink = page.locator('a[href^="/manager/shifts/"]').first();
console.log("SHIFT_LINKS", await page.locator('a[href^="/manager/shifts/"]').count());
await shiftLink.click();
await page.waitForTimeout(3500);

const srcs = await page.locator(".evidence-grid img").evaluateAll((imgs) =>
  imgs.map((img) => ({
    src: img.getAttribute("src"),
    alt: img.getAttribute("alt"),
  })),
);
console.log("GRID", JSON.stringify(srcs, null, 2));
const ids = srcs.map((s) => s.src?.match(/files\/([^/]+)/)?.[1]);
console.log("FILE_IDS", ids);
console.log("UNIQUE_IDS", [...new Set(ids)]);

if (srcs.length > 0) {
  await page.getByRole("button", { name: /view evidence 1/i }).click();
  await page.waitForSelector(".lightbox-scroller", { timeout: 5000 });
  await page.waitForTimeout(400);

  const slideInfo = await page.locator(".lightbox-slide img").evaluateAll((imgs) =>
    imgs.map((img, i) => ({
      i,
      src: img.getAttribute("src")?.match(/files\/([^/]+)/)?.[1],
      naturalWidth: img.naturalWidth,
      complete: img.complete,
    })),
  );
  console.log("SLIDES", JSON.stringify(slideInfo, null, 2));
  console.log("COUNT_TEXT", await page.locator(".lightbox-count").textContent());

  // click next twice
  await page.getByRole("button", { name: /next photo/i }).click();
  await page.waitForTimeout(500);
  console.log("AFTER_NEXT1", await page.locator(".lightbox-count").textContent());
  const scroll1 = await page.locator(".lightbox-scroller").evaluate((el) => ({
    scrollLeft: el.scrollLeft,
    clientWidth: el.clientWidth,
    child0: el.children[0]?.offsetLeft,
    child1: el.children[1]?.offsetLeft,
    child2: el.children[2]?.offsetLeft,
  }));
  console.log("SCROLL1", scroll1);

  await page.getByRole("button", { name: /next photo/i }).click();
  await page.waitForTimeout(500);
  console.log("AFTER_NEXT2", await page.locator(".lightbox-count").textContent());
  const scroll2 = await page.locator(".lightbox-scroller").evaluate((el) => ({
    scrollLeft: el.scrollLeft,
    clientWidth: el.clientWidth,
  }));
  console.log("SCROLL2", scroll2);
}

await browser.close();
