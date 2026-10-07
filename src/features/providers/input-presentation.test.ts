import assert from "node:assert/strict";

import { test } from "vitest";

import { inputPresentation } from "./input-presentation.js";

test("permission presentation accepts provider-owned disclosures and has a generic default", () => {
  const presentation = {
    description: "Approve one operation",
    approveLabel: "Allow operation",
    formTitle: "Operation permission",
  };

  const nativeRequest = {
    id: "request",
    tool: "Operation",
    kind: "permission" as const,
    input: {},
    presentation,
  };

  assert.equal(inputPresentation(nativeRequest), presentation);

  assert.equal(
    inputPresentation({ ...nativeRequest, presentation: undefined })
      .approveLabel,
    "Approve this request once",
  );
});
