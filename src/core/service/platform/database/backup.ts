import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { type DatabaseSync } from "node:sqlite";

/** How many pre-migration backups of each database to keep. */
const KEEP = 3;

/**
 * Copies the database to `backups/` beside it before migrations change it,
 * named for its last applied migration, and keeps the newest few. Updates
 * arrive automatically, so a bad migration must not cost the task history.
 * VACUUM INTO writes a consistent copy, the WAL included.
 */
export function backUpDatabase(
  client: DatabaseSync,
  path: string,
  lastMigration: string,
) {
  const directory = join(dirname(path), "backups");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const name = basename(path, extname(path));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = join(directory, `${name}-${lastMigration}-${stamp}.sqlite`);

  client.prepare("VACUUM INTO ?").run(backup);

  // Newest first by the timestamp in each name, then by its migration.
  // Modification times can't order them, since some filesystems keep those
  // only to the second.
  const stamped = new RegExp(`^${name}-.+-(\\d{4}-[\\dT-]+Z)\\.sqlite$`);

  const backups = readdirSync(directory)
    .flatMap((file) => {
      const time = file.match(stamped)?.[1];

      return time ? [{ file, time }] : [];
    })
    .sort(
      (a, b) => b.time.localeCompare(a.time) || b.file.localeCompare(a.file),
    );

  for (const { file } of backups.slice(KEEP)) {
    rmSync(join(directory, file), { force: true });
  }

  return backup;
}
