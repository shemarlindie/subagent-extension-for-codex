import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, vi } from "vitest";

import { type Event } from "../../../../shared/events/types.js";
import { startSchema, type Task } from "../../../../shared/tasks/model.js";
import { useIncrementalVacuum } from "../../../platform/database/database.js";
import * as logging from "../../../platform/logging/logger.js";
import { ParentSeenStore } from "./parent-seen-store.js";
import { Store } from "./store.js";

function deletionFixture() {
  const store = new Store(":memory:");

  const task: Task = {
    ...startSchema.parse({ repository: "/repo", description: "Delete" }),
    title: "Delete",
    id: "delete",
    owner: "alice",
    status: "completed",
    created_at: "now",
    updated_at: "now",
    created_by: "user",
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 1,
    runtime_ms: 0,
  };

  for (const id of [task.id, `${task.id}_1`, "unrelated"]) {
    const current = { ...task, id };
    store.save(current);
    store.event(current, "task.completed", {});
  }

  const snapshot = () =>
    Object.fromEntries(
      ["tasks", "events"].map((table) => [
        table,
        store.database.client
          .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
          .all(),
      ]),
    );

  return { store, task, snapshot };
}

test("task deletion removes events and preserves other tasks, including matching prefixes", (t) => {
  const { store, task, snapshot } = deletionFixture();
  t.onTestFinished(() => store.close());
  const before = snapshot();
  assert.throws(() => store.delete(task.id, "bob"), /Task not found/);
  assert.deepEqual(snapshot(), before);

  store.delete(task.id, task.owner);
  assert.throws(() => store.get(task.id, task.owner), /Task not found/);
  const after = snapshot();

  for (const table of ["tasks", "events"]) {
    const rows = after[table];
    assert.ok(rows, table);
    assert.equal(rows.length, 2, table);
  }

  assert.equal(store.get(`${task.id}_1`, task.owner).id, `${task.id}_1`);
  assert.equal(store.events(`${task.id}_1`, task.owner).length, 1);
});

test("task deletion returns its pages once the database uses incremental vacuum", (t) => {
  const { store, task } = deletionFixture();
  t.onTestFinished(() => store.close());
  useIncrementalVacuum(store.database);
  store.eventOpaque(task, "claude.activity", { text: "x".repeat(500_000) });

  const pages = () =>
    store.database.client.prepare("PRAGMA page_count").get()?.page_count;

  const before = pages();

  store.delete(task.id, task.owner);
  assert.ok(Number(pages()) < Number(before));

  assert.equal(
    store.database.client.prepare("PRAGMA freelist_count").get()
      ?.freelist_count,
    0,
  );
});

test("task deletion leaves every record in place if deleting the task fails", (t) => {
  const { store, task, snapshot } = deletionFixture();
  t.onTestFinished(() => store.close());
  const before = snapshot();

  store.database.client.exec(
    "CREATE TRIGGER reject_task_delete BEFORE DELETE ON tasks BEGIN SELECT RAISE(ABORT, 'delete failed'); END",
  );

  assert.throws(() => store.delete(task.id, task.owner), /delete failed/);
  assert.deepEqual(snapshot(), before);
  store.database.client.exec("DROP TRIGGER reject_task_delete");
  store.delete(task.id, task.owner);
  assert.throws(() => store.get(task.id, task.owner), /Task not found/);
});

