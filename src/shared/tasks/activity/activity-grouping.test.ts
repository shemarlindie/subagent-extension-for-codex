import assert from "node:assert/strict";

import { test } from "vitest";

import { currentActivityStatus } from "./activity-status.js";
import { groupActivity } from "./activity-timeline.js";
import { event, sdk, stream, task } from "./activity-timeline-test-harness.js";

test("adjacent thinking events of each alias show Thinking… and retain every token update", () => {
  for (const type of [
    "thinking_tokens",
    "thinking.tokens",
    "agent.thinking_tokens",
  ]) {
    const events = [
      event(1, type, { tokens: 10 }),
      event(2, type, { tokens: 20 }),
      event(3, type, { tokens: 30 }),
    ];

    const groups = groupActivity(events);
    assert.equal(groups.length, 1, type);
    const [group] = groups;
    assert.ok(group);
    assert.equal(group.title, "Thinking…", type);
    assert.deepEqual(group.events, events, type);
    assert.equal(currentActivityStatus(events).text, "Thinking…", type);
  }
});

test("SDK thinking updates use Thinking… and keep their original payloads", () => {
  const events = [
    sdk(1, "thinking_tokens", { tokens: 10 }),
    sdk(2, "thinking_tokens", { tokens: 20 }),
  ];

  const groups = groupActivity(events);
  assert.equal(groups.length, 1);
  const [group] = groups;
  assert.ok(group);
  assert.equal(group.title, "Thinking…");
  assert.deepEqual(group.events, events);
  assert.equal(currentActivityStatus(events).text, "Thinking…");
});

// The aliases share one thinking predicate, covered above, so one stands for all.
const thinkingUpdate = "agent.thinking_tokens";

for (const active of [
  {
    name: "tool",
    start: event(1, "tool.started", { id: "read", name: "Read" }),
    text: "Running Read",
  },
  {
    name: "hook",
    start: sdk(1, "hook_started", {
      hook_id: "pre-tool",
      hook_name: "PreToolUse",
    }),
    text: "Hook · PreToolUse",
  },
  {
    name: "stream",
    start: event(1, "claude.activity", {
      type: "stream_event",
      event: { type: "message_start", message: { id: "response" } },
    }),
    text: "Responding",
  },
]) {
  test(`thinking updates preserve the current status of a running ${active.name}`, () => {
    const updates = [2, 3].map((id) =>
      event(id, thinkingUpdate, { tokens: id * 10 }),
    );

    const events = [active.start, ...updates];

    assert.deepEqual(currentActivityStatus(events), {
      text: active.text,
      state: "running",
    });

    const groups = groupActivity(events);
    const [activeGroup, thinking] = groups;
    assert.ok(activeGroup && thinking);
    assert.equal(activeGroup.state, "running");
    assert.equal(thinking.title, "Thinking…");
    assert.deepEqual(thinking.events, updates);
  });
}

test("correlated tool progress interrupts adjacent event consolidation", () => {
  const events = [
    event(1, "tool.started", { id: "read", name: "Read" }),
    event(2, "workspace.indexed", { message: "Indexed" }),
    event(3, "claude.activity", {
      type: "tool_progress",
      tool_use_id: "read",
      elapsed_time_seconds: 1,
    }),
    event(4, "workspace.indexed", { message: "Indexed" }),
  ];

  const groups = groupActivity(events);

  assert.deepEqual(
    groups.map((group) => group.events.map((entry) => entry.id)),
    [[1, 3], [2], [4]],
  );

  assert.deepEqual(
    groups.slice(1).map((group) => group.title),
    ["Workspace indexed", "Workspace indexed"],
  );
});

test("an intervening event keeps repeated thinking updates separate", () => {
  const events = [
    event(1, "agent.thinking_tokens", { tokens: 10 }),
    sdk(2, "notification", { text: "New information" }),
    event(3, "agent.thinking_tokens", { tokens: 20 }),
  ];

  assert.deepEqual(
    groupActivity(events).map((group) => group.events.map((entry) => entry.id)),
    [[1], [2], [3]],
  );
});

