import assert from "node:assert/strict";

import { test } from "vitest";

import { Store } from "../../../service/features/tasks/storage/store.js";
import { decodedEvent } from "../../events/decode.js";
import { startSchema, type Task } from "../model.js";
import { CHAT_EVENTS, chatItems } from "./chat.js";

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
  instructions: [],
  instructions_sent: 0,
  pending_steers: [],
  queue: [],
  turn: 2,
  runtime_ms: 0,
};

const event = (id: number, type: string, data: Record<string, unknown> = {}) =>
  decodedEvent({ id, task_id: "task", type, timestamp: "", data });

test("stored Chat events include compaction failures and exclude ordinary statuses", (t) => {
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

  assert.deepEqual(store.chatEvents(task.id, CHAT_EVENTS), [failure]);
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

test("Chat puts outcome rows where turns end, with a failure's error, and notes between messages", () => {
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
    event(10, "task.failed", { error: "Cost budget exhausted" }),
  ]);

  assert.deepEqual(
    items.map((item) => {
      if (item.kind === "message") return [item.kind, item.id];

      if (item.kind === "outcome") {
        return [item.kind, item.turn, item.outcome, item.error, item.event_id];
      }

      return [item.kind, item.note];
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
      ["outcome", 2, "failed", "Cost budget exhausted", 10],
    ],
  );
});

test("Chat orders explicit parent reports before the matching final reply's updated SDK message", () => {
  const items = chatItems(task, [
    event(1, "agent.message", {
      role: "assistant",
      message_id: "sdk_final",
      text: "Done.",
      raw_response: { message: { id: "sdk_final" } },
    }),
    event(2, "parent.message", { text: "Worker report" }),
    event(3, "agent.reply", { text: "Done.", turn: 1 }),
    event(4, "task.turn_ended", {
      turn: 1,
      outcome: "completed",
      runtime_ms: 0,
      cost_usd: 0,
    }),
  ]);

  assert.deepEqual(
    items.map((item) => [item.id, item.event_id, item.kind]),
    [
      ["request", 0, "message"],
      ["parent_2", 2, "message"],
      ["sdk_final", 3, "message"],
      ["turn_1_4", 4, "outcome"],
    ],
  );

  const report = items[1];
  assert.ok(report);

  assert.equal(
    report.kind === "message" && report.message.parent_message,
    true,
  );

  assert.equal(
    report.kind === "message" && report.message.text,
    "Worker report",
  );
});
