import assert from "node:assert/strict";

import { test } from "vitest";

import { decodedEvent } from "../../events/decode.js";
import { startSchema, type Task } from "../model.js";
import { parentUpdate } from "./parent-updates.js";

const task: Task = {
  ...startSchema.parse({
    provider: "claude",
    repository: "/repo",
    description: "Cache prices",
  }),
  id: "task",
  title: "Cache prices",
  owner: "alice",
  created_by: "parent",
  status: "completed",
  created_at: "2026-10-07T10:00:00Z",
  updated_at: "2026-10-07T10:00:00Z",
  instructions_sent: 0,
  pending_steers: [],
  queue: [],
  turn: 2,
  runtime_ms: 0,
};

const reply = (turn: number) =>
  decodedEvent({
    id: turn,
    task_id: "task",
    type: "agent.reply",
    timestamp: "2026-10-07T10:00:00Z",
    data: {
      text: "The cache has no store yet.",
      turn,
      wrap_up: {
        recap: "PriceCache has no store.",
        ask: "Which store?",
        actions: [{ label: "SQLite" }],
        blocked: true,
      },
    },
  });

test("a blocked wrap-up waits on its answer like a request until the next turn", () => {
  assert.deepEqual(
    [reply(2), reply(1)].map((e) => {
      const update = parentUpdate(task, e, false);

      return [update?.kind, update?.text];
    }),
    [
      ["request", "Which store?"],
      ["reply", "The cache has no store yet."],
    ],
  );
});
