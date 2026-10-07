import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import {
  startSchema,
  type Task,
  UnconfirmedTerminationError,
} from "../../../shared/contracts.js";
import { Store } from "../../tasks/store.js";
import { ExecutorJournal } from "./journal.js";
import { MacExecutor } from "./mac-executor.js";

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "ac-executor-journal-"));
  const db = join(dir, "state.sqlite");
  const store = new Store(db);

  const task: Task = {
    ...startSchema.parse({
      provider: "codex",
      description: "Review",
      budget: { max_cost_usd: null },
    }),
    id: "task_one",
    title: "Review",
    owner: "alice",
    workspace: dir,
    session_id: "sess_one",
    attempt: 1,
    instructions: [],
    runtime_ms: 0,
    provider_recovery_required: false,
    status: "running",
    created_at: "now",
    updated_at: "now",
  };

  store.save(task);

  const ref = {
    session_id: "sess_one",
    state_ref: "openai-agent-session:sess_one",
    environment_id: "env_one",
    remote_url: "https://api.openai.com/executor?opaque=private",
  };

  return { dir, db, store, task, ref, journal: new ExecutorJournal(store) };
}

test("executor reservation survives restart and blocks duplicate compute without storing remote URL secrets", async () => {
  const f = await setup();
  const record = f.journal.reserve(f.task, f.ref);
  assert.equal(record.phase, "starting");
  assert.equal(record.pid, undefined);
  const row = f.store.db.prepare("SELECT body FROM codex_executors").get()!;
  assert.ok(!String(row.body).includes("private"));
  f.store.close();
  const reopened = new Store(f.db);
  const journal = new ExecutorJournal(reopened);
  assert.deepEqual(journal.read(f.task), record);

  assert.throws(
    () => journal.reserve(f.task, f.ref),
    UnconfirmedTerminationError,
  );

  reopened.close();
});

test("executor PID updates are bound to launch identity and only a confirmed stop permits a fresh launch", async () => {
  const f = await setup();
  const first = f.journal.reserve(f.task, f.ref);
  f.journal.running(f.task, first.launch_id, 12345);
  assert.equal(f.journal.read(f.task)?.pid, 12345);
  assert.throws(() => f.journal.reserve(f.task, f.ref), /remains unconfirmed/);
  f.journal.uncertain(f.task, first.launch_id);
  assert.throws(() => f.journal.reserve(f.task, f.ref), /remains unconfirmed/);
  f.journal.stopped(f.task, first.launch_id);
  const next = f.journal.reserve(f.task, f.ref);
  assert.notEqual(next.launch_id, first.launch_id);
  assert.throws(() => f.journal.stopped(f.task, first.launch_id), /Stale/);
  assert.equal(f.journal.read(f.task)?.launch_id, next.launch_id);
  f.store.close();
});

test("executor journal rejects changed owners, workspaces, policies and malformed durable records", async () => {
  const f = await setup();
  const record = f.journal.reserve(f.task, f.ref);
  assert.throws(() => f.journal.read({ ...f.task, owner: "bob" }), /not found/);

  assert.throws(
    () => f.journal.reserve({ ...f.task, workspace: "/other" }, f.ref),
    /not been persisted/,
  );

  assert.throws(
    () =>
      f.journal.reserve({ ...f.task, worker_profile: "implementer" }, f.ref),
    /not been persisted/,
  );

  assert.throws(() => f.journal.running(f.task, record.launch_id, -1));

  f.store.db
    .prepare("UPDATE codex_executors SET body=?")
    .run(JSON.stringify({ ...record, pid: "not a PID" }));

  assert.throws(() => f.journal.reserve(f.task, f.ref));
  f.store.close();
});

test("native recovery fails closed for stale launches and does not signal a stored PID", async () => {
  const f = await setup();

  const executor = new MacExecutor(
    "/unused",
    f.dir,
    "test-placeholder",
    f.journal,
  );

  await executor.recover(f.task);
  const record = f.journal.reserve(f.task, f.ref);
  f.journal.running(f.task, record.launch_id, process.pid);
  await assert.rejects(executor.recover(f.task), UnconfirmedTerminationError);
  // This deliberately points at the test runner: recovery must not signal it.
  process.kill(process.pid, 0);
  f.journal.stopped(f.task, record.launch_id);
  await executor.recover(f.task);
  f.store.close();
});

test(
  "macOS executor persists its actual process group and confirms shutdown before allowing replacement",
  { skip: process.platform !== "darwin" },
  async () => {
    const f = await setup();

    try {
      const repository = join(f.dir, "repository");
      execFileSync("git", ["init", "-q", repository]);
      f.task.workspace = repository;
      f.store.save(f.task);
      const executable = join(f.dir, "test-executor");

      await writeFile(executable, "#!/bin/sh\nwhile read line; do :; done\n", {
        mode: 0o700,
      });

      const executor = new MacExecutor(
        executable,
        join(f.dir, "runtime"),
        "test-placeholder",
        f.journal,
      );

      const invalid = new MacExecutor(
        executable,
        join(repository, "runtime"),
        "test-placeholder",
        f.journal,
      );

      await assert.rejects(
        invalid.start(f.task, f.ref),
        /runtime must be outside/,
      );

      assert.equal(f.journal.read(f.task), undefined);
      const handle = await executor.start(f.task, f.ref);
      const record = f.journal.read(f.task)!;
      assert.equal(record.phase, "running");
      assert.ok(record.pid);
      process.kill(record.pid!, 0);

      await assert.rejects(
        executor.start(f.task, f.ref),
        /remains unconfirmed/,
      );

      await handle.stop();
      assert.equal(f.journal.read(f.task)?.phase, "stopped");
      await executor.recover(f.task);
    } finally {
      f.store.close();
    }
  },
);

test(
  "recovery terminates a verified surviving group after reopening the journal, including the pre-PID startup gap",
  { skip: process.platform !== "darwin" },
  async () => {
    for (const phase of ["running", "starting"]) {
      const f = await setup();
      const repository = join(f.dir, "repository");
      execFileSync("git", ["init", "-q", repository]);
      f.task.workspace = repository;
      f.store.save(f.task);
      const executable = join(f.dir, "test-executor");

      await writeFile(executable, "#!/bin/sh\nwhile read line; do :; done\n", {
        mode: 0o700,
      });

      const original = new MacExecutor(
        executable,
        join(f.dir, "runtime"),
        "test-placeholder",
        f.journal,
      );

      const handle = await original.start(f.task, f.ref);
      const saved = f.journal.read(f.task)!;
      assert.equal(saved.process?.pgid, saved.pid);
      assert.ok(saved.process?.started);
      assert.ok(!JSON.stringify(saved).includes("opaque=private"));

      if (phase === "starting") {
        f.store.db.prepare("UPDATE codex_executors SET body=?").run(
          JSON.stringify({
            ...saved,
            phase,
            pid: undefined,
            process: undefined,
          }),
        );
      }

      f.store.close();
      const store = new Store(f.db);

      try {
        const journal = new ExecutorJournal(store);

        const recovered = new MacExecutor(
          executable,
          join(f.dir, "runtime"),
          "test-placeholder",
          journal,
        );

        await recovered.recover(f.task);
        await handle.exited;
        assert.equal(journal.read(f.task)?.phase, "stopped");

        assert.throws(
          () => process.kill(-saved.pid!, 0),
          (error: NodeJS.ErrnoException) => error.code === "ESRCH",
        );

        await recovered.recover(f.task);
      } finally {
        await handle.stop().catch(() => {});
        store.close();
      }
    }
  },
);
