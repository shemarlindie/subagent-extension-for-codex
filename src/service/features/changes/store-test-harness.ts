import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { structuredPatch } from "diff";
import type { TestContext } from "vitest";

import { startSchema, type Task } from "../../../shared/tasks/model.js";
import type { FileEdit } from "../providers/types.js";
import { Store } from "../tasks/storage/store.js";
import { ChangeStore } from "./store.js";

async function createChangesFixture<T>(
  context: TestContext,
  createFactory: (store: Store) => T,
) {
  const directory = await mkdtemp(join(tmpdir(), "recorded-changes-"));
  const workspace = join(directory, "workspace");
  await mkdir(workspace);
  const database = join(directory, "state.sqlite");
  let store = new Store(database);
  let changes = createFactory(store);

  const task: Task = {
    ...startSchema.parse({
      repository: workspace,
      description: "Record edits",
    }),
    id: "changes",
    title: "Record edits",
    owner: "alice",
    status: "running",
    workspace,
    created_at: "2026-10-17T00:00:00.000Z",
    updated_at: "2026-10-17T00:00:00.000Z",
    instructions: [],
    created_by: "user",
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 1,
    runtime_ms: 0,
  };

  store.save(task);

  context.onTestFinished(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  return {
    directory,
    workspace,
    task,
    get store() {
      return store;
    },
    get changes() {
      return changes;
    },
    restart() {
      store.close();
      store = new Store(database);
      changes = createFactory(store);
    },
  };
}

export function edit(
  path: string,
  before = "before\n",
  after = "after\n",
  flags: Partial<Pick<FileEdit, "created" | "deleted" | "source">> = {},
): FileEdit {
  return {
    path,
    hunks: structuredPatch(path, path, before, after).hunks,
    source: "tool",
    ...flags,
  };
}

export const storeFixture = (context: TestContext) =>
  createChangesFixture(context, (store) => new ChangeStore(store));
