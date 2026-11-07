# Database and migrations

Use this guide when changing durable storage, migrations, transactions or event
notifications, or when restoring a pre-migration backup. For backups and
continuation in general, see [Task continuation](task-continuation.md).

## Connection and ownership

The service and the projects CLI share `<data directory>/service.sqlite`. The
shared connection enables WAL and foreign keys and applies pending migrations
before any feature reads it.

- Each feature declares its tables with Drizzle in its own `schema.ts`.
  `src/service/platform/database/schema.ts` collects them for drizzle-kit.
- Each feature queries only its own tables through the shared `Database`. Read
  another feature's data through its service or store. Use Drizzle for queries,
  and raw SQL where it is clearer.

## Read validation and errors

- Validate stored JSON on read. A malformed record must fail with an error that
  names it. Check the fields that ownership and control flow need, and leave
  opaque provider state and event data as stored.
- Query failures expose SQLite's underlying error. Keep SQL parameters and
  stored values out of API errors and logs.

## Indexed reads

Queries block the service's event loop while they run. Keep reads on request and
scheduling paths indexed, so their cost grows with the rows a request needs.

- When a query filters or sorts on a field of a JSON body, declare a virtual
  generated column with `generatedAlwaysAs` and index it. `tasks` does this for
  `status`, `created_at` and `conversation_id`. SQLite computes these columns
  from the body, so writes need no change. A body that isn't valid JSON then
  fails to write.
- Check a new query's plan with `EXPLAIN QUERY PLAN`.
  `store.integration.test.ts` asserts the plans of the task store's list and
  typed event reads.
- `PRAGMA optimize` runs at each open so the planner has statistics for new
  indexes.

## Change a schema

1. Edit the owning feature's Drizzle schema.
2. Run `npm run db:generate -- --name <change>` and review the SQL. SQLite
   rebuilds a table for many column changes. For a data backfill, write a custom
   migration with `npx drizzle-kit generate --custom --name <change>`.
3. Run the focused database tests and the affected feature tests.

Commit the new folder under `migrations/` with the change. Never edit a
committed migration.

## Migration application

- `src/service/platform/database/migrate.ts` applies pending migrations in one
  `BEGIN IMMEDIATE` transaction and records them in Drizzle's
  `__drizzle_migrations` ledger. A service and a CLI starting together migrate
  once.
- Startup rejects databases created before versioned migrations, and histories
  with migrations this build lacks. Use a build that has those migrations, or
  start with a fresh data directory.
- The package ships `migrations/`, so source checkouts and installed packages
  use the same files.
- Before migrating a database that already has migrations,
  `src/service/platform/database/backup.ts` copies it with `VACUUM INTO` to
  `<data>/backups/service-<last-applied-migration>-<timestamp>.sqlite`. It keeps
  the newest three. Plugin updates arrive automatically, so these backups are
  the way back from a bad migration.

## Free space

The service opens the database with `auto_vacuum=INCREMENTAL` and runs
`PRAGMA incremental_vacuum` after deleting a task, so deleted history returns
its space to the file system. A database created in another mode is converted on
the service's first open with one `VACUUM`, logged as `database.vacuum_started`
and `database.vacuum_completed`. That open takes longer on a large database. The
projects CLI never converts it.

## Restore a backup

1. Stop the service.
2. Move `service.sqlite` and its `-wal` and `-shm` files out of the data
   directory.
3. Copy the backup to `service.sqlite`.
4. Run the version that matches the backup. A newer build migrates it again, and
   an older build refuses a database with migrations it lacks. To pin a plugin
   version, reinstall it from that release's tag (`@vX.Y.Z`).

## Transactions and notifications

Write a task change and its events in one `store.transaction(() => …)` so they
commit together. Transactions are synchronous and don't nest. Run Git, provider
and network work before opening one, and have event-writing helpers use the open
transaction.

Listeners on `store.bus` hear an event only after its transaction commits, in
order, and never hear one that rolled back. If a listener throws, the service
logs the error without affecting the commit or other listeners. The `change`
notification follows the same rules and fires once per owner per transaction.

Notifications only tell consumers to read stored results. Consumers recover
missed updates from the database through long polls or panel refreshes when the
owner's revision changes.
