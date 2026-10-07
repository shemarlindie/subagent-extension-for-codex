import assert from "node:assert/strict";

import { test } from "vitest";

import { codexExecutionPresentation } from "./codex/input-presentation.js";
import { inputPresentation } from "./input-presentation.js";

test("permission presentation accepts provider-owned disclosures and has a generic default", () => {
  const nativeRequest = {
    id: "request",
    tool: "CodexExecution",
    kind: "permission" as const,
    input: {},
    presentation: codexExecutionPresentation,
  };

  assert.deepEqual(
    inputPresentation(nativeRequest),
    codexExecutionPresentation,
  );

  const custom = {
    description: "Approve one operation",
    approveLabel: "Allow operation",
    formTitle: "Operation permission",
  };

  assert.equal(
    inputPresentation({ ...nativeRequest, presentation: custom }),
    custom,
  );

  assert.equal(
    inputPresentation({ ...nativeRequest, presentation: undefined })
      .approveLabel,
    "Approve this request once",
  );
});
