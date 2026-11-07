import assert from "node:assert/strict";

import { test } from "vitest";

import {
  fixtureSdkAssistantErrorTypes,
  fixtureSdkResultSubtypes,
} from "./fixture-events.js";
import {
  context,
  fixtureProvider,
  task,
} from "./fixture-provider-test-helpers.js";

test("fixture assistant-error keys cover every SDK assistant error code", async () => {
  const provider = fixtureProvider();

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

test("fixture failure triggers stop at each stage", async () => {
  for (const stage of [
    "start",
    "before-input",
    "after-input",
    "after-tools",
    "before-reply",
  ]) {
    const f = context();

    await assert.rejects(
      fixtureProvider().run(f.runContext, `[fixture:fail stage=${stage}]`),
      new RegExp(`Fixture failure at ${stage}`),
    );

    assert.equal(
      f.events.filter((event) => event.type === "agent.completed").length,
      1,
      stage,
    );
  }
});

test("fixture completion triggers emit each failed SDK result", async () => {
  for (const { subtype, key, error } of [
    ...fixtureSdkResultSubtypes
      .filter((subtype) => subtype !== "success")
      .map((subtype) => ({
        subtype,
        key: subtype,
        error: new RegExp(`Fixture completion: ${subtype}`),
      })),
    // A success result marked is_error still fails the turn.
    {
      subtype: "success",
      key: "success is_error=true",
      error: /Fixture completion: success \(is_error\)/,
    },
  ]) {
    const f = context();

    await assert.rejects(
      fixtureProvider().run(
        f.runContext,
        `[fixture:completion subtype=${key}]`,
      ),
      error,
    );

    const completion = f.events.find(
      (event) => event.type === "agent.completed",
    );

    assert.equal(completion?.data.subtype, subtype, key);
    assert.equal(completion?.data.is_error, true, key);
  }
});
