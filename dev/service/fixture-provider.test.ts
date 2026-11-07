import assert from "node:assert/strict";

import { test } from "vitest";

import { Settings } from "../../src/service/features/settings/settings.js";
import { Store } from "../../src/service/features/tasks/storage/store.js";
import { startSchema } from "../../src/shared/tasks/model.js";
import { fixtureSdkActivityTypes } from "./fixture-events.js";
import {
  context,
  fixtureProvider,
  task,
} from "./fixture-provider-test-helpers.js";
import { fixtureStreamFrameTypes } from "./fixture-scenarios.js";

test("fixture readiness and model discovery expose configured states", async () => {
  assert.equal((await fixtureProvider().readiness()).ready, true);

  assert.equal(
    (await fixtureProvider({ readiness: "unavailable" }).readiness()).ready,
    false,
  );

  await assert.rejects(
    fixtureProvider({ readiness: "error" }).readiness(),
    /readiness check failed/,
  );

  assert.deepEqual(await fixtureProvider({ models: "empty" }).models(), []);

  await assert.rejects(
    fixtureProvider({ models: "error" }).models(),
    /model discovery failed/,
  );

  const transient = fixtureProvider({ models: "error-once" });
  await assert.rejects(transient.models(), /failed once/);
  assert.equal((await transient.models()).length, 2);
});

test("fixture run keys emit every SDK activity and stream frame", async () => {
  const provider = fixtureProvider();

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

    const provider = fixtureProvider();

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

      return { ...task(), ...prepared };
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

test("fixture checkpoints hold the turn until steers arrive and preserve the streamed reply", async () => {
  const f = context();
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let accept!: Parameters<typeof f.runContext.acceptSteers>[0];
  const taken: string[] = [];
  const deltas: string[] = [];

  f.runContext.acceptSteers = (callback) => {
    accept = callback;
  };

  f.runContext.steerTaken = (id) => {
    taken.push(id);
  };

  f.runContext.delta = (_id, text) => {
    deltas.push(text);
  };

  const running = fixtureProvider({
    beforeReply: async () => {
      ready.resolve();
      await release.promise;
    },
  }).run(f.runContext, "Checkpoint fixture");

  await ready.promise;

  assert.equal(
    f.events.some((event) => event.type === "agent.completed"),
    false,
  );

  assert.equal(accept({ id: "steer", text: "Include this detail" }), true);
  release.resolve();
  const output = await running;
  assert.deepEqual(taken, ["steer"]);
  assert.match(output.reply, /Also took: Include this detail/);
  assert.equal(deltas.join(""), output.reply);
});

test("interrupting a held streaming checkpoint finishes without releasing it", async () => {
  const f = context();
  const streaming = Promise.withResolvers<void>();

  const running = fixtureProvider({
    beforeReplyChunk: async (_context, index) => {
      if (index !== 1) return;
      streaming.resolve();
      await new Promise<void>(() => {});
    },
  }).run(f.runContext, "Held streaming fixture");

  await streaming.promise;
  f.controller.abort();
  await assert.rejects(running, /Fixture interrupted/);

  assert.deepEqual(
    f.events
      .filter((event) => event.type === "agent.completed")
      .map((event) => event.data.subtype),
    ["interrupted"],
  );
});