for (const type of ["workspace.indexed", "agent.thinking_tokens"]) {
  test(`adjacent ${type} events from separate host tasks stay separate`, () => {
    const first = event(1, type, { message: "Same", tokens: 10 });

    const second = {
      ...event(2, type, { message: "Same", tokens: 20 }),
      task_id: "other-host-task",
    };

    const groups = groupActivity([first, second]);

    assert.deepEqual(
      groups.map((group) => group.events),
      [[first], [second]],
    );
  });
}

// Matching summaries are the case that could merge them.
for (const role of ["assistant", "user"]) {
  test(`distinct SDK ${role} messages with matching summaries stay separate`, () => {
    const events = [1, 2].map((id) =>
      event(id, "claude.activity", {
        type: role,
        uuid: `message-${id}`,
        message: { content: [{ type: "text", text: "Repeated message" }] },
        summary: "Repeated message",
      }),
    );

    assert.deepEqual(
      groupActivity(events).map((group) => group.events),
      events.map((entry) => [entry]),
    );
  });
}

for (const type of ["workspace.indexed", "thinking_tokens"]) {
  test(`failed ${type} events retain diagnostics instead of routine labels`, () => {
    const events = [
      event(1, type, { error: "Operation failed", message: "Routine" }),
      event(2, type, { error: "Operation failed", message: "Routine" }),
    ];

    const groups = groupActivity(events);

    assert.deepEqual(
      groups.map((group) => group.events),
      events.map((entry) => [entry]),
    );

    for (const group of groups) {
      assert.equal(group.state, "failed");
      assert.equal(group.summary, "Operation failed");
      assert.notEqual(group.title, "Thinking…");
    }
  });
}

test("repeated lifecycle events remain individually inspectable", () => {
  for (const type of [
    "task.started",
    "task.completed",
    "task.failed",
    "task.interrupted",
    "agent.completed",
    "agent.input_required",
    "agent.input_submitted",
  ]) {
    const events = [event(1, type), event(2, type)];

    assert.deepEqual(
      groupActivity(events).map((group) => group.events),
      events.map((entry) => [entry]),
      type,
    );
  }
});

for (const { type, title } of [
  { type: "task.started", title: "Task started" },
]) {
  test(`${type} has a lifecycle title and stays separate from connection events`, () => {
    const events = [event(1, type), event(2, "agent.started"), sdk(3, "init")];
    const groups = groupActivity(events);

    assert.deepEqual(
      groups.map((group) => ({
        kind: group.kind,
        title: group.title,
        events: group.events,
      })),
      [
        { kind: "status", title, events: [events[0]] },
        { kind: "status", title: "Agent connected", events: [events[1]] },
        {
          kind: "status",
          title: "Claude connected",
          events: [events[2]],
        },
      ],
    );
  });
}

test("repeated failure events stay individually prominent", () => {
  const events = [
    sdk(1, "permission_denied", { message: "Blocked" }),
    sdk(2, "permission_denied", { message: "Blocked" }),
    sdk(3, "mirror_error", { error: "Could not mirror the session" }),
    sdk(4, "mirror_error", { error: "Could not mirror the session" }),
  ];

  const groups = groupActivity(events);

  assert.deepEqual(
    groups.map((group) => group.events),
    events.map((entry) => [entry]),
  );

  assert.ok(groups.every((group) => group.state === "failed"));
});

test("tool lifecycles correlate interleaved starts, progress and results without losing responses", () => {
  const events = [
    event(1, "tool.started", {
      id: "read",
      name: "Read",
      input: { file_path: "a.ts" },
    }),
    event(2, "tool.started", {
      id: "bash",
      name: "Bash",
      input: { command: "npm test" },
    }),
    event(3, "claude.activity", {
      type: "tool_progress",
      tool_use_id: "read",
      tool_name: "Read",
      elapsed_time_seconds: 1,
    }),
    event(4, "tool.completed", {
      id: "bash",
      error: true,
      content: "Test failure",
    }),
    event(5, "tool.completed", {
      id: "read",
      error: false,
      content: "File text",
    }),
  ];

  const groups = groupActivity(events);
  assert.equal(groups.length, 2);
  const [read, bash] = groups;
  assert.ok(read && bash);
  assert.equal(read.kind, "tool");
  assert.equal(read.state, "completed");

  assert.deepEqual(
    read.events.map((e) => e.id),
    [1, 3, 5],
  );

  assert.match(read.title, /Read/);
  assert.equal(bash.state, "failed");

  assert.deepEqual(
    bash.events.map((e) => e.id),
    [2, 4],
  );

  assert.match(bash.title, /Bash/);
});

