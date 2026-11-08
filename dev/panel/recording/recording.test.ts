import assert from "node:assert/strict";

import { test } from "vitest";

import type { EventEnvelope } from "../../../src/shared/events/event-contract";
import { startSchema, type Task } from "../../../src/shared/tasks/model";
import { leftovers, recordFixture } from "./recording";

const home = "/Users/someone";
const root = "/private/var/folders/xy/T/run-abc";
const repository = `${root}/repo`;
const workspace = `${root}/wt/task_123`;

const task = {
  ...startSchema.parse({ description: "Review", repository }),
  id: "task_123",
  title: "Review",
  owner: "verification",
  status: "completed",
  created_at: "2026-10-07T17:00:00.000Z",
  updated_at: "2026-10-07T17:01:00.000Z",
  completed_at: "2026-10-07T17:01:00.000Z",
  workspace,
  branch: "agent/task_123",
  session_id: "real-session",
  session_owner: "Someones-Mac.local",
  session_state_ref: `${home}/.claude/projects/${workspace.replace(/[^a-zA-Z0-9]/g, "-")}/real-session.jsonl`,
  created_by: "user",
  instructions_sent: 1,
  pending_steers: [],
  queue: [],
  turn: 2,
} as unknown as Task;

const init = {
  type: "system",
  subtype: "init",
  cwd: workspace,
  session_id: "real-session",
  model: "claude-opus-5-5",
  tools: ["Read"],
  skills: ["my-private-skill"],
  plugins: [{ name: "private-plugin", path: "builtin" }],
  mcp_servers: [{ name: "Private connector", status: "pending" }],
  memory_paths: { auto: `${home}/.claude/projects/x/memory/` },
  scratchpad_path: `${root}/scratch`,
};

const rateLimit = {
  type: "rate_limit_event",
  rate_limit_info: {
    status: "allowed",
    rateLimitType: "five_hour",
    utilization: 0.75,
    overageDisabledReason: "org_level_disabled",
  },
  session_id: "real-session",
};

const startedEvent: EventEnvelope = {
  id: 41,
  task_id: "task_123",
  type: "agent.started",
  timestamp: "2026-10-07T17:00:00.000Z",
  data: {
    model: init.model,
    tools: init.tools,
    response_ref: "init",
    raw_response: init,
  },
};

const events: EventEnvelope[] = [
  startedEvent,
  {
    id: 42,
    task_id: "task_123",
    type: "claude.activity",
    timestamp: "2026-10-07T17:00:05.000Z",
    data: { ...rateLimit, response_ref: "rate", raw_response: rateLimit },
  },
  {
    id: 43,
    task_id: "task_123",
    type: "task.instruction",
    timestamp: "2026-10-07T17:00:30.000Z",
    data: {
      message_id: "msg_1",
      message: "Carry on",
      from: "parent",
      delivery: "steer",
      request: "req_011CfoFZY4Mt23i4ncNSKMP5",
    },
  },
];

const recorded = recordFixture(task, events, {
  id: "preview-recorded-test",
  title: "Recorded: a test",
  start: "2026-10-02T11:00:00.000Z",
  firstId: 3000,
  conversationId: "dev-thread",
  home,
  host: "Someones-Mac.local",
  username: "someone",
});

test("a recording keeps nothing from the machine or account it ran on", () => {
  const text = JSON.stringify(recorded);

  for (const secret of [
    home,
    root,
    "Someones-Mac",
    "real-session",
    "task_123",
    "req_011",
    "my-private-skill",
    "private-plugin",
    "Private connector",
    "org_level_disabled",
    "utilization",
  ]) {
    assert.ok(!text.includes(secret), secret);
  }

  const [first, , instruction] = recorded.events;
  assert.ok(first);
  assert.ok(instruction);
  const started = first.data.raw_response as Record<string, unknown>;

  assert.equal(started.cwd, "/demo/data/worktrees/preview-recorded-test");
  assert.equal(started.session_id, "preview-session");
  assert.equal(started.memory_paths, undefined);
  assert.equal(instruction.data.request, "req_preview_0001");
});

