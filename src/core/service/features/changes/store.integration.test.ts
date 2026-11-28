import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { applyPatch } from "diff";
import { describe, expect, it } from "vitest";

import { composeHunks, formatFileDiff } from "./compose.js";
import { edit, storeFixture } from "./store-test-harness.js";

describe("durable change scopes", () => {
  it("updates both scopes atomically and announces only committed edits (S1)", async (context) => {
    const { changes, store, task } = await storeFixture(context);
    const notifications: string[] = [];

    store.bus.on("change", (owner: string) => {
      notifications.push(owner);
      expect(changes.rows(task, "task")).toHaveLength(1);
      expect(changes.rows(task, "turn")).toHaveLength(1);
    });

    const revision = store.revision(task.owner);

    store.database.client.exec(
      "CREATE TRIGGER reject_turn BEFORE INSERT ON file_changes WHEN NEW.scope = 'turn' BEGIN SELECT RAISE(ABORT, 'turn rejected'); END",
    );

    expect(() => changes.record(task, edit("file.txt"))).toThrow(
      /turn rejected/u,
    );

    expect(changes.rows(task, "task")).toEqual([]);
    expect(changes.rows(task, "turn")).toEqual([]);
    expect(notifications).toEqual([]);
    expect(store.revision(task.owner)).toBe(revision);
    store.database.client.exec("DROP TRIGGER reject_turn");
    changes.record(task, edit("file.txt"));
    expect(notifications).toEqual([task.owner]);
  });

  it("serializes calls submitted together onto each scope's latest diff (S1)", async (context) => {
    const { changes, task } = await storeFixture(context);

    await Promise.all([
      Promise.resolve().then(() =>
        changes.record(task, edit("file.txt", "base\n", "middle\n")),
      ),
      Promise.resolve().then(() =>
        changes.record(task, edit("file.txt", "middle\n", "final\n")),
      ),
    ]);

    for (const scope of ["task", "turn"] as const) {
      const rows = changes.rows(task, scope);
      expect(rows).toHaveLength(1);
      const [row] = rows;
      assert.ok(row);

      expect(
        applyPatch(
          "base\n",
          formatFileDiff(row.path, row.hunks, row.created, row.deleted),
        ),
      ).toBe("final\n");
    }
  });

  it("keeps the first creation flag, the latest deletion and sticky command provenance (S2)", async (context) => {
    const { changes, task } = await storeFixture(context);
    changes.record(task, edit("file.txt", "base\n", "middle\n"));

    changes.record(
      task,
      edit("file.txt", "middle\n", "", {
        created: true,
        deleted: true,
        source: "command",
      }),
    );

    expect(changes.rows(task, "task")[0]).toMatchObject({
      created: false,
      deleted: true,
      source: "command",
      incomplete: false,
    });

    changes.record(task, edit("file.txt", "", "final\n"));

    expect(changes.rows(task, "task")[0]).toMatchObject({
      created: false,
      deleted: false,
      source: "command",
    });

    changes.record(task, edit("new.txt", "", "new\n", { created: true }));
    changes.record(task, edit("new.txt", "new\n", "updated\n"));

    expect(changes.rows(task, "task")[1]).toMatchObject({
      path: "new.txt",
      created: true,
    });
  });

  it("removes exact reversions and files created then deleted (S3)", async (context) => {
    const { changes, task } = await storeFixture(context);
    changes.record(task, edit("file.txt"));
    changes.record(task, edit("file.txt", "after\n", "before\n"));

    changes.record(
      task,
      edit("created.txt", "", "temporary\n", { created: true }),
    );

    changes.record(
      task,
      edit("created.txt", "temporary\n", "", { deleted: true }),
    );

    expect(changes.rows(task, "task")).toEqual([]);
    expect(changes.rows(task, "turn")).toEqual([]);
  });

  it("drops contradictory hunks and keeps an incomplete file through later edits (S4)", async (context) => {
    const { changes, task } = await storeFixture(context);
    changes.record(task, edit("file.txt"));
    changes.record(task, edit("file.txt", "unseen edit\n", "later\n"));

    expect(changes.rows(task, "task")[0]).toMatchObject({
      incomplete: true,
      hunks: [],
    });

    changes.record(
      task,
      edit("file.txt", "later\n", "", { deleted: true, source: "command" }),
    );

    expect(changes.rows(task, "task")[0]).toMatchObject({
      incomplete: true,
      hunks: [],
      deleted: true,
      source: "command",
    });

    changes.record(task, edit("file.txt", "", "recreated\n"));

    expect(changes.rows(task, "task")[0]).toMatchObject({
      incomplete: true,
      hunks: [],
      deleted: false,
    });
  });

  it("marks named files incomplete and retains a separate command marker (S4, S5)", async (context) => {
    const { changes, task } = await storeFixture(context);
    changes.record(task, edit("file.txt"));
    changes.unrecorded(task, "file.txt");
    changes.unrecorded(task);
    changes.unrecorded(task);

    expect(changes.rows(task, "task")).toMatchObject([
      { path: "", incomplete: true, source: "command", hunks: [] },
      { path: "file.txt", incomplete: true, source: "command", hunks: [] },
    ]);

    expect(changes.rows(task, "turn")).toMatchObject([
      { path: "", incomplete: true, source: "command", hunks: [] },
      { path: "file.txt", incomplete: true, source: "command", hunks: [] },
    ]);
  });

  it("preserves provenance when an edit tool's diff could not be captured", async (context) => {
    const { changes, task } = await storeFixture(context);
    changes.unrecorded(task, "tool.txt", "tool");

    expect(changes.rows(task, "task")[0]).toMatchObject({
      source: "tool",
      incomplete: true,
    });

    changes.unrecorded(task, "tool.txt", "command");

    expect(changes.rows(task, "turn")[0]).toMatchObject({
      source: "command",
      incomplete: true,
    });
  });

  it("clears only turn rows and composes the next edit onto independent bases (S6)", async (context) => {
    const { changes, task } = await storeFixture(context);
    changes.record(task, edit("file.txt", "base\n", "first\n"));
    changes.clearTurn(task);
    expect(changes.rows(task, "turn")).toEqual([]);
    expect(changes.rows(task, "task")).toHaveLength(1);
    changes.record(task, edit("file.txt", "first\n", "second\n"));

    const [taskRow] = changes.rows(task, "task");
    const [turnRow] = changes.rows(task, "turn");
    assert.ok(taskRow && turnRow);

    expect(
      applyPatch("base\n", formatFileDiff(taskRow.path, taskRow.hunks)),
    ).toBe("second\n");

    expect(
      applyPatch("first\n", formatFileDiff(turnRow.path, turnRow.hunks)),
    ).toBe("second\n");
  });

  it("retains interrupted task edits across a database reopen (S7)", async (context) => {
    const fixture = await storeFixture(context);
    fixture.changes.record(fixture.task, edit("file.txt"));
    const before = fixture.changes.rows(fixture.task, "task");
    fixture.task.status = "interrupted";
    fixture.store.save(fixture.task);
    fixture.restart();
    const task = fixture.store.get(fixture.task.id, fixture.task.owner);
    expect(task.status).toBe("interrupted");
    expect(fixture.changes.rows(task, "task")).toEqual(before);
  });

  it("cascades task deletion without removing another task's rows (S8)", async (context) => {
    const { changes, store, task } = await storeFixture(context);
    const other = { ...task, id: "changes-other" };
    store.save(other);
    changes.record(task, edit("file.txt"));
    changes.record(other, edit("other.txt"));
    store.delete(task.id, task.owner);
    expect(changes.rows(task, "task")).toEqual([]);
    expect(changes.rows(task, "turn")).toEqual([]);
    expect(changes.rows(other, "task")).toHaveLength(1);
  });
});

