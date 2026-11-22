// The fixture worker needs a prompt key for every SDK activity, stream frame,
// assistant error and result subtype, so each row kind can be checked without
// model calls. The catalogs are typed against the SDK, and these tests prove
// each key emits what it names.
import assert from "node:assert/strict";

import { test } from "vitest";

import {
  fixtureSdkActivityTypes,
  fixtureSdkAssistantErrorTypes,
  fixtureSdkResultSubtypes,
} from "./fixture-events.js";
import {
  context,
  fixtureProvider,
  task,
} from "./fixture-provider-test-helpers.js";
import { fixtureStreamFrameTypes } from "./fixture-scenarios.js";

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
