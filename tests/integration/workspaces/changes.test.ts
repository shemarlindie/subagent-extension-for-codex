import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { structuredPatch } from "diff";
import { expect, test } from "vitest";

import { FixtureProvider } from "../../../dev/service/fixture-provider.js";
import type { RunContext } from "../../../src/service/features/providers/types.js";
import { Control } from "../../../src/service/features/tasks/runtime/control.js";
import { Store } from "../../../src/service/features/tasks/storage/store.js";
import { Workspaces } from "../../../src/service/features/workspaces/workspace.js";
import { callTool } from "../../../src/service/platform/server/tools.js";
import type {
  ChangeCounts,
  ChangedFileContent,
  Changes,
} from "../../../src/shared/changes/changes.js";
import { copyCommittedRepository } from "../../support/repository-test-harness.js";

async function until(done: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (done()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Task did not complete");
}

async function setup() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "agent-changes-")));
  const repo = join(dir, "repo");
  await copyCommittedRepository(repo, { "existing.txt": "before\n" });

  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

  const provider = new FixtureProvider();

  const c = new Control(
    new Store(join(dir, "tasks.sqlite")),
    new Workspaces(join(dir, "worktrees"), [repo]),
    new Map([[provider.id, provider]]),
  );

  const tool = <T>(
    name: string,
    args: Record<string, unknown>,
    authority: "parent" | "user" = "parent",
  ) => callTool(c, "alice", name, args, authority) as Promise<T>;

  const done = async (id: string) => {
    await until(
      () =>
        !c.active.has(id) &&
        ["completed", "failed", "interrupted"].includes(
          c.store.get(id, "alice").status,
        ),
    );

    return c.store.get(id, "alice");
  };

  const start = async (
    run: (context: RunContext, prompt: string) => Promise<void>,
    workspace_strategy: "current_repo" | "worktree" = "current_repo",
    depends_on: string[] = [],
  ) => {
    provider.run = async (context, prompt) => {
      await run(context, prompt);

      return { reply: "Done" };
    };

    const task = await c.start("alice", {
      repository: repo,
      provider: "fixture",
      description: "Edit files",
      workspace_strategy,
      depends_on,
    });

    return done(task.id);
  };

  return {
    dir,
    repo,
    git,
    c,
    provider,
    tool,
    done,
    start,
    close: async () => {
      await c.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function edit(
  c: RunContext,
  path: string,
  before: string,
  after: string,
  source: "tool" | "command" = "tool",
) {
  const full = join(c.task.workspace!, path);
  if (after) await writeFile(full, after);
  else await rm(full, { force: true });

  c.fileChanged({
    path: full,
    hunks: structuredPatch("", "", before, after).hunks,
    ...(!before ? { created: true as const } : {}),
    ...(!after ? { deleted: true as const } : {}),
    source,
  });
}

test("change tools return sorted recorded edits, incomplete files and command warnings for both audiences", async () => {
  const s = await setup();

  try {
    const t = await s.start(async (c) => {
      await edit(c, "z.txt", "", "last\n", "command");
      await edit(c, "existing.txt", "before\n", "after\n");

      await writeFile(
        join(c.task.workspace!, "binary.bin"),
        Buffer.from([0, 1]),
      );

      c.editUnrecorded(join(c.task.workspace!, "binary.bin"));
      c.editUnrecorded();
    });

    const args = { task_id: t.id };
    const changes = await s.tool<Changes>("get_changes", args);

    expect(
      changes.files.map((f) => [f.path, f.status, f.source, !!f.incomplete]),
    ).toEqual([
      ["binary.bin", "modified", "command", true],
      ["existing.txt", "modified", "tool", false],
      ["z.txt", "added", "command", false],
    ]);

    expect(changes.additions).toBe(2);
    expect(changes.deletions).toBe(1);
    expect(changes.diff).not.toContain("binary.bin");
    expect(changes.diff).toContain("+after");
    expect(changes.unrecorded_commands).toBe(true);

    const counts = await s.tool<ChangeCounts>(
      "app_get_change_counts",
      args,
      "user",
    );

    expect(counts.files).toBe(3);
    expect(counts.additions).toBe(changes.additions);
    expect(counts.deletions).toBe(changes.deletions);

    expect(s.git(s.repo, "for-each-ref", "refs/agent-tasks")).toBe("");
  } finally {
    await s.close();
  }
});

test("pages split only between whole files and every page lists all files", async () => {
  const s = await setup();

  try {
    const t = await s.start(async (c) => {
      for (const name of ["c.txt", "a.txt", "b.txt"]) {
        await edit(c, name, "", `${name}\n`);
      }
    });

    let page = s.c.changes.changes(t, "task", undefined, 1);
    const diffs = [page.diff];

    while (page.next_cursor) {
      page = s.c.changes.changes(t, "task", page.next_cursor, 1);

      expect(page.files.map((f) => f.path)).toEqual([
        "a.txt",
        "b.txt",
        "c.txt",
      ]);

      diffs.push(page.diff);
    }

    expect(diffs.map((d) => /^diff --git a\/(\S+)/.exec(d)?.[1])).toEqual([
      "a.txt",
      "b.txt",
      "c.txt",
    ]);
  } finally {
    await s.close();
  }
});

test("recorded worktree diffs survive a commit, workspace removal and branch deletion", async () => {
  const s = await setup();

  try {
    const t = await s.start(async (c) => {
      await edit(c, "existing.txt", "before\n", "recorded\n");
      await edit(c, "new.txt", "", "new content\n");
    }, "worktree");

    const args = { task_id: t.id };
    const original = await s.tool<Changes>("get_changes", args);
    expect(t.branch).toBe(`agent/${t.id}`);

    expect(s.git(t.workspace!, "branch", "--show-current").trim()).toBe(
      t.branch,
    );

    expect(original.files.map((file) => [file.path, file.status])).toEqual([
      ["existing.txt", "modified"],
      ["new.txt", "added"],
    ]);

    expect(original.diff).toContain("+recorded");
    expect(original.diff).toContain("+new content");

    execFileSync("git", ["-C", s.repo, "apply", "--check", "-"], {
      input: original.diff,
    });

    expect(await readFile(join(s.repo, "existing.txt"), "utf8")).toBe(
      "before\n",
    );

    s.git(t.workspace!, "add", "existing.txt");

    s.git(
      t.workspace!,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "task edits",
    );

    expect(s.git(s.repo, "log", "-1", "--format=%s", t.branch!).trim()).toBe(
      "task edits",
    );

    expect(await s.tool<Changes>("get_changes", args)).toEqual(original);
    await s.c.workspaces.removeWorktree(t, true);
    expect(await s.tool<Changes>("get_changes", args)).toEqual(original);

    expect(
      (
        await s.tool<ChangedFileContent>("get_changed_file", {
          ...args,
          path: "existing.txt",
        })
      ).state,
    ).toBe("unavailable");

    await s.c.workspaces.deleteBranch(t);
    expect(await s.tool<Changes>("get_changes", args)).toEqual(original);
  } finally {
    await s.close();
  }
});

test("file tools read current disk content, page UTF-8, preview images and restrict paths to recorded files", async () => {
  const s = await setup();

  try {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);

    const t = await s.start(async (c) => {
      await edit(c, "existing.txt", "before\n", "recorded\n");
      await writeFile(join(c.task.workspace!, "logo.png"), png);

      await writeFile(
        join(c.task.workspace!, "data.bin"),
        Buffer.from([1, 0, 2, 0]),
      );

      c.editUnrecorded(join(c.task.workspace!, "logo.png"));
      c.editUnrecorded(join(c.task.workspace!, "data.bin"));
    });

    const args = { task_id: t.id };
    const content = "héllo wörld\n".repeat(10);
    await writeFile(join(s.repo, "existing.txt"), content);

    const file = await s.tool<ChangedFileContent>("get_changed_file", {
      ...args,
      path: "existing.txt",
    });

    expect(file).toMatchObject({
      state: "present",
      encoding: "utf8",
      content,
      size: Buffer.byteLength(content),
    });

    let part = await s.c.changes.changedFile(t, "existing.txt", undefined, 50);
    const firstCursor = part.next_cursor;
    expect(firstCursor).toBeDefined();
    let joined = part.content!;

    while (part.next_cursor) {
      part = await s.c.changes.changedFile(
        t,
        "existing.txt",
        part.next_cursor,
        50,
      );

      joined += part.content;
    }

    expect(joined).toBe(content);

    await writeFile(join(s.repo, "existing.txt"), "changed again\n");

    await expect(
      s.tool("get_changed_file", {
        ...args,
        path: "existing.txt",
        cursor: firstCursor,
      }),
    ).rejects.toThrow(/Stale/);

    await expect(
      s.tool("get_changed_file", {
        ...args,
        path: "existing.txt",
        cursor: "invalid",
      }),
    ).rejects.toThrow(/Invalid/);

    expect(
      await s.tool<ChangedFileContent>("get_changed_file", {
        ...args,
        path: "logo.png",
      }),
    ).toMatchObject({
      state: "present",
      encoding: "base64",
      content: png.toString("base64"),
      mime_type: "image/png",
    });

    expect(
      await s.tool<ChangedFileContent>("get_changed_file", {
        ...args,
        path: "data.bin",
      }),
    ).toMatchObject({ state: "binary", size: 4 });

    await rm(join(s.repo, "existing.txt"));

    expect(
      (
        await s.tool<ChangedFileContent>("get_changed_file", {
          ...args,
          path: "existing.txt",
        })
      ).state,
    ).toBe("deleted");

    for (const path of [
      "unrecorded.txt",
      "../repo/existing.txt",
      ".git/config",
    ]) {
      await expect(
        s.tool("get_changed_file", { ...args, path }),
      ).rejects.toThrow(/not among this task's changes/);
    }
  } finally {
    await s.close();
  }
});

test("dependent prompts include the recorded diff within the existing size limit and note unrecorded edits", async () => {
  const s = await setup();

  try {
    const first = await s.start(async (c) => {
      await edit(c, "large.txt", "", `${"x".repeat(60_000)}\nend-of-diff\n`);
      c.editUnrecorded(join(c.task.workspace!, "blob.bin"));
      c.editUnrecorded();
    }, "worktree");

    await s.c.workspaces.removeWorktree(first, true);
    await s.c.workspaces.deleteBranch(first);
    let prompt = "";

    await s.start(
      async (_c, p) => {
        prompt = p;
      },
      "worktree",
      [first.id],
    );

    expect(prompt).toContain(`Dependency ${first.id} replied:\nDone`);

    expect(prompt).toContain(
      `Dependency ${first.id}'s recorded edits (2 files, +2 −0):`,
    );

    expect(prompt).toContain(
      "Edits to blob.bin weren't recorded, so they have no diff.",
    );

    expect(prompt).toContain(
      "Commands also changed files that weren't recorded.",
    );

    expect(prompt).toContain("diff --git a/large.txt b/large.txt");
    expect(prompt).toContain(`+${"x".repeat(100)}`);
    expect(prompt).toContain("diff truncated");
    expect(prompt).not.toContain("end-of-diff");
  } finally {
    await s.close();
  }
});

test("starting, steering, waiting for input and finishing create no task snapshot refs", async () => {
  const s = await setup();
  let steered: (() => void) | undefined;

  const steer = new Promise<void>((resolve) => {
    steered = resolve;
  });

  try {
    s.provider.run = async (c) => {
      c.acceptSteers((message) => {
        c.steerTaken(message.id);
        steered!();

        return true;
      });

      await edit(c, "recorded.txt", "", "worker\n");
      await steer;

      await c.input(
        "AskUserQuestion",
        { questions: [{ question: "Continue?" }] },
        c.signal,
      );

      return { reply: "Done" };
    };

    const t = await s.c.start("alice", {
      repository: s.repo,
      description: "Edit and ask",
      provider: "fixture",
    });

    await until(() => s.c.store.get(t.id, "alice").status === "running");
    expect(s.git(s.repo, "for-each-ref", "refs/agent-tasks")).toBe("");
    await s.c.send("alice", t.id, "Steer", "user");
    await until(() => !!s.c.store.get(t.id, "alice").pending_input);
    expect(s.git(s.repo, "for-each-ref", "refs/agent-tasks")).toBe("");
    await writeFile(join(s.repo, "user-during-wait.txt"), "user\n");
    const waiting = s.c.store.get(t.id, "alice");
    s.c.input("alice", t.id, waiting.pending_input!.id, true);
    await s.done(t.id);
    expect(s.git(s.repo, "for-each-ref", "refs/agent-tasks")).toBe("");

    const changes = await s.tool<Changes>("get_changes", {
      task_id: t.id,
    });

    expect(changes.files.map((f) => f.path)).toEqual(["recorded.txt"]);
  } finally {
    await s.close();
  }
});
