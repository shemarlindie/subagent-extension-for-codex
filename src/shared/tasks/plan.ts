import type { AgentPlanPayload, PlanStep } from "./plan-contract.js";

/** The worker's latest plan, on the task. */
export interface TaskPlan {
  steps: PlanStep[];
  /** The turn that last updated it. */
  turn: number;
  updated_at: string;
  /** A steer or a new turn's message reached the worker after this update. */
  stale?: true;
}

const MAX_PLAN_STEPS = 30;
const MAX_PLAN_STEP_LENGTH = 200;

/** What the worker's update_plan call sends: exactly one of the two. */
export interface PlanUpdateInput {
  items?: PlanStep[];
  advance?: boolean;
}

/**
 * An update's outcome: the new plan, an error that changes nothing, or a
 * note that there was nothing to change.
 */
export type PlanUpdateResult =
  | ({ kind: "updated" } & AgentPlanPayload)
  | { kind: "unchanged"; message: string }
  | { kind: "invalid"; error: string };

const invalid = (error: string): PlanUpdateResult => ({
  kind: "invalid",
  error,
});

function validSteps(items: PlanStep[]) {
  if (items.length > MAX_PLAN_STEPS) {
    return `A plan has at most ${MAX_PLAN_STEPS} steps.`;
  }

  if (
    items.some(
      (s) => !s.content.trim() || s.content.length > MAX_PLAN_STEP_LENGTH,
    )
  ) {
    return `Each step needs text of 1 to ${MAX_PLAN_STEP_LENGTH} characters.`;
  }

  if (items.filter((s) => s.status === "in_progress").length > 1) {
    return "At most one step can be in progress.";
  }

  return undefined;
}

/** The indices whose status changed, when the contents match in order. */
function changedSteps(before: PlanStep[], after: PlanStep[]) {
  if (
    before.length !== after.length ||
    before.some((s, i) => s.content !== after[i]?.content)
  ) {
    return undefined;
  }

  return after.flatMap((s, i) => (s.status === before[i]?.status ? [] : [i]));
}

/** Completes the step in progress and starts the next pending one. */
function advanced(steps: PlanStep[]) {
  const next = steps.map((s) =>
    s.status === "in_progress" ? { ...s, status: "completed" as const } : s,
  );

  const pending = next.findIndex((s) => s.status === "pending");

  return next.map((s, i) =>
    i === pending ? { ...s, status: "in_progress" as const } : s,
  );
}

const allDone = (total: number) =>
  total === 1 ? "the only step is done" : `all ${total} steps are done`;

/** Applies an update_plan call to the current steps. */
export function applyPlanUpdate(
  current: PlanStep[] | undefined,
  input: PlanUpdateInput,
): PlanUpdateResult {
  const { items, advance } = input;

  if ((items === undefined) === (advance !== true)) {
    return invalid("Send either items or advance: true.");
  }

  if (items) {
    const problem = validSteps(items);
    if (problem) return invalid(problem);
    const steps = items.map((s) => ({ ...s, content: s.content.trim() }));
    // Sent again unchanged, it reads as the whole list.
    const changed = current ? changedSteps(current, steps) : undefined;

    return { kind: "updated", steps, ...(changed?.length ? { changed } : {}) };
  }

  if (!current?.length) return invalid("There is no plan to advance.");
  const steps = advanced(current);
  const changed = changedSteps(current, steps) ?? [];

  if (!changed.length) {
    return {
      kind: "unchanged",
      message: `Plan unchanged: ${allDone(current.length)}.`,
    };
  }

  return { kind: "updated", steps, changed };
}

/** How far the plan has got, and the step in progress. */
export function planProgress(steps: PlanStep[]) {
  const current = steps.find((s) => s.status === "in_progress")?.content;

  return {
    done: steps.filter((s) => s.status === "completed").length,
    total: steps.length,
    ...(current ? { current } : {}),
  };
}

/** A plan's progress, as a parent agent's task reads show it. */
export function planSummary(plan: TaskPlan) {
  return {
    ...planProgress(plan.steps),
    ...(plan.stale ? { stale: true } : {}),
  };
}

/** The plan has steps left to do. */
export const planOpen = (steps: PlanStep[]) =>
  steps.some((s) => s.status !== "completed");

/** The tool's one-line result, as Claude Desktop words it. */
export function planResultLine(steps: PlanStep[]) {
  if (!steps.length) return "Plan cleared.";
  const total = steps.length;
  const current = steps.findIndex((s) => s.status === "in_progress");

  if (current >= 0) {
    return `Plan updated: step ${current + 1} of ${total} is in progress.`;
  }

  return planOpen(steps)
    ? `Plan updated: ${planProgress(steps).done} of ${total} steps are done.`
    : `Plan updated: ${allDone(total)}.`;
}

/**
 * Marks a plan with steps left as made before the worker's latest message,
 * for a taken steer or a new turn.
 */
export function markPlanStale(plan: TaskPlan | undefined) {
  if (plan && planOpen(plan.steps)) plan.stale = true;
}
