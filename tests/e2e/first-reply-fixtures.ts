import type { FixtureProviderOptions } from "../../dev/service/fixture-provider";
import { test as base } from "./fixtures";

type FirstReply = {
  beforeReply: NonNullable<FixtureProviderOptions["beforeReply"]>;
  held: Promise<void>;
  release(): void;
};

/** Hold only the first task's first reply until its browser condition is ready. */
export const firstReplyTest = base.extend<{ firstReply: FirstReply }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires destructured dependencies.
  firstReply: async ({}, use) => {
    const held = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    let firstTask: string | undefined;

    try {
      await use({
        held: held.promise,
        release: released.resolve,
        beforeReply: async ({ task }) => {
          firstTask ??= task.id;
          if (task.id !== firstTask || task.turn !== 1) return;
          held.resolve();
          await released.promise;
        },
      });
    } finally {
      released.resolve();
    }
  },
  fixtureProvider: async ({ firstReply }, use) => {
    await use({
      turnDelayMs: 0,
      replyPaceMs: 0,
      beforeReply: firstReply.beforeReply,
    });
  },
});