test("hooks and background SDK tasks correlate by their own IDs across interleaving", () => {
  const events = [
    sdk(1, "hook_started", { hook_id: "h1", hook_name: "Checks" }),
    sdk(2, "task_started", {
      task_id: "sdk-task",
      description: "Review files",
    }),
    sdk(3, "hook_progress", { hook_id: "h1", stdout: "Checking" }),
    sdk(4, "task_progress", {
      task_id: "sdk-task",
      description: "Reading files",
    }),
    sdk(5, "hook_response", {
      hook_id: "h1",
      outcome: "error",
      stderr: "Hook failed",
    }),
    sdk(6, "task_notification", {
      task_id: "sdk-task",
      status: "completed",
      summary: "Reviewed",
    }),
  ];

  const groups = groupActivity(events);
  assert.equal(groups.length, 2);
  const [hook, backgroundTask] = groups;
  assert.ok(hook && backgroundTask);

  assert.deepEqual(
    hook.events.map((e) => e.id),
    [1, 3, 5],
  );

  assert.equal(hook.state, "failed");

  assert.deepEqual(
    backgroundTask.events.map((e) => e.id),
    [2, 4, 6],
  );

  assert.equal(backgroundTask.state, "completed");
});

test("thinking, retries and ordinary statuses keep separate rows while failures remain prominent", () => {
  const events = [
    sdk(1, "status", { status: "requesting" }),
    sdk(2, "api_retry", { attempt: 1, max_retries: 3, retry_delay_ms: 200 }),
    sdk(3, "status", { status: "requesting" }),
    sdk(4, "permission_denied", { tool_name: "Bash", message: "Blocked" }),
    sdk(5, "status", { status: "compacting" }),
  ];

  const groups = groupActivity(events);

  assert.deepEqual(
    groups.slice(0, 3).map((group) => group.events.map((e) => e.id)),
    [[1], [2], [3]],
  );

  const failure = groups.find((g) => g.events.some((e) => e.id === 4));
  assert.equal(failure?.state, "failed");
  assert.equal(failure?.events.length, 1);
  assert.equal(groups.at(-1)?.events[0].id, 5);
});

test("turn boundaries isolate repeated tool IDs in later turns", () => {
  for (const boundary of [
    "agent.completed",
    "task.completed",
    "task.failed",
    "task.interrupted",
  ]) {
    const groups = groupActivity([
      event(1, "tool.started", { id: "reused", name: "Read" }),
      event(2, boundary),
      event(3, "tool.started", { id: "reused", name: "Read" }),
      event(4, "tool.completed", { id: "reused", content: "Later result" }),
    ]);

    const tools = groups.filter((g) => g.kind === "tool");

    assert.deepEqual(
      tools.map((tool) => tool.events.map((e) => e.id)),
      [[1], [3, 4]],
      boundary,
    );

    const [earlier, later] = tools;
    assert.ok(earlier && later);
    assert.notEqual(earlier.id, later.id, boundary);
  }
});

test("orphan results and future events remain represented", () => {
  const events = [
    event(1, "tool.completed", { id: "missing", content: "Result" }),
    sdk(2, "future_activity", { detail: "Retained" }),
  ];

  const groups = groupActivity(events);

  assert.deepEqual(
    groups.flatMap((g) => g.events).map((e) => e.id),
    [1, 2],
  );
});

test("stream blocks accumulate text, thinking and tool input while preserving every raw event", () => {
  const events = [
    stream(1, { type: "message_start", message: { id: "message-one" } }),
    stream(2, {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    }),
    stream(3, {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello " },
    }),
    stream(4, {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "world" },
    }),
    stream(5, {
      type: "content_block_start",
      index: 1,
      content_block: { type: "thinking", thinking: "" },
    }),
    stream(6, {
      type: "content_block_delta",
      index: 1,
      delta: { type: "thinking_delta", thinking: "Checking evidence" },
    }),
    stream(7, {
      type: "content_block_start",
      index: 2,
      content_block: { type: "tool_use", id: "tool", name: "Read", input: {} },
    }),
    stream(8, {
      type: "content_block_delta",
      index: 2,
      delta: { type: "input_json_delta", partial_json: '{"file_path":"a.ts"}' },
    }),
    stream(9, { type: "message_stop" }),
  ];

  const groups = groupActivity(events);
  assert.equal(groups.length, 1);
  const [group] = groups;
  assert.ok(group);
  assert.equal(group.kind, "stream");
  assert.equal(group.state, "completed");
  assert.deepEqual(group.events, events);
});

