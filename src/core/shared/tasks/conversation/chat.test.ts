import assert from "node:assert/strict";

import { test } from "vitest";

import { Store } from "../../../service/features/tasks/storage/store.js";
import { decodedEvent } from "../../events/decode.js";
import { startSchema, type Task } from "../model.js";
import { CHAT_EVENTS, chatItems } from "./chat.js";
import { READ_EVENTS } from "./unread.js";

const task: Task = {
  ...startSchema.parse({
    repository: "/repo",
    description: "Move the helpers",
  }),
  id: "task",
  title: "Move the helpers",
  owner: "alice",
  created_by: "user",
  status: "failed",
  created_at: "",
  updated_at: "",
  instructions_sent: 0,
  pending_steers: [],
  queue: [],
  turn: 2,
  runtime_ms: 0,
};

const event = (id: number, type: string, data: Record<string, unknown> = {}) =>
  decodedEvent({ id, task_id: "task", type, timestamp: "", data });

test("stored Chat events include compaction failures and question answers, and exclude ordinary statuses and permission decisions", (t) => {
  const store = new Store(":memory:");

  t.onTestFinished(() => store.close());
  store.save(task);

  store.eventOpaque(task, "claude.activity", {
    type: "system",
    subtype: "status",
    status: "compacting",
    activity: { kind: "status", statusTitle: "Compacting context" },
    raw_response: { type: "system", subtype: "status", status: "compacting" },
  });

  const failure = store.eventOpaque(task, "claude.activity", {
    type: "system",
    subtype: "status",
    compact_result: "failed",
    raw_response: {
      type: "system",
      subtype: "status",
      compact_result: "failed",
    },
    activity: {
      kind: "status",
      statusTitle: "Context compaction failed",
      failed: true,
    },
  });

  store.event(task, "agent.input_decision", {
    request_id: "permission",
    approved: true,
    authority: "user",
  });

  const answers = store.event(task, "agent.input_decision", {
    request_id: "question",
    approved: true,
    authority: "user",
    answers: { "Which format?": "TOML" },
  });

  assert.deepEqual(store.chatEvents(task.id), [failure, answers]);
});

test("Chat shows a compaction failure between replies without ending the turn", () => {
  const items = chatItems(task, [
    event(1, "agent.reply", { text: "Before compaction", turn: 1 }),
    event(2, "claude.activity", {
      type: "system",
      subtype: "status",
      activity: {
        kind: "status",
        statusTitle: "Context compaction failed",
        failed: true,
      },
      raw_response: {
        type: "system",
        subtype: "status",
        status: null,
        compact_result: "failed",
        compact_error: "The summary exceeded the context window.",
      },
    }),
    event(3, "agent.reply", { text: "Continued", turn: 1 }),
  ]);

  assert.deepEqual(
    items.map((item) => item.kind),
    ["message", "message", "note", "message"],
  );

  assert.deepEqual(items[2], {
    kind: "note",
    id: "evt_2",
    event_id: 2,
    timestamp: "",
    note: "failure",
    text: "Context compaction failed",
  });
});

test("Chat puts outcome rows where turns end, with a failure's error, and notes and ended plans between messages", () => {
  const items = chatItems(task, [
    event(1, "task.started", { turn: 1 }),
    event(2, "agent.reply", { text: "Moved them.", turn: 1 }),
    event(3, "task.turn_ended", {
      turn: 1,
      outcome: "completed",
      runtime_ms: 1000,
      cost_usd: 0.1,
    }),
    event(4, "task.instruction", {
      message_id: "msg_1",
      message: "Now the tests",
      from: "user",
      delivery: "steer",
    }),
    event(5, "task.worktree_recreated", { from: "branch" }),
    event(6, "task.session_started", { reason: "session_unavailable" }),
    event(7, "task.started", { turn: 2 }),
    event(8, "claude.activity", {
      type: "system",
      subtype: "compact_boundary",
      activity: { kind: "compact_boundary" },
      raw_response: { type: "system", subtype: "compact_boundary" },
    }),
    event(9, "task.turn_ended", {
      turn: 2,
      outcome: "failed",
      runtime_ms: 2000,
      cost_usd: 0.2,
    }),
    // A plan that ends with the turn doesn't separate the failure from it.
    event(10, "task.plan_ended", {
      steps: [{ content: "Run the tests", status: "in_progress" }],
    }),
    event(11, "task.failed", { error_code: "cost_budget_exhausted" }),
  ]);

  assert.deepEqual(
    items.map((item) => {
      if (item.kind === "message") return [item.kind, item.id];

      if (item.kind === "outcome") {
        return [item.kind, item.turn, item.outcome, item.error, item.event_id];
      }

      if (item.kind === "plan") return [item.kind, item.steps[0]?.content];
      if (item.kind === "visual") return [item.kind, item.title];

      return [item.kind, item.kind === "note" ? item.note : item.from];
    }),
    [
      ["message", "request"],
      ["message", "reply_2"],
      ["outcome", 1, "completed", undefined, 3],
      ["message", "msg_1"],
      ["note", "worktree"],
      ["note", "session"],
      ["note", "compaction"],
      // A read after the outcome row gets it again, with the error.
      ["outcome", 2, "failed", "Cost limit reached.", 11],
      ["plan", "Run the tests"],
    ],
  );
});

test("a compaction's note replaces its command's output, and other command output stays", () => {
  const commandTurn = (turn: number, first: number, text: string) => [
    event(first, "task.started", { turn }),
    event(first + 2, "agent.reply", { text, turn, command_output: true }),
  ];

  const items = chatItems(task, [
    ...commandTurn(1, 1, "Compacted"),
    event(2, "claude.activity", {
      type: "system",
      subtype: "compact_boundary",
      activity: { kind: "compact_boundary" },
    }),
    ...commandTurn(2, 4, "Context Usage"),
  ]);

  assert.deepEqual(
    items.map((item) =>
      item.kind === "message" ? item.message.text : item.kind,
    ),
    ["Move the helpers", "note", "Context Usage"],
  );
});

test("Chat reads every event that leaves a task unread, and an input request adds no item", () => {
  for (const type of READ_EVENTS) assert.ok(CHAT_EVENTS.includes(type), type);

  const items = chatItems(task, [
    event(1, "agent.reply", { text: "Need a decision", turn: 2 }),
    event(2, "agent.input_required", { request: { id: "req" } }),
  ]);

  // The request, then the reply.
  assert.deepEqual(
    items.map((item) => item.event_id),
    [0, 1],
  );
});
