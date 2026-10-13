# Database and migrations

Use this guide when changing durable storage, migrations, transactions or
event notifications. For operational backups
and continuation, see [Task continuation](task-continuation.md).

## Connection and ownership

The service and the projects CLI share `<data directory>/console.sqlite`.
The shared connection enables WAL and foreign keys and applies pending
migrations before any feature reads it.

- Each feature declares its tables with Drizzle in its own `schema.ts`.
  `src/service/platform/database/schema.ts` collects them for drizzle-kit.
- Each feature queries only its own tables through the shared `Database`. Read
  another feature's data through its service or store. Use Drizzle for queries,
  with raw SQL where it is clearer.

## Read validation and errors

- Validate stored JSON on read. Malformed records must fail with an error naming
  the record. Check fields needed for ownership and control flow while preserving opaque provider state
  and event data.
- Query failures expose SQLite's underlying error. Keep SQL parameters and stored
  values out of API errors and logs.

## Change a schema

1. Edit the owning feature's Drizzle schema.
2. Run `npm run db:generate -- --name <change>`. Review the SQL: SQLite
   rebuilds a table for many column changes. Use a custom migration for data backfills:
   `npx drizzle-kit generate --custom --name <change>`.
3. Run the focused database and affected feature tests. Include the new folder
   under `migrations/` in any requested commit. Never edit a committed migration.

## Migration application

- `src/service/platform/database/migrate.ts` applies migrations in one
  `BEGIN IMMEDIATE` transaction and records them in Drizzle's
  `__drizzle_migrations` ledger, so a service and a CLI starting together
  migrate once. Known migration histories receive any pending migrations.
- Startup rejects databases created before versioned migrations and histories
  containing migrations this build lacks. For an unrecognized history, use a
  build containing those migrations. Otherwise start with a fresh data directory.
- `migrations/` ships in the package. Source checkouts and installed packages use
  the same migration files.
- Before applying pending migrations to a database that already has some,
  `src/service/platform/database/backup.ts` copies it with `VACUUM INTO` to
  `<data>/backups/console-<last-applied-migration>-<timestamp>.sqlite` and keeps
  the newest three. Plugin updates arrive automatically, so this is the way
  back from a bad migration.

## Restore a backup

1. Stop the service.
2. Move `console.sqlite` and its `-wal` and `-shm` files out of the data
   directory.
3. Copy the backup to `console.sqlite`.
4. Run the version that matches the backup: a newer build migrates it again,
   and an older build refuses a database that names migrations it lacks. To
   pin a plugin version, reinstall it from that release's tag (`@vX.Y.Z`).

## Transactions and notifications

Write a task change and the events that record it in one
`store.transaction(() => …)`, so they commit together. Transactions are
synchronous and don't nest: run Git, provider and network work before
opening one, and have event-writing helpers use that transaction.

Event listeners on `store.bus` hear an event only after its transaction
commits, in order, and never one that rolled back. If a listener throws, the
service logs the error without affecting the commit or other listeners.

Notifications tell consumers to read stored results. Consumers recover missed
updates from the database through long polls or panel refreshes when the
owner's revision changes. `change` follows the same notification rules, once per
owner per transaction.