test("a recording is renumbered, moved to its start and owned by the preview", () => {
  assert.deepEqual(
    recorded.events.map((event) => [event.id, event.task_id, event.timestamp]),
    [
      [3000, "preview-recorded-test", "2026-10-02T11:00:00.000Z"],
      [3001, "preview-recorded-test", "2026-10-02T11:00:05.000Z"],
      [3002, "preview-recorded-test", "2026-10-02T11:00:30.000Z"],
    ],
  );

  assert.deepEqual(
    {
      id: recorded.task.id,
      owner: recorded.task.owner,
      conversation_id: recorded.task.conversation_id,
      repository: recorded.task.repository,
      workspace: recorded.task.workspace,
      branch: recorded.task.branch,
      session_owner: recorded.task.session_owner,
      completed_at: recorded.task.completed_at,
    },
    {
      id: "preview-recorded-test",
      owner: "preview",
      conversation_id: "dev-thread",
      repository: "/demo/project",
      workspace: undefined,
      branch: undefined,
      session_owner: "preview-host",
      completed_at: "2026-10-02T11:01:00.000Z",
    },
  );
});

test("provider events are derived again from their original response", () => {
  const [, rateLimited] = recorded.events;
  assert.ok(rateLimited);

  // The stored copy of the session ID goes, and the original keeps it.
  assert.equal(rateLimited.data.session_id, undefined);

  assert.equal(
    (rateLimited.data.raw_response as Record<string, unknown>).session_id,
    "preview-session",
  );

  assert.equal(
    (rateLimited.data.activity as Record<string, unknown>).kind,
    "rate_limit_event",
  );
});

test("a current_repo recording maps its workspace to the fixture repository, and a top-level directory is left alone", () => {
  const { task: recordedTask, events: recordedEvents } = recordFixture(
    { ...task, repository: "/scratch/repo", workspace: "/scratch/repo" },
    [
      {
        ...startedEvent,
        type: "claude.activity",
        data: {
          response_ref: "repo",
          raw_response: { cwd: "/scratch/repo/x", note: "/scratch/other" },
        },
      },
    ],
    {
      id: "preview-recorded-repo",
      start: "2026-10-02T11:00:00.000Z",
      firstId: 1,
      home,
      host: "Someones-Mac.local",
      username: "someone",
    },
  );

  assert.equal(recordedTask.repository, "/demo/project");

  const [recordedEvent] = recordedEvents;
  assert.ok(recordedEvent);

  assert.deepEqual(recordedEvent.data.raw_response, {
    cwd: "/demo/project/x",
    note: "/scratch/other",
  });
});

test("leftovers finds values as they are and dash-encoded", () => {
  assert.deepEqual(
    leftovers('{"a":"-Users-someone-x","b":"Someones-Mac"}', [
      home,
      "Someones-Mac",
      "/private/tmp",
      "",
    ]),
    [home, "Someones-Mac"],
  );
});

test("local usernames are replaced in URLs, plugin names and encoded paths", () => {
  const result = recordFixture(
    {
      ...task,
      description:
        "https://github.com/some.one/repo plugin@some.one /Users/some.one/config",
    },
    [
      {
        ...startedEvent,
        type: "task.started",
        data: { "plugin@some.one": ["-Users-some-one-config"] },
      },
    ],
    {
      id: "preview-recorded-username",
      start: "2026-10-02T11:00:00.000Z",
      firstId: 1,
      home: "/Users/some.one",
      host: "Someones-Mac.local",
      username: "some.one",
    },
  );

  assert.equal(
    result.task.description,
    "https://github.com/demo-user/repo plugin@demo-user /demo/home/config",
  );

  assert.deepEqual(result.events[0]?.data, {
    "plugin@demo-user": ["-demo-home-config"],
  });

  assert.deepEqual(leftovers(JSON.stringify(result), ["some.one"]), []);
});

