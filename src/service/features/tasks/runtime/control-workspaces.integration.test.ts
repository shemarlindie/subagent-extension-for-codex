import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { structuredPatch } from "diff";
import { test } from "vitest";

import { FixtureProvider } from "../../../../../dev/service/fixture-provider.js";
import type { RunContext } from "../../providers/types.js";
import { input, setup, until } from "./control-test-harness.js";

test("recorded worktree edits include committed and untracked files without touching primary checkout", async () => {
  class Writer extends FixtureProvider {
    override async run(c: RunContext, p: string) {
      await writeFile(join(c.task.workspace!, "README.md"), "changed\n");

      await writeFile(
        join(c.task.workspace!, "new.ts"),
        "export const answer = 42;\n",
      );

      c.fileChanged({
        path: join(c.task.workspace!, "README.md"),
        hunks: structuredPatch("", "", "hello\n", "changed\n").hunks,
        source: "tool",
      });

      c.fileChanged({
        path: join(c.task.workspace!, "new.ts"),
        hunks: structuredPatch("", "", "", "export const answer = 42;\n").hunks,
        created: true,
        source: "tool",
      });

      execFileSync("git", ["-C", c.task.workspace!, "add", "README.md"]);

      execFileSync("git", [
        "-C",
        c.task.workspace!,
        "commit",
        "-qm",
        "worker edit",
      ]);

      return super.run(c, p);
    }
  }

  const { c, store, repo } = await setup(new Writer());
  const t = await c.start("alice", input(repo));

  await until(
    () =>
      !c.active.has(t.id) && store.get(t.id, "alice").status === "completed",
  );

  // The worktree is on the task's own branch, which holds the worker's commit.
  const done = store.get(t.id, "alice");
  assert.equal(done.branch, `agent/${t.id}`);

  assert.equal(
    execFileSync("git", ["-C", repo, "log", "-1", "--format=%s", done.branch])
      .toString()
      .trim(),
    "worker edit",
  );

  assert.equal(
    execFileSync("git", ["-C", done.workspace!, "branch", "--show-current"])
      .toString()
      .trim(),
    done.branch,
  );

  const { diff, files } = c.changes.changes(done);

  assert.deepEqual(
    files.map((file) => [file.path, file.status]),
    [
      ["README.md", "modified"],
      ["new.ts", "added"],
    ],
  );

  assert.match(diff, /changed/);
  assert.match(diff, /answer = 42/);
  execFileSync("git", ["-C", repo, "apply", "--check", "-"], { input: diff });

  assert.equal(await readFile(join(repo, "README.md"), "utf8"), "hello\n");
  await c.close();
});

test("worktree branches use the owner's prefix, and Git rejects invalid names", async () => {
  const { c, store, repo } = await setup();

  try {
    assert.throws(() =>
      c.settings.update("alice", {
        set: { task: { worktree_branch_prefix: "a b/" } },
      }),
    );

    c.settings.update("alice", {
      set: { task: { worktree_branch_prefix: "work/" } },
    });

    const t = await c.start("alice", input(repo));
    await until(() => store.get(t.id, "alice").status === "completed");
    assert.equal(store.get(t.id, "alice").branch, `work/${t.id}`);

    execFileSync("git", [
      "-C",
      repo,
      "rev-parse",
      "--verify",
      `refs/heads/work/${t.id}`,
    ]);

    // Allowed characters can still form an invalid ref.
    c.settings.update("alice", {
      set: { task: { worktree_branch_prefix: "a..b/" } },
    });

    const bad = await c.start("alice", input(repo));
    await until(() => store.get(bad.id, "alice").status === "failed");
    assert.match(store.get(bad.id, "alice").error!, /Invalid worktree branch/);
    assert.equal(store.get(bad.id, "alice").workspace, undefined);
  } finally {
    await c.close();
  }
});

