// Node-side fixture service for the panel dev host. Vite loads this module with
// ssrLoadModule (see vite.config.ts) and answers FIXTURE_SERVICE_TOOLS with the
// real service code: a Store in a temporary SQLite file, seeded with the preview
// fixture tasks, and callTool with user authority, as the console calls it.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Control } from "../../src/features/tasks/control";
import { Store } from "../../src/features/tasks/store";
import { callTool } from "../../src/platform/server/tools";
import { FIXTURE_SERVICE_TOOLS } from "./host-helpers";
import { previewTasks } from "./preview/fixtures";

type FixtureStore = {
  store: Store;
  directory: string;
};

// One store per module instance. Vite re-runs this module after a source edit,
// so the old store is closed and a new one is seeded with the new code.
const previous = (globalThis as { __fixtureStore?: FixtureStore })
  .__fixtureStore;

if (previous) {
  previous.store.close();
  rmSync(previous.directory, { recursive: true, force: true });
}

let current: FixtureStore | undefined;

/** Seeds the fixture tasks on first use. */
function fixtureStore() {
  if (!current) {
    const directory = mkdtempSync(join(tmpdir(), "panel-fixture-service-"));
    const store = new Store(join(directory, "fixtures.sqlite"));

    for (const task of previewTasks) store.save(task);

    current = { store, directory };
    (globalThis as { __fixtureStore?: FixtureStore }).__fixtureStore = current;
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

  const store = fixtureStore();
  const task = previewTasks.find((task) => task.id === args.task_id);

  // Served tools only read the store, so no other control parts are needed.
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
