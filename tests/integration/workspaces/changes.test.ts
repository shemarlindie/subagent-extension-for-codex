import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test, vi } from "vitest";

import { Workspaces } from "../../../src/service/features/workspaces/workspace.js";
import { startSchema, type Task } from "../../../src/shared/tasks/model.js";

async function setup() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "agent-changes-")));
  const repo = join(dir, "repo");
  await mkdir(repo);

  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

  git(repo, "init", "-q");

  for (let i = 0; i < 3; i++) {
    await writeFile(join(repo, `file-${i}.txt`), `line ${i}\n`.repeat(20));
  }

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
      created_by: "user",
      instructions_sent: 0,
      pending_steers: [],
      queue: [],
      turn: 1,
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

    for (let i = 0; i < 3; i++) {
      await writeFile(join(s.repo, `file-${i}.txt`), `edited ${i}\n`);
    }

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

test("a removed worktree's changes are its branch's commits, and a task without snapshots gets an error", async () => {
  const s = await setup();

  try {
    const t = await s.task("worktree");
    const w = t.workspace!;
    await writeFile(join(w, "committed.txt"), "committed\n");
    s.git(w, "add", "committed.txt");

    s.git(
      w,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "worker commit",
    );

    // Uncommitted work goes with the worktree.
    await writeFile(join(w, "draft.txt"), "draft\n");
    s.git(s.repo, "worktree", "remove", "--force", w);

    const changes = await s.workspaces.changes(t);
    assert.equal(changes.state, "workspace_missing");
    assert.equal(changes.branch, t.branch);

    assert.deepEqual(
      changes.files.map((f) => f.path),
      ["committed.txt"],
    );

    assert.match(changes.diff, /\+committed/);

    // Files read from the branch, too.
    assert.equal(
      (await s.workspaces.changedFile(t, "committed.txt")).content,
      "committed\n",
    );

    // Once the branch is deleted, there's nothing to read.
    s.git(s.repo, "branch", "-D", t.branch!);

    assert.deepEqual(await s.workspaces.changes(t), {
      scope: "task",
      state: "branch_deleted",
      branch: t.branch,
      files: [],
      additions: 0,
      deletions: 0,
      diff: "",
    });

    await assert.rejects(
      s.workspaces.changedFile(t, "committed.txt"),
      /were deleted/,
    );

    const untracked = await s.task("current_repo");
    delete untracked.start_tree;
    await assert.rejects(s.workspaces.changes(untracked), /no change snapshot/);
    delete untracked.turn_start_tree;

    await assert.rejects(
      s.workspaces.changes(untracked, "turn"),
      /no change snapshot/,
    );

    // A task that hasn't started has no changes yet.
    delete untracked.workspace;
    assert.deepEqual((await s.workspaces.changes(untracked)).files, []);
  } finally {
    await s.close();
  }
});

