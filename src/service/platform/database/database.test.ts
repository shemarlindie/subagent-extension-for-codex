import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { test } from "vitest";

import { events } from "../../features/tasks/storage/schema.js";
import { migrationsFolder, openDatabase } from "./database.js";

function scratch(t: { onTestFinished(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), "database-"));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));

  return dir;
}

const tables = (client: DatabaseSync) =>
  client
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => String(row.name));

const ledger = (client: DatabaseSync) =>
  client
    .prepare("SELECT name FROM __drizzle_migrations ORDER BY id")
    .all()
    .map((row) => String(row.name));

test("a fresh database gets every active table and the connection settings", (t) => {
  const path = join(scratch(t), "data", "console.sqlite");
  const db = openDatabase(path);
  t.onTestFinished(() => db.close());

  assert.deepEqual(tables(db.client), [
    "__drizzle_migrations",
    "events",
    "project_roots",
    "tasks",
    "user_settings",
  ]);

  assert.equal(
    db.client.prepare("PRAGMA journal_mode").get()?.journal_mode,
    "wal",
  );

  assert.equal(db.client.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
});

test("reopening applies nothing twice and keeps existing rows", (t) => {
  const path = join(scratch(t), "console.sqlite");
  const first = openDatabase(path);

  first.client
    .prepare("INSERT INTO tasks VALUES(?,?,?)")
    .run("kept", "alice", "{}");

  const applied = ledger(first.client);
  first.close();

  const second = openDatabase(path);
  t.onTestFinished(() => second.close());
  assert.deepEqual(ledger(second.client), applied);

  assert.equal(
    second.client.prepare("SELECT COUNT(*) AS n FROM tasks").get()?.n,
    1,
  );
});

test("a database from before versioned migrations is refused and left untouched", (t) => {
  const path = join(scratch(t), "console.sqlite");
  const legacy = new DatabaseSync(path);

  legacy.exec(
    "CREATE TABLE tasks(id TEXT PRIMARY KEY, owner TEXT NOT NULL, body TEXT NOT NULL)",
  );

  legacy.close();

  assert.throws(
    () => openDatabase(path),
    /created by an unsupported earlier version\. Delete its data directory/,
  );

  const after = new DatabaseSync(path);
  t.onTestFinished(() => after.close());
  assert.deepEqual(tables(after), ["tasks"]);
});

test("a database migrated by a newer build is refused", (t) => {
  const path = join(scratch(t), "console.sqlite");
  const db = openDatabase(path);

  db.client
    .prepare(
      "INSERT INTO __drizzle_migrations(hash, created_at, name) VALUES('x', 0, ?)",
    )
    .run("29990101000000_future");

  db.close();

  assert.throws(
    () => openDatabase(path),
    /migrated by a newer version \(29990101000000_future\)/,
  );
});

test("a failing migration rolls back with its ledger entry, and applies once fixed", (t) => {
  const dir = scratch(t);
  const path = join(dir, "console.sqlite");
  const folder = join(dir, "migrations");
  cpSync(migrationsFolder, folder, { recursive: true });
  openDatabase(path, folder).close();
  const added = join(folder, "29990101000000_add_notes");
  mkdirSync(added);

  writeFileSync(
    join(added, "migration.sql"),
    "CREATE TABLE notes(id TEXT PRIMARY KEY);\n--> statement-breakpoint\nINSERT INTO missing VALUES(1);",
  );

  assert.throws(() => openDatabase(path, folder), /no such table: missing/);
  const failed = new DatabaseSync(path);
  assert.ok(!tables(failed).includes("notes"));
  assert.ok(!ledger(failed).includes("29990101000000_add_notes"));
  failed.close();

  writeFileSync(
    join(added, "migration.sql"),
    "CREATE TABLE notes(id TEXT PRIMARY KEY);",
  );

  const fixed = openDatabase(path, folder);
  t.onTestFinished(() => fixed.close());
  assert.ok(tables(fixed.client).includes("notes"));
  assert.equal(ledger(fixed.client).at(-1), "29990101000000_add_notes");
});

test("processes opening a new database together migrate it once", async (t) => {
  const path = join(scratch(t), "console.sqlite");
  const module = pathToFileURL(join(import.meta.dirname, "database.ts")).href;
  const script = `const { openDatabase } = await import(${JSON.stringify(module)}); openDatabase(${JSON.stringify(path)}).close();`;

  const run = () =>
    new Promise<void>((resolve, reject) => {
      execFile(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "--eval", script],
        (error, _stdout, stderr) =>
          error ? reject(new Error(stderr || error.message)) : resolve(),
      );
    });

  await Promise.all([run(), run(), run(), run()]);
  const db = new DatabaseSync(path);
  t.onTestFinished(() => db.close());

  assert.deepEqual(
    ledger(db),
    readdirSync(migrationsFolder).filter((name) => /^\d{14}_/.test(name)),
  );
});

