import assert from "node:assert/strict";

import { test } from "vitest";

import {
  compactPermissionLabel,
  shortPermissionLabel,
} from "./permission-label";

test("summaries abbreviate permission modes to a word", () => {
  assert.equal(compactPermissionLabel("Read only"), "Read");

  assert.equal(
    compactPermissionLabel(shortPermissionLabel("Default — ask for approval")),
    "Ask",
  );

  assert.equal(compactPermissionLabel("Plan"), "Plan");
});
