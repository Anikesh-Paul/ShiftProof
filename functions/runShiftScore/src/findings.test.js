const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeFindings, photoIdsForScore } = require("./findings");

const LIVE_THREE = [
  {
    id: "gloves_worn",
    label: "Gloves at the prep line",
    relatedClauseIds: ["FS-01"],
    quote: "Wear clean disposable gloves at the food-prep station.",
  },
  {
    id: "handwash_station",
    label: "Stocked handwash station",
    relatedClauseIds: ["FS-02"],
    quote: "Handwash must be stocked before service.",
  },
  {
    id: "floor_clear",
    label: "Floor clear of slip hazards",
    relatedClauseIds: ["FS-07"],
    quote: "Service floor should be clear of slip hazards at open.",
  },
];

test("omitted quote uses the live item quote, not a leftover café sentence", () => {
  const scored = normalizeFindings(
    {
      items: [
        {
          id: "gloves_worn",
          status: "gap",
          clause_id: "FS-01",
          quote: "",
          confidence: 0.84,
          evidence_note: "Bare hands at prep.",
        },
      ],
    },
    LIVE_THREE,
  );
  const gloves = scored.find((row) => row.id === "gloves_worn");
  assert.equal(
    gloves.quote,
    "Wear clean disposable gloves at the food-prep station.",
  );
  assert.doesNotMatch(
    gloves.quote,
    /Food handlers must wear clean disposable gloves/,
  );
});

test("a Finding cites only its item’s live Clause, not a wandered id", () => {
  const scored = normalizeFindings(
    {
      items: [
        {
          id: "gloves_worn",
          status: "gap",
          clause_id: "FS-07",
          quote: "Service floor should be clear of slip hazards at open.",
          confidence: 0.84,
          evidence_note: "Model wandered to the floor rule.",
        },
      ],
    },
    LIVE_THREE,
  );
  const gloves = scored.find((row) => row.id === "gloves_worn");
  assert.equal(gloves.clause_id, "FS-01");
  assert.equal(
    gloves.quote,
    "Wear clean disposable gloves at the food-prep station.",
  );
});

test("a three-item live set scores three Findings", () => {
  const scored = normalizeFindings({ items: [] }, LIVE_THREE);
  assert.equal(scored.length, 3);
  assert.deepEqual(
    scored.map((row) => row.clause_id),
    ["FS-01", "FS-02", "FS-07"],
  );
  assert.equal(
    scored[0].quote,
    "Wear clean disposable gloves at the food-prep station.",
  );
});

test("missing live quote falls back to a generic Clause line", () => {
  const scored = normalizeFindings(
    { items: [] },
    [
      {
        id: "allergen_board",
        label: "Allergen board posted",
        relatedClauseIds: ["FS-09"],
      },
    ],
  );
  assert.equal(scored[0].quote, "Clause FS-09 must be met.");
});

test("every uploaded photo up to eight is included in the score", () => {
  const eight = ["a", "b", "c", "d", "e", "f", "g", "h"];
  assert.deepEqual(photoIdsForScore(eight), eight);
  assert.deepEqual(photoIdsForScore([...eight, "i"]), eight);
});
