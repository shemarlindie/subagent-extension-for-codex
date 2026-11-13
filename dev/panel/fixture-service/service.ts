// Node-side fixture service for the panel dev host. Vite loads this module with
// ssrLoadModule (see vite.config.ts) and answers FIXTURE_SERVICE_TOOLS with the
// real service code: a Store in a temporary SQLite file, seeded with the preview
// fixture tasks, and callTool with user authority, as the console calls it.
// Tasks with change fixtures get disposable repositories and recorded edit hunks.
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { structuredPatch } from "diff";

import { Control } from "../../../src/service/features/tasks/runtime/control";
import { Store } from "../../../src/service/features/tasks/storage/store";
import { Workspaces } from "../../../src/service/features/workspaces/workspace";
import { callTool } from "../../../src/service/platform/server/tools";
import type { Task } from "../../../src/shared/tasks/model";
import { FIXTURE_SERVICE_TOOLS } from "../host/host-helpers";
import { previewAttachments } from "../scenarios/attachment-scenarios";
import {
  type ChangeFixture,
  type Edits,
  previewChanges,
  type Turn,
} from "../scenarios/change-fixtures";
import { previewEvents, previewTasks } from "../scenarios/fixtures";
import { replayRecordedEdits } from "./replay-edits";

type FixtureStore = {
  store: Store;
  control: Control;
  directory: string;
  initialized: Set<string>;
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

/**
 * Synchronous calls block the worker, so a stuck Git call would otherwise
 * outlast the test timeout and hang the run.
 */
const gitTimeout = 30_000;

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
      // Commits otherwise leave a background repack running in the repository.
      "-c",
      "maintenance.auto=false",
      ...args,
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: gitTimeout },
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
    execFileSync("git", ["-C", root, "apply", "-"], {
      input: turn.patch,
      timeout: gitTimeout,
    });
  } else {
    write(root, turn);
  }
}

/** Read fixture text to create the same incremental hunks a provider reports. */
function fileContents(root: string, prefix = ""): Map<string, string> {
  const files = new Map<string, string>();

  for (const entry of readdirSync(join(root, prefix), {
    withFileTypes: true,
  })) {
    if (entry.name === ".git") continue;
    const path = join(prefix, entry.name);

    if (entry.isDirectory()) {
      for (const [key, value] of fileContents(root, path)) {
        files.set(key, value);
      }
    } else if (entry.isFile()) {
      files.set(path, readFileSync(join(root, path), "utf8"));
    }
  }

  return files;
}

function recordFixtureTurn(
  control: Control,
  task: Task,
  fixture: ChangeFixture,
  before: Map<string, string>,
  after: Map<string, string>,
) {
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const oldText = before.get(path);
    const newText = after.get(path);

    if (oldText === newText) continue;

    if (oldText?.includes("\0") || newText?.includes("\0")) {
      control.changes.unrecorded(task, path);
      continue;
    }

    control.changes.record(task, {
      path,
      hunks: structuredPatch(
        path,
        path,
        oldText ?? "",
        newText ?? "",
        undefined,
        undefined,
        { context: 3 },
      ).hunks,
      source: fixture.source ?? "tool",
      ...(oldText === undefined ? { created: true } : {}),
      ...(newText === undefined ? { deleted: true } : {}),
    });
  }

  for (const path of fixture.incomplete ?? []) {
    control.changes.unrecorded(task, path);
  }

  if (fixture.unrecordedCommands) control.changes.unrecorded(task);
}

/**
 * Builds a task's repository from its change fixture: a base commit, then
 * each turn. The task's workspace, branch become real ones. Each turn reports incremental edit hunks.
 */
function seedChanges(
  task: Task,
  fixture: ChangeFixture,
  root: string,
  control: Control,
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
  }

  const workspace = task.workspace;
  control.store.save(task);

  for (const [index, turn] of fixture.turns.entries()) {
    control.changes.clearTurn(task);
    const before = fileContents(workspace);
    apply(workspace, turn);
    const after = fileContents(workspace);

    recordFixtureTurn(control, task, fixture, before, after);

    if (fixture.commit) {
      git(workspace, "add", "-A");
      git(workspace, "commit", "-qm", `Turn ${index + 1}`);
    }
  }

  // The task's changes end, then the user commits their own edits over some
  // of its files. Recorded edits stay unchanged.
  if (fixture.committedAfter) {
    write(workspace, fixture.committedAfter);
    git(workspace, "add", "--", ...Object.keys(fixture.committedAfter));
    git(workspace, "commit", "-qm", "User commit");
  }

  if (fixture.removed) {
    git(repo, "worktree", "remove", "--force", workspace);
    task.workspace_removed = true;
  }

  if (fixture.branchDeleted) {
    git(repo, "branch", "-D", task.branch!);
    task.branch_deleted = true;
  }
}

/** Stores the fixture attachments. One has no file, as if removed by hand. */
function seedAttachments(control: Control) {
  for (const [taskId, attachments] of Object.entries(previewAttachments)) {
    const folder = control.attachments.folder(taskId);
    mkdirSync(folder, { recursive: true });

    for (const { content, ...attachment } of attachments) {
      if (content !== undefined) {
        writeFileSync(join(folder, attachment.file), content);
      }
    }

    control.attachments.save(
      taskId,
      attachments.map(({ content: _, ...attachment }) => attachment),
    );
  }
}

/** Seed task metadata first, leaving repositories and edit replay until requested. */
function fixtureStore() {
  if (current) return current;
  const directory = mkdtempSync(join(tmpdir(), "panel-fixture-service-"));
  const store = new Store(join(directory, "fixtures.sqlite"));
  const workspaces = new Workspaces(join(directory, "worktrees"), []);
  // No providers: served tools read changes and manage worktrees, and
  // never run a task.
  const control = new Control(store, workspaces, new Map());
  current = { store, control, directory, initialized: new Set() };
  (globalThis as { __fixtureStore?: FixtureStore }).__fixtureStore = current;

  for (const task of previewTasks) store.save(structuredClone(task));
  seedAttachments(control);

  return current;
}

/** Build a task once so later reads preserve worktree and branch actions. */
function initializeTask(fixture: FixtureStore, task: Task) {
  if (fixture.initialized.has(task.id)) return;
  const saved = fixture.store.get(task.id, task.owner);
  const changes = previewChanges[task.id];

  if (changes) {
    seedChanges(saved, changes(), fixture.directory, fixture.control);
  } else {
    replayRecordedEdits(fixture.control, saved, previewEvents);
  }

  fixture.store.save(saved);
  fixture.initialized.add(task.id);
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

  const fixture = fixtureStore();
  const task = previewTasks.find((task) => task.id === args.task_id);
  if (task) initializeTask(fixture, task);

  return callTool(
    fixture.control,
    task?.owner ?? "preview",
    name,
    args,
    "user",
  );
}

/** Closes and removes the store; for tests. */
export function closeFixtureService() {
  if (!current) return;
  const { store, directory } = current;
  store.close();
  rmSync(directory, { recursive: true, force: true });
  current = undefined;
  delete (globalThis as { __fixtureStore?: FixtureStore }).__fixtureStore;
}
