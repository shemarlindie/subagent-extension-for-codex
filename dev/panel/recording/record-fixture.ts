// Records a task from a service database as a preview fixture:
//
//   npm run fixture:record -- --db <tasks.sqlite> --task <task id> --name <name>
//     [--title <title>] [--start <ISO time>] [--first-id <n>]
//     [--replace <from>=<to> ...]
//
// It writes dev/panel/recorded/<name>.json, sanitized by
// `recordFixture`, and refuses to when a local path, the host name or the
// user name is left in it; `--replace` covers what the run itself added. Add
// the file to `recordedFixtures` in fixtures.ts. See
// docs/development.md#recorded-fixtures.
import { realpathSync, writeFileSync } from "node:fs";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

import { format, resolveConfig } from "prettier";

import type { EventEnvelope } from "../../../src/shared/events/event-contract";
import type { Task } from "../../../src/shared/tasks/model";
import { leftovers, recordFixture } from "./recording";

const { values } = parseArgs({
  options: {
    db: { type: "string" },
    task: { type: "string" },
    name: { type: "string" },
    title: { type: "string" },
    start: { type: "string", default: "2026-10-02T11:00:00.000Z" },
    "first-id": { type: "string", default: "3000" },
    replace: { type: "string", multiple: true, default: [] },
  },
});

const firstId = Number(values["first-id"]);

const replace = values.replace.map((pair): [string, string] => {
  const at = pair.indexOf("=");

  // Without "=", the empty `from` fails the check below.
  return at < 1 ? ["", ""] : [pair.slice(0, at), pair.slice(at + 1)];
});

if (
  !values.db ||
  !values.task ||
  !values.name ||
  !/^[a-z0-9-]+$/.test(values.name) ||
  Number.isNaN(Date.parse(values.start)) ||
  !Number.isInteger(firstId) ||
  replace.some(([from]) => !from)
) {
  throw new Error(
    "Usage: --db <tasks.sqlite> --task <task id> --name <lowercase-name> [--title <title>] [--start <ISO time>] [--first-id <n>] [--replace <from>=<to> ...]",
  );
}

const db = new DatabaseSync(values.db, { readOnly: true });
const row = db.prepare("SELECT body FROM tasks WHERE id=?").get(values.task);
if (!row) throw new Error(`No task ${values.task} in ${values.db}`);
const task = JSON.parse(String(row.body)) as Task;

const events = db
  .prepare("SELECT * FROM events WHERE task_id=? ORDER BY id")
  .all(values.task)
  .map(
    (r) =>
      ({
        ...r,
        data: {
          ...JSON.parse(String(r.data)),
          ...(r.original_response
            ? { raw_response: JSON.parse(String(r.original_response)) }
            : {}),
        },
      }) as unknown as EventEnvelope,
  );

const temp = realpathSync(tmpdir());

const fixture = recordFixture(task, events, {
  id: `preview-recorded-${values.name}`,
  title: values.title,
  start: values.start,
  firstId,
  conversationId: "dev-thread",
  home: homedir(),
  host: hostname(),
  username: userInfo().username,
  // The temporary directory, under both of its names on macOS.
  replace: [...replace, [temp, "/demo/tmp"], [tmpdir(), "/demo/tmp"]],
});

const path = join(import.meta.dirname, "../recorded", `${values.name}.json`);

// Formatted as `npm run format:check` expects.
const text = await format(JSON.stringify(fixture), {
  ...(await resolveConfig(path)),
  filepath: path,
});

// The host name also appears without its domain, as in `Someones-Mac`.
const left = leftovers(text, [
  homedir(),
  hostname(),
  hostname().replace(/\..*$/s, ""),
  userInfo().username,
  temp,
  tmpdir(),
]);

if (left.length) {
  throw new Error(
    `Not written: it still contains ${left.join(", ")}. Replace them with --replace <from>=<to>.`,
  );
}

writeFileSync(path, text);

console.log(
  `Wrote ${path}: task ${fixture.task.id}, ${fixture.events.length} events, ids ${fixture.events[0]?.id}–${fixture.events.at(-1)?.id}`,
);
