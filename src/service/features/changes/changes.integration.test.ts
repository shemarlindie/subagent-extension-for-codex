import { rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { changesFixture, edit } from "./changes-test-harness.js";

describe("change reads", () => {
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
