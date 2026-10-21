import assert from "node:assert/strict";

import { test } from "vitest";

import { contentText } from "./content-text.js";

test("contentText joins text blocks and skips other blocks", () => {
  assert.equal(
    contentText([
      { type: "text", text: "first" },
      { type: "image", source: {} },
      { type: "text", text: "" },
      "stray",
      null,
      { type: "text", text: "second" },
    ]),
    "first\nsecond",
  );
});

test("contentText ignores non-text content", () => {
  assert.equal(contentText(undefined), undefined);
  assert.equal(contentText({ type: "text", text: "x" }), undefined);
});
