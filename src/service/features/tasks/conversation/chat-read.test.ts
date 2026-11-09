import assert from "node:assert/strict";

import { test } from "vitest";

import { chatItems } from "../../../../shared/tasks/conversation/chat.js";
import { startSchema, type Task } from "../../../../shared/tasks/model.js";
import { Attachments } from "../../attachments/attachments.js";
import { Store } from "../storage/store.js";
import { chatRead } from "./chat-read.js";

/** A stored task with nothing in its Chat yet. */
function storedTask(t: { onTestFinished: (fn: () => void) => void }) {
  const store = new Store(":memory:");
  t.onTestFinished(() => store.close());
  // Listing reads only the database, so the folder is never made.
  const attachments = new Attachments(store, "/unused/attachments");

  const task: Task = {
    ...startSchema.parse({ repository: "/repo", description: "Move them" }),
    id: "task",
    title: "Move them",
    owner: "alice",
    created_by: "user",
    status: "failed",
    created_at: "",
    updated_at: "",
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 1,
    runtime_ms: 0,
  };

  store.save(task);

  return { store, attachments, task };
}

test("a Chat read at any cursor returns what reading all of Chat returns", (t) => {
  const { store, attachments, task } = storedTask(t);
  const block = { role: "assistant", message_id: "msg_1" } as const;
  store.event(task, "task.started", { turn: 1 });
  // Two text blocks of one message merge into one item at the later event.
  store.event(task, "agent.message", { ...block, text: "Half" });
  store.eventOpaque(task, "claude.activity", { type: "assistant" });
  store.event(task, "agent.message", { ...block, text: "Rest" });

  store.event(task, "task.turn_ended", {
    turn: 1,
    outcome: "failed",
    runtime_ms: 1,
    cost_usd: 0,
  });

  // The failure rewrites the outcome row at its own event.
  store.event(task, "task.failed", { error_code: "cost_budget_exhausted" });
  store.eventOpaque(task, "claude.activity", { type: "result" });

  const newest = store.lastEventId(task.id);
  const all = chatItems(task, store.chatEvents(task.id));
  const chatNewest = Math.max(...all.map((item) => item.event_id));

  for (let after = 0; after <= newest + 1; after++) {
    assert.deepEqual(
      chatRead(store, attachments, task, after),
      {
        items: all.filter(
          (item) =>
            item.event_id > after || (after === 0 && item.event_id === 0),
        ),
        next_cursor: Math.max(after, chatNewest),
      },
      `after ${after}`,
    );
  }
});

test("the first Chat read lists the request's attachments without their file names", (t) => {
  const { store, attachments, task } = storedTask(t);
  store.event(task, "task.started", { turn: 1 });

  const note = {
    position: 1,
    title: "Note",
    summary: "A decision.",
    format: "text",
    source: "inline",
    chars: 6,
    lines: 1,
  } as const;

  attachments.save(task.id, [{ ...note, file: "1-note.txt" }]);
  const [request] = chatRead(store, attachments, task, 0).items;
  assert.equal(request?.kind, "message");
  assert.deepEqual(request.message.attachments, [note]);
  const later = chatRead(store, attachments, task, 1).items;
  assert.ok(!later.some((item) => item.event_id === 0));
});
