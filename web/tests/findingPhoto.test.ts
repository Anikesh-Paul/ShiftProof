import assert from "node:assert/strict";
import { test } from "node:test";
import {
  photoIdFromNote,
  photoIndexFromNote,
} from "../src/lib/findingPhoto.ts";

test("Photo N at the start of a gap note is 1-based", () => {
  assert.equal(
    photoIndexFromNote(
      "Photo 1 shows an overflowing waste bin with a discarded glove on top.",
    ),
    1,
  );
  assert.equal(
    photoIndexFromNote(
      "Photo 3 shows an empty hand sanitizer bottle lying on its side.",
    ),
    3,
  );
});

test("lowercase photo N in the middle of a note still maps", () => {
  assert.equal(
    photoIndexFromNote("Glare on photo 2 hides the thermometer."),
    2,
  );
});

test("notes that do not name a photo stay unmapped", () => {
  assert.equal(
    photoIndexFromNote("Bare hands visible; no gloves in frame."),
    null,
  );
  assert.equal(photoIndexFromNote(""), null);
  assert.equal(photoIndexFromNote(undefined), null);
  assert.equal(
    photoIndexFromNote("No food handlers are present in any photos."),
    null,
  );
});

test("Photo 0 and a cite past the pool are not a mapping", () => {
  assert.equal(photoIndexFromNote("Photo 0 is blank."), null);
  const ids = ["p1", "p2", "p3"];
  assert.equal(photoIdFromNote("Photo 4 is out of frame.", ids), null);
});

test("Photo N picks that file from the compact pool", () => {
  const ids = ["p1", "p2", "p3"];
  assert.equal(photoIdFromNote("Photo 1 shows gloves.", ids), "p1");
  assert.equal(photoIdFromNote("Photo 3 shows the sink.", ids), "p3");
});

test("the first Photo N cite wins when several appear", () => {
  assert.equal(
    photoIndexFromNote("Photo 1 is dark; Photo 3 is the sink."),
    1,
  );
});

test("plural Photos N still maps to that index", () => {
  assert.equal(
    photoIndexFromNote(
      "Photos 1 and 3 show food prep surfaces and counters with unwashed dishes.",
    ),
    1,
  );
});
