import type { FixtureProviderOptions } from "../../dev/service/fixture-provider";
import { test as base } from "./fixtures";

type ReplyStream = {
  beforeReplyChunk: NonNullable<FixtureProviderOptions["beforeReplyChunk"]>;
  resume(turn: number, chunk: number): void;
};

/** Keep real SSE delivery while the browser controls when each reply grows. */
export const streamingTest = base.extend<{ replyStream: ReplyStream }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires destructured dependencies.
  replyStream: async ({}, use) => {
    const checkpoints = new Map<string, PromiseWithResolvers<void>>();

    const checkpoint = (turn: number, chunk: number) => {
      const key = `${turn}:${chunk}`;
      let current = checkpoints.get(key);

      if (!current) {
        current = Promise.withResolvers<void>();
        checkpoints.set(key, current);
      }

      return current;
    };

    await use({
      beforeReplyChunk: async ({ task }, chunk) => {
        if (task.turn > 1 && (chunk === 30 || chunk === 80)) {
          await checkpoint(task.turn, chunk).promise;
        }
      },
      resume: (turn, chunk) => checkpoint(turn, chunk).resolve(),
    });
  },
  fixtureProvider: async ({ replyStream }, use) => {
    await use({
      turnDelayMs: 0,
      replyPaceMs: 0,
      beforeReplyChunk: replyStream.beforeReplyChunk,
    });
  },
});
