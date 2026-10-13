import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { FixtureProvider } from "../../../dev/service/fixture-provider.js";
import type { RunContext } from "../../../src/service/features/providers/types.js";
import { Control } from "../../../src/service/features/tasks/runtime/control.js";
import { Store } from "../../../src/service/features/tasks/storage/store.js";
import { Workspaces } from "../../../src/service/features/workspaces/workspace.js";

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
    override async run(c: RunContext, p: string) {
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
  );

  const until = async (done: () => boolean) => {
    for (let i = 0; i < 300 && !done(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.ok(done(), "Timed out");
  };

  try {
    await writeFile(join(s.repo, "user.txt"), "user\n");

    const t = await c.start("alice", {
      repository: s.repo,
      provider: "fixture",
      description: "Write files",
      workspace_strategy: "current_repo",
    });

    await until(() => !!c.store.get(t.id, "alice").pending_input);
    const first = c.store.get(t.id, "alice");
    assert.ok(first.start_tree);
    assert.equal(first.turn_start_tree, first.start_tree);
    assert.deepEqual(s.changed("HEAD", first.start_tree), ["user.txt"]);

    // Waiting for input ends the changes, since the worker is blocked.
    assert.deepEqual(s.changed(first.start_tree, first.end_tree!), [
      "turn-1.txt",
    ]);

    // Stopping a waiting task keeps that end, leaving out edits made while
    // it waited; the next turn clears it.
    await writeFile(join(s.repo, "during-wait.txt"), "user\n");
    await c.interrupt("alice", t.id);
    const paused = c.store.get(t.id, "alice");
    assert.equal(paused.end_tree, first.end_tree);
    await rm(join(s.repo, "during-wait.txt"));

    await c.send("alice", t.id, "Continue", "user");
    await until(() => c.store.get(t.id, "alice").status === "completed");
    const done = c.store.get(t.id, "alice");
    assert.equal(done.start_tree, first.start_tree);
    assert.notEqual(done.turn_start_tree, first.turn_start_tree);
    assert.notEqual(done.end_tree, paused.end_tree);
    // Each turn records the commit HEAD was on.
    assert.equal(done.turn_head, s.git("rev-parse", "HEAD").trim());

    // The turn snapshot scopes a diff to the latest turn; the start snapshot
    // to the whole task. Both end where the turn ended, leaving out later edits.
    await writeFile(join(s.repo, "later.txt"), "user\n");

    const paths = async (scope: "task" | "turn") =>
      (await s.workspaces.changes(done, scope)).files.map((f) => f.path);

    assert.deepEqual(await paths("turn"), ["turn-2.txt"]);
    assert.deepEqual(await paths("task"), ["turn-1.txt", "turn-2.txt"]);

    await assert.rejects(
      s.workspaces.changedFile(done, "later.txt"),
      /not among this task's changes/,
    );

    assert.equal(
      (await s.workspaces.changedFile(done, "turn-2.txt")).content,
      "worker\n",
    );

    // Refs pin the snapshots, so pruning everything unreferenced keeps them.
    // The replied turn's are pinned under its number too.
    const reply = c.store.latestEvent(t.id, "agent.reply")!;
    assert.equal(reply.data.turn, 2);
    assert.equal(reply.data.end_tree, done.end_tree);

    assert.equal(
      s.git(
        "for-each-ref",
        "--format=%(objectname) %(refname)",
        "refs/agent-tasks",
      ),
      `${done.end_tree} refs/agent-tasks/${t.id}/end\n` +
        `${done.start_tree} refs/agent-tasks/${t.id}/start\n` +
        `${done.turn_start_tree} refs/agent-tasks/${t.id}/turn-start\n` +
        `${done.end_tree} refs/agent-tasks/${t.id}/turns/2/end\n` +
        `${done.turn_start_tree} refs/agent-tasks/${t.id}/turns/2/start\n`,
    );

    s.git("-c", "gc.pruneExpire=now", "gc", "-q");

    assert.deepEqual(s.changed(done.start_tree, done.end_tree!), [
      "turn-1.txt",
      "turn-2.txt",
    ]);

    await s.workspaces.unpin(done);
    assert.equal(s.git("for-each-ref", "refs/agent-tasks"), "");
  } finally {
    await c.close();
    await s.close();
  }
});

