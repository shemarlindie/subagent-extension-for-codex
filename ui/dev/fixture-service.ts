// Node-side fixture service for the panel dev host. Vite loads this module with
// ssrLoadModule (see vite.config.ts) and answers FIXTURE_SERVICE_TOOLS with the
// real service code: a Store in a temporary SQLite file, seeded with the preview
// fixtures, and callTool with user authority, as the console calls it. Summaries
// and sharp thumbnails are built and cached exactly as in production.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Control } from "../../src/features/tasks/control";
import { Store } from "../../src/features/tasks/store";
import { callTool } from "../../src/platform/server/tools";
import { FIXTURE_SERVICE_TOOLS } from "./host-helpers";
import { previewArtifacts, previewTasks } from "./preview/fixtures";

type FixtureStore = {
  store: Store;
  directory: string;
  seededArtifactTasks: Set<string>;
};

// One store per module instance. Vite re-runs this module after a source edit,
// so the old store is closed and a new one rebuilds every summary with the new code.
const previous = (globalThis as { __fixtureStore?: FixtureStore })
  .__fixtureStore;

if (previous) {
  previous.store.close();
  rmSync(previous.directory, { recursive: true, force: true });
}

let current: FixtureStore | undefined;

/** Seeds tasks on first use and artifacts only when their task is requested. */
function fixtureStore(taskId: string) {
  if (!current) {
    const directory = mkdtempSync(join(tmpdir(), "panel-fixture-service-"));
    const store = new Store(join(directory, "fixtures.sqlite"));

    for (const task of previewTasks) store.save(task);

    current = { store, directory, seededArtifactTasks: new Set() };
    (globalThis as { __fixtureStore?: FixtureStore }).__fixtureStore = current;
  }

  if (!current.seededArtifactTasks.has(taskId)) {
    // Keep generated large artifacts untouched until their task is opened.
    // Direct insertion leaves summaries to be built on the first listing.
    const insert = current.store.db.prepare(
      "INSERT INTO artifacts(id,task_id,body) VALUES(?,?,?)",
    );

    for (const artifact of previewArtifacts)
      if (artifact.task_id === taskId)
        insert.run(artifact.id, artifact.task_id, JSON.stringify(artifact));

    current.seededArtifactTasks.add(taskId);
  }

  return current.store;
}

// Registered once across reloads; it removes whichever store is current.
const global = globalThis as { __fixtureStoreCleanup?: boolean };

if (!global.__fixtureStoreCleanup) {
  global.__fixtureStoreCleanup = true;

  process.once("exit", () => {
    const store = (globalThis as { __fixtureStore?: FixtureStore })
      .__fixtureStore;

    if (store) rmSync(store.directory, { recursive: true, force: true });
  });
}

export async function fixtureServiceTool(
  name: string,
  args: Record<string, unknown>,
) {
  if (!FIXTURE_SERVICE_TOOLS.includes(name))
    throw new Error(`The fixture service does not serve ${name}`);

  const taskId = typeof args.task_id === "string" ? args.task_id : "";
  const store = fixtureStore(taskId);
  const task = previewTasks.find((task) => task.id === args.task_id);

  // The artifact tools only read the store, so no other control parts are needed.
  return callTool(
    { store } as unknown as Control,
    task?.owner ?? "preview",
    name,
    args,
    "user",
  );
}

/** Closes and removes the store; for tests. */
export function closeFixtureService() {
  if (!current) return;
  current.store.close();
  rmSync(current.directory, { recursive: true, force: true });
  current = undefined;
  delete (globalThis as { __fixtureStore?: FixtureStore }).__fixtureStore;
}
