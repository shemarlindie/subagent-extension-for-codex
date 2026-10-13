import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
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

  const backups = readdirSync(directory)
    .filter((file) => file.startsWith(`${name}-`) && file.endsWith(".sqlite"))
    .map((file) => join(directory, file))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

  for (const old of backups.slice(KEEP)) rmSync(old, { force: true });

  return backup;
}
