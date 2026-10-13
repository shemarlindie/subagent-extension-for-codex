# Database and migrations

For contributors changing durable storage. This guide owns schema changes,
legacy conversion, transaction rules and event notification semantics. For
operational backups and continuation, see [Task continuation](task-continuation.md).

## Connection and ownership

The service and the projects CLI share `<data directory>/console.sqlite`.
`openDatabase` in `src/service/platform/database/database.ts` opens it, sets WAL,
foreign keys and a 5-second busy timeout, and applies pending migrations
before any feature reads it.

- Each feature declares its tables with Drizzle in its own `schema.ts`;
  `src/service/platform/database/schema.ts` collects them for drizzle-kit.
- Each feature queries only its own tables, through the shared `Database`:
  tasks and events in `tasks/storage/store.ts`, and settings and
  project roots in their services. Other features read tasks and events
  through `Store`. Queries use Drizzle; raw SQL is kept where it is clearer,
  such as the JSON predicates in `Store.chatEvents`.

## Read validation and errors

- JSON columns are checked when read (`decodeStored` in
  `src/service/platform/database/decode.ts`, with each feature's schema). A malformed
  record fails with an error naming it, and is never dropped or given
  defaults. The schemas check the fields ownership and control flow rely on
  and pass the rest, such as provider state and event data, through
  unchanged.
- Drizzle query failures throw SQLite's own error (such as
  `FOREIGN KEY constraint failed`), not Drizzle's wrapper, whose message
  holds the SQL and its parameters.

## Change a schema

1. Edit the owning feature's Drizzle schema.
2. Run `npm run db:generate -- --name <change>`. Review the SQL: SQLite
   rebuilds a table for many column changes. Data backfills need a custom
   migration (`npx drizzle-kit generate --custom --name <change>`).
3. Run the focused database and affected feature tests. Include the new folder
   under `migrations/` in any requested commit. Never edit a committed migration.

## Migration application

- `src/service/platform/database/migrate.ts` applies migrations in one
  `BEGIN IMMEDIATE` transaction and records them in Drizzle's
  `__drizzle_migrations` ledger, so a service and a CLI starting together
  migrate once. It refuses a database whose ledger names a migration this
  build lacks.
- `migrations/` ships in the package and is read with `packagePath`, so
  source checkouts and installed packages use the same folder.

## Convert an unversioned database

Startup refuses databases from before versioned migrations. To preserve their
records, use the checkout-only converter in
`dev/database/migrate-legacy-database.ts` rather than deleting the data directory.

1. Stop the service and back up the data directory.
2. Inspect the conversion without replacing the database:

   ```sh
   npm run db:migrate-legacy -- --dry-run <data-directory>
   ```

3. Run the conversion:

   ```sh
   npm run db:migrate-legacy -- <data-directory>
   ```

The converter copies retained records into a new database, keeps event IDs,
fills in task references and validates records as the service would. It keeps
the old file as `console.sqlite.pre-migration`. Retired tables are dropped and reported. Worktrees and other data-directory files
are untouched.

## Transactions and notifications

Write a task change and the events that record it in one
`store.transaction(() => …)`, so they commit together. Transactions are
synchronous and don't nest: run Git, provider and network work before
opening one, and call helpers that write events inside it rather than opening
another.

Event listeners on `store.bus` hear an event only after its transaction
commits, in order, and never one that rolled back. A notification is a hint
that rows exist: a listener that throws is logged without affecting the
commit or other listeners, and consumers recover what they miss from the
database (long polls by re-reading, SSE clients through `Last-Event-ID`).
