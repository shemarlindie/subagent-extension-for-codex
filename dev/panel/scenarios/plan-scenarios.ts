// Tasks whose worker shows a plan: one in progress, one made stale by a steer,
// one finished and one that ended with its turn while it had steps left.
import type { Task } from "../../../src/core/shared/tasks/model";
import {
  applyPlanUpdate,
  planOpen,
  planResultLine,
  type PlanUpdateInput,
  type TaskPlan,
} from "../../../src/core/shared/tasks/plan";
import type { PlanStep } from "../../../src/core/shared/tasks/plan-contract";
import { workerToolNames } from "../../../src/providers/claude/service/runtime/worker-tool-names";
import { at, taskBase, timestamps, worktree } from "./scenario-context";
import { begin, Timeline } from "./timeline";

const [TOOL = ""] = workerToolNames;

const billingSteps = [
  "Read the billing module and its tests",
  "Map what invoices and payments each use",
  "Move invoice code into billing/invoices",
  "Move charge, refund and webhook handling",
  "Update imports across the app",
  "Run the billing suite",
  "Summarize the split",
];

const pending = (steps: string[]): PlanStep[] =>
  steps.map((content, i) => ({
    content,
    status: i === 0 ? "in_progress" : "pending",
  }));

/** A worker's update_plan call, its result and the events the service records. */
class PlanTimeline extends Timeline {
  steps: PlanStep[] = [];

  plan(input: PlanUpdateInput) {
    const update = applyPlanUpdate(this.steps, input);
    if (update.kind !== "updated") throw new Error("Invalid fixture plan");
    const { kind: _, ...payload } = update;
    this.steps = update.steps;

    this.toolDone(
      this.toolStart(TOOL, { ...input }),
      planResultLine(update.steps),
    );

    this.add("agent.plan", { ...payload }, 50);

    return planOpen(update.steps)
      ? this
      : this.add("task.plan_ended", { steps: update.steps }, 0);
  }

  /** The plan as the running turn's task stores it after the last update. */
  taskPlan(flags: Pick<TaskPlan, "stale"> = {}): TaskPlan {
    return { steps: this.steps, ...flags };
  }
}

const progress = new PlanTimeline("preview-plan", at(170), 7000);
begin(progress, ["Read", "Edit", "Bash"]);
progress.say("I'll split billing in seven steps.");
progress.plan({ items: pending(billingSteps) });
progress.tool("Read", { file_path: "src/billing/index.ts" }, "export ...");
progress.plan({ advance: true });
progress.say("Invoices only touch the customer and tax helpers.");
progress.plan({ advance: true });

progress.tool(
  "Bash",
  { command: "git mv src/billing/invoice.ts src/billing/invoices/" },
  "",
);

progress.plan({ advance: true });
progress.say("Invoice code has moved. Moving the payment handlers next.");

const steer = "msg_preview_plan_stale_1";
const stale = new PlanTimeline("preview-plan-stale", at(172), 7100);
begin(stale, ["Read", "Edit"]);
stale.plan({ items: pending(billingSteps.slice(2, 6)) });
stale.plan({ advance: true });
stale.say("Invoices moved. Starting on the payment handlers.");

stale
  .add("task.instruction", {
    message_id: steer,
    message: "Keep the webhook handlers in billing/index for now.",
    from: "user",
    delivery: "steer",
  })
  .add("task.steer_taken", { message_id: steer }, 400);

// The user stops the worker early, so the plan ends with the turn.
const stopSteer = "msg_preview_plan_unfinished_1";
const unfinished = new PlanTimeline("preview-plan-unfinished", at(176), 7300);
begin(unfinished, ["Read", "Edit"]);
unfinished.plan({ items: pending(billingSteps.slice(2, 6)) });
unfinished.plan({ advance: true });

unfinished
  .add("task.instruction", {
    message_id: stopSteer,
    message: "Stop here and summarize what moved.",
    from: "user",
    delivery: "steer",
  })
  .add("task.steer_taken", { message_id: stopSteer }, 400);

const unfinishedReply =
  "Invoice code moved to `billing/invoices`. Payments are untouched.";

unfinished
  .turnResult(unfinishedReply)
  .reply(unfinishedReply, 1)
  .turnEnded(1, "completed")
  .add("task.plan_ended", { steps: unfinished.steps }, 0)
  .add("task.completed", {}, 200);

const done = new PlanTimeline("preview-plan-done", at(174), 7200);
begin(done, ["Read", "Edit", "Bash"]);
done.plan({ items: pending(billingSteps) });

for (let i = 1; i < billingSteps.length; i++) done.plan({ advance: true });

done.plan({ advance: true });

const doneReply =
  "Billing is split into `invoices` and `payments`. The public API is unchanged and the billing suite passes (212 tests).";

done.say(doneReply);
done.finish(doneReply, 1, { duration_ms: 400000, total_cost_usd: 1.18 });

export const planTimelines = [progress, stale, unfinished, done];

const description =
  "Split billing into invoices and payments without changing public behaviour.";

const planTask = {
  ...taskBase,
  description,
  worker_profile: "implementer" as const,
};

export const planTasks: Task[] = [
  {
    ...planTask,
    ...worktree(progress.taskId),
    id: progress.taskId,
    title: "Plan: split billing",
    status: "running",
    plan: progress.taskPlan(),
    run_started_at: at(170),
    ...timestamps(170, 6),
  },
  {
    ...planTask,
    ...worktree(stale.taskId),
    id: stale.taskId,
    title: "Plan: steered mid-step",
    status: "running",
    instructions_sent: 1,
    plan: stale.taskPlan({ stale: true }),
    run_started_at: at(172),
    ...timestamps(172, 3),
  },
  {
    ...planTask,
    ...worktree(unfinished.taskId),
    id: unfinished.taskId,
    title: "Plan: unfinished",
    status: "completed",
    instructions_sent: 1,
    runtime_ms: 64000,
    completed_at: at(178),
    ...timestamps(176, 2),
  },
  {
    ...planTask,
    ...worktree(done.taskId),
    id: done.taskId,
    title: "Plan: finished",
    status: "completed",
    runtime_ms: 400000,
    cost_usd: 1.18,
    completed_at: at(181),
    ...timestamps(174, 7),
  },
];
