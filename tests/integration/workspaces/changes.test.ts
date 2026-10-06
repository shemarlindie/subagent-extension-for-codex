import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { Workspaces } from "../../../src/features/workspaces/workspace.js";
import { startSchema, type Task } from "../../../src/shared/contracts.js";

async function setup() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "agent-changes-")));
  const repo = join(dir, "repo");
  await mkdir(repo);

  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

  git(repo, "init", "-q");

  for (let i = 0; i < 3; i++)
    await writeFile(join(repo, `file-${i}.txt`), `line ${i}\n`.repeat(20));
  git(repo, "add", ".");

  git(
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-qm",
    "initial",
  );

  const workspaces = new Workspaces(join(dir, "worktrees"), [repo]);

  // A task as Control creates it, with its workspace made by `create`.
  const task = async (workspace_strategy: "worktree" | "current_repo") => {
    const t: Task = {
      ...startSchema.parse({
        repository: repo,
        provider: "fixture",
        description: "Change files",
        workspace_strategy,
      }),
      id: `task_${workspace_strategy}`,
      title: "Change files",
      owner: "alice",
      status: "running",
      instructions: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      attempt: 1,
      runtime_ms: 0,
    };

    await workspaces.create(t);

    t.turn_start_tree =
      t.start_tree ?? (await workspaces.snapshot(t.workspace!));

    return t;
  };

  return {
    repo,
    git,
    workspaces,
    task,
    close: () => rm(dir, { recursive: true, force: true }),
  };
}

test("worktree changes cover commits, edits, renames, deletions, new and binary files", async () => {
  const s = await setup();

  try {
    const t = await s.task("worktree");
    const w = t.workspace!;
    await writeFile(join(w, "file-0.txt"), "changed\n");
    s.git(w, "mv", "file-1.txt", "renamed.txt");

    s.git(
      w,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qam",
      "worker commit",
    );

    s.git(w, "rm", "-q", "file-2.txt");
    await writeFile(join(w, "new.txt"), "new\n");
    await writeFile(join(w, "image.png"), Buffer.from([0x89, 0x50, 0, 1, 2]));

    const changes = await s.workspaces.changes(t);

    assert.deepEqual(
      changes.files.map((f) => [f.path, f.status, f.old_path, f.binary]),
      [
        ["file-0.txt", "modified", undefined, false],
        ["file-2.txt", "deleted", undefined, false],
        ["image.png", "added", undefined, true],
        ["new.txt", "added", undefined, false],
        ["renamed.txt", "renamed", "file-1.txt", false],
      ],
    );

    assert.equal(changes.branch, t.branch);
    // Binary files carry their size, since they have no line counts.
    assert.equal(changes.files.find((f) => f.path === "image.png")?.size, 5);
    assert.equal(changes.additions, 2);
    assert.equal(changes.deletions, 40);
    assert.equal(changes.next_cursor, undefined);
    assert.match(changes.diff, /^diff --git a\/file-0.txt b\/file-0.txt/);
    assert.match(changes.diff, /Binary files \/dev\/null and b\/image.png/);

    // Reading changes never touches the worktree's own index.
    assert.match(s.git(w, "status", "--porcelain"), /^\?\? image.png$/m);
  } finally {
    await s.close();
  }
});

test("turn scope diffs from the latest turn's snapshot", async () => {
  const s = await setup();

  try {
    const t = await s.task("worktree");
    await writeFile(join(t.workspace!, "first.txt"), "first turn\n");
    t.turn_start_tree = await s.workspaces.snapshot(t.workspace!);
    await writeFile(join(t.workspace!, "second.txt"), "second turn\n");

    const paths = async (scope: "task" | "turn") =>
      (await s.workspaces.changes(t, scope)).files.map((f) => f.path);

    assert.deepEqual(await paths("turn"), ["second.txt"]);
    assert.deepEqual(await paths("task"), ["first.txt", "second.txt"]);
  } finally {
    await s.close();
  }
});

