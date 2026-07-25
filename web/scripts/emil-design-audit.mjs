/**
 * Emil design-eng visual audit via Playwright.
 * Navigates all routes, captures screenshots, inspects motion/interaction CSS.
 * Usage: node web/scripts/emil-design-audit.mjs [baseUrl]
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
const out = path.resolve(__dirname, "../playwright-shots/emil-audit");
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const findings = [];
const shots = [];

function note(severity, screen, issue, detail) {
  findings.push({ severity, screen, issue, detail });
  console.log(`[${severity}] ${screen}: ${issue}`);
}

async function shot(page, label) {
  const file = path.join(out, `${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  shots.push({ label, url: page.url(), file });
  console.log("SHOT", label, page.url());
  return file;
}

async function login(page, email, password) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 }),
    page.click('button[type="submit"]'),
  ]);
}

/** Inspect stylesheets + computed styles for Emil checklist issues */
async function inspectMotion(page, screen) {
  const issues = await page.evaluate(() => {
    const out = [];
    const sheets = [...document.styleSheets];
    for (const sheet of sheets) {
      let rules;
      try {
        rules = [...(sheet.cssRules || [])];
      } catch {
        continue;
      }
      for (const rule of rules) {
        if (rule.type !== CSSRule.STYLE_RULE) continue;
        const t = rule.style.transition || "";
        const a = rule.style.animation || "";
        const transform = rule.style.transform || "";
        const ease = t + " " + a;
        if (/\ball\b/.test(t)) {
          out.push({ type: "transition-all", selector: rule.selectorText, value: t });
        }
        if (/ease-in(?!-out)/.test(ease)) {
          out.push({ type: "ease-in", selector: rule.selectorText, value: ease.trim() });
        }
        if (/scale\(\s*0\s*\)/.test(transform) || /scale\(\s*0\s*\)/.test(a)) {
          out.push({ type: "scale-0", selector: rule.selectorText, value: transform || a });
        }
        // durations in ms
        const durMatch = t.match(/(\d+(?:\.\d+)?)(ms|s)/g);
        if (durMatch) {
          for (const d of durMatch) {
            const n = parseFloat(d);
            const ms = d.endsWith("s") && !d.endsWith("ms") ? n * 1000 : n;
            if (ms > 300 && !/spin|shimmer|linear/.test(t + a)) {
              out.push({ type: "slow-duration", selector: rule.selectorText, value: t, ms });
            }
          }
        }
      }
    }

    // Interactive checks: buttons without active scale, hover without fine pointer gate
    const buttons = [...document.querySelectorAll("button, .btn, a.btn, [role='button']")];
    const btnReport = {
      total: buttons.length,
      withActive: 0,
      samples: [],
    };
    for (const b of buttons.slice(0, 12)) {
      const cs = getComputedStyle(b);
      const rect = b.getBoundingClientRect();
      btnReport.samples.push({
        text: (b.textContent || "").trim().slice(0, 40),
        tag: b.tagName,
        className: b.className?.toString?.().slice(0, 80) || "",
        minHeight: Math.round(rect.height),
        transition: cs.transition,
        cursor: cs.cursor,
      });
    }

    // Touch targets under 44px
    const smallTargets = [];
    const interactive = document.querySelectorAll(
      "a, button, input, select, textarea, [role='button'], .chip, .finding-row",
    );
    for (const el of interactive) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 44 || r.width < 44) {
        smallTargets.push({
          text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 50),
          className: el.className?.toString?.().slice(0, 60) || "",
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }

    // Layout overflow
    const overflow = document.documentElement.scrollWidth > window.innerWidth + 2;

    // Focus-visible presence (rough)
    let hasFocusVisible = false;
    for (const sheet of sheets) {
      try {
        for (const rule of sheet.cssRules || []) {
          if (rule.selectorText && rule.selectorText.includes(":focus-visible")) {
            hasFocusVisible = true;
          }
        }
      } catch {
        /* cross-origin */
      }
    }

    return {
      cssIssues: out,
      btnReport,
      smallTargets: smallTargets.slice(0, 20),
      overflow,
      hasFocusVisible,
      title: document.title,
      h1: document.querySelector("h1")?.textContent?.trim() || null,
      bodyTextLen: (document.body?.innerText || "").length,
    };
  });

  for (const i of issues.cssIssues) {
    note("code", screen, i.type, `${i.selector}: ${i.value}`);
  }
  if (issues.overflow) {
    note("visual", screen, "horizontal-overflow", "document scrollWidth > viewport");
  }
  if (!issues.hasFocusVisible) {
    note("a11y", screen, "no-focus-visible", "No :focus-visible rules found in stylesheets");
  }
  const small = issues.smallTargets.filter((t) => t.h < 40 && t.w < 120);
  if (small.length) {
    note(
      "touch",
      screen,
      "small-targets",
      small
        .slice(0, 6)
        .map((t) => `"${t.text}" ${t.w}x${t.h}`)
        .join("; "),
    );
  }
  return issues;
}