test("recent events return only the task's latest 200 in chronological order after owner checks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "task-recent-events-"));
  const store = new Store(join(dir, "tasks.sqlite"));

  const task: Task = {
    ...startSchema.parse({
      repository: "/repo",
      description: "Review",
      worker_profile: "reviewer",
    }),
    title: "Review",
    id: "recent",
    owner: "alice",
    status: "running",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    created_by: "user",
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 1,
    runtime_ms: 0,
  };

  try {
    store.save(task);
    const other = { ...task, id: "other" };
    store.save(other);
    assert.deepEqual(store.recentEvents(task.id, task.owner), []);
    const expected = [];

    for (let index = 0; index < 205; index++) {
      expected.push(
        store.event(task, "agent.message", {
          role: "assistant",
          text: String(index),
        }),
      );

      store.event(other, "agent.message", {
        role: "assistant",
        text: `unrelated ${index}`,
      });
    }

    assert.deepEqual(
      store.recentEvents(task.id, task.owner),
      expected.slice(-200),
    );

    assert.throws(() => store.recentEvents(task.id, "bob"), /Task not found/);

    assert.throws(
      () => store.recentEvents("missing", task.owner),
      /Task not found/,
    );
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

function transactionFixture(t: { onTestFinished(fn: () => void): void }) {
  const store = new Store(":memory:");
  t.onTestFinished(() => store.close());

  const task: Task = {
    ...startSchema.parse({ repository: "/repo", description: "Transact" }),
    title: "Transact",
    id: "transact",
    owner: "alice",
    status: "queued",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    created_by: "user",
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 0,
    runtime_ms: 0,
  };

  store.save(task);
  const heard: string[] = [];
  store.bus.on("event", (e: Event) => heard.push(e.type));

  return { store, task, heard };
}

test("opaque provider events persist and notify with their raw payload", (t) => {
  const { store, task, heard } = transactionFixture(t);
  const payload = { subtype: "future_activity", nested: { retained: true } };
  let created: Event | undefined;

  store.transaction(() => {
    created = store.eventOpaque(task, "claude.activity", payload);
    assert.deepEqual(heard, []);
  });

  assert.equal(created?.view.kind, "opaque");
  assert.deepEqual(created?.data, payload);
  assert.deepEqual(heard, ["claude.activity"]);
  assert.deepEqual(store.events(task.id, task.owner), [created]);
});

test("a failed transaction leaves state and events unwritten, notifies nobody and restores updated_at", (t) => {
  const { store, task, heard } = transactionFixture(t);
  const updated = task.updated_at;

  assert.throws(
    () =>
      store.transaction(() => {
        task.status = "running";
        store.save(task);
        store.event(task, "task.started");
        throw new Error("write failed");
      }),
    /write failed/,
  );

  assert.equal(task.updated_at, updated);
  assert.equal(store.get(task.id, task.owner).status, "queued");
  assert.deepEqual(store.events(task.id, task.owner), []);
  assert.deepEqual(heard, []);
});

test("transactions reject nesting and asynchronous callbacks", (t) => {
  const { store, task, heard } = transactionFixture(t);

  assert.throws(
    () =>
      store.transaction(() => {
        store.event(task, "task.started");
        store.transaction(() => {});
      }),
    /already open/,
  );

  assert.throws(
    () =>
      store.transaction(async () => {
        store.event(task, "task.started");
      }),
    /must be synchronous/,
  );

  assert.deepEqual(store.events(task.id, task.owner), []);
  assert.deepEqual(heard, []);

  // The store is usable again after both.
  store.transaction(() => store.event(task, "task.started"));
  assert.deepEqual(heard, ["task.started"]);
});

test("a failing listener neither undoes the commit nor stops other listeners", (t) => {
  const { store, task, heard } = transactionFixture(t);

  store.bus.prependListener("event", () => {
    throw new Error("listener failed");
  });

  store.transaction(() => {
    store.save(task);
    store.event(task, "task.started");
  });

  store.event(task, "task.completed");
  assert.deepEqual(heard, ["task.started", "task.completed"]);
  assert.equal(store.events(task.id, task.owner).length, 2);
});

test("a transaction announces one change per owner after it commits, and a rollback none", (t) => {
  const { store, task } = transactionFixture(t);
  const changes: (string | undefined)[] = [];
  store.bus.on("change", (owner?: string) => changes.push(owner));
  const before = store.revision("alice");
  const other = { ...task, id: "other", owner: "bob" };

  store.transaction(() => {
    store.save(task);
    store.event(task, "task.started");
    store.save(other);
    store.event(task, "task.queue_changed", { queue: [], paused: false });
    assert.deepEqual(changes, []);
  });

  assert.deepEqual(changes, ["alice", "bob"]);
  const committed = store.revision("alice");
  assert.notEqual(committed, before);

  assert.throws(() =>
    store.transaction(() => {
      store.save(task);
      throw new Error("write failed");
    }),
  );

  assert.deepEqual(changes, ["alice", "bob"]);
  assert.equal(store.revision("alice"), committed);

  // A later transaction still announces after the rollback.
  store.transaction(() => store.event(task, "task.completed"));
  assert.deepEqual(changes, ["alice", "bob", "alice"]);
});

test("writes outside a transaction, and deletions, change only their owner's revision", (t) => {
  const { store, task } = transactionFixture(t);
  const other = { ...task, id: "other", owner: "bob" };
  store.save(other);
  const alice = store.revision("alice");
  const bob = store.revision("bob");

  store.event(task, "task.started");
  assert.notEqual(store.revision("alice"), alice);
  assert.equal(store.revision("bob"), bob);

  store.delete(other.id, "bob");
  assert.notEqual(store.revision("bob"), bob);
});

test("a project change reaches every owner, and another store's revisions differ", (t) => {
  const { store } = transactionFixture(t);
  const changes: (string | undefined)[] = [];
  store.bus.on("change", (owner?: string) => changes.push(owner));
  const alice = store.revision("alice");
  const bob = store.revision("bob");

  store.projectsChanged();
  assert.deepEqual(changes, [undefined]);
  assert.notEqual(store.revision("alice"), alice);
  assert.notEqual(store.revision("bob"), bob);

  // A restarted service starts counting again, under another boot id.
  const restarted = new Store(":memory:");
  t.onTestFinished(() => restarted.close());
  assert.notEqual(restarted.revision("bob"), bob);
});

test("stored tasks round-trip open provider state, and malformed ones fail with their id", (t) => {
  const { store, task } = transactionFixture(t);

  const withState = {
    ...task,
    provider_options: { claude: { approval_decider: "user" } },
    provider_state: { nested: [1, { kept: true }] },
  };

  store.save(withState);
  assert.deepEqual(store.get(task.id, task.owner), withState);

  const insert = store.database.client.prepare(
    "INSERT INTO tasks(id,owner,body) VALUES(?,?,?)",
  );

  const { owner: _owner, ...ownerless } = task;

  insert.run(
    "ownerless",
    "alice",
    JSON.stringify({ ...ownerless, id: "ownerless" }),
  );

  assert.throws(
    () => store.get("ownerless", "alice"),
    /Stored task ownerless is malformed: .*owner/s,
  );

  // A list reports the bad record rather than hiding it.
  assert.throws(() => store.list("alice", {}), /Stored task ownerless/);
});

test("stored events whose data isn't a JSON object fail with their id", (t) => {
  const { store, task } = transactionFixture(t);

  const { lastInsertRowid } = store.database.client
    .prepare("INSERT INTO events(task_id,type,timestamp,data) VALUES(?,?,?,?)")
    .run(task.id, "task.started", "now", "[1]");

  assert.throws(
    () => store.events(task.id, task.owner),
    new RegExp(`Stored event ${lastInsertRowid} is malformed`),
  );
});

test("execution storage counts committed UTF-8 JSON once and releases its counters after settlement", (t) => {
  const { store, task } = transactionFixture(t);
  const log = vi.spyOn(logging, "logEvent").mockImplementation(() => {});
  const before = store.event(task, "task.started").id;
  const other = { ...task, id: "unrelated" };
  store.save(other);
  const finish = store.beginEventStorage(task.id, 1);
  let serializations = 0;

  store.transaction(() => {
    store.eventOpaque(task, "fixture.activity", {
      response_ref: "fixture-response",
      raw_response: { fixture: true },
      content: {
        toJSON() {
          serializations++;

          return "é🧪";
        },
      },
    });

    store.eventOpaque(task, "agent.message", {
      role: "assistant",
      text: "日本語",
      raw_response: undefined,
    });

    store.event(other, "task.started");
  });

  expect(() =>
    store.transaction(() => {
      store.eventOpaque(task, "fixture.activity", {
        raw_response: { rolled_back: true },
      });

      throw new Error("rollback");
    }),
  ).toThrow("rollback");

  // Read the persisted strings independently of the production byte counter.
  const committed = store.database.client
    .prepare(
      "SELECT data, original_response FROM events WHERE task_id = ? AND id > ? ORDER BY id",
    )
    .all(task.id, before) as {
    data: string;
    original_response: string | null;
  }[];

  const bytes = committed.reduce(
    (total, row) =>
      total +
      new TextEncoder().encode(row.data + (row.original_response ?? "")).length,
    0,
  );

  finish("completed");
  expect(serializations).toBe(1);

  expect(log).toHaveBeenLastCalledWith("info", "task.event_storage", {
    task_id: task.id,
    turn: 1,
    status: "completed",
    event_count: 2,
    json_bytes: bytes,
    original_response_event_count: 1,
  });

  store.event(task, "task.completed");
  finish("completed");

  expect(
    log.mock.calls.filter(([, event]) => event === "task.event_storage"),
  ).toHaveLength(1);

  const next = store.beginEventStorage(task.id, 2);
  store.event(task, "task.started");
  next("interrupted");

  expect(log).toHaveBeenLastCalledWith("info", "task.event_storage", {
    task_id: task.id,
    turn: 2,
    status: "interrupted",
    event_count: 1,
    json_bytes: 2,
    original_response_event_count: 0,
  });
});

test("a failed storage summary cannot change settlement or leave its counters active", (t) => {
  const { store, task } = transactionFixture(t);

  const log = vi.spyOn(logging, "logEvent").mockImplementation(() => {
    throw new Error("diagnostics unavailable");
  });

  const finish = store.beginEventStorage(task.id, 1);
  store.event(task, "task.started");
  expect(() => finish("failed")).not.toThrow();
  log.mockReset();
  store.event(task, "task.completed");
  finish("failed");
  expect(log).not.toHaveBeenCalled();

  store.beginEventStorage(task.id, 2)("completed");

  expect(log).toHaveBeenCalledExactlyOnceWith("info", "task.event_storage", {
    task_id: task.id,
    turn: 2,
    status: "completed",
    event_count: 0,
    json_bytes: 0,
    original_response_event_count: 0,
  });
});

test("original responses resolve across pages by indexed task-authorized lookup", async (t) => {
  const { claudeMessageNormalizer } =
    await import("../../providers/claude/events/normalize.js");

  const normalize = claudeMessageNormalizer(true);

  const { store, task } = deletionFixture();
  t.onTestFinished(() => store.close());
  let serializations = 0;

  const context = {
    emit: (type: string, data: Record<string, unknown>) =>
      store.eventOpaque(task, type, data),
    emitOpaque: (type: string, data: Record<string, unknown>) =>
      store.eventOpaque(task, type, data),
  } as unknown as import("../../providers/types.js").RunContext;

  const delivery = (marker: string) => ({
    type: "assistant",
    uuid: "same-uuid",
    parent_tool_use_id: null,
    message: {
      id: "same-assistant-id",
      content: [
        { type: "text", text: "one" },
        { type: "text", text: "two" },
        {
          type: "tool_use",
          id: "read",
          name: "Read",
          input: { file_path: "a" },
        },
      ],
    },
    unique: marker,
    toJSON() {
      serializations++;
      const { toJSON: _, ...value } = this;

      return value;
    },
  });

  const first = delivery("first");

  normalize(
    context,
    first as unknown as import("@anthropic-ai/claude-agent-sdk").SDKMessage,
  );

  const siblings = store.events(task.id, task.owner).slice(-3);
  const responseRef = String(siblings[0]?.data.response_ref);
  assert.equal(serializations, 1);

  assert.ok(
    siblings.every(
      (event) =>
        event.data.response_ref === responseRef && !event.data.raw_response,
    ),
  );

  for (let i = 0; i < 1001; i++) store.event(task, "task.started", { turn: 1 });

  normalize(
    context,
    delivery(
      "second",
    ) as unknown as import("@anthropic-ai/claude-agent-sdk").SDKMessage,
  );

  assert.equal(serializations, 2);

  assert.ok(
    !store
      .recentEvents(task.id, task.owner)
      .some((event) => event.data.response_ref === responseRef),
  );

  assert.equal(
    (
      store.originalResponse(task.id, task.owner, responseRef) as {
        unique: string;
      }
    ).unique,
    "first",
  );

  assert.throws(
    () => store.originalResponse(task.id, "bob", responseRef),
    /Task not found/,
  );

  assert.equal(
    store.originalResponse("unrelated", task.owner, responseRef),
    undefined,
  );

  assert.equal(
    store.originalResponse(task.id, task.owner, "missing"),
    undefined,
  );

  const captures = store.database.client
    .prepare(
      "SELECT response_ref FROM events WHERE original_response IS NOT NULL",
    )
    .all();

  assert.equal(captures.length, 2);
  assert.notEqual(captures[0]?.response_ref, captures[1]?.response_ref);

  const plan = store.database.client
    .prepare(
      "EXPLAIN QUERY PLAN SELECT original_response FROM events WHERE response_ref=? AND task_id=?",
    )
    .all(responseRef, task.id);

  assert.match(String(plan[0]?.detail), /USING INDEX events_response/);
});

test("task and typed event reads search indexes instead of scanning tasks or events", (t) => {
  const { store, task } = transactionFixture(t);
  const parentSeen = new ParentSeenStore(store);
  const client = store.database.client;
  const prepare = client.prepare.bind(client);

  const plan = (read: () => unknown) => {
    const statements: string[] = [];

    const spy = vi.spyOn(client, "prepare").mockImplementation((sql) => {
      statements.push(sql);

      return prepare(sql);
    });

    try {
      read();
    } finally {
      spy.mockRestore();
    }

    return statements.flatMap((sql) =>
      prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all()
        .map((row) => String(row.detail)),
    );
  };

  const reads: [string, () => unknown, RegExp[]][] = [
    ["readState", () => store.readState(task.id), [/events_task_type/]],
    [
      "latestEvent",
      () => store.latestEvent(task.id, "agent.reply"),
      [/events_task_type/],
    ],
    ["turnEnded", () => store.turnEnded(task.id, 1), [/events_task_type/]],
    [
      "nextEventOfType",
      () => store.nextEventOfType(task.id, 0, ["task.turn_ended"]),
      [/events_task_type/],
    ],
    [
      "unseen",
      () => parentSeen.unseen(task.owner, "chat"),
      [/tasks_owner_conversation/, /events_task_type/],
    ],
    ["list", () => store.list(task.owner, {}), [/tasks_owner_created/]],
    [
      "list without archived tasks",
      () => store.list(task.owner, { archived: "exclude", include: [task.id] }),
      [/tasks_owner_created/, /task_archive/],
    ],
    [
      "list in a conversation",
      () => store.list(task.owner, { conversation: "chat", repository: "/r" }),
      [/tasks_owner_conversation/],
    ],
    [
      "readCompletedFlags",
      () => store.readCompletedFlags(task.owner, { archived: "exclude" }),
      [/tasks_owner_created/, /events_task_type/, /task_read/],
    ],
    [
      "latestInConversation",
      () => store.latestInConversation(task.owner, "chat"),
      [/tasks_owner_conversation/],
    ],
    [
      "withStatus",
      () => store.withStatus(["queued", "waiting"]),
      [/tasks_status/],
    ],
    ["chatEvents", () => store.chatEvents(task.id), [/events_task_chat/]],
    [
      "readStates",
      () => store.readStates(task.owner, {}),
      [/tasks_owner_/, /events_task_type/],
    ],
    [
      "latestEvents",
      () =>
        store.latestEvents(task.owner, "agent.reply", { conversation: "c" }),
      [/tasks_owner_conversation/, /events_task_type/],
    ],
  ];

  for (const [name, read, indexes] of reads) {
    const details = plan(read);

    for (const detail of details) {
      assert.doesNotMatch(detail, /^SCAN (events|tasks)\b/, name);
    }

    for (const index of indexes) {
      assert.ok(
        details.some((detail) => /^SEARCH/.test(detail) && index.test(detail)),
        `${name}: ${details.join("; ")}`,
      );
    }
  }
});
