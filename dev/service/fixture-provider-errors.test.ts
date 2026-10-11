import assert from "node:assert/strict";

import { test } from "vitest";

import type { Task } from "../../src/shared/tasks/model.js";
import {
  fixtureSdkAssistantErrorTypes,
  fixtureSdkResultSubtypes,
} from "./fixture-events.js";
import { FixtureProvider } from "./fixture-provider.js";
import { context, task } from "./fixture-provider-test-helpers.js";

test("fixture assistant-error keys cover every SDK assistant error code", async () => {
  const provider = new FixtureProvider();

  for (const [index, error] of fixtureSdkAssistantErrorTypes.entries()) {
    const f = context(task(`task_assistant_error_${index}`));
    await provider.run(f.runContext, `[fixture:assistant-error type=${error}]`);

    const event = f.events.find(
      (item) =>
        item.type === "claude.activity" && item.data.type === "assistant",
    );

    assert.equal(event?.data.error, error);

    assert.equal(
      (event?.data.activity as { failed?: boolean } | undefined)?.failed,
      true,
    );
  }
});

for (const stage of [
  "start",
  "before-input",
  "after-input",
  "after-tools",
  "before-reply",
]) {
  test(`fixture failure trigger stops at ${stage}`, async () => {
    const f = context();

    await assert.rejects(
      new FixtureProvider().run(f.runContext, `[fixture:fail stage=${stage}]`),
      new RegExp(`Fixture failure at ${stage}`),
    );

    assert.equal(
      f.events.filter((event) => event.type === "agent.completed").length,
      1,
    );
  });
}

test("fixture fail alias produces a reply and failed completion", async () => {
  const f = context();

  await assert.rejects(
    new FixtureProvider().run(f.runContext, "[fixture:fail]"),
    /Fixture completion: error_during_execution/,
  );

  assert.ok(
    f.events.some(
      (event) =>
        event.type === "agent.message" &&
        typeof event.data.text === "string" &&
        event.data.text.includes("Fixture task completed"),
    ),
  );

  assert.equal(
    f.events.find((event) => event.type === "agent.completed")?.data.subtype,
    "error_during_execution",
  );
});

for (const subtype of fixtureSdkResultSubtypes.filter(
  (subtype) => subtype !== "success",
)) {
  test(`fixture completion trigger emits SDK result subtype ${subtype}`, async () => {
    const f = context();

    await assert.rejects(
      new FixtureProvider().run(
        f.runContext,
        `[fixture:completion subtype=${subtype}]`,
      ),
      new RegExp(`Fixture completion: ${subtype}`),
    );

    assert.equal(
      f.events.find((event) => event.type === "agent.completed")?.data?.subtype,
      subtype,
    );
  });
}

test("fixture preserves success result messages marked is_error", async () => {
  const f = context();

  await assert.rejects(
    new FixtureProvider().run(
      f.runContext,
      "[fixture:completion subtype=success is_error=true]",
    ),
    /Fixture completion: success \(is_error\)/,
  );

  const completion = f.events.find((event) => event.type === "agent.completed");
  assert.equal(completion?.data.subtype, "success");
  assert.equal(completion?.data.is_error, true);
});

test("fixture can expose provider session deletion and shutdown errors", async () => {
  const taskWithSession = { session_id: "fixture-session" } as Task;

  await assert.rejects(
    new FixtureProvider({ deleteSessionError: true }).deleteSession(
      taskWithSession,
    ),
    /session deletion failed/,
  );

  await assert.rejects(
    new FixtureProvider({ closeError: true }).close(),
    /provider close failed/,
  );
});