// The tree a snapshot must equal: the checkout as `add -A` stages it, starting
// from HEAD in a fresh index, which ignores everything in the real index.
function treeFromHead(repo: string, dir: string) {
  const env = { ...process.env, GIT_INDEX_FILE: join(dir, "expected-index") };

  const git = (...args: string[]) =>
    execFileSync(
      "git",
      // Unsplit, so the reference adds no shared index files of its own.
      ["-C", repo, "-c", "core.splitIndex=false", ...args],
      { encoding: "utf8", env },
    );

  try {
    git("read-tree", "HEAD");
    git("add", "-A");

    return git("write-tree").trim();
  } finally {
    execFileSync("rm", ["-f", env.GIT_INDEX_FILE]);
  }
}

test("snapshots seeded from the real index match a fresh start, whatever the index holds", async () => {
  const s = await setup();

  const commit = (...args: string[]) =>
    s.git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      ...args,
    );

  try {
    await writeFile(join(s.repo, "a.txt"), "a\n");
    await writeFile(join(s.repo, "hidden.txt"), "hidden\n");
    await writeFile(join(s.repo, "gone.txt"), "gone\n");
    s.git("add", ".");
    commit("commit", "-qm", "more");

    // Staged then edited again, untracked, deleted, ignored, and an
    // assume-unchanged file edited behind the index's back.
    await writeFile(join(s.repo, "a.txt"), "staged\n");
    s.git("add", "a.txt");
    await writeFile(join(s.repo, "a.txt"), "staged\nand edited\n");
    await writeFile(join(s.repo, "new.txt"), "new\n");
    await rm(join(s.repo, "gone.txt"));
    await writeFile(join(s.repo, "ignored.log"), "noise\n");
    s.git("update-index", "--assume-unchanged", "hidden.txt");
    await writeFile(join(s.repo, "hidden.txt"), "edited anyway\n");

    const index = s.git("ls-files", "-s", "-v");
    const tree = await s.workspaces.snapshot(s.repo);
    assert.equal(tree, treeFromHead(s.repo, s.dir));
    assert.equal(s.git("show", `${tree}:hidden.txt`), "edited anyway\n");
    // The real index keeps its own entries and marks.
    assert.equal(s.git("ls-files", "-s", "-v"), index);
  } finally {
    await s.close();
  }
});

test("split indexes and merge conflicts snapshot from the copied index", async () => {
  const s = await setup();

  const commit = (...args: string[]) =>
    s.git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      ...args,
    );

  try {
    // A split index keeps its shared files in the repository; snapshots
    // must not add or change any.
    s.git("config", "core.splitIndex", "true");
    s.git("update-index", "--split-index");
    await writeFile(join(s.repo, "tracked.txt"), "edited\n");
    const gitDir = join(s.repo, ".git");

    const shared = async () =>
      (await readdir(gitDir)).filter((name) => name.startsWith("sharedindex"));

    const before = await shared();
    assert.ok(before.length);

    assert.equal(
      await s.workspaces.snapshot(s.repo),
      treeFromHead(s.repo, s.dir),
    );

    assert.deepEqual(await shared(), before);

    // A merge conflict leaves unmerged entries in the index; `add -A` on
    // the copy resolves them to the working tree, with the conflict markers.
    s.git("config", "core.splitIndex", "false");
    s.git("update-index", "--no-split-index");
    s.git("checkout", "-q", "-b", "other");
    await writeFile(join(s.repo, "tracked.txt"), "other\n");
    commit("commit", "-qam", "other");
    s.git("checkout", "-q", "-");
    await writeFile(join(s.repo, "tracked.txt"), "main\n");
    commit("commit", "-qam", "main");
    assert.throws(() => commit("merge", "-q", "other"));
    assert.match(s.git("ls-files", "-u"), /tracked\.txt/);

    assert.equal(
      await s.workspaces.snapshot(s.repo),
      treeFromHead(s.repo, s.dir),
    );

    assert.match(s.git("ls-files", "-u"), /tracked\.txt/);
  } finally {
    await s.close();
  }
});