test("a stopped task's worktree is removed, keeping the branch, then the branch can be deleted", async () => {
  const { c, store, repo } = await setup();

  const branches = () =>
    execFileSync("git", ["-C", repo, "branch", "--list", "agent/*"])
      .toString()
      .trim();

  const pins = () =>
    execFileSync("git", ["-C", repo, "for-each-ref", "refs/agent-tasks"])
      .toString()
      .trim();

  try {
    const running = await c.start("alice", input(repo, "[input]"));
    await until(() => !!store.get(running.id, "alice").pending_input);

    await assert.rejects(
      c.removeWorktree("alice", running.id),
      /Wait until the task stops/,
    );

    await c.interrupt("alice", running.id);
    const t = store.get(running.id, "alice");

    await assert.rejects(
      c.deleteBranch("alice", t.id),
      /Remove the worktree before deleting its branch/,
    );

    // Uncommitted work is listed, not discarded, until the user confirms.
    await writeFile(join(t.workspace!, "draft.txt"), "draft\n");

    assert.deepEqual(await c.removeWorktree("alice", t.id), {
      status: "uncommitted",
      files: ["draft.txt"],
    });

    assert.deepEqual(await c.removeWorktree("alice", t.id, true), {
      status: "removed",
    });

    assert.match(branches(), new RegExp(`agent/${t.id}`));
    assert.equal(store.get(t.id, "alice").workspace_removed, true);
    assert.equal(pins(), "");

    await assert.rejects(c.removeWorktree("alice", t.id), /already removed/);

    assert.deepEqual(await c.deleteBranch("alice", t.id), {
      status: "deleted",
    });

    assert.equal(branches(), "");
    assert.equal(store.get(t.id, "alice").branch_deleted, true);
    assert.equal(pins(), "");

    // Each outcome is a task event.
    assert.deepEqual(
      store
        .events(t.id, "alice")
        .filter(
          (e) =>
            e.type.startsWith("task.worktree") ||
            e.type.startsWith("task.branch"),
        )
        .map((e) => [e.type, e.data]),
      [
        [
          "task.worktree_removed",
          { path: t.workspace, branch: t.branch, forced: true },
        ],
        ["task.branch_deleted", { branch: t.branch }],
      ],
    );

    // Another user can't act on the task.
    await assert.rejects(c.removeWorktree("bob", t.id));

    // The next message recreates the worktree: from its branch, or from the
    // base commit once the branch is gone too.
    const paused = await c.start("alice", input(repo, "[input]"));
    await until(() => !!store.get(paused.id, "alice").pending_input);
    await c.interrupt("alice", paused.id);
    await c.removeWorktree("alice", paused.id);
    await c.send("alice", paused.id, "Carry on", "user");
    await until(() => store.get(paused.id, "alice").status === "completed");
    assert.ok(existsSync(store.get(paused.id, "alice").workspace!));
    await c.removeWorktree("alice", paused.id);
    await c.deleteBranch("alice", paused.id);
    await c.send("alice", paused.id, "Once more", "user");
    await until(() => store.get(paused.id, "alice").turn === 3);
    await until(() => store.get(paused.id, "alice").status === "completed");
    const recreated = store.get(paused.id, "alice");
    assert.match(branches(), new RegExp(`agent/${paused.id}`));

    assert.equal(
      execFileSync("git", ["-C", recreated.workspace!, "rev-parse", "HEAD"])
        .toString()
        .trim(),
      recreated.base_commit,
    );

    assert.deepEqual(
      store
        .events(paused.id, "alice")
        .filter((e) => e.type === "task.worktree_recreated")
        .map((e) => e.data),
      [{ from: "branch" }, { from: "base" }],
    );
  } finally {
    await c.close();
  }
});

