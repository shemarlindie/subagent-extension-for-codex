import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { DrizzleQueryError } from "drizzle-orm/errors";
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { SQLiteAsyncPreparedQuery } from "drizzle-orm/sqlite-core/async/session";

import { logEvent } from "../logging/logger.js";
import { packagePath } from "../service/runtime.js";
import { migrate } from "./migrate.js";

/** The package's migrations, the same folder in source checkouts and installed packages. */
export const migrationsFolder = packagePath("migrations");

/**
 * Drizzle replaces a failed query's SQLite error with one whose message is
 * the SQL and its parameters, which hides the reason (a constraint, a lock)
 * and copies stored values into API errors and logs. Its synchronous
 * executors rethrow the SQLite error instead.
 */
for (const method of ["run", "all", "get", "values"] as const) {
  const prototype = SQLiteAsyncPreparedQuery.prototype as unknown as Record<
    typeof method,
    ((...args: unknown[]) => unknown) | undefined
  >;

  const execute = prototype[method];

  if (!execute) {
    throw new Error(
      `Drizzle's prepared queries have no ${method} method to wrap; check the drizzle-orm upgrade.`,
    );
  }

  prototype[method] = function (this: unknown, ...args: unknown[]) {
    try {
      return execute.apply(this, args);
    } catch (error) {
      throw error instanceof DrizzleQueryError && error.cause instanceof Error
        ? error.cause
        : error;
    }
  };
}

const BUSY_TIMEOUT_MS = 5000;
const SQLITE_BUSY = 5;

/** Whether a `node:sqlite` error is SQLITE_BUSY, extended codes included. */
function busy(error: unknown) {
  return ((error as { errcode?: number }).errcode ?? 0) % 256 === SQLITE_BUSY;
}

/**
 * Switches a database to WAL. The switch needs an exclusive lock and fails
 * at once, without the busy timeout, while another process opening the same
 * new database holds one, so it retries for as long as the timeout. The mode
 * persists in the file, so later opens find it set and skip the switch.
 */
function useWal(client: DatabaseSync) {
  const deadline = Date.now() + BUSY_TIMEOUT_MS;

  for (;;) {
    try {
      if (client.prepare("PRAGMA journal_mode").get()?.journal_mode === "wal") {
        return;
      }

      client.exec("PRAGMA journal_mode=WAL");

      return;
    } catch (error) {
      if (!busy(error) || Date.now() > deadline) throw error;

      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

/** The shared connection: the raw client and the Drizzle query builder over it. */
export type Database = {
  client: DatabaseSync;
  orm: NodeSQLiteDatabase;
  /**
   * Runs `fn` in one `BEGIN IMMEDIATE` transaction and returns its result.
   * `fn` must be synchronous, and transactions don't nest: work that belongs
   * to an open transaction runs inside its callback.
   */
  transaction<T>(fn: () => T): T;
  /**
   * Runs `notify` once the open transaction commits, in the order queued, or
   * at once outside a transaction. A rollback discards it.
   */
  afterCommit(notify: () => void): void;
  close(): void;
};

function thenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | null)?.then === "function";
}

function transactions(client: DatabaseSync) {
  let queued: (() => void)[] | undefined;

  return {
    transaction<T>(fn: () => T): T {
      if (queued) {
        throw new Error(
          "A transaction is already open; run this work inside it",
        );
      }

      const notifications: (() => void)[] = [];
      queued = notifications;
      let result: T;
      client.exec("BEGIN IMMEDIATE");

      try {
        result = fn();

        // Work after an await would run outside the transaction.
        if (thenable(result)) {
          throw new Error("Database transactions must be synchronous");
        }

        client.exec("COMMIT");
      } catch (error) {
        client.exec("ROLLBACK");
        throw error;
      } finally {
        queued = undefined;
      }

      for (const notify of notifications) notify();

      return result;
    },
    afterCommit(notify: () => void) {
      if (queued) queued.push(notify);
      else notify();
    },
  };
}

/**
 * Opens the database at `path`, configures the connection and applies
 * pending migrations before any feature reads it. A failure closes the
 * connection again.
 */
export function openDatabase(
  path: string,
  migrations = migrationsFolder,
): Database {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const client = new DatabaseSync(path, { timeout: BUSY_TIMEOUT_MS });

  try {
    useWal(client);
    client.exec("PRAGMA foreign_keys=ON");

    migrate(client, migrations, path);
    // Gives the query planner statistics for new indexes. Running it at each
    // open covers services that stop without closing the connection.
    client.exec("PRAGMA optimize=0x10002");
  } catch (error) {
    client.close();
    throw error;
  }

  return {
    client,
    orm: drizzle({ client }),
    ...transactions(client),
    close: () => client.close(),
  };
}

const INCREMENTAL = 2;

/**
 * Lets `PRAGMA incremental_vacuum` return free pages to the file system.
 * Converting an existing database rewrites it with one `VACUUM`, which also
 * reclaims space freed earlier. The mode persists, so later opens skip it.
 */
export function useIncrementalVacuum(database: Database) {
  const { client } = database;
  const mode = client.prepare("PRAGMA auto_vacuum").get()?.auto_vacuum;
  if (mode === INCREMENTAL) return;

  const started = performance.now();
  logEvent("info", "database.vacuum_started");
  client.exec("PRAGMA auto_vacuum=INCREMENTAL");
  client.exec("VACUUM");

  logEvent("info", "database.vacuum_completed", {
    duration_ms: Math.round(performance.now() - started),
  });
}