async function checkHoverMedia(page, screen) {
  const hasHoverGate = await page.evaluate(() => {
    const texts = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules || []) {
          if (rule.type === CSSRule.MEDIA_RULE) {
            texts.push(rule.conditionText || rule.media?.mediaText || "");
          }
        }
      } catch {
        /* */
      }
    }
    return texts.some((t) => t.includes("hover") && t.includes("pointer"));
  });
  if (!hasHoverGate) {
    note(
      "motion",
      screen,
      "hover-without-fine-pointer-gate",
      "No @media (hover: hover) and (pointer: fine) found — hover animations may fire on touch",
    );
  }
  return hasHoverGate;
}

async function pressProbe(page, screen) {
  // Click primary buttons and note if they have press feedback via class changes
  const primary = page.locator("button.btn-primary, button[type='submit']").first();
  if ((await primary.count()) === 0) return;
  const before = await primary.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { transform: cs.transform, transition: cs.transition };
  });
  await primary.dispatchEvent("pointerdown");
  await page.waitForTimeout(50);
  const during = await primary.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { transform: cs.transform };
  });
  await primary.dispatchEvent("pointerup");
  if (before.transform === during.transform && before.transform === "none") {
    // Check if :active would change — we can only check stylesheet
    const hasActiveScale = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules || []) {
            if (
              rule.selectorText &&
              /:active/.test(rule.selectorText) &&
              /scale|translate/.test(rule.cssText)
            ) {
              return true;
            }
          }
        } catch {
          /* */
        }
      }
      return false;
    });
    if (!hasActiveScale) {
      note(
        "feedback",
        screen,
        "no-press-scale",
        `Primary button may lack press scale (transform before=${before.transform})`,
      );
    }
  }
}

// ─── MOBILE PASS ───────────────────────────────────────────
{
  const ctx = await browser.newContext({
    ...devices["iPhone 13"],
    colorScheme: "light",
  });
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") note("console", "mobile", "console-error", msg.text().slice(0, 200));
  });
  page.on("pageerror", (err) => note("console", "mobile", "pageerror", err.message.slice(0, 200)));

  // Login
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await shot(page, "01-login-mobile");
  await inspectMotion(page, "login-mobile");
  await checkHoverMedia(page, "login-mobile");

  // Demo chip interaction if present
  const demoChip = page.locator("button, a, [role='button']").filter({ hasText: /demo|staff@|fill/i }).first();
  if ((await demoChip.count()) > 0) {
    await demoChip.click();
    await page.waitForTimeout(400);
    await shot(page, "01b-login-demo-filled-mobile");
  }

  // Staff flow
  await login(page, "staff@shiftproof.demo", "DemoStaff123!");
  await page.waitForTimeout(4500);
  await shot(page, "02-staff-home-mobile");
  await inspectMotion(page, "staff-home-mobile");
  await pressProbe(page, "staff-home-mobile");

  // Staff history
  const historyLink = page.locator('a[href="/staff/shifts"]');
  if ((await historyLink.count()) > 0) {
    await historyLink.click();
    await page.waitForTimeout(1500);
    await shot(page, "03-staff-history-mobile");
    await inspectMotion(page, "staff-history-mobile");

    // Open first shift if any
    const shiftLink = page.locator('a[href^="/staff/shifts/"]').first();
    if ((await shiftLink.count()) > 0) {
      await shiftLink.click();
      await page.waitForTimeout(2000);
      await shot(page, "04-staff-photos-mobile");
      await inspectMotion(page, "staff-photos-mobile");
    } else {
      note("nav", "staff-history-mobile", "no-shift-links", "Could not open shift photos");
    }
  }

  // Logout
  const logout = page.getByRole("button", { name: /log out/i });
  if ((await logout.count()) > 0) {
    await logout.click();
    await page.waitForTimeout(800);
  }

  // Manager flow
  await login(page, "manager@shiftproof.demo", "DemoManager123!");
  await page.waitForTimeout(5000);
  await shot(page, "05-manager-home-mobile");
  await inspectMotion(page, "manager-home-mobile");
  await pressProbe(page, "manager-home-mobile");

  const mShift = page.locator('a[href^="/manager/shifts/"]').first();
  if ((await mShift.count()) > 0) {
    await mShift.click();
    await page.waitForTimeout(2500);
    await shot(page, "06-manager-detail-mobile");
    await inspectMotion(page, "manager-detail-mobile");

    const finding = page.locator(".finding-row, [data-finding], button.finding").first();
    if ((await finding.count()) > 0) {
      await finding.click();
      await page.waitForTimeout(500);
      await shot(page, "07-manager-finding-selected-mobile");
    }

    // Export if link exists
    const exportLink = page.locator('a[href$="/export"], a:has-text("Export"), button:has-text("Export")').first();
    if ((await exportLink.count()) > 0) {
      await exportLink.click();
      await page.waitForTimeout(1500);
      await shot(page, "08-manager-export-mobile");
      await inspectMotion(page, "manager-export-mobile");
    }
  } else {
    note("nav", "manager-home-mobile", "no-shift-links", "No manager shift links found");
  }

  await ctx.close();
}

