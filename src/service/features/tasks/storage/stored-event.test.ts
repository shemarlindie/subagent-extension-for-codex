import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, type TestContext } from "vitest";

import { openDatabase } from "../../../platform/database/database.js";
import { events, tasks } from "./schema.js";
import { decodeEvent } from "./stored.js";

function storedEvent(t: TestContext, data = '{"future":{"nested":[1,null]}}') {
  const dir = mkdtempSync(join(tmpdir(), "stored-event-"));
  const db = openDatabase(join(dir, "console.sqlite"));

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

  return db.orm.select().from(events).get()!;
}

test("decodes event rows without changing metadata or arbitrary JSON fields", (t) => {
  const row = storedEvent(t);

  expect(decodeEvent(row)).toEqual({
    ...row,
    data: { future: { nested: [1, null] } },
    view: { kind: "known", type: "task.started", data: {} },
  });
});

test("validated event views preserve complete raw payload data", (t) => {
  const rawResponse = {
    type: "assistant",
    uuid: "sdk-message",
    message: { id: "message-id", content: [{ type: "text", text: "Done" }] },
  };

  const row = storedEvent(
    t,
    JSON.stringify({
      role: "assistant",
      text: "Done",
      raw_response: rawResponse,
    }),
  );

  const decoded = decodeEvent({ ...row, type: "agent.message" });

  expect(decoded.view).toEqual({
    kind: "known",
    type: "agent.message",
    data: { role: "assistant", text: "Done" },
  });

  expect(decoded.data.raw_response).toEqual(rawResponse);
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

test("retains named body validation for valid JSON that is not an object", (t) => {
  const row = storedEvent(t, "[]");

  expect(() => decodeEvent(row)).toThrow(
    `Stored event ${row.id} is malformed:`,
  );
});