describe("canonical edit paths", () => {
  it("matches workspace aliases, symlinked parents and deleted targets (M5)", async (context) => {
    const { changes, directory, workspace, task } = await storeFixture(context);

    const canonical = await realpath(workspace);
    const alias = join(directory, "alias");
    await symlink(workspace, alias, "dir");
    await mkdir(join(workspace, "real"));
    await symlink(join(workspace, "real"), join(workspace, "linked"), "dir");
    await writeFile(join(workspace, "real/file.txt"), "after\n");

    changes.record(
      { ...task, workspace: alias },
      edit(join(canonical, "real/file.txt")),
    );

    changes.record(task, edit("linked/file.txt", "after\n", "final\n"));
    await rm(join(workspace, "real/file.txt"));

    changes.record(
      task,
      edit("linked/file.txt", "final\n", "", { deleted: true }),
    );

    expect(changes.rows(task, "task")).toMatchObject([
      { path: "real/file.txt", deleted: true, incomplete: false },
    ]);

    expect(changes.rows(task, "task")).toHaveLength(1);
  });

  it("drops outside, Git metadata and symlink escapes for recorded and missing edits (M5)", async (context) => {
    const { changes, directory, workspace, task } = await storeFixture(context);

    await mkdir(join(workspace, ".git"));
    await mkdir(join(directory, "outside"));
    await symlink(join(directory, "outside"), join(workspace, "escape"), "dir");
    await symlink(join(workspace, ".git"), join(workspace, "metadata"), "dir");
    // Another letter case names the same directory on case-insensitive file systems.
    const caseInsensitive = existsSync(join(workspace, ".GIT"));

    for (const path of [
      "../outside/file.txt",
      join(directory, "outside/file.txt"),
      ".git/config",
      "escape/file.txt",
      "metadata/config",
      ".",
      ...(caseInsensitive ? [".GIT/config"] : []),
    ]) {
      changes.record(task, edit(path));
      changes.unrecorded(task, path);
    }

    expect(changes.rows(task, "task")).toEqual([]);
    expect(changes.rows(task, "turn")).toEqual([]);
  });
});

describe("Git diff formatting", () => {
  it("produces patches Git applies for created, deleted and quoted paths (C6)", async (context) => {
    const { workspace } = await storeFixture(context);

    const paths = [
      "plain.txt",
      "with space.txt",
      'with"quote.txt',
      "with\ttab.txt",
    ];

    for (const path of paths) {
      const created = formatFileDiff(
        path,
        composeHunks([], edit(path, "", "new\n").hunks, true),
        true,
      );

      expect(created).toContain("new file mode 100644\n");

      expect(() =>
        execFileSync("git", ["apply", "--check", "-"], {
          cwd: workspace,
          input: created,
        }),
      ).not.toThrow();

      await writeFile(join(workspace, path), "old\n");

      const modified = formatFileDiff(
        path,
        composeHunks([], edit(path, "old\n", "new\n").hunks),
      );

      expect(() =>
        execFileSync("git", ["apply", "--check", "-"], {
          cwd: workspace,
          input: modified,
        }),
      ).not.toThrow();

      const deleted = formatFileDiff(
        path,
        composeHunks([], edit(path, "old\n", "").hunks),
        false,
        true,
      );

      expect(deleted).toContain("deleted file mode 100644\n");

      expect(() =>
        execFileSync("git", ["apply", "--check", "-"], {
          cwd: workspace,
          input: deleted,
        }),
      ).not.toThrow();
    }
  });
});