test("different parent streams do not merge and current status follows the latest live tool", () => {
  const groups = groupActivity([
    stream(1, { type: "message_start", message: { id: "main" } }),
    stream(
      2,
      { type: "message_start", message: { id: "child" } },
      "parent-tool",
    ),
    stream(3, {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Main response" },
    }),
    stream(
      4,
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Child response" },
      },
      "parent-tool",
    ),
  ]);

  assert.deepEqual(
    groups.map((group) => group.events.map((e) => e.id)),
    [
      [1, 3],
      [2, 4],
    ],
  );

  const status = currentActivityStatus([
    event(1, "tool.started", { id: "read", name: "Read" }),
    event(2, "tool.started", { id: "bash", name: "Bash" }),
  ]);

  assert.equal(status.state, "running");
  assert.match(status.text, /Bash/);
});

test("streamed response and normalized final message share their SDK message identity", () => {
  const first = stream(1, {
    type: "message_start",
    message: { id: "sdk-message" },
  });

  const delta = stream(2, {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: "Hi" },
  });

  const final = event(3, "agent.message", {
    text: "Hi",
    raw_response: {
      type: "assistant",
      message: { id: "sdk-message", content: [{ type: "text", text: "Hi" }] },
    },
  });

  const thinking = event(4, "agent.content", {
    content: { type: "thinking", thinking: "Evidence" },
    raw_response: final.data.raw_response,
  });

  const groups = groupActivity([first, delta, final, thinking]);
  assert.equal(groups.length, 1);
  const [group] = groups;
  assert.ok(group);
  assert.equal(group.kind, "message");
  assert.equal(group.state, "completed");
  assert.deepEqual(group.events, [first, delta, final, thinking]);
});

test("grouping orders retained events chronologically and accounts for each event exactly once", () => {
  const original = [
    event(5, "tool.completed", { id: "read", content: "Finished" }),
    event(1, "tool.started", { id: "read", name: "Read" }),
    sdk(4, "future_activity", { note: "One copy" }),
    sdk(3, "hook_response", { hook_id: "hook", outcome: "success" }),
    sdk(2, "hook_started", { hook_id: "hook" }),
  ];

  const groups = groupActivity(original);

  assert.deepEqual(
    groups.map((g) => g.events[0].id),
    [1, 2, 4],
  );

  assert.deepEqual(
    groups.flatMap((g) => g.events.map((e) => e.id)).sort((a, b) => a - b),
    [1, 2, 3, 4, 5],
  );

  assert.deepEqual(
    original.map((e) => e.id),
    [5, 1, 4, 3, 2],
    "Grouping does not mutate retained event order",
  );
});

test("identical SDK tool IDs in separate host tasks cannot correlate", () => {
  const first = event(1, "tool.started", { id: "read", name: "Read" });

  const second = {
    ...event(2, "tool.started", { id: "read", name: "Read" }),
    task_id: "other-host-task",
  };

  const result = event(3, "tool.completed", {
    id: "read",
    content: "First task result",
  });

  const groups = groupActivity([first, second, result]);

  assert.deepEqual(
    groups.map((group) => group.events.map((e) => e.id)),
    [[1, 3], [2]],
  );
});

