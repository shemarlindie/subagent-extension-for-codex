import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { test } from "vitest";

import { type DraftUpdate } from "../../../../shared/tasks/conversation/drafts.js";
import { Drafts } from "./drafts.js";

test("drafts grow by deltas, start over for another message and publish each change", () => {
  const bus = new EventEmitter();
  const updates: [DraftUpdate, string][] = [];
  bus.on("draft", (update, owner) => updates.push([update, owner]));
  const drafts = new Drafts(bus);

  drafts.append("alice", "t1", "m1", "Hel");
  drafts.append("alice", "t1", "m1", "lo");
  assert.deepEqual(drafts.get("t1"), { message_id: "m1", text: "Hello" });
  drafts.append("bob", "t2", "m9", "Other");

  assert.deepEqual(drafts.forOwner("alice"), [
    { task_id: "t1", message_id: "m1", text: "Hello" },
  ]);

  // Another message's clear leaves the draft; its own clears it.
  drafts.clear("t1", "m0");
  assert.ok(drafts.get("t1"));
  drafts.append("alice", "t1", "m2", "Next");
  drafts.clear("t1", "m2");
  assert.equal(drafts.get("t1"), undefined);

  assert.deepEqual(updates, [
    [{ task_id: "t1", message_id: "m1", offset: 0, text: "Hel" }, "alice"],
    [{ task_id: "t1", message_id: "m1", offset: 3, text: "lo" }, "alice"],
    [{ task_id: "t2", message_id: "m9", offset: 0, text: "Other" }, "bob"],
    [{ task_id: "t1", message_id: "m2", offset: 0, text: "Next" }, "alice"],
    [{ task_id: "t1", message_id: "m2", cleared: true }, "alice"],
  ]);
});

/** Fails unless `wait` ends well before its 5-second limit. */
async function promptly(wait: Promise<void>) {
  const started = Date.now();
  await wait;
  assert.ok(Date.now() - started < 1000);
}

test("a draft read waits for growth or a clear, or times out", async () => {
  const bus = new EventEmitter();
  const drafts = new Drafts(bus);
  drafts.append("alice", "t", "m", "Hi");

  // Already ahead of the reader: returns at once.
  assert.ok(drafts.differs("t", { length: 0 }));
  await promptly(drafts.wait("t", { length: 0 }, 5000));

  const grown = drafts.wait("t", { message_id: "m", length: 2 }, 5000);

  drafts.append("alice", "t", "m", " there");
  await promptly(grown);

  const cleared = drafts.wait("t", { message_id: "m", length: 8 }, 5000);

  drafts.clear("t");
  await promptly(cleared);

  const started = Date.now();
  assert.ok(!drafts.differs("t", { length: 0 }));
  await drafts.wait("t", { length: 0 }, 50);
  assert.ok(Date.now() - started >= 40);
  assert.equal(bus.listenerCount("draft"), 0);
});

test("a draft wait ends when its wake signal aborts", async () => {
  const bus = new EventEmitter();
  const drafts = new Drafts(bus);
  drafts.append("alice", "t", "m", "Hi");
  const known = { message_id: "m", length: 2 };

  const wake = new AbortController();
  const waiting = drafts.wait("t", known, 5000, wake.signal);
  wake.abort();
  await promptly(waiting);
  assert.equal(bus.listenerCount("draft"), 0);

  // An aborted signal returns at once.
  await promptly(drafts.wait("t", known, 5000, wake.signal));
});
