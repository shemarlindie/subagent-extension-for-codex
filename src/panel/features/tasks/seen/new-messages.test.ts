import assert from "node:assert/strict";

import { test } from "vitest";

import type { ChatItem } from "../../../../shared/tasks/conversation/chat.js";
import { newMessagesIndex } from "./new-messages";

const message = (
  event_id: number,
  from: "user" | "parent" | "worker",
  turn = 1,
): ChatItem => ({
  kind: "message",
  id: `m${event_id}`,
  event_id,
  message: {
    id: `m${event_id}`,
    event_id,
    timestamp: "",
    turn,
    from,
    kind: "message",
    text: "",
  },
});

const outcome = (event_id: number, turn = 1): ChatItem => ({
  kind: "outcome",
  id: `o${event_id}`,
  event_id,
  timestamp: "",
  turn,
  outcome: "completed",
  runtime_ms: 0,
  cost_usd: 0,
});

const note = (event_id: number, kind: "compaction" | "failure"): ChatItem => ({
  kind: "note",
  id: `n${event_id}`,
  event_id,
  timestamp: "",
  note: kind,
  text: "",
});

test("new messages start at the first item from the task after what was seen", () => {
  const items = [
    message(1, "user"),
    message(2, "worker"),
    message(3, "user"),
    note(4, "compaction"),
    message(5, "worker", 2),
  ];

  assert.equal(newMessagesIndex(items, 2), 4);
  assert.equal(newMessagesIndex(items, 0), 1);
  assert.equal(newMessagesIndex(items, 5), undefined);
  assert.equal(newMessagesIndex([...items, note(6, "failure")], 5), 5);
});

test("a new outcome shown with a seen response puts the divider above that response", () => {
  const items = [message(1, "user"), message(2, "worker"), outcome(3)];

  assert.equal(newMessagesIndex(items, 2), 1);
  assert.equal(newMessagesIndex([message(1, "user"), outcome(3)], 2), 1);
});
