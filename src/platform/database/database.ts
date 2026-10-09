import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";

import { packagePath } from "../service/runtime.js";
import { migrate } from "./migrate.js";

/** The package's migrations, the same folder in source checkouts and installed packages. */
export const migrationsFolder = packagePath("migrations");

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
      if (client.prepare("PRAGMA journal_mode").get()?.journal_mode === "wal")
        return;

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
  close(): void;
};

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
  } catch (error) {
    client.close();
    throw error;
  }

  return { client, orm: drizzle({ client }), close: () => client.close() };
}
