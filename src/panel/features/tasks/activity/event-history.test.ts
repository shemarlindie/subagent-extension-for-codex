import assert from "node:assert/strict";

import { test } from "vitest";

import type { Event } from "../../../app/state/types";
import {
  activityCursor,
  describeDropped,
  EVENT_TAIL_SIZE,
  mergeActivity,
} from "./event-history";

const event = (id: number, task_id = "task"): Event => ({
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

  assert.equal(view.events.length, EVENT_TAIL_SIZE);
  assert.equal(view.events[0].id, 2);
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