test("a same-size edit within the index's timestamp is still seen", async () => {
  const s = await setup();

  try {
    // Pin the times so the edit matches every cached stat the index keeps
    // for the file (size, whole-second mtime; ctime is switched off) and
    // the index has the same mtime: only Git's racily-clean check, which
    // compares against the index file's own mtime, can see the change.
    const file = join(s.repo, "tracked.txt"),
      time = new Date("2026-01-01T00:00:00Z");

    s.git("config", "core.trustctime", "false");
    await utimes(file, time, time);
    s.git("add", "tracked.txt");
    await writeFile(file, "edited!!!\n");
    await utimes(file, time, time);
    await utimes(join(s.repo, ".git", "index"), time, time);
    const tree = await s.workspaces.snapshot(s.repo);
    assert.equal(s.git("show", `${tree}:tracked.txt`), "edited!!!\n");
  } finally {
    await s.close();
  }
});

test("a sparse checkout's files outside the sparse set stay in snapshots", async () => {
  const s = await setup();

  try {
    await mkdir(join(s.repo, "kept"));
    await mkdir(join(s.repo, "sparse"));
    await writeFile(join(s.repo, "kept", "a.txt"), "kept\n");
    await writeFile(join(s.repo, "sparse", "b.txt"), "outside\n");
    s.git("add", ".");

    s.git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "dirs",
    );

    s.git("sparse-checkout", "set", "kept");
    await writeFile(join(s.repo, "kept", "a.txt"), "edited\n");

    const tree = await s.workspaces.snapshot(s.repo);
    assert.equal(s.git("show", `${tree}:sparse/b.txt`), "outside\n");
    assert.deepEqual(s.changed("HEAD", tree), ["kept/a.txt"]);
  } finally {
    await s.close();
  }
});

test("thousands of assume-unchanged files still snapshot from the copied index", async () => {
  const s = await setup();

  try {
    // More path bytes than one command line holds (about 1 MB on macOS).
    await mkdir(join(s.repo, "kept"));
    const name = (i: number) => `kept/${"x".repeat(200)}-${i}.txt`;
    const paths = Array.from({ length: 6000 }, (_, i) => name(i));

    for (const path of paths) await writeFile(join(s.repo, path), "same\n");
    s.git("add", ".");

    s.git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "many",
    );

    execFileSync(
      "git",
      ["-C", s.repo, "update-index", "--assume-unchanged", "-z", "--stdin"],
      { input: paths.join("\0") },
    );

    await writeFile(join(s.repo, name(5999)), "edited\n");

    // Point HEAD at a branch that doesn't exist, so starting from HEAD
    // fails: the snapshot can only come from the copied index.
    const commit = s.git("rev-parse", "HEAD").trim();
    s.git("symbolic-ref", "HEAD", "refs/heads/missing");

    const tree = await s.workspaces.snapshot(s.repo);
    assert.deepEqual(s.changed(commit, tree), [name(5999)]);
  } finally {
    await s.close();
  }
}, 60_000);

test("a checkout with no index file snapshots from HEAD", async () => {
  const s = await setup();

  try {
    await writeFile(join(s.repo, "tracked.txt"), "edited\n");
    await writeFile(join(s.repo, "new.txt"), "new\n");
    await rm(join(s.repo, ".git", "index"));

    const tree = await s.workspaces.snapshot(s.repo);
    assert.deepEqual(s.changed("HEAD", tree), ["new.txt", "tracked.txt"]);
  } finally {
    await s.close();
  }
});
