import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { FixtureProvider } from "../../../dev/fixture-provider.js";
import { Control } from "../../../src/features/tasks/control.js";
import { Store } from "../../../src/features/tasks/store.js";
import { Workspaces } from "../../../src/features/workspaces/workspace.js";
import type { RunContext } from "../../../src/shared/contracts.js";

async function setup() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "agent-snapshot-")));
  const repo = join(dir, "repo");
  await mkdir(repo);

  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });

  git("init", "-q");
  await writeFile(join(repo, ".gitignore"), "ignored.log\n");
  await writeFile(join(repo, "tracked.txt"), "committed\n");
  git("add", ".");

  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-qm",
    "initial",
  );

  const workspaces = new Workspaces(join(dir, "worktrees"), [repo]);

  return {
    dir,
    repo,
    git,
    workspaces,
    // Paths changed between two snapshots.
    changed: (from: string, to: string) =>
      git("diff", "--name-only", from, to).split("\n").filter(Boolean),
    close: () => rm(dir, { recursive: true, force: true }),
  };
}

test("a start snapshot leaves out changes that were already uncommitted", async () => {
  const s = await setup();

  try {
    await writeFile(join(s.repo, "tracked.txt"), "user edit\n");
    await writeFile(join(s.repo, "user-new.txt"), "user file\n");
    const start = await s.workspaces.snapshot(s.repo);

    await writeFile(join(s.repo, "worker.txt"), "worker file\n");
    const now = await s.workspaces.snapshot(s.repo);

    assert.deepEqual(s.changed(start, now), ["worker.txt"]);

    // The user's own changes are in the snapshot, measured from HEAD.
    assert.deepEqual(s.changed("HEAD", start), ["tracked.txt", "user-new.txt"]);
  } finally {
    await s.close();
  }
});

test("snapshots leave the real index, the working tree and the extension directory unchanged", async () => {
  const s = await setup();

  try {
    await writeFile(join(s.repo, "tracked.txt"), "staged\n");
    s.git("add", "tracked.txt");
    await writeFile(join(s.repo, "tracked.txt"), "staged\nunstaged\n");
    await writeFile(join(s.repo, "untracked.txt"), "untracked\n");
    const cached = s.git("diff", "--cached");
    const status = s.git("status", "--porcelain");

    const tree = await s.workspaces.snapshot(s.repo);

    assert.equal(s.git("diff", "--cached"), cached);
    assert.equal(s.git("status", "--porcelain"), status);
    // The snapshot holds the working tree, not the staged version.
    assert.equal(s.git("show", `${tree}:tracked.txt`), "staged\nunstaged\n");
    assert.deepEqual(await readdir(s.workspaces.root), []);
  } finally {
    await s.close();
  }
});

test("ignored files are left out of snapshots", async () => {
  const s = await setup();

  try {
    const start = await s.workspaces.snapshot(s.repo);
    await writeFile(join(s.repo, "ignored.log"), "noise\n");
    await writeFile(join(s.repo, "kept.txt"), "kept\n");

    assert.deepEqual(s.changed(start, await s.workspaces.snapshot(s.repo)), [
      "kept.txt",
    ]);
  } finally {
    await s.close();
  }
});

test("tasks record a start snapshot and replace the turn snapshot on each turn", async () => {
  const s = await setup();
  const turns: string[] = [];

  // Each turn adds one file; the first turn waits for input so it can be continued.
  class Writer extends FixtureProvider {
    async run(c: RunContext, p: string) {
      turns.push(c.task.turn_start_tree!);

      await writeFile(
        join(c.task.workspace!, `turn-${turns.length}.txt`),
        "worker\n",
      );

      return super.run(c, turns.length === 1 ? "[input]" : p);
    }
  }

  const provider = new Writer();

  const c = new Control(
    new Store(join(s.dir, "tasks.sqlite")),
    s.workspaces,
    new Map([[provider.id, provider]]),
    s.repo,
  );

  const until = async (done: () => boolean) => {
    for (let i = 0; i < 300 && !done(); i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(done(), "Timed out");
  };

  try {
    await writeFile(join(s.repo, "user.txt"), "user\n");

    const t = await c.start("alice", {
      provider: "fixture",
      description: "Write files",
      workspace_strategy: "current_repo",
    });

    await until(() => !!c.store.get(t.id, "alice").pending_input);
    const first = c.store.get(t.id, "alice");
    assert.ok(first.start_tree);
    assert.equal(first.turn_start_tree, first.start_tree);
    assert.deepEqual(s.changed("HEAD", first.start_tree), ["user.txt"]);

    await c.stop("alice", t.id, "interrupted");
    await c.continue("alice", t.id);
    await until(() => c.store.get(t.id, "alice").status === "completed");
    const done = c.store.get(t.id, "alice");
    assert.equal(done.start_tree, first.start_tree);
    assert.notEqual(done.turn_start_tree, first.turn_start_tree);

    // The turn snapshot scopes a diff to the latest turn; the start snapshot
    // to the whole task.
    const now = await s.workspaces.snapshot(s.repo);
    assert.deepEqual(s.changed(done.turn_start_tree!, now), ["turn-2.txt"]);

    assert.deepEqual(s.changed(done.start_tree!, now), [
      "turn-1.txt",
      "turn-2.txt",
    ]);
  } finally {
    await c.close();
    await s.close();
  }
});
