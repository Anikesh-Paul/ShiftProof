import assert from "node:assert/strict";
import { test } from "node:test";
import { inboxCopy } from "../src/lib/managerDemo.ts";

const todayGaps = {
  loading: false,
  itemFilter: null,
  itemKnown: true,
  view: "today" as const,
  listedCount: 8,
  todayGaps: 46,
  todayUnclear: 2,
  checksInProgress: true,
  jobsWaiting: true,
  backlogEmpty: false,
  backlogGaps: 4,
  backlogUnclear: 1,
};

test("Today still names today’s gaps, not the painted row count", () => {
  const copy = inboxCopy(todayGaps);
  assert.equal(copy.headline, "46 gaps need a look");
  assert.equal(
    copy.lede,
    "Today’s open gaps first. Older checks sit in Backlog.",
  );
});

test("All is the ledger, not today’s gap count", () => {
  const copy = inboxCopy({ ...todayGaps, view: "all", listedCount: 50 });
  assert.equal(copy.headline, "50 openings on file");
  assert.equal(copy.lede, "Every opening on file. Today stays on Today.");
  assert.doesNotMatch(copy.headline, /gap/i);
  assert.doesNotMatch(copy.lede, /Today’s open gaps first/);
});

test("All empty is a ledger empty, not All clear today", () => {
  const copy = inboxCopy({
    ...todayGaps,
    view: "all",
    listedCount: 0,
    todayGaps: 0,
    todayUnclear: 0,
    checksInProgress: false,
    jobsWaiting: false,
  });
  assert.equal(copy.headline, "No openings on file");
  assert.equal(
    copy.lede,
    "When staff submit an opening check, it lands here.",
  );
});

test("All singular uses opening, not openings", () => {
  const copy = inboxCopy({ ...todayGaps, view: "all", listedCount: 1 });
  assert.equal(copy.headline, "1 opening on file");
});

test("Gloves chip names the painted list, not the 5/5 glance", () => {
  const copy = inboxCopy({
    ...todayGaps,
    itemFilter: "gloves_worn",
    listedCount: 42,
  });
  assert.equal(copy.headline, "Gloves at prep");
  assert.equal(copy.lede, "42 openings mention this item.");
  assert.doesNotMatch(copy.lede, /Failed on/);
});

test("one matching opening uses mention, not mention plural", () => {
  const copy = inboxCopy({
    ...todayGaps,
    itemFilter: "gloves_worn",
    listedCount: 1,
  });
  assert.equal(copy.lede, "1 opening mentions this item.");
});

test("unknown item copy is locked", () => {
  const copy = inboxCopy({
    ...todayGaps,
    itemFilter: "none",
    itemKnown: false,
    listedCount: 0,
  });
  assert.equal(copy.headline, "No matching item");
  assert.equal(copy.lede, "This item is not on the opening check.");
});

test("Backlog empty copy is locked", () => {
  const copy = inboxCopy({
    ...todayGaps,
    view: "backlog",
    listedCount: 0,
    backlogEmpty: true,
    backlogGaps: 0,
    backlogUnclear: 0,
  });
  assert.equal(copy.headline, "Backlog is empty");
  assert.equal(copy.lede, "Older openings with open gaps land here.");
});

test("Backlog with older gaps is locked", () => {
  const copy = inboxCopy({
    ...todayGaps,
    view: "backlog",
    listedCount: 3,
    backlogEmpty: false,
    backlogGaps: 4,
    backlogUnclear: 1,
  });
  assert.equal(copy.headline, "4 older gaps need a look");
  assert.equal(copy.lede, "Older openings. Today stays on Today.");
});
