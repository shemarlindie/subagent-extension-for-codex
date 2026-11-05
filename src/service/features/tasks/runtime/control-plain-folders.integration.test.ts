import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { onTestFinished, test } from "vitest";

import { copyCommittedRepository } from "../../../../../tests/support/repository-test-harness.js";
import type { Provider } from "../../providers/types.js";
import { Workspaces } from "../../workspaces/workspace.js";
import { Store } from "../storage/store.js";
import { Control } from "./control.js";
import {
  DependencyWriter,
  PromptRecorder,
  until,
} from "./control-test-harness.js";

/** Approved folders in each Git state, with a provider that records prompts. */
async function folders<P extends Provider>(provider: P) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "plain-folders-")));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));

  const plain = join(dir, "plain"),
    unborn = join(dir, "unborn"),
    repo = join(dir, "repo"),
    roots = [plain, unborn, repo];

  await mkdir(plain);
  await mkdir(unborn);
  execFileSync("git", ["init", "-q", unborn]);
  await copyCommittedRepository(repo);

  const store = new Store(join(dir, "tasks.sqlite"));

  const c = new Control(
    store,
    new Workspaces(join(dir, "worktrees"), roots, roots),
    new Map([[provider.id, provider]]),
  );

  onTestFinished(async () => {
    if (store.database.client.isOpen) await c.close();
  });

  const start = (repository: string, extra: Record<string, unknown> = {}) =>
    c.start("alice", {
      provider: "fixture",
      repository,
      description: "Write",
      worker_profile: "general",
      ...extra,
    });

  const finished = async (id: string, turn = 1) => {
    await until(() => {
      const t = store.get(id, "alice");

      return (
        (t.status === "completed" || t.status === "failed") && t.turn >= turn
      );
    });

    return store.get(id, "alice");
  };

  return { dir, plain, unborn, repo, store, c, provider, start, finished };
}

test("a task runs in place in a plain folder and records its edits", async () => {
  const f = await folders(new DependencyWriter("note.txt", "hello\n"));
  const t = await f.finished((await f.start(f.plain)).id);

  assert.equal(t.status, "completed", t.error);
  assert.equal(t.workspace, f.plain);
  assert.equal(t.base_commit, undefined);
  assert.equal(t.no_git, true);
  assert.match(f.provider.prompts.get(t.id)!, /folder with no Git history/);

  assert.deepEqual(
    f.c.changes.changes(t, "task").files.map((file) => file.path),
    ["note.txt"],
  );
});

test("a task runs in place in a repository with no commits", async () => {
  const f = await folders(new PromptRecorder());
  const t = await f.finished((await f.start(f.unborn)).id);

  assert.equal(t.status, "completed", t.error);
  assert.equal(t.workspace, f.unborn);
  assert.equal(t.base_commit, undefined);
  assert.equal(t.no_git, undefined);
  assert.match(f.provider.prompts[0]!, /had no commits/);
});

test("an explicit worktree or revision fails at once without commits", async () => {
  const f = await folders(new PromptRecorder());

  for (const repository of [f.plain, f.unborn]) {
    await assert.rejects(
      f.start(repository, { workspace_strategy: "worktree" }),
      /Worktrees need a Git repository with at least one commit/,
    );
  }

  f.c.settings.update("alice", {
    set: { task: { workspace_strategy: "worktree" } },
  });

  await assert.rejects(
    f.start(f.plain, { revision: "main" }),
    /Worktrees need a Git repository with at least one commit/,
  );
});

test("a saved worktree default falls back, and only a writing task reports it", async () => {
  const f = await folders(new PromptRecorder());

  // A current_repo default loses nothing.
  assert.equal((await f.start(f.plain)).workspace_fallback, undefined);

  f.c.settings.update("alice", {
    set: { task: { workspace_strategy: "worktree" } },
  });

  const plain = await f.start(f.plain);
  assert.equal(plain.workspace_strategy, "current_repo");
  assert.equal(plain.workspace_fallback, "no_git");

  assert.equal((await f.start(f.unborn)).workspace_fallback, "no_commits");

  // The panel sends the strategy it shows, and the same conditions apply.
  assert.equal(
    (await f.start(f.plain, { workspace_strategy: "current_repo" }))
      .workspace_fallback,
    "no_git",
  );

  const reviewer = await f.start(f.plain, { worker_profile: "reviewer" });
  assert.equal(reviewer.workspace_strategy, "current_repo");
  assert.equal(reviewer.workspace_fallback, undefined);

  const ready = await f.start(f.repo);
  assert.equal(ready.workspace_strategy, "worktree");
  assert.equal(ready.workspace_fallback, undefined);
});

test("git init between turns clears no_git and the next turn still runs", async () => {
  const f = await folders(new PromptRecorder());
  const first = await f.finished((await f.start(f.plain)).id);
  assert.equal(first.no_git, true);

  execFileSync("git", ["init", "-q", f.plain]);
  await f.c.send("alice", first.id, "Continue", "user");

  const second = await f.finished(first.id, 2);
  assert.equal(second.status, "completed", second.error);
  assert.equal(second.no_git, undefined);
  assert.equal(second.base_commit, undefined);
});

test("a removed .git doesn't fail the task's next new session", async () => {
  const f = await folders(new PromptRecorder());
  const first = await f.finished((await f.start(f.repo)).id);
  assert.ok(first.base_commit);

  await rm(join(f.repo, ".git"), { recursive: true, force: true });
  delete first.session_id;
  delete first.session_state_ref;
  f.store.save(first);
  await f.c.send("alice", first.id, "Continue", "user");

  const second = await f.finished(first.id, 2);
  assert.equal(second.status, "completed", second.error);
  assert.equal(second.no_git, true);
  assert.match(f.provider.prompts.at(-1)!, /folder with no Git history/);
});

test.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
  "a blocked root doesn't stop tasks in other projects",
  async () => {
    const f = await folders(new PromptRecorder());
    const parent = join(f.dir, "parent");
    const blocked = join(parent, "blocked");
    await mkdir(blocked, { recursive: true });
    f.c.workspaces.allowedRoots.push(blocked);
    f.c.workspaces.exactRoots.push(blocked);
    await chmod(parent, 0o000);
    onTestFinished(() => chmod(parent, 0o755));

    assert.equal((await f.start(f.plain)).repository, f.plain);
  },
);
