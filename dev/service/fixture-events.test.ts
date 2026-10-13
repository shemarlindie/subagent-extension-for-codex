import assert from "node:assert/strict";

import { test } from "vitest";

import {
  fixtureActivityPayload,
  fixtureSdkActivityTypes,
  fixtureSdkAssistantErrorTypes,
  fixtureSdkSystemActivityTypes,
  fixtureStreamPayload,
} from "./fixture-events.js";
import { fixtureStreamFrameTypes, readScenarios } from "./fixture-scenarios.js";

test("fixture payloads cover every installed SDK message activity family", () => {
  const systemTypes: ReadonlySet<string> = new Set(
    fixtureSdkSystemActivityTypes,
  );

  for (const type of fixtureSdkActivityTypes) {
    const data = fixtureActivityPayload(type, {}, "task_fixture", 2);
    const raw = data.raw_response;

    assert.equal(data.type, type);
    assert.equal(data.activity.kind, type);
    assert.equal(raw.type, systemTypes.has(type) ? "system" : type);
    assert.equal(raw.session_id, "fixture_task_fixture");
    assert.equal(raw.uuid, `fixture_activity_task_fixture_2_${type}`);
    if (systemTypes.has(type)) assert.equal(raw.subtype, type);
  }
});

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

test("fixture assistant messages cover every installed SDK error code", () => {
  for (const error of fixtureSdkAssistantErrorTypes) {
    const data = fixtureActivityPayload(
      "assistant",
      { error, message: { content: [] } },
      "task_fixture",
      1,
    );

    assert.equal(data.error, error);
    assert.equal(data.activity.failed, true);
    assert.deepEqual(data.message, { content: [] });
  }
});

test("fixture stream frames cover each Messages API streaming lifecycle event", () => {
  for (const frame of fixtureStreamFrameTypes) {
    const data = fixtureStreamPayload(frame, {}, "task_fixture", 3);
    const raw = data.raw_response;
    const event = raw.event as Record<string, unknown>;

    assert.equal(event.type, frame);
    assert.equal(data.activity.kind, "stream_event");
    assert.equal(raw.session_id, "fixture_task_fixture");
    assert.equal(raw.uuid, "fixture_stream_event_task_fixture_3");
  }
});

test("fixture prompt keys parse provider, stream, and failure scenarios", () => {
  const scenarios = readScenarios(
    [
      "[fixture:question count=2]",
      "[fixture:permission tool=Edit]",
      "[fixture:tool-error name=Read count=2]",
      "[fixture:activity type=rate_limit_event rate_limit_info.status=rejected]",
      "[fixture:stream frame=content_block_delta delta=thinking text=Fixture%20thought]",
      "[fixture:fail stage=after-tools]",
      "[fixture:completion subtype=error_max_budget_usd]",
    ].join(" "),
  );

  assert.equal(scenarios.questionCount, 2);
  assert.deepEqual(scenarios.permissionTools, ["Edit"]);
  assert.deepEqual(scenarios.toolErrorNames, ["Read", "Read"]);

  assert.deepEqual(scenarios.activities, [
    {
      type: "rate_limit_event",
      fields: { "rate_limit_info.status": "rejected" },
    },
  ]);

  assert.deepEqual(scenarios.streams, [
    {
      frame: "content_block_delta",
      fields: { delta: "thinking", text: "Fixture thought" },
    },
  ]);

  assert.equal(scenarios.failStage, "after-tools");
  assert.equal(scenarios.completionSubtype, "error_max_budget_usd");
});

test("fixture prompt keys expose every bounded provider scenario", () => {
  const scenarios = readScenarios(
    [
      "[fixture:permission count=9]",
      "[fixture:assistant-error type=overloaded]",
      "[fixture:tool name=Read count=2]",
      "[fixture:tool-error name=Bash count=2]",
      "[fixture:subagent count=9 outcome=error]",
      "[fixture:content type=tool_use role=user outcome=running name=Read]",
      "[fixture:thinking]",
      "[fixture:change]",
      "[fixture:restriction name=subagents]",
      "[fixture:stream]",
      "[fixture:slow]",
      "[fixture:late]",
      "[fixture:session state=invalid]",
      "[fixture:wait ms=90000]",
      "[fixture:cost usd=1000001]",
      "[fixture:fail stage=after-input]",
      "[fixture:completion subtype=success outcome=error]",
    ].join(" "),
  );

  assert.equal(scenarios.permissionTools.length, 5);
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
  assert.equal(scenarios.streamLifecycle, true);
  assert.equal(scenarios.slow, true);
  assert.equal(scenarios.late, true);
  assert.equal(scenarios.invalidateSession, true);
  assert.equal(scenarios.waitMs, 60_000);
  assert.equal(scenarios.costUsd, 1_000_000);
  assert.equal(scenarios.failStage, "after-input");
  assert.equal(scenarios.completionSubtype, "success");
  assert.equal(scenarios.completionIsError, true);
});
