import assert from "node:assert/strict";
import { test } from "node:test";
import {
  forgetFindings,
  peekFindings,
  rememberFindings,
  resetRowCaches,
  upsertCachedFinding,
} from "../src/lib/rowCache.ts";
import type { Finding } from "../src/types/shiftproof.ts";

function finding(id: string, shiftId = "s1"): Finding {
  return {
    $id: id,
    $createdAt: "t",
    $updatedAt: "t",
    shiftId,
    itemId: id,
    status: "gap",
    clauseId: "FS-01",
    quote: "q",
    confidence: 0.8,
    evidenceNote: "n",
    source: "ai",
  };
}

test("upsert does not seed a cache from a single row", () => {
  resetRowCaches();
  upsertCachedFinding(finding("f1"));
  assert.equal(peekFindings("s1"), undefined);
});

test("upsert patches an existing cache", () => {
  resetRowCaches();
  rememberFindings("s1", [finding("f1")]);
  upsertCachedFinding({ ...finding("f1"), status: "pass" });
  assert.equal(peekFindings("s1")?.[0]?.status, "pass");
  forgetFindings("s1");
  assert.equal(peekFindings("s1"), undefined);
});
