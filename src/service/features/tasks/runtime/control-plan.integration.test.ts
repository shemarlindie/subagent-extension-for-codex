import assert from "node:assert/strict";

import { test } from "vitest";

import type { PlanStep } from "../../../../shared/tasks/plan-contract.js";
import { taskSummary } from "../../../../shared/tasks/task-list.js";
import type { RunContext } from "../../providers/types.js";
import { pollMessages } from "../conversation/message-poll.js";
import {
  eventData,
  input,
  setup,
  TestProvider,
  until,
} from "./control-test-harness.js";

const steps = (...statuses: PlanStep["status"][]): PlanStep[] =>
  statuses.map((status, i) => ({ content: `Step ${i + 1}`, status }));

test("the worker's plan is saved on the task, goes stale on a steer, ends into history and reaches Codex without waking it", async () => {
  const provider = new TestProvider();
  const run = provider.run.bind(provider);
  let context: RunContext | undefined;
  let finish = () => {};
  const gate = new Promise<void>((resolve) => (finish = resolve));

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
    const plan = () => store.get(task.id, "alice").plan;

    context.planUpdated(steps("in_progress", "pending"));
    context.planUpdated(steps("completed", "in_progress"), [0, 1]);

    assert.deepEqual(plan()?.steps, steps("completed", "in_progress"));

    assert.deepEqual(eventData(store, task.id, "agent.plan"), [
      { steps: steps("in_progress", "pending") },
      { steps: steps("completed", "in_progress"), changed: [0, 1] },
    ]);

    // A taken steer marks the open plan stale, and the next update clears it.
    const steer = await c.send("alice", task.id, "Also check b", "user", {
      delivery: "steer",
    });

    context.steerTaken(steer.message_id);
    assert.equal(plan()?.stale, true);
    context.planUpdated(steps("completed", "in_progress"));
    assert.equal(plan()?.stale, undefined);

    // Codex reads the progress, and an update alone doesn't end a wait.
    const summary = { done: 1, total: 2, current: "Step 2" };
    assert.deepEqual(taskSummary(store.get(task.id, "alice")).plan, summary);
    const cursor = store.lastEventId(task.id);
    const started = Date.now();

    setTimeout(
      () => context?.planUpdated(steps("completed", "in_progress")),
      50,
    );

    const read = await pollMessages(
      store,
      c.drafts,
      "alice",
      task.id,
      cursor,
      1,
    );

    assert.ok(Date.now() - started >= 900, "The plan update ended the wait");
    assert.deepEqual(read.messages, []);
    assert.deepEqual(read.plan, summary);

    context.planUpdated([]);
    assert.equal(plan(), undefined);

    assert.deepEqual(eventData(store, task.id, "agent.plan").at(-1), {
      steps: [],
    });

    // A cleared or finished plan leaves the card for Chat history, once.
    const ended = () => eventData(store, task.id, "task.plan_ended");
    context.planUpdated(steps("completed", "completed"));
    context.planUpdated(steps("completed", "completed"));

    assert.deepEqual(ended(), [
      { steps: steps("completed", "in_progress") },
      { steps: steps("completed", "completed") },
    ]);

    // A finished plan never goes stale.
    const late = await c.send("alice", task.id, "Also b", "user", {
      delivery: "steer",
    });

    context.steerTaken(late.message_id);
    assert.equal(plan()?.stale, undefined);

    // The plan ends with its turn, and a finished one isn't recorded again.
    // Restart recovery's test covers a plan with steps left.
    finish();
    await until(() => store.get(task.id, "alice").status === "completed");
    assert.equal(plan(), undefined);
    assert.equal(ended().length, 2);
  } finally {
    finish();
    await c.close();
  }
});
