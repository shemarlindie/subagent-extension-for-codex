import assert from "node:assert/strict";

import { expect, test } from "vitest";

import type { Draft } from "../../../src/shared/tasks/conversation/drafts";
import { StoryFeed } from "./story-feed";
import { panelAt } from "./story-test-harness";

type WaitRead = { revision: string; draft?: Draft | null };

const wait = async (feed: StoryFeed, args: Record<string, unknown>) => {
  const result = await feed.call("app_wait_for_updates", args);

  return (result.structuredContent as { result: WaitRead }).result;
};

test("a held wait returns as soon as the story moves on", async () => {
  const feed = new StoryFeed({ step: 2 });
  const { revision } = await wait(feed, {});
  const held = wait(feed, { after: revision, wait_ms: 20_000 });
  feed.set({ step: 3 });

  expect((await held).revision).not.toBe(revision);
});

test("an unchanged wait returns its revision when its time runs out", async () => {
  const feed = new StoryFeed({ step: 2 });
  const { revision } = await wait(feed, {});
  const held = wait(feed, { after: revision, wait_ms: 20 });
  feed.set({ step: 2 });

  expect((await held).revision).toBe(revision);
});

test("a draft wait returns when the streamed reply grows", async () => {
  const feed = new StoryFeed({ step: 2, streamed: 0.2 });
  const task_id = panelAt({ step: 2 }).task.id;
  const first = await wait(feed, { draft: { task_id } });
  assert.ok(first.draft);

  const held = wait(feed, {
    after: first.revision,
    draft: {
      task_id,
      message_id: first.draft.message_id,
      after_length: first.draft.text.length,
    },
    wait_ms: 20_000,
  });

  feed.set({ step: 2, streamed: 0.5 });
  const grown = await held;
  assert.ok(grown.draft);

  expect(grown.revision).toBe(first.revision);
  expect(grown.draft.text.startsWith(first.draft.text)).toBe(true);
  expect(grown.draft.text.length).toBeGreaterThan(first.draft.text.length);
});
