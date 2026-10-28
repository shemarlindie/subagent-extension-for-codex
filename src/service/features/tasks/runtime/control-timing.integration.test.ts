import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";

import type { RunContext } from "../../providers/types.js";
import { input, setup, TestProvider, until } from "./control-test-harness.js";
import { sendRef } from "./timing.js";
import { captureTiming } from "./timing-test-harness.js";

/** Holds "Hold" turns until released or interrupted. */
class Held extends TestProvider {
  release?: () => void;

  override async run(c: RunContext, prompt: string) {
    if (c.task.description === "Hold") {
      await new Promise<void>((resolve, reject) => {
        this.release = resolve;

        c.signal.addEventListener("abort", () =>
          reject(new Error("interrupted")),
        );
      });
    }

    return super.run(c, prompt);
  }
}

const turnPhases = [
  "queue_wait",
  "workspace_preparation",
  "session_selection",
  "prompt_assembly",
  "provider_run",
];

test("each turn records its queue wait, startup steps and provider run", async () => {
  const timing = await captureTiming();
  const { c, store, repo } = await setup();
  const task = await c.start("alice", input(repo));
  await until(() => store.get(task.id, "alice").status === "completed");

  await c.send("alice", task.id, "Continue", "user", {
    request_id: "caller chosen id",
  });

  await until(() => store.get(task.id, "alice").turn === 2);
  await until(() => store.get(task.id, "alice").status === "completed");
  await c.close();

  const records = (await timing.records()).filter(
    (r) => r.task_id === task.id && turnPhases.includes(r.phase as string),
  );

  expect(records).toEqual([
    expect.objectContaining({
      phase: "queue_wait",
      turn: 1,
      cause: "start",
      outcome: "success",
    }),
    expect.objectContaining({
      phase: "workspace_preparation",
      turn: 1,
      workspace_strategy: "worktree",
      workspace_action: "created",
      outcome: "success",
    }),
    expect.objectContaining({
      phase: "session_selection",
      session: "new",
      new_session_reason: "no_session",
    }),
    expect.objectContaining({ phase: "prompt_assembly", session: "new" }),
    expect.objectContaining({
      phase: "provider_run",
      outcome: "success",
      input_wait_ms: 0,
    }),
    expect.objectContaining({
      phase: "queue_wait",
      turn: 2,
      cause: "followup",
    }),
    expect.objectContaining({
      phase: "workspace_preparation",
      turn: 2,
      workspace_action: "reused",
    }),
    expect.objectContaining({ phase: "session_selection", session: "resumed" }),
    expect.objectContaining({ phase: "prompt_assembly", session: "resumed" }),
    expect.objectContaining({ phase: "provider_run", turn: 2 }),
  ]);

  expect(await timing.records("send_storage")).toEqual([
    expect.objectContaining({
      task_id: task.id,
      send_ref: sendRef("caller chosen id"),
      outcome: "success",
    }),
  ]);

  expect(await readFile(timing.path, "utf8")).not.toContain("caller chosen id");
});

test("a provider run reports the time it waited for the user", async () => {
  const timing = await captureTiming();
  const { c, store, repo } = await setup();
  const task = await c.start("alice", input(repo, "[input]"));
  await until(() => !!store.get(task.id, "alice").pending_input);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const request = store.get(task.id, "alice").pending_input!;
  c.input("alice", task.id, request.id, true, { answer: "yes" });
  await until(() => store.get(task.id, "alice").status === "completed");
  await c.close();

  const [wait] = await timing.records("input_wait");
  const [run] = await timing.records("provider_run");

  expect(wait).toMatchObject({ task_id: task.id, outcome: "success" });
  expect(wait?.duration_ms).toBeGreaterThanOrEqual(20);
  expect(run?.input_wait_ms).toBe(wait?.duration_ms);
  expect(run?.duration_ms).toBeGreaterThan(run?.input_wait_ms as number);
});

test("queue waits end once when a waiting task is interrupted or deleted", async () => {
  const timing = await captureTiming();
  const provider = new Held();
  const { c, store, repo } = await setup(provider, 1);
  const held = await c.start("alice", input(repo, "Hold"));
  await until(() => !!provider.release);
  const interrupted = await c.start("alice", input(repo));
  const deleted = await c.start("alice", input(repo));

  await c.interrupt("alice", interrupted.id);
  await c.delete("alice", deleted.id);
  provider.release?.();
  await until(() => store.get(held.id, "alice").status === "completed");
  await c.close();

  const waits = await timing.records("queue_wait");

  expect(waits.filter((r) => r.task_id !== held.id)).toEqual([
    expect.objectContaining({
      task_id: interrupted.id,
      outcome: "aborted",
      cause: "start",
    }),
    expect.objectContaining({ task_id: deleted.id, outcome: "aborted" }),
  ]);

  // Both waited only while the held turn filled the single slot.
  for (const wait of waits.filter((r) => r.task_id !== held.id)) {
    expect(wait.capacity_ms).toBe(wait.duration_ms);
  }
});

test("a dependent's queue wait reports when it was seen waiting on a dependency", async () => {
  const timing = await captureTiming();
  const provider = new Held();
  const { c, store, repo } = await setup(provider);
  const held = await c.start("alice", input(repo, "Hold"));

  const dependent = await c.start("alice", {
    ...input(repo),
    depends_on: [held.id],
  });

  await until(() => store.get(dependent.id, "alice").status === "waiting");
  await until(() => !!provider.release);
  provider.release?.();
  await until(() => store.get(dependent.id, "alice").status === "completed");
  await c.close();

  const [wait] = (await timing.records("queue_wait")).filter(
    (r) => r.task_id === dependent.id,
  );

  expect(wait).toMatchObject({ outcome: "success", capacity_ms: 0 });
  expect(wait?.dependency_observation_span_ms).toBeGreaterThanOrEqual(0);
  expect(wait?.since_dependency_observed_ms).toBeGreaterThan(0);
});
