// Node-side fixture service for the panel dev host. Vite loads this module with
// ssrLoadModule (see vite.config.ts) and answers FIXTURE_SERVICE_TOOLS with the
// real service code: a Store in a temporary SQLite file, seeded with the preview
// fixture tasks, and callTool with user authority, as the console calls it.
// Tasks with change fixtures get a real Git repository each, so their changes
// come from Git as in production.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Control } from "../../../src/service/features/tasks/runtime/control";
import { Store } from "../../../src/service/features/tasks/storage/store";
import { Workspaces } from "../../../src/service/features/workspaces/workspace";
import { callTool } from "../../../src/service/platform/server/tools";
import type { Task } from "../../../src/shared/tasks/model";
import { FIXTURE_SERVICE_TOOLS } from "../host/host-helpers";
import {
  type ChangeFixture,
  type Edits,
  previewChanges,
  type Turn,
} from "../scenarios/change-fixtures";
import { previewTasks } from "../scenarios/fixtures";

type FixtureStore = {
  store: Store;
  control: Control;
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

let current: Promise<FixtureStore> | undefined;

const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    "git",
    [
      "-C",
      cwd,
      "-c",
      "user.name=Preview",
      "-c",
      "user.email=preview@example.invalid",
      ...args,
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  ).trim();

function write(root: string, edits: Edits) {
  for (const [path, content] of Object.entries(edits)) {
    const file = join(root, path);

    if (content === null) {
      rmSync(file, { force: true });
    } else {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
  }
}

function apply(root: string, turn: Turn) {
  if ("patch" in turn && typeof turn.patch === "string") {
    execFileSync("git", ["-C", root, "apply", "-"], { input: turn.patch });
  } else {
    write(root, turn);
  }
}

/**
 * Builds a task's repository from its change fixture: a base commit, then
 * each turn. The task's workspace, branch and snapshots become real ones;
 * the turn snapshot is taken before the last turn.
 */
async function seedChanges(
  task: Task,
  fixture: ChangeFixture,
  root: string,
  workspaces: Workspaces,
) {
  const repo = join(root, "repos", task.id);
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q");
  write(repo, fixture.base);
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "Base");
  task.base_commit = git(repo, "rev-parse", "HEAD");
  // Worktree actions run Git in the repository itself.
  task.repository = repo;

  if (task.workspace_strategy === "worktree") {
    task.branch ??= `agent/${task.id}`;
    task.workspace = join(root, "worktrees", task.id);
    git(repo, "worktree", "add", "-q", "-b", task.branch, task.workspace);
  } else {
    write(repo, fixture.before ?? {});
    task.workspace = repo;
    task.start_tree = await workspaces.snapshot(repo);
  }

  const workspace = task.workspace;

  for (const [index, turn] of fixture.turns.entries()) {
    if (index === fixture.turns.length - 1) {
      task.turn_start_tree = await workspaces.snapshot(workspace);
    }

    apply(workspace, turn);

    if (fixture.commit) {
      git(workspace, "add", "-A");
      git(workspace, "commit", "-qm", `Turn ${index + 1}`);
    }
  }

  if (fixture.committedAfter) {
    await workspaces.recordEnd(task);
    write(workspace, fixture.committedAfter);
    git(workspace, "add", "--", ...Object.keys(fixture.committedAfter));
    git(workspace, "commit", "-qm", "User commit");
  }

  if (fixture.removed) git(repo, "worktree", "remove", "--force", workspace);
  if (fixture.branchDeleted) git(repo, "branch", "-D", task.branch!);
}

/** Seeds the fixture tasks on first use. */
function fixtureStore() {
  current ??= (async () => {
    const directory = mkdtempSync(join(tmpdir(), "panel-fixture-service-"));
    const store = new Store(join(directory, "fixtures.sqlite"));
    const workspaces = new Workspaces(join(directory, "snapshots"), []);
    // No providers: served tools read changes and manage worktrees, and
    // never run a task.
    const control = new Control(store, workspaces, new Map());
    const fixture = { store, control, directory };
    (globalThis as { __fixtureStore?: FixtureStore }).__fixtureStore = fixture;

    for (const task of previewTasks) {
      const saved = structuredClone(task);

      const changes = previewChanges[task.id];

      if (changes) {
        await seedChanges(saved, changes(), directory, workspaces);
      }

      store.save(saved);
    }

    return fixture;
  })();

  return current;
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
  if (!FIXTURE_SERVICE_TOOLS.includes(name)) {
    throw new Error(`The fixture service does not serve ${name}`);
  }

  const { control } = await fixtureStore();
  const task = previewTasks.find((task) => task.id === args.task_id);

  return callTool(control, task?.owner ?? "preview", name, args, "user");
}

/** Closes and removes the store; for tests. */
export async function closeFixtureService() {
  if (!current) return;
  const { store, directory } = await current;
  store.close();
  rmSync(directory, { recursive: true, force: true });
  current = undefined;
  delete (globalThis as { __fixtureStore?: FixtureStore }).__fixtureStore;
}
