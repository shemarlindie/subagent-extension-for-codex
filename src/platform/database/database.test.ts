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

test("a fresh database gets every table, the webhook checkpoint and the connection settings", (t) => {
  const path = join(scratch(t), "data", "console.sqlite");
  const db = openDatabase(path);
  t.onTestFinished(() => db.close());

  assert.deepEqual(tables(db.client), [
    "__drizzle_migrations",
    "event_checkpoint",
    "event_outbox",
    "event_subscriptions",
    "events",
    "form_requests",
    "project_roots",
    "tasks",
    "user_settings",
  ]);

  assert.deepEqual(
    db.client.prepare("SELECT id, cursor FROM event_checkpoint").get()?.cursor,
    0,
  );

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

  first.client.prepare("UPDATE event_checkpoint SET cursor=7").run();
  const applied = ledger(first.client);
  first.close();

  const second = openDatabase(path);
  t.onTestFinished(() => second.close());
  assert.deepEqual(ledger(second.client), applied);

  assert.equal(
    second.client.prepare("SELECT COUNT(*) AS n FROM tasks").get()?.n,
    1,
  );

  assert.equal(
    second.client.prepare("SELECT cursor FROM event_checkpoint").get()?.cursor,
    7,
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
          error ? reject(new Error(stderr || String(error))) : resolve(),
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
