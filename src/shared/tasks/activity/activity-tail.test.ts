import assert from "node:assert/strict";

import { test } from "vitest";

import type { Event } from "../../events/types.js";
import {
  addDropped,
  EVENT_TAIL_SIZE,
  windowActivity,
} from "./activity-tail.js";

const event = (
  id: number,
  type = "status",
  data: Record<string, unknown> = {},
): Event => ({
  id,
  task_id: "task",
  timestamp: `2026-10-03T12:00:0${id % 10}.000Z`,
  type,
  data,
});

test("dropped events are tallied by kind and carried forward without mutation", () => {
  const first = addDropped(undefined, [
    event(1, "tool.started", { name: "Bash" }),
    event(2, "tool.started", { name: "Bash" }),
    event(3, "tool.started", { name: "Edit" }),
    event(4, "agent.message", { role: "assistant" }),
  ]);

  assert.equal(first?.count, 4);
  assert.equal(first?.toolCalls, 3);
  assert.deepEqual(first?.tools, { Bash: 2, Edit: 1 });
  assert.equal(first?.messages, 1);

  const second = addDropped(first, [
    event(5, "tool.started", { name: "Read" }),
  ]);

  assert.equal(second?.count, 5);
  assert.equal(second?.to, "2026-10-03T12:00:05.000Z");
  assert.equal(first?.count, 4, "the previous summary is not mutated");
  assert.deepEqual(first?.tools, { Bash: 2, Edit: 1 });
});

test("a window keeps the newest events and tallies the rest", () => {
  const log = Array.from({ length: EVENT_TAIL_SIZE + 3 }, (_, i) =>
    event(i + 1, "tool.started", { name: "Bash" }),
  );

  const page = windowActivity(log);

  assert.equal(page.total, EVENT_TAIL_SIZE + 3);
  assert.equal(page.events.length, EVENT_TAIL_SIZE);
  assert.equal(page.events[0].id, 4);
  assert.equal(page.dropped?.count, 3);
});

test("a window reads only the events after its cursor, and has no tally when nothing fell off", () => {
  const log = [event(1), event(2), event(3)];

  const page = windowActivity(log, 2);

  assert.deepEqual(
    page.events.map((item) => item.id),
    [3],
  );

  assert.equal(page.total, 3);
  assert.equal(page.dropped, undefined);
});