test("a failed Drizzle query throws SQLite's error, without the query's values", (t) => {
  const db = openDatabase(join(scratch(t), "console.sqlite"));
  t.onTestFinished(() => db.close());

  assert.throws(
    () =>
      db.orm
        .insert(events)
        .values({
          task_id: "missing",
          type: "task.queued",
          timestamp: "secret-timestamp",
          data: "{}",
        })
        .run(),
    (error: Error) =>
      error.message === "FOREIGN KEY constraint failed" &&
      !error.message.includes("secret-timestamp"),
  );
});

test("project names upgrade preserves saved approvals and existing task data", (t) => {
  const dir = scratch(t);
  const path = join(dir, "console.sqlite");
  const older = join(dir, "older-migrations");
  mkdirSync(older);

  const [initial] = readdirSync(migrationsFolder)
    .filter((name) => /^\d{14}_/.test(name))
    .sort();

  assert.ok(initial, "expected at least one migration");

  cpSync(join(migrationsFolder, initial), join(older, initial), {
    recursive: true,
  });

  const before = openDatabase(path, older);

  before.client
    .prepare("INSERT INTO project_roots(path, kind) VALUES(?,?)")
    .run("/repo", "repository");

  before.client
    .prepare("INSERT INTO tasks VALUES(?,?,?)")
    .run("kept", "alice", "{}");

  before.close();
  const upgraded = openDatabase(path);

  t.onTestFinished(() => {
    if (upgraded.client.isOpen) upgraded.close();
  });

  assert.deepEqual(
    {
      ...upgraded.client
        .prepare("SELECT path,kind,name FROM project_roots")
        .get(),
    },
    { path: "/repo", kind: "repository", name: null },
  );

  assert.equal(
    upgraded.client.prepare("SELECT COUNT(*) AS n FROM tasks").get()?.n,
    1,
  );

  upgraded.client
    .prepare("UPDATE project_roots SET name=? WHERE path=?")
    .run("Saved name", "/repo");

  upgraded.close();
  const reopened = openDatabase(path);
  t.onTestFinished(() => reopened.close());

  assert.equal(
    reopened.client.prepare("SELECT name FROM project_roots").get()?.name,
    "Saved name",
  );
});