test("uncommitted changes keep the task's files that differ from HEAD, and drop them once committed", async () => {
  const s = await setup();

  const commit = (...paths: string[]) => {
    s.git(s.repo, "add", "--", ...paths);

    s.git(
      s.repo,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "user commit",
    );
  };

  // file-0.txt is 20 lines of "line 0"; each edit replaces one line.
  const lines = Array.from({ length: 20 }, () => "line 0");

  const edit = async (line: number, text: string) => {
    lines[line] = text;
    await writeFile(join(s.repo, "file-0.txt"), `${lines.join("\n")}\n`);
  };

  try {
    // The user's own uncommitted edits, from before the task: one to a file
    // the task leaves alone, one to a file it also edits.
    await writeFile(join(s.repo, "file-2.txt"), "user's\n");
    await edit(0, "user's edit");
    const t = await s.task("current_repo");
    await edit(19, "task's edit");
    await writeFile(join(s.repo, "task.txt"), "task\n");
    t.status = "completed";
    t.end_tree = await s.workspaces.snapshot(s.repo);
    // An edit after the task ended, to a file it didn't change.
    await writeFile(join(s.repo, "file-1.txt"), "later\n");

    const uncommitted = () => s.workspaces.uncommittedChanges(t);

    const paths = async () => (await uncommitted()).files.map((f) => f.path);

    assert.deepEqual(await paths(), ["file-0.txt", "task.txt"]);

    // Only the task's edit shows, not the user's earlier one in the same file.
    assert.match((await uncommitted()).diff, /\+task's edit/);
    assert.doesNotMatch((await uncommitted()).diff, /user's edit/);

    // Committing a file drops it; the panel previews only what's left.
    commit("file-0.txt");
    assert.deepEqual(await paths(), ["task.txt"]);

    await assert.rejects(
      s.workspaces.changedFile(t, "file-0.txt", undefined, undefined, true),
      /not among this task's uncommitted changes/,
    );

    assert.equal(
      (
        await s.workspaces.changedFile(
          t,
          "task.txt",
          undefined,
          undefined,
          true,
        )
      ).content,
      "task\n",
    );

    // A later edit to a task's file is uncommitted again, and shows alone:
    // what was committed stays out.
    await edit(10, "edited again");
    assert.deepEqual(await paths(), ["file-0.txt", "task.txt"]);

    const again = (await uncommitted()).files[0];
    assert.deepEqual([again.additions, again.deletions], [1, 1]);
    assert.doesNotMatch((await uncommitted()).diff, /task's edit/);

    // A deletion committed since the start leaves the baseline too.
    await rm(join(s.repo, "file-2.txt"));
    commit("file-2.txt");
    assert.deepEqual(await paths(), ["file-0.txt", "task.txt"]);

    // Pages hold whole files, and later pages read the same state.
    const first = await s.workspaces.uncommittedChanges(
      t,
      "task",
      undefined,
      1,
    );

    assert.match(first.diff, /^diff --git a\/file-0.txt/);
    assert.ok(first.next_cursor);
    await writeFile(join(s.repo, "task.txt"), "changed between pages\n");

    const second = await s.workspaces.uncommittedChanges(
      t,
      "task",
      first.next_cursor,
      1,
    );

    assert.match(second.diff, /^diff --git a\/task.txt[\s\S]*\+task$/m);
    assert.equal(second.next_cursor, undefined);
    await writeFile(join(s.repo, "task.txt"), "task\n");

    commit("file-0.txt", "task.txt");
    assert.deepEqual(await paths(), []);

    // The full view still lists everything the task changed.
    assert.deepEqual(
      (await s.workspaces.changes(t)).files.map((f) => f.path),
      ["file-0.txt", "task.txt"],
    );

    // This turn measures from the turn's start, and from the commit HEAD was
    // on then. file-0.txt, committed before the turn, has an edit left
    // uncommitted when the turn starts; only the turn's own edit shows. A
    // commit made during the turn drops the files it took.
    await edit(5, "before the turn");
    t.turn_start_tree = await s.workspaces.snapshot(s.repo);
    t.turn_head = s.git(s.repo, "rev-parse", "HEAD").trim();
    await edit(6, "in the turn");
    await writeFile(join(s.repo, "turn.txt"), "turn\n");
    commit("turn.txt");
    t.end_tree = await s.workspaces.snapshot(s.repo);
    const turn = await s.workspaces.uncommittedChanges(t, "turn");

    assert.deepEqual(
      turn.files.map((f) => f.path),
      ["file-0.txt"],
    );

    assert.match(turn.diff, /\+in the turn/);
    // It may be a context line, but isn't added or removed.
    assert.doesNotMatch(turn.diff, /^[-+].*before the turn/m);
  } finally {
    await s.close();
  }
});

test("a worktree's uncommitted changes are all of its own, and none once it's removed", async () => {
  const s = await setup();

  try {
    const t = await s.task("worktree");
    const w = t.workspace!;
    await writeFile(join(w, "committed.txt"), "committed\n");
    s.git(w, "add", "committed.txt");

    s.git(
      w,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "worker commit",
    );

    await writeFile(join(w, "file-0.txt"), "draft\n");
    await writeFile(join(w, "new.txt"), "new\n");

    assert.deepEqual(
      (await s.workspaces.uncommittedChanges(t)).files.map((f) => f.path),
      ["file-0.txt", "new.txt"],
    );

    // This turn keeps the files changed since the turn started.
    t.turn_start_tree = await s.workspaces.snapshot(w);
    await writeFile(join(w, "turn.txt"), "turn\n");

    assert.deepEqual(
      (await s.workspaces.uncommittedChanges(t, "turn")).files.map(
        (f) => f.path,
      ),
      ["turn.txt"],
    );

    s.git(s.repo, "worktree", "remove", "--force", w);

    assert.deepEqual(await s.workspaces.uncommittedChanges(t), {
      scope: "task",
      state: "workspace_missing",
      branch: t.branch,
      files: [],
      additions: 0,
      deletions: 0,
      diff: "",
    });
  } finally {
    await s.close();
  }
});

test("a current_repo task that ended without an end snapshot has no changes to show", async () => {
  const s = await setup();

  try {
    const t = await s.task("current_repo");
    await writeFile(join(s.repo, "file-0.txt"), "changed\n");

    // While a turn runs, its changes are live.
    assert.equal((await s.workspaces.changes(t)).files.length, 1);

    // Ended before end snapshots, the checkout now mixes in later edits.
    t.status = "completed";

    assert.deepEqual(await s.workspaces.changes(t), {
      scope: "task",
      state: "end_unrecorded",
      files: [],
      additions: 0,
      deletions: 0,
      diff: "",
    });

    await assert.rejects(
      s.workspaces.changedFile(t, "file-0.txt"),
      /ended before its end state was recorded/,
    );

    // With one, its changes end there.
    t.end_tree = await s.workspaces.snapshot(s.repo);
    await writeFile(join(s.repo, "file-1.txt"), "later\n");

    assert.deepEqual(
      (await s.workspaces.changes(t)).files.map((f) => f.path),
      ["file-0.txt"],
    );
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
    for (const path of ["file-2.txt", "../repo/file-2.txt", ".git/config"]) {
      await assert.rejects(
        s.workspaces.changedFile(t, path),
        /not among this task's changes/,
      );
    }

    // A later part's cursor can't reach an unchanged file either.
    await assert.rejects(
      s.workspaces.changedFile(
        t,
        "file-2.txt",
        `${s.git(w, "rev-parse", "HEAD^{tree}").trim()}:0`,
      ),
      /not among this task's changes/,
    );

    // An uncommitted edit goes with a removed worktree.
    s.git(s.repo, "worktree", "remove", "--force", w);

    await assert.rejects(
      s.workspaces.changedFile(t, "file-0.txt"),
      /not among this task's changes/,
    );
  } finally {
    await s.close();
  }
});

test("later pages reuse the diff of the first, until it expires", async () => {
  const s = await setup();
  vi.useFakeTimers({ toFake: ["Date"] });

  try {
    const t = await s.task("current_repo");

    for (let i = 0; i < 3; i++) {
      await writeFile(join(s.repo, `file-${i}.txt`), `edited ${i}\n`);
    }

    const first = await s.workspaces.changes(t, "task", undefined, 10);

    // Moving the checkout away makes every Git call fail, so a page that
    // still reads must come from the cached diff.
    await rename(s.repo, `${s.repo}-moved`);
    const second = await s.workspaces.changes(t, "task", first.next_cursor, 10);
    assert.match(second.diff, /file-1.txt/);
    assert.deepEqual(second.files, first.files);

    vi.setSystemTime(Date.now() + 61_000);

    await assert.rejects(
      s.workspaces.changes(t, "task", second.next_cursor, 10),
    );
  } finally {
    vi.useRealTimers();
    await s.close();
  }
});

test("only the two most recent diffs are kept", async () => {
  const s = await setup();

  try {
    const t = await s.task("current_repo");

    for (let i = 0; i < 3; i++) {
      await writeFile(join(s.repo, `file-${i}.txt`), `edited ${i}\n`);
    }

    // Three tree pairs: the task's (from HEAD's tree), then the turn's from
    // two other bases, the empty tree and a later snapshot.
    const oldest = await s.workspaces.changes(t, "task", undefined, 10);

    t.turn_start_tree = s
      .git(s.repo, "hash-object", "-t", "tree", "/dev/null")
      .trim();

    await s.workspaces.changes(t, "turn", undefined, 10);

    for (const i of [0, 1]) {
      await writeFile(join(s.repo, `file-${i}.txt`), "turn base\n");
    }

    t.turn_start_tree = await s.workspaces.snapshot(s.repo);

    for (const i of [0, 1]) {
      await writeFile(join(s.repo, `file-${i}.txt`), "edited again\n");
    }

    const newest = await s.workspaces.changes(t, "turn", undefined, 10);
    assert.ok(newest.next_cursor);

    // With Git unreachable, only cached pairs can still be read: the newest
    // pair's next page, but not the oldest pair's.
    await rename(s.repo, `${s.repo}-moved`);

    assert.match(
      (await s.workspaces.changes(t, "turn", newest.next_cursor, 10)).diff,
      /file-1.txt/,
    );

    await assert.rejects(
      s.workspaces.changes(t, "task", oldest.next_cursor, 10),
    );
  } finally {
    await s.close();
  }
});
