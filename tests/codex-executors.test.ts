import { test } from "node:test";
import assert from "node:assert/strict";
import { CodexExecutors } from "../src/providers/codex-executors.js";
import { startSchema, type Task } from "../src/model.js";
import type { ExecutorHandle } from "../src/providers/mac-executor.js";

const task: Task = {
  ...startSchema.parse({ title: "Review", description: "Review" }),
  id: "task_one",
  owner: "alice",
  workspace: "/worktree/one",
  session_id: "sess_one",
  status: "running",
  attempt: 1,
  runtime_ms: 0,
  instructions: [],
  created_at: "now",
  updated_at: "now",
};
const ref = {
  session_id: "sess_one",
  state_ref: "openai-agent-session:sess_one",
  environment_id: "env_one",
  remote_url: "https://api.openai.com/executor",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const ending = deferred<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>();
  let stops = 0;
  const handle: ExecutorHandle = {
    exited: ending.promise,
    stop: async () => {
      stops++;
      ending.resolve({ code: 0, signal: null });
    },
  };
  return { handle, ending, stops: () => stops };
}

test("concurrent executor acquisitions share startup and keep compute between turns", async () => {
  const f = fixture();
  const ready = deferred<ExecutorHandle>();
  let starts = 0;
  const pool = new CodexExecutors({
    start: async () => {
      starts++;
      return ready.promise;
    },
  });
  const first = pool.acquire(task, ref),
    second = pool.acquire(task, ref);
  await Promise.resolve();
  assert.equal(starts, 1);
  ready.resolve(f.handle);
  const [a, b] = await Promise.all([first, second]);
  await assert.rejects(pool.stop(task, ref), /still in use/);
  a.release();
  a.release();
  b.release();
  assert.equal(f.stops(), 0);
  const continued = await pool.acquire({ ...task, attempt: 2 }, ref);
  assert.equal(starts, 1);
  continued.release();
  await pool.stop(task, ref);
  assert.equal(f.stops(), 1);
  await pool.close();
});

test("executor acquisition verifies persisted session and rejects changed ownership, workspace and policy", async () => {
  const f = fixture();
  const pool = new CodexExecutors({ start: async () => f.handle });
  await assert.rejects(
    pool.acquire({ ...task, session_id: undefined }, ref),
    /Persist/,
  );
  const lease = await pool.acquire(task, ref);
  for (const changed of [
    { ...task, owner: "bob" },
    { ...task, workspace: "/other" },
    { ...task, worker_profile: "implementer" as const },
  ])
    await assert.rejects(pool.acquire(changed, ref), /identity changed/);
  await assert.rejects(
    pool.stop({ ...task, owner: "bob" }, ref),
    /identity changed/,
  );
  await assert.rejects(
    pool.acquire(task, { ...ref, environment_id: "other" }),
    /identity changed/,
  );
  lease.release();
  await pool.close();
});

test("shutdown waits for pending startup, stops its executor and refuses new work", async () => {
  const f = fixture();
  const ready = deferred<ExecutorHandle>();
  const pool = new CodexExecutors({ start: () => ready.promise });
  const acquiring = assert.rejects(pool.acquire(task, ref), /unavailable/);
  const closing = pool.close();
  assert.equal(pool.close(), closing);
  await assert.rejects(pool.acquire(task, ref), /shutting down/);
  ready.resolve(f.handle);
  await Promise.all([acquiring, closing]);
  assert.equal(f.stops(), 1);
});

test("startup captures immutable task and session identity", async () => {
  const f = fixture();
  let observed: Task | undefined;
  const pool = new CodexExecutors({
    start: async (input) => {
      observed = input;
      return f.handle;
    },
  });
  const mutable = structuredClone(task);
  const acquiring = pool.acquire(mutable, ref);
  mutable.workspace = "/wrong";
  const lease = await acquiring;
  assert.equal(observed?.workspace, task.workspace);
  lease.release();
  await pool.close();
});

test("failed startup can retry, but executor exit cannot replace compute while still leased", async () => {
  const f = fixture();
  let starts = 0;
  const pool = new CodexExecutors({
    start: async () => {
      if (++starts === 1) throw new Error("startup failed");
      return f.handle;
    },
  });
  await assert.rejects(pool.acquire(task, ref), /startup failed/);
  await new Promise((resolve) => setImmediate(resolve));
  const lease = await pool.acquire(task, ref);
  f.ending.resolve({ code: 1, signal: null });
  await lease.exited;
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(pool.acquire(task, ref), /has exited/);
  assert.equal(starts, 2);
  lease.release();
  await pool.close();
});

test("shutdown reports stop failure and keeps the service closed", async () => {
  const f = fixture();
  const pool = new CodexExecutors({
    start: async () => ({
      ...f.handle,
      stop: async () => {
        throw new Error("termination failed");
      },
    }),
  });
  const lease = await pool.acquire(task, ref);
  lease.release();
  await assert.rejects(pool.close(), AggregateError);
  await assert.rejects(pool.acquire(task, ref), /shutting down/);
  f.ending.resolve({ code: 0, signal: null });
});

test("turn ownership excludes concurrent input writers and releases after a failed turn", async () => {
  const f = fixture();
  const pool = new CodexExecutors({ start: async () => f.handle });
  const turn = deferred<void>();
  const running = assert.rejects(
    pool.run(task, ref, () => turn.promise),
    /turn failed/,
  );
  await assert.rejects(
    pool.run(task, ref, async () => "duplicate"),
    /active Codex turn/,
  );
  await assert.rejects(pool.stop(task, ref), /still in use/);
  turn.reject(new Error("turn failed"));
  await running;
  assert.equal(await pool.run(task, ref, async () => "continued"), "continued");
  assert.equal(f.stops(), 0);
  await pool.close();
});