test("removing webhooks preserves tasks and activity while dropping populated delivery tables", (t) => {
  const dir = scratch(t);
  const path = join(dir, "console.sqlite");
  const older = join(dir, "older-migrations");
  mkdirSync(older);

  const migrationNames = readdirSync(migrationsFolder)
    .filter((name) => /^\d{14}_/.test(name))
    .sort();

  const removal = migrationNames.findIndex((name) =>
    name.endsWith("_remove-webhooks"),
  );

  assert.ok(removal > 0);

  for (const name of migrationNames.slice(0, removal)) {
    cpSync(join(migrationsFolder, name), join(older, name), {
      recursive: true,
    });
  }

  const before = openDatabase(path, older);

  before.client
    .prepare("INSERT INTO tasks VALUES(?,?,?)")
    .run("kept", "alice", "{}");

  before.client
    .prepare(
      "INSERT INTO events(id,task_id,type,timestamp,data) VALUES(?,?,?,?,?)",
    )
    .run(7, "kept", "task.completed", "now", "{}");

  before.client
    .prepare("INSERT INTO event_subscriptions VALUES(?,?,?)")
    .run("sub", "alice", "{}");

  before.client
    .prepare(
      "INSERT INTO event_outbox(subscription_id,event_id,task_id,body) VALUES(?,?,?,?)",
    )
    .run("sub", "evt_7", "kept", "{}");

  before.client.prepare("UPDATE event_checkpoint SET cursor=7").run();
  before.close();

  const upgraded = openDatabase(path);
  t.onTestFinished(() => upgraded.close());

  assert.deepEqual(tables(upgraded.client), [
    "__drizzle_migrations",
    "events",
    "project_roots",
    "tasks",
    "user_settings",
  ]);

  assert.deepEqual(
    { ...upgraded.client.prepare("SELECT * FROM tasks").get() },
    { id: "kept", owner: "alice", body: "{}" },
  );

  assert.deepEqual(
    { ...upgraded.client.prepare("SELECT * FROM events").get() },
    {
      id: 7,
      task_id: "kept",
      type: "task.completed",
      timestamp: "now",
      data: "{}",
    },
  );

  assert.equal(
    upgraded.client
      .prepare(
        "INSERT INTO events(task_id,type,timestamp,data) VALUES(?,?,?,?)",
      )
      .run("kept", "task.started", "later", "{}").lastInsertRowid,
    8,
  );

  assert.deepEqual(
    upgraded.client.prepare("PRAGMA foreign_key_check").all(),
    [],
  );
});

test("removing native forms discards pending requests and preserves task activity", (t) => {
  const dir = scratch(t);
  const path = join(dir, "console.sqlite");
  const older = join(dir, "older-migrations");
  mkdirSync(older);

  const names = readdirSync(migrationsFolder)
    .filter((name) => /^\d{14}_/.test(name))
    .sort();

  const removal = names.findIndex((name) =>
    name.endsWith("_remove-native-forms"),
  );

  assert.ok(removal > 0);

  for (const name of names.slice(0, removal)) {
    cpSync(join(migrationsFolder, name), join(older, name), {
      recursive: true,
    });
  }

  const before = openDatabase(path, older);

  before.client
    .prepare("INSERT INTO tasks VALUES(?,?,?)")
    .run("kept", "alice", "{}");

  before.client
    .prepare(
      "INSERT INTO events(id,task_id,type,timestamp,data) VALUES(?,?,?,?,?)",
    )
    .run(7, "kept", "task.completed", "now", "{}");

  before.client
    .prepare(
      "INSERT INTO form_requests(id,owner,expires,task_id,body) VALUES(?,?,?,?,?)",
    )
    .run("pending", "alice", 9e12, "kept", "malformed");

  before.client
    .prepare(
      "INSERT INTO form_requests(id,owner,expires,task_id,body) VALUES(?,?,?,?,?)",
    )
    .run("taskless", "alice", 9e12, null, "malformed");

  before.close();

  const upgraded = openDatabase(path);
  t.onTestFinished(() => upgraded.close());
  assert.ok(!tables(upgraded.client).includes("form_requests"));

  assert.deepEqual(
    { ...upgraded.client.prepare("SELECT * FROM tasks").get() },
    { id: "kept", owner: "alice", body: "{}" },
  );

  assert.deepEqual(
    { ...upgraded.client.prepare("SELECT * FROM events").get() },
    {
      id: 7,
      task_id: "kept",
      type: "task.completed",
      timestamp: "now",
      data: "{}",
    },
  );

  assert.equal(
    upgraded.client
      .prepare(
        "INSERT INTO events(task_id,type,timestamp,data) VALUES(?,?,?,?)",
      )
      .run("kept", "task.started", "later", "{}").lastInsertRowid,
    8,
  );

  assert.deepEqual(
    upgraded.client.prepare("PRAGMA foreign_key_check").all(),
    [],
  );
});
