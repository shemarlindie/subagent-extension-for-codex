import assert from "node:assert/strict";

import { test } from "vitest";

import { Settings } from "../../src/service/features/settings/settings.js";
import { Store } from "../../src/service/features/tasks/storage/store.js";
import type { ModelChoice } from "../../src/shared/providers/types.js";
import { startSchema, type Task } from "../../src/shared/tasks/model.js";
import { fixtureSdkActivityTypes } from "./fixture-events.js";
import { FixtureProvider } from "./fixture-provider.js";
import { context, task } from "./fixture-provider-test-helpers.js";
import { fixtureStreamFrameTypes } from "./fixture-scenarios.js";

test("fixture readiness and model discovery expose configured states", async () => {
  assert.equal((await new FixtureProvider().readiness()).ready, true);

  assert.equal(
    (await new FixtureProvider({ readiness: "unavailable" }).readiness()).ready,
    false,
  );

  await assert.rejects(
    new FixtureProvider({ readiness: "error" }).readiness(),
    /readiness check failed/,
  );

  assert.deepEqual(await new FixtureProvider({ models: "empty" }).models(), []);

  await assert.rejects(
    new FixtureProvider({ models: "error" }).models(),
    /model discovery failed/,
  );

  const transient = new FixtureProvider({ models: "error-once" });
  await assert.rejects(transient.models(), /failed once/);
  assert.equal((await transient.models()).length, 2);

  const delayed = new FixtureProvider({
    readinessDelayMs: 1,
    modelsDelayMs: 1,
  });

  await delayed.readiness();
  await delayed.models();
});

test("fixture runs permission prompts, questions, tools, and stream frames", async () => {
  const provider = new FixtureProvider();
  const f = context();

  const output = await provider.run(
    f.runContext,
    [
      "[fixture:question]",
      "[fixture:permission tool=Edit]",
      "[fixture:tool-error name=Read]",
      "[fixture:activity type=control_request_progress]",
      "[fixture:stream]",
    ].join(" "),
  );

  assert.match(output.reply, /Fixture task completed/);
  assert.deepEqual(f.inputs, ["AskUserQuestion", "Edit"]);
  assert.equal(f.sessions.length, 1);

  assert.ok(
    f.events.some(
      (event) => event.type === "tool.completed" && event.data.error,
    ),
  );

  assert.ok(
    f.events.some(
      (event) =>
        event.type === "claude.activity" &&
        event.data.type === "control_request_progress",
    ),
  );

  assert.ok(
    f.events.some(
      (event) =>
        event.type === "claude.activity" &&
        (event.data.raw_response as Record<string, unknown>).type ===
          "stream_event",
    ),
  );

  assert.equal(
    f.events.filter((event) => event.type === "agent.completed").length,
    1,
  );
});

test("fixture cost marker supports a zero-cost completion", async () => {
  const f = context(task("task_zero_cost"));
  await new FixtureProvider().run(f.runContext, "[fixture:cost usd=0]");

  assert.equal(
    f.events.find((event) => event.type === "agent.completed")?.data.cost_usd,
    0,
  );
});

test("fixture provider instances keep metadata and permission options isolated", () => {
  const first = new FixtureProvider();
  const second = new FixtureProvider();

  const originalClaudeLabel =
    second.metadata.nativePermissions!.options[0]!.label;

  first.metadata.nativePermissions!.formTitle = "Changed fixture title";
  first.metadata.nativePermissions!.options[0]!.label = "Changed fixture label";

  assert.equal(
    second.metadata.nativePermissions?.formTitle,
    "Fixture permission mode",
  );

  assert.equal(
    second.metadata.nativePermissions?.options[0]?.label,
    originalClaudeLabel,
  );
});

test("fixture model catalogs copy caller data and returned effort levels", async () => {
  const modelChoices: ModelChoice[] = [
    {
      value: "custom",
      displayName: "Custom",
      description: "Test model",
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium"],
    },
  ];

  const provider = new FixtureProvider({ modelChoices: [...modelChoices] });

  modelChoices[0]!.supportedEffortLevels = ["max"];
  const first = await provider.models();
  first[0]!.supportedEffortLevels!.push("high");

  assert.deepEqual((await provider.models())[0]?.supportedEffortLevels, [
    "low",
    "medium",
  ]);
});

test("fixture run keys emit every SDK activity and stream frame", async () => {
  const provider = new FixtureProvider();

  const activityTypes = [
    "init",
    "assistant",
    "user",
    "stream_event",
    ...fixtureSdkActivityTypes,
  ];

  const prompts = [
    ...activityTypes.map((type) => `[fixture:activity type=${type}]`),
    ...fixtureStreamFrameTypes.map(
      (frame) => `[fixture:stream frame=${frame}]`,
    ),
  ];

  const f = context();

  await provider.run(f.runContext, prompts.join(" "));

  const emittedActivityTypes = f.events
    .filter((event) => event.type === "claude.activity")
    .map((event) => event.data.type);

  for (const type of activityTypes) {
    assert.ok(emittedActivityTypes.includes(type), type);
  }

  const streamFrames = f.events
    .filter((event) => event.type === "claude.activity")
    .flatMap((event) => {
      const raw = event.data.raw_response as
        { type?: string; event?: { type?: string } } | undefined;

      return raw?.type === "stream_event" && raw.event?.type
        ? [raw.event.type]
        : [];
    });

  for (const frame of fixtureStreamFrameTypes) {
    assert.ok(streamFrames.includes(frame), frame);
  }
});

test("fixture permission modes simulate allow, deny, ask, and approval authority", () => {
  const store = new Store(":memory:");

  try {
    const defaults = new Settings(store.database, () => ["fixture"]).values(
      "alice",
    );

    const provider = new FixtureProvider();

    const prepare = (
      permissionMode: string,
      approvalDecider = "user",
      approvalMode?: "ask_user" | "parent_agent",
    ) => {
      const input = startSchema.parse({
        repository: "/repo",
        provider: "fixture",
        description: "Permission policy fixture",
        ...(approvalMode ? { approval_mode: approvalMode } : {}),
        provider_options: {
          fixture: {
            permission_mode: permissionMode,
            approval_decider: approvalDecider,
          },
        },
      });

      const prepared = provider.taskPolicy.prepareStart({
        input,
        defaults,
        authority: "user",
      });

      return { ...task(), ...prepared } as Task;
    };

    for (const mode of ["plan", "dontAsk"]) {
      assert.equal(
        provider.taskPolicy.decideInput(prepare(mode), "Bash"),
        false,
      );
    }

    for (const mode of ["auto", "bypassPermissions"]) {
      assert.equal(
        provider.taskPolicy.decideInput(prepare(mode), "Bash"),
        true,
      );
    }

    assert.equal(
      provider.taskPolicy.decideInput(prepare("acceptEdits"), "Edit"),
      true,
    );

    assert.equal(
      provider.taskPolicy.decideInput(prepare("acceptEdits"), "Bash"),
      undefined,
    );

    assert.equal(
      provider.taskPolicy.decideInput(prepare("auto"), "AskUserQuestion"),
      undefined,
    );

    assert.equal(
      provider.taskPolicy.parentMayApprove(prepare("default")),
      false,
    );

    assert.equal(
      provider.taskPolicy.parentMayApprove(prepare("default", "parent_agent")),
      true,
    );

    assert.equal(
      provider.taskPolicy.parentMayApprove(
        prepare("default", "user", "parent_agent"),
      ),
      true,
    );
  } finally {
    store.close();
  }
});
