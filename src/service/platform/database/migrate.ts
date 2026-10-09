import { type DatabaseSync } from "node:sqlite";

import { readMigrationFiles } from "drizzle-orm/migrator";

/** Drizzle's ledger table, so drizzle-kit and Drizzle's migrator read the same history. */
const LEDGER = "__drizzle_migrations";

/**
 * Applies the migrations in `folder` that the database lacks, in one
 * `BEGIN IMMEDIATE` transaction. Drizzle's own migrator reads its ledger
 * before opening a deferred transaction, so two processes starting together
 * could both run the same migration; taking the write lock first makes the
 * second wait, then find nothing to apply.
 */
export function migrate(client: DatabaseSync, folder: string, path: string) {
  const migrations = readMigrationFiles({ migrationsFolder: folder });

  if (!migrations.length) throw new Error(`No migrations found in ${folder}`);

  client.exec("BEGIN IMMEDIATE");

  try {
    const versioned = client
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(LEDGER);

    if (!versioned) {
      const tables = client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .all();

      // Databases from before versioned migrations are not upgraded.
      if (tables.length)
        throw new Error(
          `${path} was created by an unsupported earlier version. Delete its data directory to start over.`,
        );

      client.exec(
        `CREATE TABLE ${LEDGER}(id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC, name TEXT, applied_at TEXT)`,
      );
    }

    const applied = new Set(
      client
        .prepare(`SELECT name FROM ${LEDGER}`)
        .all()
        .map((row) => String(row.name)),
    );

    const known = new Set(migrations.map((m) => m.name));
    const unknown = [...applied].filter((name) => !known.has(name));

    if (unknown.length)
      throw new Error(
        `${path} was migrated by a newer version (${unknown.join(", ")}). Update codex-subagent-extension.`,
      );

    const record = client.prepare(
      `INSERT INTO ${LEDGER}(hash, created_at, name, applied_at) VALUES(?,?,?,?)`,
    );

    for (const migration of migrations) {
      if (applied.has(migration.name)) continue;

      for (const statement of migration.sql)
        if (statement.trim()) client.exec(statement);

      record.run(
        migration.hash,
        migration.folderMillis,
        migration.name,
        new Date().toISOString(),
      );
    }

    client.exec("COMMIT");
  } catch (error) {
    client.exec("ROLLBACK");
    throw error;
  }
}
