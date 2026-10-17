import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { changesFixture, edit } from "./changes-test-harness.js";

describe("change reads", () => {
  it("sorts files, counts incomplete files without lines and pages between whole files (R1 to R3)", async (context) => {
    const { changes, task } = await changesFixture(context);
    changes.record(task, edit("z.txt", "", "created\n", { created: true }));

    changes.record(
      task,
      edit("a.txt", "removed\n", "", { deleted: true, source: "command" }),
    );

    changes.record(task, edit("broken.txt"));
    changes.unrecorded(task, "broken.txt");
    changes.unrecorded(task);
    const first = changes.changes(task, "task", undefined, 1);
    const second = changes.changes(task, "task", first.next_cursor, 1);

    expect(first.files.map((file) => file.path)).toEqual([
      "a.txt",
      "broken.txt",
      "z.txt",
    ]);

    expect(first).toMatchObject({
      additions: 1,
      deletions: 1,
      unrecorded_commands: true,
    });

    expect(first.files[0]).toMatchObject({
      status: "deleted",
      source: "command",
    });

    expect(first.files[2]).toMatchObject({ status: "added", source: "tool" });
    expect(second.files).toEqual(first.files);
    expect(first.diff).toContain("a/a.txt");
    expect(first.diff).not.toContain("z.txt");
    expect(second.diff).toContain("b/z.txt");
    expect(second.next_cursor).toBeUndefined();

    expect(changes.counts(task)).toMatchObject({
      additions: 1,
      deletions: 1,
      files: 3,
    });
  });

  it("rejects stale, malformed and cross-scope change cursors", async (context) => {
    const { changes, task } = await changesFixture(context);
    changes.record(task, edit("a.txt"));
    changes.record(task, edit("b.txt"));
    const cursor = changes.changes(task, "task", undefined, 1).next_cursor;
    expect(cursor).toBeDefined();
    expect(() => changes.changes(task, "turn", cursor)).toThrow(/Stale/u);
    expect(() => changes.changes(task, "task", "invalid")).toThrow(/Invalid/u);
    changes.record(task, edit("a.txt", "after\n", "latest\n"));
    expect(() => changes.changes(task, "task", cursor)).toThrow(/Stale/u);
  });

  it("reads the current file including later edits, and paginates it (R5)", async (context) => {
    const { changes, workspace, task } = await changesFixture(context);
    changes.record(task, edit("file.txt"));

    await writeFile(
      join(workspace, "file.txt"),
      "later edit by someone else\n",
    );

    const first = await changes.changedFile(task, "file.txt", undefined, 5);

    const second = await changes.changedFile(
      task,
      "file.txt",
      first.next_cursor,
      100,
    );

    expect(first).toMatchObject({
      state: "present",
      encoding: "utf8",
      content: "later",
      size: 27,
    });

    expect(first.content! + second.content!).toBe(
      await readFile(join(workspace, "file.txt"), "utf8"),
    );

    expect(second.next_cursor).toBeUndefined();
    await writeFile(join(workspace, "file.txt"), "changed again\n");

    await expect(
      changes.changedFile(task, "file.txt", first.next_cursor),
    ).rejects.toThrow(/Stale/u);

    await expect(
      changes.changedFile(task, "file.txt", "invalid"),
    ).rejects.toThrow(/Invalid/u);
  });

  it("returns missing files as deleted and a removed workspace as unavailable (R5)", async (context) => {
    const { changes, workspace, task } = await changesFixture(context);
    changes.record(task, edit("file.txt"));

    expect(await changes.changedFile(task, "file.txt")).toEqual({
      path: "file.txt",
      state: "deleted",
      size: 0,
    });

    await rm(workspace, { recursive: true });

    expect(await changes.changedFile(task, "file.txt")).toEqual({
      path: "file.txt",
      state: "unavailable",
      size: 0,
    });
  });

  it("allows previews from the latest turn when the task's net diff cancels out (R5)", async (context) => {
    const { changes, workspace, task } = await changesFixture(context);
    changes.record(task, edit("file.txt"));
    changes.clearTurn(task);
    changes.record(task, edit("file.txt", "after\n", "before\n"));
    expect(changes.rows(task, "task")).toEqual([]);
    expect(changes.rows(task, "turn")).toHaveLength(1);
    await writeFile(join(workspace, "file.txt"), "before\n");

    expect(await changes.changedFile(task, "file.txt")).toMatchObject({
      state: "present",
      content: "before\n",
    });
  });

  it("reads images as base64 and other binaries as their size (R5)", async (context) => {
    const { changes, workspace, task } = await changesFixture(context);
    const bytes = Buffer.from([0, 1, 2, 3, 255]);

    for (const path of ["image.png", "binary.dat"]) {
      changes.unrecorded(task, path);
      await writeFile(join(workspace, path), bytes);
    }

    expect(await changes.changedFile(task, "image.png")).toMatchObject({
      state: "present",
      encoding: "base64",
      mime_type: "image/png",
      content: bytes.toString("base64"),
      size: bytes.length,
    });

    expect(await changes.changedFile(task, "binary.dat")).toEqual({
      path: "binary.dat",
      state: "binary",
      size: bytes.length,
    });
  });

  it("restricts file reads to recorded rows and rechecks symlink targets (R5)", async (context) => {
    const { changes, directory, workspace, task } =
      await changesFixture(context);

    await writeFile(join(directory, "secret.txt"), "secret");
    await writeFile(join(workspace, "file.txt"), "after\n");
    changes.record(task, edit("file.txt"));

    await expect(changes.changedFile(task, "../secret.txt")).rejects.toThrow(
      /not among/u,
    );

    await expect(changes.changedFile(task, "unrecorded.txt")).rejects.toThrow(
      /not among/u,
    );

    await expect(changes.changedFile(task, "")).rejects.toThrow(/not among/u);
    await rm(join(workspace, "file.txt"));
    await symlink(join(directory, "secret.txt"), join(workspace, "file.txt"));

    await expect(changes.changedFile(task, "file.txt")).rejects.toThrow(
      /outside/u,
    );
  });
});