test("thinking signatures are scrubbed in nested SDK blocks and stream deltas", () => {
  const data = {
    response_ref: "signatures",
    raw_response: {
      message: {
        content: [
          {
            type: "thinking",
            thinking: "Keep the reasoning text",
            signature: "opaque-thinking-signature",
          },
        ],
      },
      event: {
        delta: {
          type: "signature_delta",
          signature: "opaque-stream-signature",
        },
      },
      tool_input: { signature: "ordinary tool input" },
    },
  };

  const result = recordFixture(
    task,
    [{ ...startedEvent, type: "claude.activity", data }],
    {
      id: "preview-recorded-signatures",
      start: "2026-10-02T11:00:00.000Z",
      firstId: 1,
      home,
      host: "Someones-Mac.local",
      username: "someone",
    },
  );

  const text = JSON.stringify(result);
  assert.ok(!text.includes("opaque-thinking-signature"));
  assert.ok(!text.includes("opaque-stream-signature"));

  assert.deepEqual(result.events[0]?.data.raw_response, {
    message: {
      content: [
        {
          type: "thinking",
          thinking: "Keep the reasoning text",
          signature: "preview-signature",
        },
      ],
    },
    event: {
      delta: { type: "signature_delta", signature: "preview-signature" },
    },
    tool_input: data.raw_response.tool_input,
  });

  assert.equal(
    data.raw_response.message.content[0]?.signature,
    "opaque-thinking-signature",
  );

  assert.equal(
    data.raw_response.event.delta.signature,
    "opaque-stream-signature",
  );
});

test("replacements redact decoded strings and preserve literal replacement values", () => {
  const secret = 'secret "token"\nwith\\backslash';
  const replacement = 'safe "value"\nwith\\backslash';

  const result = recordFixture(
    { ...task, description: secret },
    [
      {
        ...startedEvent,
        type: "task.started",
        data: { [secret]: [secret, "marker", "x"] },
      },
    ],
    {
      id: "preview-recorded-escaped",
      start: "2026-10-02T11:00:00.000Z",
      firstId: 1,
      home,
      host: "Someones-Mac.local",
      username: "someone",
      replace: [
        [secret, replacement],
        ["marker", "/demo/label"],
        ["x", "removed"],
      ],
    },
  );

  assert.equal(result.task.description, replacement);

  const [resultEvent] = result.events;
  assert.ok(resultEvent);

  assert.deepEqual(resultEvent.data, {
    [replacement]: [replacement, "/demo/label", "removed"],
  });

  assert.equal(task.description, "Review");
  assert.deepEqual(startedEvent.data.raw_response, init);
});

test("recording sanitizes each original response once and rewrites sibling references", async () => {
  const { originalResponseLookup } =
    await import("../../../src/shared/providers/claude/responses");

  const original = {
    type: "assistant",
    message: {
      id: "shared",
      content: [
        { type: "text", text: home },
        { type: "text", text: "second" },
      ],
    },
    future_metadata: { path: home },
  };

  const siblings = [
    {
      ...startedEvent,
      type: "agent.message",
      data: {
        role: "assistant",
        text: home,
        response_ref: "delivery",
        raw_response: original,
      },
    },
    {
      ...startedEvent,
      id: 42,
      type: "agent.message",
      data: { role: "assistant", text: "second", response_ref: "delivery" },
    },
  ];

  const options = {
    id: "preview-captures",
    firstId: 5000,
    start: task.created_at,
    home,
    host: "Someones-Mac.local",
    username: "someone",
  };

  const result = recordFixture(task, siblings, options);

  assert.equal(
    result.events.filter((event) => event.data.raw_response).length,
    1,
  );

  assert.deepEqual(
    result.events.map((event) => event.data.response_ref),
    ["response-5000", "response-5000"],
  );

  const lookup = originalResponseLookup(result.events);
  assert.equal(lookup(result.events[0]!), lookup(result.events[1]!));
  assert.equal(JSON.stringify(lookup(result.events[1]!)).includes(home), false);

  assert.ok(
    JSON.stringify(lookup(result.events[1]!)).includes("future_metadata"),
  );

  assert.throws(
    () => recordFixture(task, [siblings[1]!], options),
    /FULL_EVENTS=1 before recording/,
  );
});
