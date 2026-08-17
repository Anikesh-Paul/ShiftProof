import type { Page, Request } from "@playwright/test";
import {
  applyAiRecheck,
  type RecheckScoreStatus,
} from "./agentJobs";

function isFunctionExecution(url: URL): boolean {
  return /\/functions\/[^/]+\/executions\/?$/.test(url.pathname);
}

function parseExecutionBody(request: Request): {
  action?: string;
  taskId?: string;
} {
  const raw = request.postData() || "";
  try {
    const json = JSON.parse(raw) as {
      action?: string;
      taskId?: string;
      body?: string | { action?: string; taskId?: string };
    };
    if (typeof json.body === "string") {
      try {
        return JSON.parse(json.body) as { action?: string; taskId?: string };
      } catch {
        return {};
      }
    }
    if (json.body && typeof json.body === "object") return json.body;
    return json;
  } catch {
    return {};
  }
}

/**
 * Intercept runShiftScore { action: "recheck" } as a successful one-item score.
 * Writes the Finding the Function would have written, then returns ok.
 */
export async function stubRecheckFunction(
  page: Page,
  opts: {
    status?: RecheckScoreStatus;
    evidenceNote?: string;
    confidence?: number;
    delayMs?: number;
  } = {},
): Promise<void> {
  const status = opts.status ?? "pass";
  await page.route(
    (url) => isFunctionExecution(new URL(url)),
    async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const payload = parseExecutionBody(route.request());
      if (payload.action !== "recheck" || !payload.taskId) {
        await route.continue();
        return;
      }
      await applyAiRecheck(payload.taskId, {
        status,
        evidenceNote: opts.evidenceNote,
        confidence: opts.confidence,
      });
      const waitMs = opts.delayMs ?? 400;
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      const now = new Date().toISOString();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          $id: `exec_recheck_${payload.taskId}`,
          $createdAt: now,
          $updatedAt: now,
          $permissions: [],
          functionId: "runShiftScore",
          trigger: "http",
          status: "completed",
          statusCode: 200,
          responseStatusCode: 200,
          responseBody: JSON.stringify({ ok: true, status }),
          logs: "",
          errors: "",
          duration: 0.2,
        }),
      });
    },
  );
}

/** Intercept runShiftScore { action: "recheck" } as a successful one-item Pass. */
export async function stubRecheckFunctionPass(
  page: Page,
  opts: { evidenceNote?: string; confidence?: number; delayMs?: number } = {},
): Promise<void> {
  await stubRecheckFunction(page, { ...opts, status: "pass" });
}
