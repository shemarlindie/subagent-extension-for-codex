import assert from "node:assert/strict";

import { test } from "vitest";

import { decodedEvent } from "../../../../shared/events/decode";
import type { Event } from "../../../app/state/types";
import {
  activityCursor,
  describeDropped,
  EVENT_TAIL_SIZE,
  mergeActivity,
  turnStart,
} from "./event-history";

const event = (id: number, task_id = "task"): Event =>
  decodedEvent({
    id,
    task_id,
    timestamp: "2026-10-03T12:00:00.000Z",
    type: "status",
    data: {},
  });

const dropped = {
  task_id: "task",
  count: 5,
  from: "2026-10-03T12:00:00.000Z",
  to: "2026-10-03T12:00:05.000Z",
  toolCalls: 3,
  tools: { Bash: 2, Edit: 1 },
  messages: 1,
  failures: 1,
  retries: 0,
};

test("an empty page keeps the same events array", () => {
  const previous = [event(1), event(2)];

  const view = mergeActivity({ events: previous }, "task", {
    events: [],
  });

  assert.ok(view.events === previous, "Unchanged views can skip rendering");
});

test("new events append and keep only the most recent tail", () => {
  const previous = [event(1)];
  const page = Array.from({ length: EVENT_TAIL_SIZE }, (_, i) => event(i + 2));

  const view = mergeActivity({ events: previous }, "task", {
    events: page,
  });

  const [oldest] = view.events;
  assert.equal(view.events.length, EVENT_TAIL_SIZE);
  assert.ok(oldest);
  assert.equal(oldest.id, 2);
  assert.equal(view.events.at(-1)!.id, EVENT_TAIL_SIZE + 1);
  assert.equal(activityCursor(view.events, "task"), EVENT_TAIL_SIZE + 1);
});

test("events from another task are dropped rather than reused", () => {
  const view = mergeActivity({ events: [event(1, "other")] }, "task", {
    events: [],
  });

  assert.deepEqual(view.events, []);
  assert.equal(activityCursor(view.events, "task"), 0);
});

test("the tally is the service's, and an unchanged one keeps its identity", () => {
  const previous = { events: [event(1)], dropped };

  const same = mergeActivity(previous, "task", {
    events: [],
    dropped: { ...dropped },
  });

  assert.ok(
    same.dropped === previous.dropped,
    "Unchanged notes skip rendering",
  );

  const grown = mergeActivity(previous, "task", {
    events: [],
    dropped: { ...dropped, count: 6 },
  });

  assert.equal(grown.dropped?.count, 6);
});

test("a page without a tally clears the note", () => {
  const view = mergeActivity({ events: [event(1)], dropped }, "task", {
    events: [],
  });

  assert.equal(view.dropped, undefined);
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
  });

  assert.equal(headline, "1,284 earlier events over 9m 40s not shown.");

  assert.deepEqual(details, [
    "412 tool calls (Bash 190, Edit 88, Read 60, +2 more)",
    "31 messages",
    "1 failure",
    "2 retries",
  ]);
});

test("a turn starts after the event that closed the previous turn", () => {
  const typed = (id: number, type: string, data = {}): Event =>
    decodedEvent({
      ...event(id),
      type,
      data,
    });

  const events = [
    typed(1, "task.started", { turn: 1 }),
    typed(2, "task.turn_ended", {
      turn: 1,
      outcome: "completed",
      runtime_ms: 0,
      cost_usd: 0,
    }),
    // A queued message delivered as turn 1 ends, before the status that closes it.
    typed(3, "task.instruction"),
    typed(4, "task.completed"),
    typed(5, "task.instruction"),
    typed(6, "task.queued"),
    typed(7, "task.started", { turn: 2 }),
    typed(8, "task.turn_ended", {
      turn: 2,
      outcome: "completed",
      runtime_ms: 0,
      cost_usd: 0,
    }),
    typed(9, "task.started", { turn: 3 }),
  ];

  assert.equal(turnStart({ events }, 1), 1);
  assert.equal(turnStart({ events }, 2), 5);
  assert.equal(turnStart({ events }, 3), undefined, "Turn 3 has not ended");

  // With earlier events dropped, the first turn's start may be among them.
  assert.equal(turnStart({ events: events.slice(1), dropped }, 1), undefined);
  assert.equal(turnStart({ events: events.slice(1), dropped }, 2), 5);
  assert.equal(turnStart({ events: events.slice(2), dropped }, 2), undefined);
});
