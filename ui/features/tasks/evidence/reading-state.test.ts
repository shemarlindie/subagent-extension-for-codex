import assert from "node:assert/strict";

import { test } from "vitest";

import { SessionStateStore } from "../../../shared/state/session-state";

test("reading positions survive inspector remounts and remain isolated by task, tab and controller", () => {
  const session = new SessionStateStore();
  const otherSession = new SessionStateStore();
  const chat = session.get("task", "task-a").reading.chat;
  chat.position = { top: 120, pinned: false };

  assert.equal(session.get("task", "task-a").reading.chat, chat);
  assert.deepEqual(session.get("task", "task-b").reading.chat, {});
  assert.deepEqual(session.get("task", "task-a").reading.activity, {});
  assert.deepEqual(otherSession.get("task", "task-a").reading.chat, {});
});