test("one host task lifecycle boundary preserves another host's operation correlation", () => {
  const otherStart = {
    ...event(2, "tool.started", { id: "read", name: "Read" }),
    task_id: "other-host-task",
  };

  const otherProgress = {
    ...event(4, "claude.activity", {
      type: "tool_progress",
      tool_use_id: "read",
      elapsed_time_seconds: 1,
    }),
    task_id: "other-host-task",
  };

  const otherResult = {
    ...event(5, "tool.completed", { id: "read", content: "Other task result" }),
    task_id: "other-host-task",
  };

  const groups = groupActivity([
    event(1, "tool.started", { id: "read", name: "Read" }),
    otherStart,
    event(3, "task.completed"),
    otherProgress,
    otherResult,
  ]);

  const other = groups.find((group) => group.events.includes(otherStart));

  assert.deepEqual(
    other?.events.map((e) => e.id),
    [2, 4, 5],
  );

  assert.equal(other?.state, "completed");
});

test("rate-limit updates group together without startup or Claude status events", () => {
  const events = [
    event(1, "agent.started", {}),
    sdk(2, "status", { status: null }),
    event(3, "claude.activity", {
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed" },
    }),
    event(4, "claude.activity", {
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed" },
    }),
    sdk(5, "status", { status: null }),
  ];

  const groups = groupActivity(events);

  assert.deepEqual(
    groups.map((group) => group.events.map((event) => event.id)),
    [[1], [2], [3, 4], [5]],
  );

  const [, , rateLimit] = groups;
  assert.ok(rateLimit);

  assert.equal(rateLimit.title, "Rate limit updated");

  assert.deepEqual(
    groups.flatMap((group) => group.events),
    events,
  );
});

test("failed context compaction exposes its exact error and failed current state", () => {
  const events = [
    sdk(1, "status", {
      status: "compacting",
      compact_result: "failed",
      compact_error: "Context could not be compacted",
    }),
  ];

  const groups = groupActivity(events);
  assert.equal(groups.length, 1);
  const [group] = groups;
  assert.ok(group);
  assert.equal(group.state, "failed");
  assert.equal(group.title, "Context compaction failed");
  assert.equal(group.summary, "Context could not be compacted");
  const current = currentActivityStatus(events, task("running"));
  assert.equal(current.state, "failed");
});

test("merged tool progress separates housekeeping bursts in input event order", () => {
  const groups = groupActivity([
    event(1, "tool.started", { id: "read", name: "Read" }),
    sdk(2, "status", { status: "requesting" }),
    event(3, "claude.activity", {
      type: "tool_progress",
      tool_use_id: "read",
      tool_name: "Read",
      elapsed_time_seconds: 1,
    }),
    sdk(4, "status", { status: "compacting" }),
  ]);

  const statuses = groups.filter((group) => group.kind === "status");
  assert.equal(statuses.length, 2);

  assert.deepEqual(
    statuses.map((group) => group.events.map((e) => e.id)),
    [[2], [4]],
  );

  assert.deepEqual(
    groups.find((group) => group.kind === "tool")?.events.map((e) => e.id),
    [1, 3],
  );
});

test("merged normalized message content separates housekeeping bursts in input event order", () => {
  const raw = { type: "assistant", message: { id: "shared-message" } };

  const groups = groupActivity([
    event(1, "agent.message", { text: "Initial text", raw_response: raw }),
    sdk(2, "status", { status: "requesting" }),
    event(3, "agent.message", { text: "Continuation text", raw_response: raw }),
    sdk(4, "status", { status: "compacting" }),
  ]);

  const statuses = groups.filter((group) => group.kind === "status");
  assert.equal(statuses.length, 2);

  assert.deepEqual(
    statuses.map((group) => group.events.map((e) => e.id)),
    [[2], [4]],
  );

  assert.deepEqual(
    groups.find((group) => group.kind === "message")?.events.map((e) => e.id),
    [1, 3],
  );
});

test("a turn completion keeps its result when no matching reply follows", () => {
  const groups = groupActivity([
    event(1, "agent.completed", { result: "Done." }),
    event(2, "agent.reply", { text: "Something else.", turn: 1 }),
    event(3, "agent.completed", { result: "Later." }),
  ]);

  assert.deepEqual(
    groups.map((group) => [group.title, group.summary]),
    [
      ["Turn completed", "Done."],
      ["Reply", undefined],
      ["Turn completed", "Later."],
    ],
  );

  const [, reply] = groups;
  assert.ok(reply);
  const [replyEvent] = reply.events;
  assert.ok(replyEvent);
  assert.equal(replyEvent.data.text, "Something else.");
});
