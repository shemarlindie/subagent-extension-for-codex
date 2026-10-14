import assert from "node:assert/strict";

import { test } from "vitest";

import { compactReasoningLabel } from "./setting-labels";

test("summaries abbreviate reasoning levels, resolving the default", () => {
  assert.equal(compactReasoningLabel("high"), "H");
  assert.equal(compactReasoningLabel("xhigh"), "H+");
  assert.equal(compactReasoningLabel("default", "medium"), "M");
  assert.equal(compactReasoningLabel("default"), undefined);
});
