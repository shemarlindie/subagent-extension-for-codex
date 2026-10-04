import assert from "node:assert/strict";
import { test } from "vitest";
import type { Event } from "../ui/core/types";
import {
  EVENT_TAIL_SIZE,
  describeDropped,
  readEventTail,
} from "../ui/core/event-history";

const event = (id: number, task_id = "task"): Event => ({
  id,
  task_id,
  timestamp: "2026-10-03T12:00:00.000Z",
  type: "status",
  data: {},
});

test("an empty poll keeps the same events array", async () => {
  const previous = [event(1), event(2)];

  const { events: tail } = await readEventTail(
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

  const { events: tail } = await readEventTail(
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

  const { events: tail } = await readEventTail(
    "task",
    previous,
    async () => [],
    () => true,
  );

  assert.deepEqual(tail, []);
  assert.ok(tail !== previous);
});

const typed = (id: number, type: string, data = {}): Event => ({
  ...event(id),
  type,
  data,
  timestamp: new Date(Date.UTC(2026, 9, 3, 12, 0, id)).toISOString(),
});

test("dropped events are tallied by kind and carried across polls", async () => {
  const history = [
    typed(1, "tool.started", { name: "Bash" }),
    typed(2, "tool.started", { name: "Bash" }),
    typed(3, "tool.started", { name: "Edit" }),
    typed(4, "agent.message", { role: "assistant" }),
    typed(5, "task.failed"),
    ...Array.from({ length: EVENT_TAIL_SIZE }, (_, i) => event(i + 6)),
  ];

  const first = await readEventTail(
    "task",
    [],
    async (after) => (after ? [] : history),
    () => true,
  );

  assert.equal(first.events.length, EVENT_TAIL_SIZE);
  assert.equal(first.dropped?.count, 5);
  assert.equal(first.dropped?.toolCalls, 3);
  assert.deepEqual(first.dropped?.tools, { Bash: 2, Edit: 1 });
  assert.equal(first.dropped?.messages, 1);
  assert.equal(first.dropped?.failures, 1);
  // A later poll adds to the same tally rather than starting over.
  const next = event(1000);

  const second = await readEventTail(
    "task",
    first.events,
    async (after) => (after < 1000 ? [next] : []),
    () => true,
    first.dropped,
  );

  assert.equal(second.dropped?.count, 6);
  assert.equal(first.dropped?.count, 5, "the previous summary is not mutated");
});

test("a summary from another history is not reused", async () => {
  const stale = (
    await readEventTail(
      "task",
      [],
      async (after) =>
        after
          ? []
          : Array.from({ length: EVENT_TAIL_SIZE + 3 }, (_, i) => event(i + 1)),
      () => true,
    )
  ).dropped;

  const fresh = await readEventTail(
    "task",
    [],
    async () => [],
    () => true,
    stale,
  );

  assert.equal(fresh.dropped, undefined);
});

test("the dropped note names the span, tools and trouble", () => {
  const { headline, details } = describeDropped({
    task_id: "task",
    count: 1284,
    from: "2026-10-03T12:00:00.000Z",
    to: "2026-10-03T12:09:40.000Z",
    toolCalls: 412,
    tools: { Bash: 190, Edit: 88, Read: 60, Grep: 40, Glob: 34 },
    messages: 31,
    failures: 1,
    retries: 2,
    artifacts: 0,
  });

  assert.equal(headline, "1,284 earlier events over 9m 40s not shown.");

  assert.deepEqual(details, [
    "412 tool calls (Bash 190, Edit 88, Read 60, +2 more)",
    "31 messages",
    "1 failure",
    "2 retries",
  ]);
});