// ─── DESKTOP PASS ──────────────────────────────────────────
{
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: "light",
  });
  const page = await ctx.newPage();

  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await shot(page, "10-login-desktop");
  await inspectMotion(page, "login-desktop");

  await login(page, "manager@shiftproof.demo", "DemoManager123!");
  await page.waitForTimeout(5000);
  await shot(page, "11-manager-home-desktop");
  await inspectMotion(page, "manager-home-desktop");

  const mShift = page.locator('a[href^="/manager/shifts/"]').first();
  if ((await mShift.count()) > 0) {
    await mShift.click();
    await page.waitForTimeout(2500);
    await shot(page, "12-manager-detail-desktop");
    await inspectMotion(page, "manager-detail-desktop");

    // Sticky bar viewport shot (not full page)
    const sticky = page.locator(".manager-sticky, .sticky-actions, [class*='sticky']").first();
    if ((await sticky.count()) > 0) {
      await page.screenshot({
        path: path.join(out, "12b-manager-sticky-viewport.png"),
        fullPage: false,
      });
      shots.push({
        label: "12b-manager-sticky-viewport",
        url: page.url(),
        file: path.join(out, "12b-manager-sticky-viewport.png"),
      });
    }
  }

  await page.getByRole("button", { name: /log out/i }).click();
  await page.waitForTimeout(600);

  await login(page, "staff@shiftproof.demo", "DemoStaff123!");
  await page.waitForTimeout(4000);
  await shot(page, "13-staff-home-desktop");
  await inspectMotion(page, "staff-home-desktop");

  const hist = page.locator('a[href="/staff/shifts"]');
  if ((await hist.count()) > 0) {
    await hist.click();
    await page.waitForTimeout(1500);
    await shot(page, "14-staff-history-desktop");
  }

  await ctx.close();
}

// ─── REDUCED MOTION PASS ───────────────────────────────────
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await shot(page, "20-login-reduced-motion");
  const animDisabled = await page.evaluate(() => {
    const el = document.querySelector(".login-brand, .brand-photo, main, body");
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { animation: cs.animation, transition: cs.transitionDuration };
  });
  findings.push({
    severity: "info",
    screen: "reduced-motion",
    issue: "prefers-reduced-motion-check",
    detail: JSON.stringify(animDisabled),
  });
  await ctx.close();
}

await browser.close();

const report = {
  base,
  at: new Date().toISOString(),
  shotCount: shots.length,
  findingCount: findings.length,
  findings,
  shots,
};
await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
console.log("\n=== SUMMARY ===");
console.log("shots:", shots.length, "→", out);
console.log("findings:", findings.length);
const bySev = {};
for (const f of findings) bySev[f.severity] = (bySev[f.severity] || 0) + 1;
console.log("by severity:", bySev);
