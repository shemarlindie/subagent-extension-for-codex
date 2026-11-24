import assert from "node:assert/strict";

import { test } from "vitest";

import type { PlanStep } from "../../../../shared/tasks/plan-contract.js";
import type { RunContext } from "../../providers/types.js";
import {
  eventData,
  input,
  setup,
  TestProvider,
  until,
} from "./control-test-harness.js";

const steps = (...statuses: PlanStep["status"][]): PlanStep[] =>
  statuses.map((status, i) => ({ content: `Step ${i + 1}`, status }));

test("a wrap-up checks off the plan and reaches the reply, unless a steer follows it", async () => {
  const provider = new TestProvider();
  const run = provider.run.bind(provider);
  let context: RunContext | undefined;
  let finish = () => {};
  let gate = new Promise<void>((resolve) => (finish = resolve));

  provider.run = async (ctx, prompt) => {
    context = ctx;
    ctx.acceptSteers(() => true);
    await gate;

    return run(ctx, prompt);
  };

  const { c, store, repo } = await setup(provider);

  try {
    const task = await c.start("alice", input(repo));
    await until(() => !!context);
    assert.ok(context);
    const plan = () => store.get(task.id, "alice").plan?.steps;
    context.planUpdated(steps("in_progress", "pending"));

    // A wrap-up that breaks the field rules changes nothing.
    assert.throws(
      () => context?.wrappedUp({ recap: "Done.", blocked: true }),
      /actions and blocked need an ask/,
    );

    assert.deepEqual(plan(), steps("in_progress", "pending"));
    context.wrappedUp({ recap: "Both steps are done." });
    assert.deepEqual(plan(), steps("completed", "completed"));

    // The work goes on after a steer, so the held wrap-up is dropped.
    const steer = await c.send("alice", task.id, "Also b", "user", {
      delivery: "steer",
    });

    context.steerTaken(steer.message_id);
    finish();
    await until(() => store.get(task.id, "alice").status === "completed");

    assert.equal(
      eventData(store, task.id, "agent.reply")[0]?.wrap_up,
      undefined,
    );

    // The next turn's latest wrap-up rides on its reply.
    const first = context;
    gate = new Promise<void>((resolve) => (finish = resolve));
    await c.send("alice", task.id, "Next", "user");
    await until(() => context !== first);

    const wrapUp = {
      recap: "Both steps are done.",
      ask: "Commit it?",
      actions: [{ label: "Yes, commit" }, { label: "Not yet" }],
    };

    context.wrappedUp({ recap: "Almost." });
    context.wrappedUp(wrapUp);
    finish();
    await until(() => eventData(store, task.id, "agent.reply").length === 2);

    assert.deepEqual(
      eventData(store, task.id, "agent.reply")[1]?.wrap_up,
      wrapUp,
    );
  } finally {
    finish();
    await c.close();
  }
});
