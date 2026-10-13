import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { test } from "vitest";

import { FixtureProvider } from "../../../dev/service/fixture-provider.js";
import { Projects } from "../../../src/service/features/projects/projects.js";
import { Control } from "../../../src/service/features/tasks/runtime/control.js";
import { Store } from "../../../src/service/features/tasks/storage/store.js";
import { Workspaces } from "../../../src/service/features/workspaces/workspace.js";
import { startSchema, type Task } from "../../../src/shared/tasks/model.js";
import { waitForListening } from "../../support/helpers.js";

const exec = promisify(execFile);

test(
  "listener collision fails before persisted task recovery or queued worktree creation",
  { timeout: 20000 },
  async (t) => {
    const dir = await realpath(
      await mkdtemp(join(tmpdir(), "review-lifecycle-")),
    );

    t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
    const repository = join(dir, "repository");
    const data = join(dir, "data");
    await mkdir(repository);
    execFileSync("git", ["init", "-q", repository]);

    execFileSync("git", [
      "-C",
      repository,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "initial",
    ]);

    const store = new Store(join(data, "console.sqlite"));

    new Control(
      store,
      new Workspaces(join(data, "worktrees"), []),
      new Map([["fixture", new FixtureProvider()]]),
    );

    const projects = new Projects(
      store.database,
      new Workspaces(join(data, "worktrees"), []),
    );

    await projects.register(repository);

    for (const status of ["running", "queued"] as const) {
      const timestamp = new Date().toISOString();

      const task: Task = {
        ...startSchema.parse({
          provider: "fixture",
          description: "Review [input]",
          repository,
        }),
        id: `task_collision_${status}`,
        title: "Review [input]",
        owner: "owner",
        status,
        created_at: timestamp,
        updated_at: timestamp,
        instructions: [],
        created_by: "user",
        instructions_sent: 0,
        pending_steers: [],
        queue: [],
        turn: 1,
        runtime_ms: 0,
      };

      store.save(task);
      store.event(task, "task.created");
    }

    const before = store.all();

    const beforeEvents = before.map((task) =>
      store.events(task.id, task.owner),
    );

    store.close();

    const reservation = createServer();
    await waitForListening(reservation.listen(0, "127.0.0.1"));

    t.onTestFinished(
      () =>
        new Promise<void>((done, reject) =>
          reservation.close((error) => (error ? reject(error) : done())),
        ),
    );

    const port = (reservation.address() as import("node:net").AddressInfo).port;
    const env = { ...process.env };

    for (const key of Object.keys(env)) {
      if (key.startsWith("CODEX_SUBAGENT_EXTENSION_") || key === "PORT")
        delete env[key];
    }

    await assert.rejects(
      exec(
        process.execPath,
        [fileURLToPath(new URL("../../../dist/main.js", import.meta.url))],
        {
          env: {
            ...env,
            CODEX_SUBAGENT_EXTENSION_DATA: data,
            PORT: String(port),
          },
          timeout: 15000,
        },
      ),
      /EADDRINUSE|address already in use/,
    );

    const reopened = new Store(join(data, "console.sqlite"));

    try {
      assert.deepEqual(reopened.all(), before);

      assert.deepEqual(
        before.map((task) => reopened.events(task.id, task.owner)),
        beforeEvents,
      );
    } finally {
      reopened.close();
    }

    const worktrees = await readdir(join(data, "worktrees")).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );

    assert.deepEqual(worktrees, []);

    assert.equal(
      execFileSync(
        "git",
        ["-C", repository, "worktree", "list", "--porcelain"],
        { encoding: "utf8" },
      ).match(/^worktree /gm)?.length,
      1,
    );
  },
);
