/**
 * Click a staff evidence photo and capture the error.
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(
  "C:/Users/kamal/AppData/Roaming/npm/node_modules/@playwright/test",
);

const base = process.argv[2] || "http://localhost:5173";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(__dirname, "../playwright-shots/photo-click");
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ...devices["iPhone 13"],
  colorScheme: "light",
});
const page = await ctx.newPage();

const logs = [];
page.on("console", (msg) => {
  logs.push({ type: msg.type(), text: msg.text() });
  console.log("CONSOLE", msg.type(), msg.text().slice(0, 300));
});
page.on("response", async (res) => {
  const url = res.url();
  if (url.includes("evidence") || url.includes("storage") || url.includes("files")) {
    console.log("RESP", res.status(), url.slice(0, 180));
    logs.push({ type: "response", status: res.status(), url });
  }
});

async function login(email, password) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 }),
    page.click('button[type="submit"]'),
  ]);
}

// Staff flow
await login("staff@shiftproof.demo", "DemoStaff123!");
await page.waitForTimeout(3000);
await page.goto(`${base}/staff/shifts`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(out, "01-history.png"), fullPage: true });

// Prefer a row with photos (View photos)
const viewPhotos = page.getByRole("link", { name: /view photos/i }).first();
const continueDraft = page.getByRole("link", { name: /continue draft/i }).first();
if ((await viewPhotos.count()) > 0) {
  await viewPhotos.click();
} else if ((await continueDraft.count()) > 0) {
  await continueDraft.click();
} else {
  // any shift link
  await page.locator('a[href^="/staff/shifts/"]').first().click();
}
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(out, "02-evidence-page.png"), fullPage: true });

const img = page.locator(".photo-grid img, .photo-tile img, .evidence-img").first();
const imgCount = await page.locator(".photo-grid img, .photo-tile img").count();
console.log("IMG_COUNT", imgCount);

let photoHref = null;
const link = page.locator(".photo-grid a, .photo-tile a").first();
if ((await link.count()) > 0) {
  photoHref = await link.getAttribute("href");
  console.log("PHOTO_HREF", photoHref);
}

if ((await img.count()) > 0) {
  const src = await img.getAttribute("src");
  console.log("IMG_SRC", src);
  // Fetch the image URL with page context (cookies/session)
  if (src) {
    const fetchResult = await page.evaluate(async (url) => {
      try {
        const r = await fetch(url, { credentials: "include" });
        const ct = r.headers.get("content-type");
        const text = ct && ct.includes("json") ? await r.text() : `(binary ${ct}, ${r.status})`;
        return { status: r.status, contentType: ct, body: text.slice(0, 800) };
      } catch (e) {
        return { error: String(e) };
      }
    }, src);
    console.log("FETCH_IMG", JSON.stringify(fetchResult, null, 2));
    logs.push({ type: "fetch_img", ...fetchResult, src });
  }
}

// Click to open (new tab)
if ((await link.count()) > 0) {
  const [popup] = await Promise.all([
    page.waitForEvent("popup", { timeout: 8000 }).catch(() => null),
    link.click(),
  ]);
  if (popup) {
    await popup.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(1000);
    const popupUrl = popup.url();
    const popupText = await popup.locator("body").innerText().catch(() => "");
    console.log("POPUP_URL", popupUrl);
    console.log("POPUP_TEXT", popupText.slice(0, 600));
    await popup.screenshot({ path: path.join(out, "03-popup.png"), fullPage: true }).catch(() => {});
    logs.push({ type: "popup", url: popupUrl, text: popupText.slice(0, 1000) });

    // Also fetch popup URL
    if (popupUrl && popupUrl.startsWith("http")) {
      const fetchPopup = await page.evaluate(async (url) => {
        try {
          const r = await fetch(url, { credentials: "include" });
          const ct = r.headers.get("content-type");
          const text = await r.text();
          return { status: r.status, contentType: ct, body: text.slice(0, 800) };
        } catch (e) {
          return { error: String(e) };
        }
      }, popupUrl);
      console.log("FETCH_POPUP", JSON.stringify(fetchPopup, null, 2));
      logs.push({ type: "fetch_popup", ...fetchPopup });
    }
  } else {
    // same-tab navigation?
    await page.waitForTimeout(1500);
    console.log("NO_POPUP current", page.url());
    const body = await page.locator("body").innerText().catch(() => "");
    console.log("PAGE_TEXT", body.slice(0, 600));
    await page.screenshot({ path: path.join(out, "03-after-click.png"), fullPage: true });
    logs.push({ type: "same_tab", url: page.url(), text: body.slice(0, 1000) });
  }
}

// Manager side too
await page.goto(`${base}/login`, { waitUntil: "networkidle" }).catch(() => {});
// logout if needed
if (!page.url().includes("/login")) {
  const lo = page.getByRole("button", { name: /log out/i });
  if ((await lo.count()) > 0) await lo.click();
  await page.waitForTimeout(800);
}
await login("manager@shiftproof.demo", "DemoManager123!");
await page.waitForTimeout(4000);
const mShift = page.locator('a[href^="/manager/shifts/"]').first();
if ((await mShift.count()) > 0) {
  await mShift.click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(out, "04-manager-detail.png"), fullPage: true });
  const mLink = page.locator(".evidence-link, .evidence-grid a").first();
  if ((await mLink.count()) > 0) {
    const href = await mLink.getAttribute("href");
    console.log("MANAGER_PHOTO_HREF", href);
    if (href) {
      const fr = await page.evaluate(async (url) => {
        try {
          const r = await fetch(url, { credentials: "include" });
          const ct = r.headers.get("content-type");
          const text = await r.text();
          return { status: r.status, contentType: ct, body: text.slice(0, 800) };
        } catch (e) {
          return { error: String(e) };
        }
      }, href);
      console.log("MANAGER_FETCH", JSON.stringify(fr, null, 2));
      logs.push({ type: "manager_fetch", href, ...fr });
    }
  } else {
    console.log("NO_MANAGER_EVIDENCE_LINKS");
  }
}

await writeFile(path.join(out, "report.json"), JSON.stringify({ logs, at: new Date().toISOString() }, null, 2));
await browser.close();
console.log("done", out);
