import assert from "node:assert/strict";

import { test } from "vitest";

import { fixtureActivityPayload } from "./fixture-events.js";
import { readScenarios } from "./fixture-scenarios.js";

test("fixture activity payloads keep nested overrides and unknown SDK events", () => {
  const known = fixtureActivityPayload(
    "rate_limit_event",
    { "rate_limit_info.status": "rejected", "rate_limit_info.utilization": 1 },
    "task_fixture",
    1,
  );

  assert.deepEqual(known.rate_limit_info, {
    status: "rejected",
    utilization: 1,
  });

  assert.equal(known.activity.failed, false);

  const unknown = fixtureActivityPayload("future_sdk_event", {}, "task", 1);
  assert.equal(unknown.activity.kind, "future_sdk_event");

  assert.equal(unknown.raw_response.type, "future_sdk_event");
});

test("fixture prompt keys parse every bounded provider, stream, and failure scenario", () => {
  const scenarios = readScenarios(
    [
      "[fixture:question count=2]",
      "[fixture:permission tool=Edit count=9]",
      "[fixture:assistant-error type=overloaded]",
      "[fixture:tool name=Read count=2]",
      "[fixture:tool-error name=Bash count=2]",
      "[fixture:subagent count=9 outcome=error]",
      "[fixture:content type=tool_use role=user outcome=running name=Read]",
      "[fixture:thinking]",
      "[fixture:change]",
      "[fixture:restriction name=subagents]",
      "[fixture:activity type=rate_limit_event rate_limit_info.status=rejected]",
      "[fixture:stream]",
      "[fixture:stream frame=content_block_delta delta=thinking text=Fixture%20thought]",
      "[fixture:slow]",
      "[fixture:late]",
      "[fixture:session state=invalid]",
      "[fixture:wait ms=90000]",
      "[fixture:cost usd=1000001]",
      "[fixture:fail stage=after-tools]",
      "[fixture:completion subtype=success outcome=error]",
    ].join(" "),
  );

  assert.equal(scenarios.questionCount, 2);
  assert.deepEqual(scenarios.permissionTools, Array(5).fill("Edit"));
  assert.deepEqual(scenarios.assistantErrors, ["overloaded"]);
  assert.deepEqual(scenarios.toolNames, ["Read", "Read"]);
  assert.deepEqual(scenarios.toolErrorNames, ["Bash", "Bash"]);
  assert.equal(scenarios.subagentCount, 4);
  assert.equal(scenarios.subagentOutcome, "error");

  assert.deepEqual(scenarios.content, [
    { role: "user", kind: "tool_use", outcome: "running", name: "Read" },
  ]);

  assert.equal(scenarios.thinking, true);
  assert.equal(scenarios.change, true);
  assert.deepEqual(scenarios.restrictions, ["subagents"]);

  assert.deepEqual(scenarios.activities, [
    {
      type: "rate_limit_event",
      fields: { "rate_limit_info.status": "rejected" },
    },
  ]);

  assert.equal(scenarios.streamLifecycle, true);

  assert.deepEqual(scenarios.streams, [
    {
      frame: "content_block_delta",
      fields: { delta: "thinking", text: "Fixture thought" },
    },
  ]);

  assert.equal(scenarios.slow, true);
  assert.equal(scenarios.late, true);
  assert.equal(scenarios.invalidateSession, true);
  assert.equal(scenarios.waitMs, 60_000);
  assert.equal(scenarios.costUsd, 1_000_000);
  assert.equal(scenarios.failStage, "after-tools");
  assert.equal(scenarios.completionSubtype, "success");
  assert.equal(scenarios.completionIsError, true);
});
