import assert from "node:assert/strict";

import { test, vi } from "vitest";

import { type Event } from "../../../../shared/events/types.js";
import {
  EVENT_TAIL_SIZE,
  windowActivity,
  windowTurnActivity,
} from "../../../../shared/tasks/activity/activity-tail.js";
import { startSchema, type Task } from "../../../../shared/tasks/model.js";
import { ActivityPages } from "./activity-pages.js";
import { Store } from "./store.js";

function fixture() {
  const store = new Store(":memory:");

  const task: Task = {
    ...startSchema.parse({ repository: "/repo", description: "Activity" }),
    title: "Activity",
    id: "activity",
    owner: "alice",
    status: "running",
    created_at: "now",
    updated_at: "now",
    instructions: [],
    created_by: "user",
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 1,
    runtime_ms: 0,
  };

  store.save(task);

  // Every third event is a tool call, so the tally has both kinds to count.
  let written = 0;

  const write = (count: number) => {
    for (let i = 0; i < count; i++) {
      const n = written++;

      if (n % 3 === 0) {
        store.event(task, "tool.started", { name: "Bash" });
      } else {
        store.event(task, "agent.message", {
          role: "assistant",
          text: "Activity page message",
        });
      }
    }
  };

  return { store, task, write };
}

/** Every event of a task, read a page at a time. */
function everything(store: Store, id: string) {
  const all: Event[] = [];

  for (let after = 0; ;) {
    const page = store.taskEvents(id, after);
    if (!page.length) return all;

    all.push(...page);
    after = page.at(-1)!.id;
  }
}

test("a page is the newest window and the tally of the rest", () => {
  const { store, task, write } = fixture();
  write(EVENT_TAIL_SIZE + 250);

  const page = new ActivityPages(store).page(task.id, 0),
    log = everything(store, task.id);

  assert.deepEqual(page, windowActivity(log));
  assert.equal(page.events.length, EVENT_TAIL_SIZE);
  assert.equal(page.dropped?.count, 250);
});

test("a poll returns only the events after its cursor and extends the tally", () => {
  const { store, task, write } = fixture();
  write(EVENT_TAIL_SIZE + 10);

  const pages = new ActivityPages(store),
    first = pages.page(task.id, 0),
    cursor = first.events.at(-1)!.id;

  write(1200);

  const next = pages.page(task.id, cursor),
    log = everything(store, task.id);

  assert.deepEqual(next, windowActivity(log, cursor));
  assert.equal(next.events.length, EVENT_TAIL_SIZE);
});

test("a poll with nothing new does not count the history again", () => {
  const { store, task, write } = fixture();
  write(EVENT_TAIL_SIZE + 500);

  const pages = new ActivityPages(store),
    first = pages.page(task.id, 0),
    cursor = first.events.at(-1)!.id,
    read = vi.spyOn(store, "taskEvents");

  const again = pages.page(task.id, cursor);

  // One probe for events past the tally, and one read of the window.
  assert.equal(read.mock.calls.length, 2);
  assert.deepEqual(again.dropped, first.dropped);
  assert.deepEqual(again.events, []);
});

test("a turn reads from the previous turn's close through its own close", () => {
  const { store, task, write } = fixture();

  const end = (turn: number) => {
    store.event(task, "task.turn_ended", {
      turn,
      outcome: "completed",
      runtime_ms: 1,
      cost_usd: 0,
    });

    // Queue changes can come between the end and the status that closes it.
    store.event(task, "agent.content", { role: "user", content: [] });
    store.event(task, "task.completed", {});
  };

  write(5);
  end(1);
  write(EVENT_TAIL_SIZE + 30);
  end(2);
  write(4);
  end(3);
  write(3);

  const pages = new ActivityPages(store),
    log = everything(store, task.id),
    second = pages.turn(task.id, 2);

  assert.deepEqual(second, windowTurnActivity(log, 2));
  assert.equal(second.events.length, EVENT_TAIL_SIZE);
  assert.equal(second.dropped?.count, 33);
  assert.equal(second.events.at(-1)!.type, "task.completed");

  assert.deepEqual(pages.turn(task.id, 1), windowTurnActivity(log, 1));
  assert.equal(pages.turn(task.id, 1).events.length, 8);
  assert.equal(pages.turn(task.id, 3).events.length, 7);
  assert.equal(pages.turn(task.id, 3).dropped, undefined);

  // A turn that has not ended runs to the newest event.
  assert.deepEqual(pages.turn(task.id, 4), windowTurnActivity(log, 4));
  assert.equal(pages.turn(task.id, 4).events.length, 3);
});
