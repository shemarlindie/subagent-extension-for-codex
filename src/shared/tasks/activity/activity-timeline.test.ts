import assert from "node:assert/strict";

import { test } from "vitest";

import { claudeActivityPresentation } from "../../../service/features/providers/claude/events/activity.js";
import { decodedEvent } from "../../events/decode.js";
import { type Event } from "../../events/types.js";
import { startSchema, type Task } from "../model.js";
import { currentActivityStatus } from "./activity-status.js";
import { groupActivity, thinkingSpan } from "./activity-timeline.js";

for (const type of [
  "thinking_tokens",
  "thinking.tokens",
  "agent.thinking_tokens",
]) {
  test(`adjacent ${type} events show Thinking… and retain every token update`, () => {
    const events = [
      event(1, type, { tokens: 10 }),
      event(2, type, { tokens: 20 }),
      event(3, type, { tokens: 30 }),
    ];

    const groups = groupActivity(events);
    assert.equal(groups.length, 1);
    const [group] = groups;
    assert.ok(group);
    assert.equal(group.title, "Thinking…");
    assert.deepEqual(group.events, events);
    assert.equal(currentActivityStatus(events).text, "Thinking…");
  });
}

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

for (const type of [
  "thinking_tokens",
  "thinking.tokens",
  "agent.thinking_tokens",
  "SDK thinking_tokens",
]) {
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
    test(`${type} updates preserve the current status of a running ${active.name}`, () => {
      const updates = [2, 3].map((id) =>
        type === "SDK thinking_tokens"
          ? sdk(id, "thinking_tokens", { tokens: id * 10 })
          : event(id, type, { tokens: id * 10 }),
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
}

test("requesting status has its own row and never a thinking span", () => {
  const events = [sdk(1, "status", { status: "requesting" })];
  const [group] = groupActivity(events);
  assert.ok(group);
  assert.equal(group.title, "Requesting");
  assert.equal(currentActivityStatus(events).text, "Requesting");
  assert.equal(thinkingSpan(group, events), undefined);
});

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
  assert.equal(repeated.title, "Notification · 2 events");
  assert.equal(repeated.summary, "Ready");
  assert.deepEqual(repeated.events, events.slice(0, 2));
  assert.equal(finished.summary, "Finished");
  assert.deepEqual(finished.events, events.slice(2));
});

for (const role of ["assistant", "user"]) {
  for (const summary of [undefined, "Repeated message"]) {
    test(`distinct SDK ${role} messages with ${summary ? "matching" : "no"} summaries stay separate`, () => {
      const events = [1, 2].map((id) =>
        event(id, "claude.activity", {
          type: role,
          uuid: `message-${id}`,
          message: { content: [{ type: "text", text: "Repeated message" }] },
          ...(summary ? { summary } : {}),
        }),
      );

      assert.deepEqual(
        groupActivity(events).map((group) => group.events),
        events.map((entry) => [entry]),
      );
    });
  }
}

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

for (const type of [
  "task.started",
  "task.completed",
  "task.failed",
  "task.interrupted",
  "agent.completed",
  "agent.input_required",
  "agent.input_submitted",
]) {
  test(`repeated ${type} events remain individually inspectable`, () => {
    const events = [event(1, type), event(2, type)];

    assert.deepEqual(
      groupActivity(events).map((group) => group.events),
      events.map((entry) => [entry]),
    );
  });
}

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

function event(
  id: number,
  type: string,
  data: Record<string, unknown> = {},
): Event {
  return decodedEvent({
    id,
    type,
    data:
      type === "claude.activity" || data.raw_response
        ? { ...data, activity: claudeActivityPresentation({ type, data }) }
        : data,
    task_id: "host-task",
    timestamp: new Date(id * 1000).toISOString(),
  });
}

function sdk(id: number, subtype: string, data: Record<string, unknown> = {}) {
  return event(id, "claude.activity", { type: "system", subtype, ...data });
}

function task(status: Task["status"]): Task {
  return {
    ...startSchema.parse({
      repository: "/repo",
      description: "Review",
      worker_profile: "reviewer",
    }),
    id: "host-task",
    title: "Review",
    owner: "owner",
    repository: "/repo",
    status,
    created_at: "",
    updated_at: "",
    instructions: [],
    created_by: "user",
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 1,
    runtime_ms: 0,
  };
}

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

for (const boundary of [
  "agent.completed",
  "task.completed",
  "task.failed",
  "task.interrupted",
]) {
  test(`${boundary} isolates repeated tool IDs in later turns`, () => {
    const groups = groupActivity([
      event(1, "tool.started", { id: "reused", name: "Read" }),
      event(2, boundary),
      event(3, "tool.started", { id: "reused", name: "Read" }),
      event(4, "tool.completed", { id: "reused", content: "Later result" }),
    ]);

    const tools = groups.filter((g) => g.kind === "tool");
    assert.equal(tools.length, 2);

    assert.deepEqual(
      tools.map((tool) => tool.events.map((e) => e.id)),
      [[1], [3, 4]],
    );

    const [earlier, later] = tools;
    assert.ok(earlier && later);
    assert.notEqual(earlier.id, later.id);
  });
}

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

function stream(
  id: number,
  wire: Record<string, unknown>,
  parent: string | null = null,
) {
  return event(id, "claude.activity", {
    type: "stream_event",
    parent_tool_use_id: parent,
    event: wire,
  });
}

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
  for (const [start, finish, prefix] of [
    [
      sdk(1, "hook_started", { hook_id: "hook" }),
      sdk(2, "hook_response", { hook_id: "hook", outcome: "cancelled" }),
      "Cancelled",
    ],
    [
      sdk(1, "task_started", { task_id: "background", description: "Review" }),
      sdk(2, "task_notification", { task_id: "background", status: "stopped" }),
      "Stopped",
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
    assert.ok(group.summary?.startsWith(prefix), group.summary);
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

test("a thinking row lasts until the next event, or is open-ended when none follows", () => {
  const thinking = [event(10, "thinking_tokens"), event(14, "thinking_tokens")];
  const [group] = groupActivity(thinking);
  assert.ok(group);

  assert.deepEqual(thinkingSpan(group, thinking), {
    start: 10000,
    end: null,
  });

  const all = [
    ...thinking,
    event(20, "tool.started", { id: "a", name: "Read" }),
  ];

  assert.deepEqual(thinkingSpan(group, all), { start: 10000, end: 20000 });
});

test("a message that absorbed its thinking marker spans marker to message", () => {
  const raw = { message: { id: "m1" } };

  const events = [
    event(5, "thinking_tokens", { tokens: 10 }),
    event(9, "agent.message", { text: "Done", raw_response: raw }),
    event(5.5, "agent.message", {
      content: [{ type: "thinking", thinking: "hm" }],
      raw_response: raw,
    }),
  ];

  const message = groupActivity(events).find((g) => g.kind === "message")!;
  const span = thinkingSpan(message, events);
  assert.ok(span && span.end !== null && span.end > span.start);
});

test("rows that are not thinking have no span", () => {
  const events = [event(1, "tool.started", { id: "a", name: "Read" })];
  const [group] = groupActivity(events);
  assert.ok(group);
  assert.equal(thinkingSpan(group, events), undefined);
});

test("startup and ordinary statuses remain visible beside a thinking row", () => {
  const events = [
    event(10, "agent.started"),
    sdk(11, "status", { status: null }),
    event(12, "thinking_tokens", { tokens: 10 }),
    event(20, "tool.started", { id: "a", name: "Read" }),
  ];

  const group = groupActivity(events).find((g) => g.title === "Thinking…")!;
  const groups = groupActivity(events);

  assert.deepEqual(
    groups.map((group) => group.events.map((event) => event.id)),
    [[10], [11], [12], [20]],
  );

  const [connected, working] = groups;
  assert.ok(connected && working);

  assert.equal(connected.title, "Agent connected");
  assert.equal(working.title, "Working");
  assert.equal(thinkingSpan(connected, events), undefined);
  assert.equal(thinkingSpan(working, events), undefined);
  assert.deepEqual(thinkingSpan(group, events), { start: 12000, end: 20000 });
});

test("a turn's reply gets its own row without showing its text in the summary", () => {
  const groups = groupActivity([
    event(1, "agent.completed", { result: "Done." }),
    event(2, "agent.reply", { text: "Done.", turn: 1 }),
    event(3, "task.completed", { reply: "Done." }),
  ]);

  assert.deepEqual(
    groups.map((group) => [group.title, group.summary]),
    [
      ["Turn completed", undefined],
      ["Reply", undefined],
      ["Task completed", undefined],
    ],
  );

  const [, reply] = groups;
  assert.ok(reply);
  const [replyEvent] = reply.events;
  assert.ok(replyEvent);
  assert.equal(replyEvent.data.text, "Done.");
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

test("turn ends and queue changes summarise their outcome and queue", () => {
  const groups = groupActivity([
    event(1, "task.turn_ended", {
      turn: 2,
      outcome: "interrupted",
      runtime_ms: 1000,
      cost_usd: 0,
    }),
    event(2, "task.queue_changed", {
      queue: [{ message_id: "m", message: "Next", from: "user" }],
      paused: true,
    }),
  ]);

  assert.deepEqual(
    groups.map((group) => [group.title, group.summary]),
    [
      ["Turn ended", "Turn 2 interrupted"],
      ["Queue changed", "1 queued · paused"],
    ],
  );
});
