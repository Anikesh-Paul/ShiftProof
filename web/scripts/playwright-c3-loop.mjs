/**
 * C3 full loop: staff submit → score → manager sees findings.
 * Prefer real demo kit photos when present (gap kit for video narrative).
 * node web/scripts/playwright-c3-loop.mjs [baseUrl]
 */
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(
  "C:/Users/kamal/AppData/Roaming/npm/node_modules/@playwright/test",
);

const base = process.argv[2] || "http://localhost:5174";
const out = path.resolve("web/playwright-shots/c3");
await mkdir(out, { recursive: true });

// 1x1 png fallback when demo kits missing
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Load up to 5 images from demo/photos/gap (or pass/unclear). */
function loadKitFiles() {
  const roots = [
    path.resolve("demo/photos"),
    path.resolve("../demo/photos"),
  ];
  for (const root of roots) {
    for (const kit of ["gap", "pass", "unclear"]) {
      const dir = path.join(root, kit);
      if (!existsSync(dir)) continue;
      const names = readdirSync(dir)
        .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
        .sort()
        .slice(0, 5);
      if (names.length >= 3) {
        return {
          kit,
          files: names.map((name) => {
            const buf = readFileSync(path.join(dir, name));
            const ext = path.extname(name).toLowerCase();
            const mime =
              ext === ".png"
                ? "image/png"
                : ext === ".webp"
                  ? "image/webp"
                  : "image/jpeg";
            return { name, mimeType: mime, buffer: buf };
          }),
        };
      }
    }
  }
  return null;
}

const kit = loadKitFiles();
const uploadFiles = kit
  ? kit.files
  : [
      { name: "a.png", mimeType: "image/png", buffer: PNG },
      { name: "b.png", mimeType: "image/png", buffer: PNG },
      { name: "c.png", mimeType: "image/png", buffer: PNG },
    ];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ...devices["iPhone 13"],
  colorScheme: "light",
});
const page = await ctx.newPage();
const log = [];

function step(msg) {
  log.push(msg);
  console.log(msg);
}

async function login(email, password) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 25000 }),
    page.click('button[type="submit"]'),
  ]);
}

try {
  step(
    kit
      ? `kit=${kit.kit} files=${uploadFiles.length}`
      : "kit=fallback-1x1-png (demo/photos missing)",
  );

  // Staff
  await login("staff@shiftproof.demo", "DemoStaff123!");
  await page.waitForTimeout(3000);
  await page.goto(`${base}/staff`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const start = page.getByRole("button", { name: /start opening check/i });
  await start.click({ timeout: 15000 });
  await page.waitForURL(/\/staff\/shifts\//, { timeout: 20000 });
  const draftUrl = page.url();
  const shiftIdMatch = draftUrl.match(/\/staff\/shifts\/([^/?#]+)/);
  const shiftId = shiftIdMatch ? shiftIdMatch[1] : null;
  step(`draft ${draftUrl}`);
  if (!shiftId) throw new Error("Could not parse shiftId from draft URL");
  step(`shiftId ${shiftId}`);

  // Evidence page (not open-fix recheck inputs on staff home)
  await page.getByRole("heading", { name: /evidence/i }).waitFor({ timeout: 15000 });
  const input = page.locator(
    '[data-testid="staff-evidence-input"], input[type="file"][multiple]',
  );
  await input.first().waitFor({ state: "attached", timeout: 10000 });
  await input.first().setInputFiles(uploadFiles);
  // wait for uploads (real kit jpgs are larger)
  const uploadWait = kit ? 20000 : 10000;
  await page.waitForTimeout(uploadWait);
  await page.screenshot({ path: path.join(out, "01-after-upload.png") });

  const submit = page.getByRole("button", { name: /submit proof/i });
  // may need wait until enabled
  for (let i = 0; i < 40; i++) {
    if (await submit.isEnabled()) break;
    await page.waitForTimeout(1000);
  }
  if (!(await submit.isEnabled())) {
    throw new Error("Submit still disabled after uploads");
  }
  await submit.click();
  // Gemini + Storage can take 2+ min (large kit + 503 retries); poll staff UI
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(2000);
    const t = (await page.locator("body").innerText()).toLowerCase();
    if (
      /scoring complete|job:\s*done|scored|complete|failed|could not score/i.test(
        t,
      )
    ) {
      break;
    }
  }
  await page.screenshot({ path: path.join(out, "02-after-submit.png") });

  const body = await page.locator("body").innerText();
  step(`submit body: ${body.slice(0, 400).replace(/\n/g, " | ")}`);

  const scored =
    /scoring complete|job:\s*done|scored/i.test(body) ||
    body.toLowerCase().includes("complete");
  if (scored) step("PASS staff saw score complete-ish");
  else step("WARN staff may still be waiting — check job status text");

  // Manager
  await page.getByRole("button", { name: /log out/i }).click();
  await page.waitForTimeout(1000);
  await login("manager@shiftproof.demo", "DemoManager123!");
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(out, "03-manager-inbox.png") });

  const mBody = await page.locator("body").innerText();
  step(`manager: ${mBody.slice(0, 350).replace(/\n/g, " | ")}`);

  // Open the shift just submitted (not an older golden/stub scoreboard)
  await page.goto(`${base}/manager/shifts/${shiftId}`, {
    waitUntil: "networkidle",
  });
  step(`open /manager/shifts/${shiftId}`);
  // Wait for scoreboard findings (Gemini job may still be running; allow ~3 min)
  let findingRows = 0;
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(2000);
    findingRows = await page.locator(".finding-row").count();
    if (findingRows >= 5) break;
    const t = (await page.locator("body").innerText()).toLowerCase();
    if (
      /job failed|scoring failed|could not score/.test(t) &&
      findingRows < 1 &&
      i > 8
    ) {
      step("WARN job appears failed with no findings");
      break;
    }
    if (i > 0 && i % 5 === 0) {
      await page.reload({ waitUntil: "networkidle" }).catch(() => {});
    }
  }
  await page.screenshot({ path: path.join(out, "04-manager-scoreboard.png") });

  const sBody = await page.locator("body").innerText();
  step(`findings rows=${findingRows}`);
  step(`scoreboard: ${sBody.slice(0, 350).replace(/\n/g, " | ")}`);
  await page.screenshot({ path: path.join(out, "05-scoreboard-detail.png") });

  if (findingRows >= 1) {
    step("PASS manager sees findings");
    await page.locator(".finding-row").first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, "06-finding-selected.png") });
  } else if (/waiting on score|no findings/i.test(sBody)) {
    step("FAIL no findings yet — scoring may have failed");
  } else {
    step(`INFO scoreboard text: ${sBody.slice(0, 300)}`);
  }

  // Export
  const exportLink = page.locator('a[href*="/export"]');
  if (await exportLink.count()) {
    await exportLink.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(out, "07-export.png") });
    step("PASS export page");
  }

  await writeFile(
    path.join(out, "log.txt"),
    log.join("\n") + `\nhasFindings=${findingRows > 0}\n`,
  );

  if (findingRows < 5) {
    console.error(
      `C3 LOOP INCOMPLETE — need ≥5 findings on submitted shift, got ${findingRows}`,
    );
    process.exit(1);
  }
  console.log("C3 LOOP OK");
  process.exit(0);
} catch (e) {
  console.error(e);
  await page.screenshot({ path: path.join(out, "error.png") }).catch(() => {});
  await writeFile(path.join(out, "log.txt"), log.join("\n") + "\n" + String(e));
  process.exit(1);
} finally {
  await browser.close();
}
