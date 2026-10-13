import assert from "node:assert/strict";

import { test } from "vitest";

import { type Event } from "../../events/types.js";
import { startSchema, type Task } from "../model.js";
import { conversation } from "./messages.js";

const task: Task = {
  ...startSchema.parse({
    repository: "/repo",
    description: "Review the parser",
  }),
  id: "task",
  title: "Review the parser",
  owner: "alice",
  created_by: "parent",
  status: "completed",
  created_at: "2026-10-07T10:00:00Z",
  updated_at: "2026-10-07T10:00:00Z",
  instructions: [],
  instructions_sent: 0,
  pending_steers: [],
  queue: [],
  turn: 2,
  runtime_ms: 0,
};

const event = (id: number, type: string, data: Record<string, unknown>) =>
  ({
    id,
    task_id: "task",
    type,
    timestamp: `2026-10-07T10:00:${String(id).padStart(2, "0")}Z`,
    data,
  }) as Event;

const said = (
  id: number,
  text: string,
  messageId: string,
  parent: string | null = null,
) =>
  event(id, "agent.message", {
    role: "assistant",
    text,
    raw_response: { message: { id: messageId }, parent_tool_use_id: parent },
  });

test("a conversation has the request, messages, worker messages and replies in order", () => {
  const messages = conversation(task, [
    event(1, "task.started", { turn: 1 }),
    said(2, "Looking at the lexer first.", "sdk_1"),
    said(3, "A subagent's note.", "sdk_sub", "toolu_1"),
    said(4, "The parser is fine.", "sdk_2"),
    said(5, "One check is missing.", "sdk_2"),
    event(6, "agent.reply", {
      text: "One check is missing.",
      turn: 1,
    }),
    event(7, "task.instruction", {
      message_id: "msg_1",
      message: "Add the check",
      from: "user",
      delivery: "steer",
    }),
    event(8, "task.started", { turn: 2 }),
    event(9, "agent.reply", { text: "Added it.", turn: 2 }),
  ]);

  assert.deepEqual(
    messages.map((m) => [m.id, m.event_id, m.turn, m.from, m.kind, m.text]),
    [
      ["request", 0, 1, "parent", "request", "Review the parser"],
      ["sdk_1", 2, 1, "worker", "message", "Looking at the lexer first."],
      // Text blocks of one SDK message join; the reply that repeats the
      // turn's last message takes its place and id.
      [
        "sdk_2",
        6,
        1,
        "worker",
        "reply",
        "The parser is fine.\n\nOne check is missing.",
      ],
      ["msg_1", 7, 1, "user", "message", "Add the check"],
      ["reply_9", 9, 2, "worker", "reply", "Added it."],
    ],
  );
});

test("sent messages show whether a turn has taken them yet", () => {
  const messages = conversation(
    {
      ...task,
      pending_steers: [{ id: "msg_pending", message: "Soon", from: "user" }],
      queue: [
        {
          id: "msg_left",
          message: "Left over",
          from: "parent",
          delivery: "steer",
          recorded: true,
        },
      ],
    },
    [
      event(1, "task.instruction", {
        message_id: "msg_pending",
        message: "Soon",
        from: "user",
        delivery: "steer",
      }),
      event(2, "task.instruction", {
        message_id: "msg_left",
        message: "Left over",
        from: "parent",
        delivery: "steer",
      }),
    ],
  );

  assert.deepEqual(
    messages.slice(1).map((m) => [m.id, m.state]),
    [
      ["msg_pending", "pending_steer"],
      ["msg_left", "queued"],
    ],
  );
});

test("matching final replies preserve the explicit parent report's stable identity", () => {
  const messages = conversation(task, [
    event(1, "task.started", { turn: 1 }),
    said(2, "Finished checking the parser.", "sdk_final"),
    event(3, "parent.message", { text: "Finished checking the parser." }),
    event(4, "agent.reply", { text: "Finished checking the parser.", turn: 1 }),
  ]);

  assert.deepEqual(
    messages.slice(1).map((m) => [m.id, m.event_id, m.kind, m.parent_message]),
    [
      ["parent_3", 3, "message", true],
      ["sdk_final", 4, "reply", undefined],
    ],
  );

  assert.equal(
    messages.find((m) => m.id === "parent_3")?.text,
    "Finished checking the parser.",
  );
});

test("a final reply identical to an explicit report creates a separate reply without rewriting the report", () => {
  const messages = conversation(task, [
    event(1, "task.started", { turn: 1 }),
    event(2, "parent.message", { text: "Done." }),
    event(3, "agent.reply", { text: "Done.", turn: 1 }),
  ]);

  assert.deepEqual(
    messages.slice(1).map((m) => [m.id, m.event_id, m.kind, m.parent_message]),
    [
      ["parent_2", 2, "message", true],
      ["reply_3", 3, "reply", undefined],
    ],
  );
});

test("stored acknowledgments annotate only their exact explicit report without changing IDs or cursors", () => {
  const events = [
    event(1, "parent.message", { text: "First" }),
    event(2, "parent.message", { text: "Second" }),
    said(3, "Ordinary", "sdk_normal"),
    event(4, "parent.message_acknowledged", { message_id: 2 }),
    event(5, "parent.message_acknowledged", { message_id: 3 }),
  ];

  const messages = conversation(task, events);

  assert.deepEqual(
    messages
      .slice(1)
      .map((message) => [message.id, message.event_id, message.acknowledged]),
    [
      ["parent_1", 1, undefined],
      ["parent_2", 2, true],
      ["sdk_normal", 3, undefined],
    ],
  );
});
