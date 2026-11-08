import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { test, vi } from "vitest";

import { input, setup, until } from "./control-test-harness.js";

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

    // Several tasks delete together.
    const other = await c.start("alice", input(repo, "[input]"));
    await until(() => !!store.get(other.id, "alice").pending_input);
    await c.interrupt("alice", other.id);
    await c.delete("alice", [kept.id, other.id]);
    assert.deepEqual(sessions, [t.id]);
    assert.deepEqual(store.list("alice", {}), []);
  } finally {
    await c.close();
  }
});

test("tasks without a recorded session leave session deletion available for the rest", async () => {
  const { c, store, repo } = await setup();
  const sessions: string[] = [];
  const fixture = c.providers.get("fixture")!;
  const verify = fixture.sessionDeletionStatus!.bind(fixture);

  fixture.deleteSession = async (t) => {
    sessions.push(t.id);
  };

  const stopped = async () => {
    const task = await c.start("alice", input(repo, "[input]"));
    await until(() => !!store.get(task.id, "alice").pending_input);
    await c.interrupt("alice", task.id);

    return store.get(task.id, "alice");
  };

  try {
    const recorded = await stopped();
    const unrecorded = await stopped();
    delete unrecorded.session_id;
    store.save(unrecorded);
    const selection = [recorded.id, unrecorded.id];
    const preview = await c.taskDeletionPreview("alice", selection, true);

    assert.equal(preview.sessionDeletion.available, true);
    assert.ok(preview.confirmation);

    const target = (id: string) => preview.tasks.find((task) => task.id === id);

    assert.ok(target(recorded.id)?.session);
    assert.equal(target(unrecorded.id)?.sessionRecorded, false);

    // An unverified session still blocks the batch and names its task.
    fixture.sessionDeletionStatus = async (task) =>
      task.id === recorded.id
        ? { available: false, message: "Unverified." }
        : verify(task);

    assert.deepEqual(
      (await c.taskDeletionPreview("alice", selection, true)).sessionDeletion,
      { available: false, message: `Unverified. Task: ${recorded.title}` },
    );

    fixture.sessionDeletionStatus = verify;
    await c.delete("alice", selection, true, preview.confirmation);
    assert.deepEqual(sessions, [recorded.id]);
    assert.deepEqual(store.list("alice", {}), []);
  } finally {
    await c.close();
  }
});

test("deletion locks execution and duplicate cleanup until it finishes", async () => {
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

    release();
    await deletion;
    assert.throws(() => store.get(task.id, "alice"), /not found/);
  } finally {
    release?.();
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

test("deleting a task keeps a worktree outside the managed folder and its branch", async () => {
  const { c, store, repo, dir } = await setup();

  try {
    const task = await c.start("alice", input(repo));
    await until(() => store.get(task.id, "alice").status === "completed");
    const moved = store.get(task.id, "alice");
    const outside = join(dir, "outside-worktree");

    execFileSync("git", [
      "-C",
      repo,
      "worktree",
      "move",
      moved.workspace!,
      outside,
    ]);

    moved.workspace = outside;
    store.save(moved);

    const preview = await c.taskDeletionPreview("alice", [task.id], false);

    assert.deepEqual(preview.tasks[0]?.retainedWorktree, {
      worktree: outside,
      branch: moved.branch,
    });

    await c.delete("alice", task.id, false, preview.confirmation);
    assert.throws(() => store.get(task.id, "alice"), /not found/);
    assert.equal(existsSync(outside), true);
    assert.equal(await c.workspaces.branchExists(moved), true);
  } finally {
    await c.close();
  }
});

test("changed worktree targets refuse reviewed deletion and keep repurposed checkouts", async () => {
  const { c, store, repo } = await setup();

  try {
    const task = await c.start("alice", input(repo));
    await until(() => store.get(task.id, "alice").status === "completed");
    const stopped = store.get(task.id, "alice");
    const reviewed = await c.workspaces.deletion(stopped);

    const commit = (message: string) => {
      execFileSync("git", [
        "-C",
        stopped.workspace!,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "--allow-empty",
        "-qm",
        message,
      ]);
    };

    commit("new branch tip");

    await assert.rejects(
      c.workspaces.discard(stopped, reviewed.version),
      /Worktree or branch changed/,
    );

    assert.equal(existsSync(stopped.workspace!), true);
    assert.equal(await c.workspaces.branchExists(stopped), true);

    execFileSync("git", [
      "-C",
      stopped.workspace!,
      "checkout",
      "-qb",
      "user-work",
    ]);

    await assert.rejects(
      c.delete("alice", stopped.id),
      /different branch or repository/,
    );

    assert.equal(existsSync(store.get(stopped.id, "alice").workspace!), true);
    assert.equal(await c.workspaces.branchExists(stopped), true);

    assert.equal(
      execFileSync("git", [
        "-C",
        stopped.workspace!,
        "branch",
        "--show-current",
      ])
        .toString()
        .trim(),
      "user-work",
    );

    execFileSync("git", [
      "-C",
      stopped.workspace!,
      "checkout",
      "-q",
      stopped.branch!,
    ]);

    const approved = await c.workspaces.deletion(stopped);
    const inspect = c.workspaces.deletion.bind(c.workspaces);

    const inspection = vi
      .spyOn(c.workspaces, "deletion")
      .mockImplementationOnce(async (target) => {
        const resources = await inspect(target);
        commit("new work during cleanup");

        return resources;
      });

    try {
      await assert.rejects(
        c.workspaces.discard(stopped, approved.version),
        /branch changed during cleanup/,
      );

      assert.equal(existsSync(stopped.workspace!), false);
      assert.equal(await c.workspaces.branchExists(stopped), true);
    } finally {
      inspection.mockRestore();
    }
  } finally {
    await c.close();
  }
});
