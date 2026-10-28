import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { test } from "vitest";

import {
  DependencyWriter,
  input,
  setup,
  until,
} from "./control-test-harness.js";

test("dependents wait on an interrupted dependency and fail with a failed one, and a follow-up resumes them", async () => {
  const { c, store, repo } = await setup();
  const first = await c.start("alice", input(repo, "[input]"));

  const second = await c.start("alice", {
    ...input(repo, "Review result"),
    depends_on: [first.id],
  });

  await until(() => store.get(first.id, "alice").status === "waiting");
  await until(() => store.get(second.id, "alice").status === "waiting");
  await c.interrupt("alice", first.id);

  // An interrupted dependency keeps its dependents waiting, and names it.
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(store.get(second.id, "alice").status, "waiting");
  assert.equal(store.get(second.id, "alice").waiting_for, first.id);

  assert.deepEqual(
    store
      .events(second.id, "alice")
      .filter((e) => e.type === "task.waiting")
      .at(-1)?.data,
    { reason: "waiting_for_dependency", dependency_id: first.id },
  );

  // A failed dependency still fails them.
  await c.send("alice", first.id, "[fail]", "user");
  await until(() => store.get(first.id, "alice").status === "failed");
  await until(() => store.get(second.id, "alice").status === "failed");

  assert.equal(
    store.get(second.id, "alice").error,
    `Dependency ${first.id} failed`,
  );

  assert.equal(store.get(second.id, "alice").workspace, undefined);

  // Once the dependency completes, a follow-up resumes the dependent.
  await c.send("alice", first.id, "Try again", "user");
  await until(() => store.get(first.id, "alice").status === "completed");
  await c.send("alice", second.id, "Go ahead", "user");
  await until(() => store.get(second.id, "alice").status === "completed");
  await c.close();
});

test("current_repo dependents see only the dependency's own changes", async () => {
  const writer = new DependencyWriter("worker.ts", "worker\n");
  const prompts = writer.prompts;
  const { c, store, repo } = await setup(writer);
  await writeFile(join(repo, "user.ts"), "user\n");
  const current = { workspace_strategy: "current_repo" };
  const first = await c.start("alice", { ...input(repo, "Write"), ...current });

  const second = await c.start("alice", {
    ...input(repo, "Review"),
    ...current,
    depends_on: [first.id],
  });

  await until(() => store.get(second.id, "alice").status === "completed");

  const [, dependency] = prompts
    .get(second.id)!
    .split(`Dependency ${first.id}'s recorded edits`);

  assert.ok(dependency);
  assert.match(dependency, /\+worker/);
  assert.doesNotMatch(dependency, /\+user/);
  await c.close();
});