test("pages hold whole files, list every file, and keep reading the same state", async () => {
  const s = await setup();

  try {
    const t = await s.task("current_repo");
    for (let i = 0; i < 3; i++)
      await writeFile(join(s.repo, `file-${i}.txt`), `edited ${i}\n`);

    const first = await s.workspaces.changes(t, "task", undefined, 10);
    assert.equal(first.files.length, 3);
    assert.match(first.diff, /file-0.txt/);
    assert.doesNotMatch(first.diff, /file-1.txt/);

    // An edit after the first page doesn't change the later pages.
    await writeFile(join(s.repo, "late.txt"), "late\n");
    const pages = [first.diff];

    for (let page = first; page.next_cursor;) {
      page = await s.workspaces.changes(t, "task", page.next_cursor, 10);
      assert.equal(page.files.length, 3);
      pages.push(page.diff);
    }

    // One file per page, each once, in order.
    assert.deepEqual(
      pages.map((page) => /^diff --git a\/(\S+)/.exec(page)?.[1]),
      ["file-0.txt", "file-1.txt", "file-2.txt"],
    );

    assert.doesNotMatch(pages.join(""), /late.txt/);
    assert.equal((await s.workspaces.changes(t)).files.length, 4);

    // A cursor from another base is refused.
    const other = await s.workspaces.changes(t, "turn", undefined, 10);
    t.turn_start_tree = await s.workspaces.snapshot(s.repo);

    await assert.rejects(
      s.workspaces.changes(t, "turn", other.next_cursor),
      /Stale changes cursor/,
    );
  } finally {
    await s.close();
  }
});

test("a removed worktree names its branch, and older tasks get an error", async () => {
  const s = await setup();

  try {
    const t = await s.task("worktree");
    s.git(s.repo, "worktree", "remove", t.workspace!);

    assert.deepEqual(await s.workspaces.changes(t), {
      scope: "task",
      state: "workspace_missing",
      branch: t.branch,
      files: [],
      additions: 0,
      deletions: 0,
      diff: "",
    });

    const older = await s.task("current_repo");
    delete older.start_tree;
    await assert.rejects(s.workspaces.changes(older), /predates/);
    delete older.turn_start_tree;
    await assert.rejects(s.workspaces.changes(older, "turn"), /predates/);

    // A task that hasn't started has no changes yet.
    delete older.workspace;
    assert.deepEqual((await s.workspaces.changes(older)).files, []);
  } finally {
    await s.close();
  }
});

test("changed files are read whole or in parts, with images as base64 and other binaries as a size", async () => {
  const s = await setup();

  try {
    const t = await s.task("worktree");
    const w = t.workspace!;
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
    await writeFile(join(w, "file-0.txt"), "héllo wörld\n".repeat(10));
    await writeFile(join(w, "logo.png"), png);
    await writeFile(join(w, "data.bin"), Buffer.from([1, 0, 2, 0]));
    await rm(join(w, "file-1.txt"));

    const text = await s.workspaces.changedFile(t, "file-0.txt");

    assert.deepEqual(text, {
      path: "file-0.txt",
      state: "present",
      size: Buffer.byteLength("héllo wörld\n".repeat(10)),
      encoding: "utf8",
      content: "héllo wörld\n".repeat(10),
    });

    // Parts join back into the whole file.
    let part = await s.workspaces.changedFile(t, "file-0.txt", undefined, 50);
    let joined = part.content!;

    while (part.next_cursor) {
      part = await s.workspaces.changedFile(
        t,
        "file-0.txt",
        part.next_cursor,
        50,
      );

      joined += part.content;
    }

    assert.equal(joined, text.content);

    assert.deepEqual(await s.workspaces.changedFile(t, "logo.png"), {
      path: "logo.png",
      state: "present",
      size: png.length,
      mime_type: "image/png",
      encoding: "base64",
      content: png.toString("base64"),
    });

    assert.deepEqual(await s.workspaces.changedFile(t, "data.bin"), {
      path: "data.bin",
      state: "binary",
      size: 4,
    });

    assert.deepEqual(await s.workspaces.changedFile(t, "file-1.txt"), {
      path: "file-1.txt",
      state: "deleted",
      size: 0,
    });

    // Unchanged files, and paths outside the repository, are refused.
    for (const path of ["file-2.txt", "../repo/file-2.txt", ".git/config"])
      await assert.rejects(
        s.workspaces.changedFile(t, path),
        /not among this task's changes/,
      );

    // A later part's cursor can't reach an unchanged file either.
    await assert.rejects(
      s.workspaces.changedFile(
        t,
        "file-2.txt",
        `${s.git(w, "rev-parse", "HEAD^{tree}").trim()}:0`,
      ),
      /not among this task's changes/,
    );

    s.git(s.repo, "worktree", "remove", "--force", w);

    await assert.rejects(
      s.workspaces.changedFile(t, "file-0.txt"),
      /worktree was removed; this file is on branch agent\/task_worktree/,
    );
  } finally {
    await s.close();
  }
});