test("a task is deleted in any state with everything related to it", async () => {
  const { c, store, repo } = await setup();

  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args])
      .toString()
      .trim();

  const sessions: string[] = [];

  c.providers.get("fixture")!.deleteSession = async (t) => {
    sessions.push(t.id);
  };

  try {
    const t = await c.start("alice", input(repo, "[input]"));
    await until(() => !!store.get(t.id, "alice").pending_input);
    const stopped = store.get(t.id, "alice");
    assert.ok(stopped.workspace && existsSync(stopped.workspace));
    assert.match(git("branch", "--list", "agent/*"), new RegExp(t.id));
    assert.equal(git("for-each-ref", "refs/agent-tasks"), "");

    // A task that depends on this one keeps it, whatever its state, since a
    // follow-up could still resume it.
    const dependent = await c.start("alice", {
      ...input(repo, "[input]"),
      depends_on: [t.id],
    });

    await until(() => store.get(dependent.id, "alice").status === "waiting");
    await c.interrupt("alice", dependent.id);

    await assert.rejects(
      c.delete("alice", t.id),
      new RegExp(`${dependent.id} depends on this task`),
    );

    await c.delete("alice", dependent.id);
    await assert.rejects(c.delete("bob", t.id), /not found/);
    assert.deepEqual(sessions, []);

    await c.send("alice", t.id, "Follow up", "user", {
      delivery: "queue",
      request_id: "retry",
    });

    const receipts = () =>
      store.database.client
        .prepare("SELECT COUNT(*) AS count FROM task_send_receipts")
        .get()?.count;

    assert.equal(receipts(), 1);

    // One waiting for input is interrupted first.
    assert.deepEqual(await c.delete("alice", t.id, true), {
      status: "deleted",
    });

    assert.equal(c.active.has(t.id), false);

    assert.deepEqual(sessions, [t.id]);
    assert.throws(() => store.get(t.id, "alice"), /Task not found/);

    assert.deepEqual(store.taskEvents(t.id, 0), []);
    assert.equal(receipts(), 0);

    assert.equal(existsSync(stopped.workspace), false);
    assert.equal(git("branch", "--list", "agent/*").includes(t.id), false);
    assert.equal(git("for-each-ref", "refs/agent-tasks").includes(t.id), false);

    // Without the option, the provider's session is left alone.
    const kept = await c.start("alice", input(repo, "[input]"));
    await until(() => !!store.get(kept.id, "alice").pending_input);
    await c.interrupt("alice", kept.id);

    // Deleting a task with its dependent removes the dependent first.
    const follower = await c.start("alice", {
      ...input(repo, "[input]"),
      depends_on: [kept.id],
    });

    await until(() => store.get(follower.id, "alice").status === "waiting");
    await c.interrupt("alice", follower.id);
    await c.delete("alice", [kept.id, follower.id]);
    assert.deepEqual(sessions, [t.id]);
    assert.deepEqual(store.all("alice"), []);
  } finally {
    await c.close();
  }
});

test("deletion locks execution, dependencies and duplicate cleanup until it finishes", async () => {
  const { c, store, repo } = await setup();
  let release!: () => void;

  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });

  let deleting = false;

  c.providers.get("fixture")!.deleteSession = async () => {
    deleting = true;
    await pending;
  };

  try {
    const task = await c.start("alice", input(repo, "[input]"));
    await until(() => !!store.get(task.id, "alice").pending_input);
    await c.interrupt("alice", task.id);
    const deletion = c.delete("alice", task.id, true);
    await until(() => deleting);

    await assert.rejects(
      c.send("alice", task.id, "Resume", "user"),
      /being deleted/,
    );

    await assert.rejects(
      c.send("alice", task.id, "Resume", "user", { delivery: "queue" }),
      /being deleted/,
    );

    await assert.rejects(c.interrupt("alice", task.id), /being deleted/);

    await assert.rejects(c.delete("alice", task.id), /being deleted/);

    await assert.rejects(
      c.start("alice", { ...input(repo), depends_on: [task.id] }),
      /being deleted/,
    );

    release();
    await deletion;
    assert.throws(() => store.get(task.id, "alice"), /not found/);
  } finally {
    release?.();
    await c.close();
  }
});

test("provider deletion failures preserve local task resources and release the lock", async () => {
  const { c, store, repo } = await setup();

  c.providers.get("fixture")!.deleteSession = async () => {
    throw new Error("cleanup failed");
  };

  try {
    const task = await c.start("alice", input(repo, "[input]"));
    await until(() => !!store.get(task.id, "alice").pending_input);
    await c.interrupt("alice", task.id);
    await assert.rejects(c.delete("alice", task.id, true), /cleanup failed/);
    const kept = store.get(task.id, "alice");
    assert.equal(existsSync(kept.workspace!), true);
    assert.ok(store.events(task.id, "alice").length);
    await c.delete("alice", task.id);
    assert.throws(() => store.get(task.id, "alice"), /not found/);
  } finally {
    await c.close();
  }
});

test("a follow-up already awaiting project validation cannot resurrect a deleted task", async () => {
  const { c, store, repo } = await setup();
  let release!: () => void;

  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });

  let validating = false;

  try {
    const task = await c.start("alice", input(repo, "[input]"));
    await until(() => !!store.get(task.id, "alice").pending_input);
    await c.interrupt("alice", task.id);

    c.projects = {
      resolve: async () => {
        validating = true;
        await pending;
      },
    } as unknown as typeof c.projects;

    const continuation = c.send("alice", task.id, "Continue", "user");
    // Attach the rejection assertion before cleanup can make filesystem checks fail.
    const rejected = assert.rejects(continuation, /not found|removed|ENOENT/);
    await until(() => validating);
    await c.delete("alice", task.id);
    release();
    await rejected;
    assert.throws(() => store.get(task.id, "alice"), /not found/);
  } finally {
    release?.();
    await c.close();
  }
});
