// Converts a data directory's database from before versioned migrations
// (commit c40cb73 and earlier) to the current schema, once. Stop the service
// first; the script holds its lease while it runs.
//
//   npm run db:migrate-legacy -- [--dry-run] [<data directory>]
//
// The old database is kept beside the new one as console.sqlite.pre-migration.
// Worktrees, events-key and admin-token are left as they are.

import { existsSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { decodeSubscription } from "../../src/service/features/events/service.js";
import { Settings } from "../../src/service/features/settings/settings.js";
import { decodeRequest } from "../../src/service/features/tasks/input/forms.js";
import {
  decodeEvent,
  decodeTask,
} from "../../src/service/features/tasks/storage/stored.js";
import { openDatabase } from "../../src/service/platform/database/database.js";
import { lease } from "../../src/service/platform/service/lease.js";
import { dataDirectory } from "../../src/service/platform/service/runtime.js";

/** Tables an unversioned database can hold; the projects CLI created only some. */
const LEGACY_TABLES = new Set([
  "tasks",
  "events",
  "form_requests",
  "project_roots",
  "user_settings",
  "event_subscriptions",
  "event_outbox",
  "event_checkpoint",
  // Retired; not copied.
  "artifacts",
  "codex_executors",
]);

/** What a migration copied and dropped, by table. */
export type MigrationReport = {
  copied: Record<string, number>;
  dropped: Record<string, number>;
};

type Row = Record<string, string | number | null>;

/** Removes a database file with its WAL and shared-memory files. */
function removeDatabase(path: string) {
  for (const file of [path, `${path}-wal`, `${path}-shm`])
    rmSync(file, { force: true });
}

/**
 * Migrates `<data>/console.sqlite`. With `dryRun`, it builds and checks the
 * new database, then discards it.
 */
export function migrateLegacyDatabase(
  data: string,
  { dryRun = false } = {},
): MigrationReport {
  const path = join(data, "console.sqlite");
  const kept = `${path}.pre-migration`;
  const next = `${path}.migrating`;

  if (!existsSync(path)) throw new Error(`No database at ${path}`);
  if (existsSync(kept))
    throw new Error(`${kept} already exists; this directory was migrated`);

  const release = lease(data);

  try {
    // Read-write, so closing it folds any pending WAL into the file kept.
    const legacy = new DatabaseSync(path);
    let report: MigrationReport;

    try {
      checkLegacy(legacy);
      removeDatabase(next);
      const database = openDatabase(next);

      try {
        report = database.transaction(() => copy(legacy, database));
      } finally {
        database.close();
      }
    } finally {
      legacy.close();
    }

    if (dryRun) removeDatabase(next);
    else {
      renameSync(path, kept);

      try {
        renameSync(next, path);
      } catch (error) {
        // Put the old database back rather than leave none in place.
        renameSync(kept, path);
        throw error;
      }
    }

    return report;
  } catch (error) {
    removeDatabase(next);
    throw error;
  } finally {
    release();
  }
}

/** Refuses anything but an unversioned database with only known tables. */
function checkLegacy(legacy: DatabaseSync) {
  const tables = legacy
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all()
    .map((row) => String(row.name));

  if (tables.includes("__drizzle_migrations"))
    throw new Error("The database is already versioned; nothing to migrate");

  const unknown = tables.filter((name) => !LEGACY_TABLES.has(name));

  if (unknown.length)
    throw new Error(`Unexpected tables: ${unknown.join(", ")}`);

  if (!tables.includes("tasks"))
    throw new Error("No tasks table; this is not a service database");
}

/** The task an outbox delivery's envelope names, if any. */
function outboxTaskId(row: Row) {
  try {
    return (JSON.parse(String(row.body)) as { data?: { task_id?: unknown } })
      .data?.task_id;
  } catch (error) {
    throw new Error(
      `Stored webhook delivery ${row.subscription_id}/${row.event_id} is malformed`,
      { cause: error },
    );
  }
}

function copy(
  legacy: DatabaseSync,
  database: ReturnType<typeof openDatabase>,
): MigrationReport {
  const client = database.client;

  const has = (table: string) =>
    !!legacy
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(table);

  const rows = (table: string) =>
    has(table) ? (legacy.prepare(`SELECT * FROM ${table}`).all() as Row[]) : [];

  const report: MigrationReport = { copied: {}, dropped: {} };

  const count = (kind: "copied" | "dropped", table: string) =>
    (report[kind][table] = (report[kind][table] ?? 0) + 1);

  const tasks = new Set<string>();

  for (const row of rows("tasks")) {
    decodeTask(String(row.id), String(row.body));

    client
      .prepare("INSERT INTO tasks(id,owner,body) VALUES(?,?,?)")
      .run(row.id, row.owner, row.body);

    tasks.add(String(row.id));
    count("copied", "tasks");
  }

  // Ids are kept, so event cursors held by clients and the webhook checkpoint stay valid.
  const event = client.prepare(
    "INSERT INTO events(id,task_id,type,timestamp,data) VALUES(?,?,?,?,?)",
  );

  for (const row of rows("events")) {
    if (!tasks.has(String(row.task_id))) {
      count("dropped", "events");
      continue;
    }

    decodeEvent({
      id: Number(row.id),
      task_id: String(row.task_id),
      type: String(row.type),
      timestamp: String(row.timestamp),
      data: String(row.data),
    });

    event.run(row.id, row.task_id, row.type, row.timestamp, row.data);
    count("copied", "events");
  }

  // Carry the id sequence over, not just the kept ids: events deleted with
  // their tasks may have used higher ids that a client or the webhook
  // checkpoint has already passed, and reusing them would skip new events.
  const sequence = Number(
    legacy.prepare("SELECT seq FROM sqlite_sequence WHERE name='events'").get()
      ?.seq ?? 0,
  );

  client.prepare("DELETE FROM sqlite_sequence WHERE name='events'").run();

  client
    .prepare(
      "INSERT INTO sqlite_sequence(name,seq) VALUES('events',max(?,(SELECT IFNULL(MAX(id),0) FROM events)))",
    )
    .run(sequence);

  for (const row of rows("form_requests")) {
    const request = decodeRequest(String(row.id), String(row.body));

    // A form about a task that no longer exists can't be answered.
    if (request.task_id !== undefined && !tasks.has(request.task_id)) {
      count("dropped", "form_requests");
      continue;
    }

    client
      .prepare(
        "INSERT INTO form_requests(id,owner,expires,task_id,body) VALUES(?,?,?,?,?)",
      )
      .run(row.id, row.owner, row.expires, request.task_id ?? null, row.body);

    count("copied", "form_requests");
  }

  for (const row of rows("project_roots")) {
    client
      .prepare("INSERT INTO project_roots(path,kind) VALUES(?,?)")
      .run(row.path, row.kind);

    count("copied", "project_roots");
  }

  for (const row of rows("user_settings")) {
    client
      .prepare("INSERT INTO user_settings(owner,body) VALUES(?,?)")
      .run(row.owner, row.body);

    count("copied", "user_settings");
  }

  // Settings check themselves when read; any provider name passes here.
  const settings = new Settings(database, () => ["claude"]);

  for (const row of rows("user_settings")) settings.values(String(row.owner));

  for (const row of rows("event_subscriptions")) {
    decodeSubscription(String(row.id), String(row.body));

    client
      .prepare("INSERT INTO event_subscriptions(id,owner,body) VALUES(?,?,?)")
      .run(row.id, row.owner, row.body);

    count("copied", "event_subscriptions");
  }

  for (const row of rows("event_outbox")) {
    // The envelope names its task; its event id can't be split reliably,
    // since task ids may contain underscores.
    const taskId = outboxTaskId(row);

    if (typeof taskId !== "string" || !tasks.has(taskId)) {
      count("dropped", "event_outbox");
      continue;
    }

    client
      .prepare(
        "INSERT INTO event_outbox(subscription_id,event_id,task_id,body,status,attempts,next_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        row.subscription_id,
        row.event_id,
        taskId,
        row.body,
        row.status,
        row.attempts,
        row.next_at,
      );

    count("copied", "event_outbox");
  }

  const [checkpoint] = rows("event_checkpoint");

  if (checkpoint)
    client
      .prepare("UPDATE event_checkpoint SET cursor=? WHERE id=1")
      .run(checkpoint.cursor);

  for (const table of ["artifacts", "codex_executors"])
    if (has(table)) report.dropped[table] = rows(table).length;

  const violations = client.prepare("PRAGMA foreign_key_check").all();

  if (violations.length)
    throw new Error(
      `Foreign key violations after copying: ${JSON.stringify(violations)}`,
    );

  return report;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    options: { "dry-run": { type: "boolean", default: false } },
    allowPositionals: true,
  });

  const data = positionals[0] ?? dataDirectory();
  const dryRun = values["dry-run"];
  const report = migrateLegacyDatabase(data, { dryRun });

  console.log(
    dryRun
      ? `Dry run: ${data}/console.sqlite would migrate.`
      : `Migrated ${data}/console.sqlite; the old database is console.sqlite.pre-migration.`,
  );

  console.log(JSON.stringify(report, null, 2));
}
