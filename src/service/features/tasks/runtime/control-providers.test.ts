import assert from "node:assert/strict";

import { test } from "vitest";

import { FixtureProvider } from "../../../../../dev/service/fixture-provider.js";
import { type ProviderTaskPolicy } from "../../providers/task-policy.js";
import type { Provider } from "../../providers/types.js";
import { input, setup, until } from "./control-test-harness.js";

test("scheduler enforces concurrency and independent branches run together", async () => {
  const { c, store, repo } = await setup(undefined, 2);

  const tasks = await Promise.all([
    c.start("alice", input(repo, "[input]")),
    c.start("alice", input(repo, "[input]")),
    c.start("alice", input(repo, "[input]")),
  ]);

  await until(
    () =>
      c.active.size === 2 &&
      tasks.filter((t) => !!store.get(t.id, "alice").pending_input).length ===
        2,
  );

  assert.equal(
    tasks.filter((t) => store.get(t.id, "alice").status === "queued").length,
    1,
  );

  await c.interrupt("alice", tasks[0].id);
  await until(() => !!store.get(tasks[2].id, "alice").pending_input);
  await c.close();
});

test("a new provider controls preparation and input policy without built-in identity assumptions", async () => {
  const provider: Provider = new FixtureProvider();
  provider.id = "new-built-in";
  const prepared: string[] = [];
  const decisions: boolean[] = [];
  let allowParent = false;

  provider.taskPolicy = {
    prepareStart({ input, authority }) {
      assert.equal(input.approval_mode, undefined);

      if (input.model === "forbidden") {
        throw new Error("Native model unavailable");
      }

      const options = input.provider_options?.[input.provider];

      if (
        options?.execution_pool !== undefined &&
        options.execution_pool !== "isolated"
      ) {
        throw new Error("Native execution pool must be isolated");
      }

      prepared.push(authority);

      return {
        model: "native-default",
        reasoning_effort: "minimal",
        provider_options: {
          [input.provider]: { execution_pool: "isolated" },
        },
      };
    },
    decideInput: () => true,
    parentMayApprove: () => allowParent,
    inputKind: (tool) =>
      tool === "ChooseApproach" ? "question" : "permission",
  };

  provider.run = async (context) => {
    const automatic = await context.input("NativeRead", {}, context.signal);
    decisions.push(automatic.approved);
    await context.input("ChooseApproach", {}, context.signal);
    // Changing the provider's automatic policy affects its next request.
    provider.taskPolicy.decideInput = () => undefined;
    const manual = await context.input("NativeWrite", {}, context.signal);
    decisions.push(manual.approved);

    return {
      reply: "Done",
    };
  };

  const { c, store, repo } = await setup(provider);

  try {
    await assert.rejects(
      c.start("alice", {
        ...input(repo),
        provider: provider.id,
        model: "forbidden",
      }),
      /Native model unavailable/,
    );

    await assert.rejects(
      c.start("alice", {
        ...input(repo),
        provider: provider.id,
        provider_options: {
          [provider.id]: { execution_pool: "shared" },
        },
      }),
      /must be isolated/,
    );

    await assert.rejects(
      c.start("alice", {
        ...input(repo),
        provider: provider.id,
        provider_options: { claude: { permission_mode: "plan" } },
      }),
      /selected provider/,
    );

    assert.equal(store.all().length, 0);

    const task = await c.start(
      "alice",
      { ...input(repo), provider: provider.id },
      "parent",
    );

    assert.equal(task.model, "native-default");
    assert.equal(task.reasoning_effort, "minimal");

    assert.deepEqual(task.provider_options, {
      [provider.id]: { execution_pool: "isolated" },
    });

    assert.deepEqual(
      store.get(task.id, "alice").provider_options,
      task.provider_options,
    );

    assert.deepEqual(prepared, ["parent"]);

    await until(
      () =>
        store.get(task.id, "alice").pending_input?.tool === "ChooseApproach",
    );

    const question = store.get(task.id, "alice").pending_input!;
    assert.equal(question.kind, "question");
    assert.deepEqual(decisions, [true]);

    // Questions remain interactive even when the native policy approves tools.
    c.input(
      "alice",
      task.id,
      question.id,
      true,
      { choice: "small" },
      undefined,
      "parent",
    );

    await until(
      () => store.get(task.id, "alice").pending_input?.tool === "NativeWrite",
    );

    const permission = store.get(task.id, "alice").pending_input!;

    assert.throws(
      () =>
        c.input(
          "alice",
          task.id,
          permission.id,
          true,
          undefined,
          undefined,
          "parent",
        ),
      /requires user approval/,
    );

    allowParent = true;

    c.input(
      "alice",
      task.id,
      permission.id,
      false,
      undefined,
      undefined,
      "parent",
    );

    await until(() => store.get(task.id, "alice").status === "completed");
    assert.deepEqual(decisions, [true, false]);
  } finally {
    await c.close();
  }
});

test("a new provider owns native session continuation after a restart", async () => {
  const provider: Provider = new FixtureProvider();
  provider.id = "new-native";
  let sessionValid = false;
  const validated: string[] = [];

  const policy: ProviderTaskPolicy = {
    prepareStart: () => ({}),
    decideInput: () => undefined,
    parentMayApprove: () => false,
    inputKind: () => "permission",
    async validateSession(task) {
      validated.push(task.session_state_ref!);
      if (!sessionValid) throw new Error("Native session unavailable");
    },
  };

  provider.taskPolicy = policy;
  const { c, store, repo } = await setup(provider);
  c.stopped = true;

  try {
    const task = await c.start("alice", {
      ...input(repo),
      provider: provider.id,
    });

    task.status = "running";
    task.turn = 1;

    task.provider_options = {
      ...task.provider_options,
      [provider.id]: { native_turn_id: "native-turn" },
    };

    task.session_id = "native-session";
    task.session_state_ref = "native:opaque-session";
    task.session_owner = c.ownerWorker;
    store.save(task);
    await c.recover();
    assert.equal(store.get(task.id, "alice").status, "interrupted");
    c.stopped = false;

    // A session the provider rejects gives way to a new one.
    await c.send("alice", task.id, "Continue", "user");
    await until(() => store.get(task.id, "alice").status === "completed");
    const renewed = store.get(task.id, "alice");

    assert.equal(
      renewed.provider_options?.[provider.id]?.native_turn_id,
      "native-turn",
    );

    assert.equal(renewed.session_id, `fixture_${task.id}`);

    assert.deepEqual(
      store
        .events(task.id, "alice")
        .filter((e) => e.type === "task.session_started")
        .map((e) => e.data),
      [{ reason: "session_unavailable" }],
    );

    // One it accepts resumes.
    sessionValid = true;
    await c.send("alice", task.id, "Continue", "user");
    await until(() => store.get(task.id, "alice").turn === 3);
    await until(() => store.get(task.id, "alice").status === "completed");
    assert.equal(store.get(task.id, "alice").session_id, `fixture_${task.id}`);

    assert.deepEqual(validated, [
      "native:opaque-session",
      `fixture:${renewed.workspace}`,
    ]);
  } finally {
    await c.close();
  }
});
