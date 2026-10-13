import assert from "node:assert/strict";

import { test } from "vitest";

import { claudeActivityPresentation } from "../../../src/service/features/providers/claude/events/activity";
import { type Event } from "../../../src/shared/events/types";
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
  instructions: [{ id: "msg_1", message: "Carry on", from: "parent" }],
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
    overageDisabledReason: "org_level_disabled",
    unifiedWindows: { five_hour: { utilization: 0.75 } },
  },
  session_id: "real-session",
};

const events: Event[] = [
  {
    id: 41,
    task_id: "task_123",
    type: "agent.started",
    timestamp: "2026-10-07T17:00:00.000Z",
    data: { model: init.model, tools: init.tools, raw_response: init },
  },
  {
    id: 42,
    task_id: "task_123",
    type: "claude.activity",
    timestamp: "2026-10-07T17:00:05.000Z",
    data: { ...rateLimit, raw_response: rateLimit },
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

  const started = recorded.events[0].data.raw_response as Record<
    string,
    unknown
  >;

  assert.equal(started.cwd, "/demo/data/worktrees/preview-recorded-test");
  assert.equal(started.session_id, "preview-session");
  assert.equal(started.memory_paths, undefined);
  assert.equal(recorded.events[2].data.request, "req_preview_0001");
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
      title: recorded.task.title,
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
      title: "Recorded: a test",
      conversation_id: "dev-thread",
      repository: "/demo/project",
      workspace: undefined,
      branch: undefined,
      session_owner: "preview-host",
      completed_at: "2026-10-02T11:01:00.000Z",
    },
  );
});

test("provider events get their presentation again", () => {
  const [started] = recorded.events;
  const { activity, ...data } = started.data;

  assert.deepEqual(
    activity,
    claudeActivityPresentation({ type: started.type, data }),
  );
});

test("a current_repo recording maps its workspace to the fixture repository, and a top-level directory is left alone", () => {
  const { task: recordedTask, events: recordedEvents } = recordFixture(
    { ...task, repository: "/scratch/repo", workspace: "/scratch/repo" },
    [
      {
        ...events[0],
        data: {
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
    },
  );

  assert.equal(recordedTask.repository, "/demo/project");

  assert.deepEqual(recordedEvents[0].data.raw_response, {
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

test("replacements redact decoded strings and preserve literal replacement values", () => {
  const secret = 'secret "token"\nwith\\backslash';
  const replacement = 'safe "value"\nwith\\backslash';

  const result = recordFixture(
    { ...task, description: secret },
    [{ ...events[0], data: { [secret]: [secret, "marker", "x"] } }],
    {
      id: "preview-recorded-escaped",
      start: "2026-10-02T11:00:00.000Z",
      firstId: 1,
      home,
      host: "Someones-Mac.local",
      replace: [
        [secret, replacement],
        ["marker", "/demo/label"],
        ["x", "removed"],
      ],
    },
  );

  assert.equal(result.task.description, replacement);

  assert.deepEqual(result.events[0].data, {
    [replacement]: [replacement, "/demo/label", "removed"],
  });

  assert.equal(task.description, "Review");
  assert.deepEqual(events[0].data.raw_response, init);
});
