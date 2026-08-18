import assert from "node:assert/strict";
import { test } from "node:test";
import { citationForFinding } from "../src/lib/managerDemo.ts";
import type { ChecklistItem } from "../src/types/shiftproof.ts";

const items: ChecklistItem[] = [
  {
    id: "gloves_worn",
    label: "Gloves at prep",
    requiredPhoto: true,
    relatedClauseIds: ["FS-01"],
    quote: "Food handlers must wear clean disposable gloves at the prep station.",
  },
  {
    id: "handwash_station",
    label: "Handwash station",
    requiredPhoto: true,
    relatedClauseIds: ["FS-02"],
    quote: "Handwash sink must be clear, stocked, and accessible before service.",
  },
  {
    id: "fridge_temp",
    label: "Fridge temperature",
    requiredPhoto: true,
    relatedClauseIds: ["FS-05"],
    quote: "Cold storage must show temperature within safe range at open.",
  },
  {
    id: "counter_clean",
    label: "Prep counter clean",
    requiredPhoto: true,
    relatedClauseIds: ["FS-04"],
    quote: "Food-prep surfaces must be clean and free of debris before service.",
  },
];

test("stored clause that belongs to the item is kept", () => {
  const cite = citationForFinding(
    {
      itemId: "gloves_worn",
      clauseId: "FS-01",
      quote: "Food handlers must wear clean disposable gloves at the prep station.",
    },
    items,
  );
  assert.equal(cite.gap, false);
  assert.equal(cite.clauseId, "FS-01");
  assert.match(cite.quote, /disposable gloves/);
});

test("FS-01 on Fridge is not inherited — item clause wins", () => {
  const cite = citationForFinding(
    {
      itemId: "fridge_temp",
      clauseId: "FS-01",
      quote: "Food handlers must wear clean disposable gloves at the prep station.",
    },
    items,
  );
  assert.equal(cite.gap, false);
  assert.equal(cite.clauseId, "FS-05");
  assert.match(cite.quote, /Cold storage/);
  assert.doesNotMatch(cite.quote, /gloves/i);
});

test("FS-01 on Handwash and Prep uses each item's own clause", () => {
  const handwash = citationForFinding(
    {
      itemId: "handwash_station",
      clauseId: "FS-01",
      quote: "Food handlers must wear clean disposable gloves at the prep station.",
    },
    items,
  );
  const prep = citationForFinding(
    {
      itemId: "counter_clean",
      clauseId: "FS-01",
      quote: "Food handlers must wear clean disposable gloves at the prep station.",
    },
    items,
  );
  assert.equal(handwash.clauseId, "FS-02");
  assert.match(handwash.quote, /Handwash/);
  assert.equal(prep.clauseId, "FS-04");
  assert.match(prep.quote, /Food-prep surfaces/);
});

test("missing stored clause uses the item's own clause", () => {
  const cite = citationForFinding({ itemId: "fridge_temp" }, items);
  assert.equal(cite.gap, false);
  assert.equal(cite.clauseId, "FS-05");
  assert.match(cite.quote, /Cold storage/);
});

test("unknown item with no clause is a citation gap — not FS-01", () => {
  const cite = citationForFinding({ itemId: "mystery_item" }, items);
  assert.equal(cite.gap, true);
  assert.equal(cite.clauseId, "");
  assert.equal(cite.quote, "");
});

test("inherited clause with no item clause is a citation gap", () => {
  const cite = citationForFinding(
    {
      itemId: "orphan_item",
      clauseId: "FS-01",
      quote: "Food handlers must wear clean disposable gloves at the prep station.",
    },
    items,
  );
  assert.equal(cite.gap, true);
  assert.equal(cite.clauseId, "");
  assert.equal(cite.quote, "");
});
