import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, type TestContext } from "vitest";

import { openDatabase } from "../../../platform/database/database.js";
import { events, tasks } from "./schema.js";
import { decodeEvent } from "./stored.js";

function storedEvent(
  t: TestContext,
  data = '{"turn":1,"future":{"nested":[1,null]}}',
) {
  const dir = mkdtempSync(join(tmpdir(), "stored-event-"));
  const db = openDatabase(join(dir, "service.sqlite"));

  t.onTestFinished(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  db.orm
    .insert(tasks)
    .values({ id: "task-1", owner: "chat-1", body: "{}" })
    .run();

  db.orm
    .insert(events)
    .values({
      task_id: "task-1",
      type: "task.started",
      timestamp: "2026-10-09T00:00:00.000Z",
      data,
    })
    .run();

  const row = db.orm.select().from(events).get();
  assert.ok(row);

  return row;
}

test("decodes event rows without changing metadata or arbitrary JSON fields", (t) => {
  const {
    original_response: _capture,
    response_ref: _id,
    chat: _chat,
    ...row
  } = storedEvent(t);

  expect(decodeEvent(row)).toEqual({
    ...row,
    data: { turn: 1, future: { nested: [1, null] } },
    view: { kind: "known", type: "task.started", data: { turn: 1 } },
  });
});

test("incomplete known payloads remain opaque without losing their fields", (t) => {
  const row = storedEvent(
    t,
    JSON.stringify({ turn: "two", outcome: "completed" }),
  );

  const decoded = decodeEvent({ ...row, type: "task.turn_ended" });

  expect(decoded.view).toEqual({
    kind: "opaque",
    type: "task.turn_ended",
    data: { turn: "two", outcome: "completed" },
  });

  expect(decoded.data).toEqual({ turn: "two", outcome: "completed" });
});

test("names an event with corrupt row metadata before decoding its JSON", (t) => {
  const row = storedEvent(t, "invalid JSON");

  expect(() =>
    decodeEvent({ ...row, type: 42 } as unknown as typeof events.$inferSelect),
  ).toThrow(`Stored event ${row.id} is malformed:`);
});

test("retains the named invalid JSON error for an otherwise valid event row", (t) => {
  const row = storedEvent(t, "invalid JSON");

  expect(() => decodeEvent(row)).toThrow(
    `Stored event ${row.id} is not valid JSON`,
  );
});
