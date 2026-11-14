import assert from "node:assert/strict";

import { expect, test } from "vitest";

import { chatItems } from "../../../src/shared/tasks/conversation/chat";
import { PLAYBACK_MS, sceneAt } from "./playback";
import { panelAt } from "./story-test-harness";

const scenes = Array.from({ length: PLAYBACK_MS / 50 }, (_, i) =>
  sceneAt(i * 50),
);

test("a playing panel's events only grow, so its read cursors stay valid", () => {
  const panels = scenes.flatMap(({ panel }) => (panel ? [panel] : []));
  const [first] = panels;
  assert.ok(first);
  let previous = panelAt(first).events;

  for (const panel of panels) {
    const { events } = panelAt(panel);

    expect(events.slice(0, previous.length)).toEqual(previous);
    previous = events;
  }
});

test("each streamed reply hands off to its stored message under one id", () => {
  const streaming = scenes.flatMap(({ panel, step }) =>
    panel?.streamed ? [{ panel, step }] : [],
  );

  expect(new Set(streaming.map((scene) => scene.step)).size).toBe(2);

  for (const scene of streaming) {
    const { task, events, draft } = panelAt(scene.panel);
    assert.ok(draft);
    const stored = panelAt({ step: scene.step });
    const shown = chatItems(task, events);
    expect(shown.some((item) => item.id === draft.message_id)).toBe(false);

    const message = chatItems(stored.task, stored.events).find(
      (item) => item.id === draft.message_id,
    );

    expect(message).toMatchObject({ kind: "message" });
    expect(stored.draft).toBeUndefined();
  }
});
