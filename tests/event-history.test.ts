import assert from "node:assert/strict";
import { test } from "vitest";
import type { Event } from "../ui/core/types";
import { EVENT_TAIL_SIZE, readEventTail } from "../ui/core/event-history";

const event = (id: number, task_id = "task"): Event => ({
  id,
  task_id,
  timestamp: "2026-10-03T12:00:00.000Z",
  type: "status",
  data: {},
});

test("an empty poll keeps the same events array", async () => {
  const previous = [event(1), event(2)];
  const tail = await readEventTail(
    "task",
    previous,
    async () => [],
    () => true,
  );
  assert.ok(tail === previous, "Unchanged views can skip rendering");
});

test("new pages append and keep only the most recent tail", async () => {
  const previous = [event(1)];
  const pages = [
    Array.from({ length: EVENT_TAIL_SIZE }, (_, i) => event(i + 2)),
  ];
  const tail = await readEventTail(
    "task",
    previous,
    async () => pages.shift() ?? [],
    () => true,
  );
  assert.equal(tail.length, EVENT_TAIL_SIZE);
  assert.equal(tail[0].id, 2);
  assert.equal(tail.at(-1)!.id, EVENT_TAIL_SIZE + 1);
});

test("events from another task are dropped rather than reused", async () => {
  const previous = [event(1, "other")];
  const tail = await readEventTail(
    "task",
    previous,
    async () => [],
    () => true,
  );
  assert.deepEqual(tail, []);
  assert.ok(tail !== previous);
});
