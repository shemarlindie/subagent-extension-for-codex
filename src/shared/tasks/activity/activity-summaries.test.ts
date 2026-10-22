import assert from "node:assert/strict";

import { test } from "vitest";

import { groupActivity } from "./activity-timeline.js";
import { event, sdk } from "./activity-timeline-test-harness.js";

test("repeated notifications consolidate only when their summaries match", () => {
  const events = [
    sdk(1, "notification", { text: "Ready" }),
    sdk(2, "notification", { text: "Ready" }),
    sdk(3, "notification", { text: "Finished" }),
  ];

  const groups = groupActivity(events);
  assert.equal(groups.length, 2);
  const [repeated, finished] = groups;
  assert.ok(repeated && finished);
  assert.equal(repeated.summary, "Ready");
  assert.deepEqual(repeated.events, events.slice(0, 2));
  assert.equal(finished.summary, "Finished");
  assert.deepEqual(finished.events, events.slice(2));
});

test("unknown events without summaries retain distinct payloads in separate rows", () => {
  const events = [
    event(1, "custom.update", { progress: 10 }),
    event(2, "custom.update", { progress: 20 }),
  ];

  assert.deepEqual(
    groupActivity(events).map((group) => group.events),
    events.map((entry) => [entry]),
  );
});

test("notifications and failures present useful prose in their group summaries", () => {
  const groups = groupActivity([
    sdk(1, "notification", { text: "Build artifacts are ready" }),
    sdk(2, "permission_denied", {
      tool_name: "Bash",
      message: "Shell execution blocked",
    }),
    event(3, "agent.completed", {
      subtype: "error_max_turns",
      is_error: true,
      errors: ["Turn limit reached"],
    }),
  ]);

  const [notification, denied, completed] = groups;
  assert.ok(notification && denied && completed);

  assert.equal(notification.summary, "Build artifacts are ready");
  assert.match(denied.summary ?? "", /Shell execution blocked/);
  assert.match(completed.summary ?? "", /Turn limit reached/);
  assert.equal(denied.state, "failed");
  assert.equal(completed.state, "failed");
});

test("failed hooks expose stderr or fallback output in the group summary", () => {
  for (const fields of [
    { stderr: "Hook stderr failure", output: "Ignored stdout" },
    { output: "Hook output failure" },
  ]) {
    const groups = groupActivity([
      sdk(1, "hook_started", { hook_id: "hook", hook_name: "Checks" }),
      sdk(2, "hook_response", { hook_id: "hook", outcome: "error", ...fields }),
    ]);

    const [group] = groups;
    assert.ok(group);

    assert.equal(group.state, "failed");
    assert.equal(group.summary, fields.stderr ?? fields.output);
  }
});

test("failed tools expose string or mixed text-block results in their summary", () => {
  for (const content of [
    "Read failed: access denied",
    [
      { type: "text", text: "Read failed:" },
      { type: "image", source: {} },
      { type: "text", text: "access denied" },
    ],
  ]) {
    const groups = groupActivity([
      event(1, "tool.started", {
        id: "read",
        name: "Read",
        input: { file_path: "src/a.ts" },
      }),
      event(2, "tool.completed", { id: "read", error: true, content }),
    ]);

    const [group] = groups;
    assert.ok(group);

    assert.equal(group.state, "failed");
    assert.match(group.summary ?? "", /Read failed:/);
    assert.match(group.summary ?? "", /access denied/);

    const [started] = group.events;
    assert.ok(started);

    assert.deepEqual(
      started.data.input,
      { file_path: "src/a.ts" },
      "Original tool input remains inspectable",
    );
  }
});

test("cancelled hooks and stopped or killed background tasks remain neutral terminal operations", () => {
  for (const [start, finish] of [
    [
      sdk(1, "hook_started", { hook_id: "hook" }),
      sdk(2, "hook_response", { hook_id: "hook", outcome: "cancelled" }),
    ],
    [
      sdk(1, "task_started", { task_id: "background", description: "Review" }),
      sdk(2, "task_notification", { task_id: "background", status: "stopped" }),
    ],
    [
      sdk(1, "task_started", { task_id: "background", description: "Review" }),
      sdk(2, "task_updated", {
        task_id: "background",
        patch: { status: "killed" },
      }),
      "Stopped",
    ],
  ] as const) {
    const groups = groupActivity([start, finish]);
    assert.equal(groups.length, 1);
    const [group] = groups;
    assert.ok(group);
    assert.equal(group.state, "info");
  }
});

test("late tool progress preserves a failed result summary and state", () => {
  const groups = groupActivity([
    event(1, "tool.started", {
      id: "read",
      name: "Read",
      input: { file_path: "a.ts" },
    }),
    event(2, "tool.completed", {
      id: "read",
      error: true,
      content: "Access denied",
    }),
    event(3, "claude.activity", {
      type: "tool_progress",
      tool_use_id: "read",
      tool_name: "Read",
      elapsed_time_seconds: 3,
    }),
  ]);

  assert.equal(groups.length, 1);
  const [group] = groups;
  assert.ok(group);
  assert.equal(group.state, "failed");
  assert.equal(group.summary, "Access denied");
});

test("a turn's reply gets its own row without showing its text in the summary", () => {
  const groups = groupActivity([
    event(1, "agent.completed", { result: "Done." }),
    event(2, "agent.reply", { text: "Done.", turn: 1 }),
    event(3, "task.completed", { reply: "Done." }),
  ]);

  assert.deepEqual(
    groups.map((group) => group.summary),
    [undefined, undefined, undefined],
  );

  const [, reply] = groups;
  assert.ok(reply);
  const [replyEvent] = reply.events;
  assert.ok(replyEvent);
  assert.equal(replyEvent.data.text, "Done.");
});
