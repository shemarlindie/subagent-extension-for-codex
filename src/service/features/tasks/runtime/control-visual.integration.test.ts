import assert from "node:assert/strict";

import { test } from "vitest";

import { chatItems } from "../../../../core/shared/tasks/conversation/chat.js";
import type { RunContext } from "../../providers/types.js";
import { pollMessages } from "../conversation/message-poll.js";
import { input, setup, TestProvider, until } from "./control-test-harness.js";

test("visuals are numbered per task, a new version takes its visual's place in Chat, and Codex reads a line for each", async () => {
  const provider = new TestProvider();
  const run = provider.run.bind(provider);
  let context: RunContext | undefined;
  let finish = () => {};
  const gate = new Promise<void>((resolve) => (finish = resolve));

  provider.run = async (ctx, prompt) => {
    context = ctx;
    await gate;

    return run(ctx, prompt);
  };

  const { c, store, repo } = await setup(provider);

  try {
    const task = await c.start("alice", input(repo));
    await until(() => !!context);
    assert.ok(context);

    assert.equal(context.visualShown("Chart", "<svg>1</svg>"), 1);
    assert.equal(context.visualShown("Cards", "<div></div>"), 2);
    const cursor = store.lastEventId(task.id);
    assert.equal(context.visualShown("Chart, fixed", "<svg>2</svg>", 1), 1);

    // A refused call records nothing, so Chat below has no visual 3.
    assert.throws(
      () => context?.visualShown("Gone", "<svg/>", 3),
      /There is no visual 3. This task has shown visuals 1 to 2./,
    );

    assert.equal(store.get(task.id, "alice").visuals, 2);

    const visuals = (after = 0) =>
      chatItems(
        store.get(task.id, "alice"),
        store.chatEvents(task.id, after),
      ).flatMap((item) =>
        item.kind === "visual" && item.event_id > after
          ? [[item.id, item.title, item.code]]
          : [],
      );

    assert.deepEqual(visuals(), [
      ["visual_1", "Chart, fixed", "<svg>2</svg>"],
      ["visual_2", "Cards", "<div></div>"],
    ]);

    // A later read gets the new version alone, for the panel to put in place.
    assert.deepEqual(visuals(cursor), [
      ["visual_1", "Chart, fixed", "<svg>2</svg>"],
    ]);

    // Codex reads a line for each visual, which a new version moves to the end.
    const read = await pollMessages(store, c.drafts, "alice", task.id, 0, 0);

    assert.deepEqual(
      read.messages
        .filter((m) => m.kind === "visual")
        .map((m) => [m.id, m.text]),
      [
        ["visual_2", "[Visual 2 shown in the panel: Cards]"],
        ["visual_1", "[Visual 1 shown in the panel: Chart, fixed]"],
      ],
    );
  } finally {
    finish();
    await c.close();
  }
});
