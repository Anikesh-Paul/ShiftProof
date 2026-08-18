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
          photo_indexes: [1],
        },
      ],
    },
    LIVE_THREE,
    3,
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
          photo_indexes: [1],
        },
      ],
    },
    LIVE_THREE,
    3,
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

function scoredRow(overrides = {}, photoCount = 3) {
  const [row] = normalizeFindings(
    {
      items: [
        {
          id: "gloves_worn",
          status: "gap",
          clause_id: "FS-01",
          quote: "Wear clean disposable gloves at the food-prep station.",
          confidence: 0.9,
          evidence_note: "Bare hands at prep.",
          photo_indexes: [1],
          ...overrides,
        },
      ],
    },
    LIVE_THREE,
    photoCount,
  );
  return row;
}

test("Confidence is the minimum of present rubric factors", () => {
  const gloves = scoredRow({ subject: 0.9, visibility: 0.6 });
  assert.equal(gloves.confidence, 0.6);
  assert.equal(gloves.status, "gap");
});

test("no rubric factors uses the raw confidence, then gates still apply", () => {
  const gloves = scoredRow({
    status: "gap",
    confidence: 0.72,
    subject: undefined,
    visibility: undefined,
  });
  assert.equal(gloves.confidence, 0.72);
  assert.equal(gloves.status, "gap");
});

test("lighting and coverage join the min when the model sent them", () => {
  const gloves = scoredRow({
    subject: 0.9,
    visibility: 0.9,
    lighting: 0.4,
  });
  assert.equal(gloves.confidence, 0.4);
  assert.equal(gloves.status, "unclear");
});

test("proposed Pass below High becomes Unclear and keeps Confidence", () => {
  const gloves = scoredRow({
    status: "pass",
    confidence: 0.72,
    evidence_note: "Gloves visible at the prep line.",
  });
  assert.equal(gloves.status, "unclear");
  assert.equal(gloves.confidence, 0.72);
});

test("proposed Pass at High with a valid cite still publishes Pass", () => {
  const high = scoredRow({
    status: "pass",
    confidence: 0.84,
    evidence_note: "Handlers wearing gloves at the prep station.",
    photo_indexes: [1],
  });
  assert.equal(high.status, "pass");
  assert.equal(high.confidence, 0.84);

  const atBar = scoredRow({
    status: "pass",
    confidence: 0.8,
    evidence_note: "Handlers wearing gloves at the prep station.",
    photo_indexes: [1],
  });
  assert.equal(atBar.status, "pass");
  assert.equal(atBar.confidence, 0.8);
});

test("proposed Gap at Medium still publishes Gap", () => {
  const gloves = scoredRow({ status: "gap", confidence: 0.72 });
  assert.equal(gloves.status, "gap");
  assert.equal(gloves.confidence, 0.72);
});

test("proposed Gap below Low becomes Unclear", () => {
  const gloves = scoredRow({ status: "gap", confidence: 0.4 });
  assert.equal(gloves.status, "unclear");
  assert.equal(gloves.confidence, 0.4);
});

test("no valid photo cite caps Confidence at 0.50 and forces Unclear", () => {
  const outOfRange = scoredRow(
    {
      status: "pass",
      confidence: 0.92,
      evidence_note: "Handlers wearing gloves at the prep station.",
      photo_indexes: [9],
    },
    3,
  );
  assert.ok(outOfRange.confidence <= 0.5);
  assert.equal(outOfRange.status, "unclear");

  const missing = scoredRow({
    status: "gap",
    confidence: 0.84,
    photo_indexes: undefined,
  });
  assert.ok(missing.confidence <= 0.5);
  assert.equal(missing.status, "unclear");
});

test("an unreadable-frame note caps Confidence at 0.45 and forces Unclear", () => {
  const gloves = scoredRow({
    status: "gap",
    confidence: 0.84,
    evidence_note: "Heavy glare; cannot confirm glove use at prep.",
    photo_indexes: [1],
  });
  assert.ok(gloves.confidence <= 0.45);
  assert.equal(gloves.status, "unclear");
});

test("a readable note that only mentions darker finish is not note-capped", () => {
  const gloves = scoredRow({
    status: "gap",
    confidence: 0.84,
    evidence_note: "Darker wood cabinets in the back; bare hands at prep.",
    photo_indexes: [1],
  });
  assert.equal(gloves.confidence, 0.84);
  assert.equal(gloves.status, "gap");
});

test("emergency stub rows without cites cannot publish Pass", () => {
  const gloves = scoredRow({
    status: "pass",
    confidence: 0.88,
    evidence_note: "Photo set (4) consistent with Gloves at the prep line.",
    photo_indexes: undefined,
  });
  assert.equal(gloves.status, "unclear");
  assert.ok(gloves.confidence <= 0.5);
});

test("omitted item remains Unclear at 0.30", () => {
  const scored = normalizeFindings({ items: [] }, LIVE_THREE, 3);
  assert.equal(scored.length, 3);
  for (const row of scored) {
    assert.equal(row.status, "unclear");
    assert.equal(row.confidence, 0.3);
  }
});

test("invalid rubric factors are ignored or clamped inside [0, 1]", () => {
  const ignored = scoredRow({
    status: "gap",
    confidence: 0.7,
    subject: "nope",
    visibility: Number.POSITIVE_INFINITY,
    lighting: null,
  });
  assert.equal(ignored.confidence, 0.7);
  assert.equal(ignored.status, "gap");

  const clamped = scoredRow({
    status: "gap",
    subject: 1.4,
    visibility: -0.2,
  });
  assert.equal(clamped.confidence, 0);
  assert.ok(clamped.confidence >= 0 && clamped.confidence <= 1);
});

test("rubric factors and photo indexes are not stored on the Finding", () => {
  const gloves = scoredRow({
    status: "gap",
    subject: 0.9,
    visibility: 0.6,
    lighting: 0.8,
    coverage: 0.7,
    photo_indexes: [1, 2],
  });
  assert.equal(gloves.subject, undefined);
  assert.equal(gloves.visibility, undefined);
  assert.equal(gloves.lighting, undefined);
  assert.equal(gloves.coverage, undefined);
  assert.equal(gloves.photo_indexes, undefined);
  assert.deepEqual(Object.keys(gloves).sort(), [
    "clause_id",
    "confidence",
    "evidence_note",
    "id",
    "quote",
    "status",
  ]);
});
