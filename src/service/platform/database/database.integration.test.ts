import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { test, vi } from "vitest";

import { events } from "../../features/tasks/storage/schema.js";
import * as logging from "../logging/logger.js";
import {
  migrationsFolder,
  openDatabase,
  useIncrementalVacuum,
} from "./database.js";

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
    "file_changes",
    "project_roots",
    "task_archive",
    "task_read",
    "task_send_receipts",
    "tasks",
    "user_settings",
  ]);

  assert.deepEqual(
    db.client
      .prepare("PRAGMA table_info(project_roots)")
      .all()
      .map((column) => String(column.name)),
    ["path", "kind", "name"],
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

test("an unversioned database is refused and left untouched", (t) => {
  const path = join(scratch(t), "console.sqlite");
  const unversioned = new DatabaseSync(path);

  unversioned.exec(
    "CREATE TABLE tasks(id TEXT PRIMARY KEY, owner TEXT NOT NULL, body TEXT NOT NULL)",
  );

  unversioned.close();

  assert.throws(
    () => openDatabase(path),
    /created by an unsupported earlier version\. Delete its data directory/,
  );

  const after = new DatabaseSync(path);
  t.onTestFinished(() => after.close());
  assert.deepEqual(tables(after), ["tasks"]);
});

test("a database with an unrecognized migration is refused", (t) => {
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
    /migration history this build does not recognize \(29990101000000_future\)/,
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

/** A database migrated from a copy of the package's migrations, which a test can extend. */
function migratedCopy(t: { onTestFinished(fn: () => void): void }) {
  const dir = scratch(t);
  const path = join(dir, "console.sqlite");
  const folder = join(dir, "migrations");
  cpSync(migrationsFolder, folder, { recursive: true });
  openDatabase(path, folder).close();

  const addMigration = (name: string) => {
    mkdirSync(join(folder, name));

    writeFileSync(
      join(folder, name, "migration.sql"),
      `CREATE TABLE ${name.replace(/^\d+_/, "")}(id TEXT PRIMARY KEY);`,
    );
  };

  const backups = () => {
    try {
      return readdirSync(join(dir, "backups")).sort();
    } catch {
      return [];
    }
  };

  return { dir, path, folder, addMigration, backups };
}

test("no backup is made of a new database or when nothing is pending", (t) => {
  const { path, folder, backups } = migratedCopy(t);
  openDatabase(path, folder).close();
  assert.deepEqual(backups(), []);
});

test("pending migrations back up the database as it was first", (t) => {
  const { dir, path, folder, addMigration, backups } = migratedCopy(t);
  const db = openDatabase(path, folder);
  const previous = ledger(db.client);

  db.client
    .prepare("INSERT INTO tasks VALUES(?,?,?)")
    .run("kept", "alice", "{}");

  db.close();
  addMigration("29990101000000_notes");
  openDatabase(path, folder).close();

  const [backup, ...rest] = backups();
  assert.deepEqual(rest, []);
  assert.ok(backup);
  assert.match(backup, new RegExp(`^console-${previous.at(-1)}-.*\\.sqlite$`));

  const copy = new DatabaseSync(join(dir, "backups", backup));
  t.onTestFinished(() => copy.close());
  assert.deepEqual(ledger(copy), previous);
  assert.ok(!tables(copy).includes("notes"));
  assert.equal(copy.prepare("SELECT id FROM tasks").get()?.id, "kept");
});

test("backups are pruned by the time in their names, whatever their file times", (t) => {
  const { dir, path, folder, addMigration, backups } = migratedCopy(t);
  const older = join(dir, "backups");
  mkdirSync(older);

  // Copied backups can share one modification time, newest name first here.
  for (const year of ["2003", "2002", "2001"]) {
    const file = join(
      older,
      `console-0_init-${year}-01-01T00-00-00-000Z.sqlite`,
    );

    writeFileSync(file, "");
    utimesSync(file, 1, 1);
  }

  addMigration("29990101000000_notes");
  openDatabase(path, folder).close();

  assert.deepEqual(
    backups().map((file) => file.match(/-(\d{4})-/)?.[1]),
    ["2002", "2003", String(new Date().getUTCFullYear())],
  );
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

test("the service converts a database to incremental vacuum once, reclaiming free pages", (t) => {
  const db = openDatabase(join(scratch(t), "console.sqlite"));
  t.onTestFinished(() => db.close());
  const log = vi.spyOn(logging, "logEvent").mockImplementation(() => {});
  t.onTestFinished(() => log.mockRestore());

  const pragma = (name: string) =>
    Number(Object.values(db.client.prepare(`PRAGMA ${name}`).get()!)[0]);

  db.client.exec(
    "INSERT INTO tasks VALUES('a','alice',''); UPDATE tasks SET body = printf('%.*c', 500000, 'x'); DELETE FROM tasks",
  );

  assert.ok(pragma("freelist_count") > 0);
  useIncrementalVacuum(db);
  assert.equal(pragma("auto_vacuum"), 2);
  assert.equal(pragma("freelist_count"), 0);

  assert.deepEqual(
    log.mock.calls.map(([, event]) => event),
    ["database.vacuum_started", "database.vacuum_completed"],
  );

  useIncrementalVacuum(db);
  assert.equal(log.mock.calls.length, 2);
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
