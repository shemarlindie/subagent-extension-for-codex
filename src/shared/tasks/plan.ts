import type { AgentPlanPayload, PlanStep } from "./plan-contract.js";

/** The worker's plan for the running turn, on the task. It ends with the turn. */
export interface TaskPlan {
  steps: PlanStep[];
  /** A steer reached the worker after this update. */
  stale?: true;
}

/** Longer lists stop being glanceable in the panel. */
export const MAX_PLAN_STEPS = 12;
const MAX_PLAN_STEP_LENGTH = 200;

/**
 * What the worker's update_plan call sends: a whole list, an advance, or
 * steps marked by number to catch up.
 */
export interface PlanUpdateInput {
  items?: PlanStep[];
  advance?: boolean;
  /** 1-based numbers of steps to complete. */
  done?: number[];
  /** The 1-based number of the step to start. */
  start?: number;
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
    return `A plan has at most ${MAX_PLAN_STEPS} steps. Use broader steps.`;
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

/**
 * Completes the steps in `done` and starts `start`. A different step that was
 * in progress goes back to pending, since only `done` says it finished.
 */
function marked(steps: PlanStep[], done: number[], start?: number) {
  return steps.map((s, i): PlanStep => {
    if (i + 1 === start) return { ...s, status: "in_progress" };
    if (done.includes(i + 1)) return { ...s, status: "completed" };

    return start !== undefined && s.status === "in_progress"
      ? { ...s, status: "pending" }
      : s;
  });
}

function validMarks(total: number, done: number[], start?: number) {
  const numbers = start === undefined ? done : [...done, start];

  if (numbers.some((n) => n < 1 || n > total)) {
    return `Step numbers run from 1 to ${total}.`;
  }

  return start !== undefined && done.includes(start)
    ? "A step can't be both done and started."
    : undefined;
}

const allDone = (total: number) =>
  total === 1 ? "the only step is done" : `all ${total} steps are done`;

/** Applies an update_plan call to the current steps. */
export function applyPlanUpdate(
  current: PlanStep[] | undefined,
  input: PlanUpdateInput,
): PlanUpdateResult {
  const { items, advance, done, start } = input;
  const marks = done !== undefined || start !== undefined;

  if (
    [items !== undefined, advance === true, marks].filter(Boolean).length !== 1
  ) {
    return invalid("Send one of items, advance: true, or done and start.");
  }

  if (items) {
    const problem = validSteps(items);
    if (problem) return invalid(problem);
    const steps = items.map((s) => ({ ...s, content: s.content.trim() }));
    // Sent again unchanged, it reads as the whole list.
    const changed = current ? changedSteps(current, steps) : undefined;

    return { kind: "updated", steps, ...(changed?.length ? { changed } : {}) };
  }

  if (!current?.length) {
    return invalid("There is no plan yet. Send items first.");
  }

  if (marks) {
    const problem = validMarks(current.length, done ?? [], start);
    if (problem) return invalid(problem);
  }

  const steps = advance
    ? advanced(current)
    : marked(current, done ?? [], start);

  const changed = changedSteps(current, steps) ?? [];

  if (!changed.length) {
    return {
      kind: "unchanged",
      message: advance
        ? `Plan unchanged: ${allDone(current.length)}.`
        : "Plan unchanged: those steps already have that status.",
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

/** The plan Chat pins: one with steps left. */
export const pinnedPlan = (plan: TaskPlan | undefined) =>
  plan && planOpen(plan.steps) ? plan : undefined;

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
