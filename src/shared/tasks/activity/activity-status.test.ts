import assert from "node:assert/strict";

import { test } from "vitest";

import { currentActivityStatus } from "./activity-status.js";
import { event, sdk, task } from "./activity-timeline-test-harness.js";

test("thinking updates preserve an input request while a tool is still running", () => {
  const events = [
    event(1, "tool.started", { id: "read", name: "Read" }),
    event(2, "agent.input_required", {
      request: { id: "request", tool: "Read", kind: "permission", input: {} },
    }),
    event(3, "agent.thinking_tokens", { tokens: 10 }),
  ];

  assert.deepEqual(currentActivityStatus(events), {
    text: "Needs input · Read",
    state: "info",
  });
});

for (const status of [
  "completed",
  "failed",
  "interrupted",
  "waiting",
  "queued",
] as const) {
  test(`host task ${status} overrides stale running tool activity`, () => {
    const current = currentActivityStatus(
      [event(1, "tool.started", { id: "read", name: "Read" })],
      task(status),
    );

    assert.ok(!current.text.includes("Read"));
    if (status !== "queued") assert.notEqual(current.state, "running");
    else assert.equal(current.text, "Queued");
    if (status === "completed") assert.equal(current.state, "completed");
    if (status === "failed") assert.equal(current.state, "failed");
  });
}

test("current status follows the most recently updated interleaved operation", () => {
  const current = currentActivityStatus([
    event(1, "tool.started", { id: "a", name: "Read" }),
    event(2, "tool.started", { id: "b", name: "Bash" }),
    event(3, "claude.activity", {
      type: "tool_progress",
      tool_use_id: "a",
      tool_name: "Read",
      elapsed_time_seconds: 2,
    }),
  ]);

  assert.equal(current.state, "running");
  assert.match(current.text, /Running Read/);
});

for (const terminal of ["agent.completed", "task.interrupted"]) {
  test(`continuation clears stale ${terminal} current status`, () => {
    const current = currentActivityStatus([
      event(1, "tool.started", { id: "old", name: "Read" }),
      event(2, terminal),
      event(3, "task.started", { turn: 2 }),
    ]);

    assert.equal(current.text, "Working");
    assert.equal(current.state, "running");
  });
}

test("submitted input clears a stale current input request", () => {
  const current = currentActivityStatus([
    event(1, "agent.input_required", {
      request: {
        id: "request",
        tool: "AskUserQuestion",
        kind: "question",
        input: {},
      },
    }),
    event(2, "agent.input_submitted"),
  ]);

  assert.equal(current.text, "Working");
  assert.equal(current.state, "running");
});

test("SDK action-required sessions report input state instead of running", () => {
  const current = currentActivityStatus([
    sdk(1, "session_state_changed", { state: "requires_action" }),
  ]);

  assert.equal(current.text, "Needs input");
  assert.equal(current.state, "info");
});

test("SDK idle sessions report a finished turn or host finishing state", () => {
  const events = [sdk(1, "session_state_changed", { state: "idle" })];
  const finished = currentActivityStatus(events);
  assert.equal(finished.state, "completed");
  assert.equal(finished.text, "Turn finished");
  const finishing = currentActivityStatus(events, task("running"));
  assert.equal(finishing.text, "Finishing up");
  assert.equal(finishing.state, "info");
});

test("rejected SDK rate limits report waiting rather than running", () => {
  const current = currentActivityStatus([
    event(1, "claude.activity", {
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected" },
    }),
  ]);

  assert.equal(current.text, "Waiting for rate limit reset");
  assert.equal(current.state, "info");
});

test("failed SDK result takes precedence over a still-running host task", () => {
  const current = currentActivityStatus(
    [
      event(1, "agent.completed", {
        subtype: "error_max_turns",
        is_error: true,
        errors: ["Turn limit reached"],
      }),
    ],
    task("running"),
  );

  assert.equal(current.text, "Failed");
  assert.equal(current.state, "failed");
});
