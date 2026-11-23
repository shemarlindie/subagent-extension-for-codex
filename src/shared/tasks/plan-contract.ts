export type PlanStepStatus = "pending" | "in_progress" | "completed";

export interface PlanStep {
  content: string;
  status: PlanStepStatus;
}

/** An update to the worker's plan. */
export interface AgentPlanPayload {
  steps: PlanStep[];
  /**
   * The steps whose status changed, when the step contents match the previous
   * plan's in order. Without it the event is a new or revised list.
   */
  changed?: number[];
}

/**
 * A plan leaving the pinned card, with its final steps: finished, or replaced,
 * cleared or ended with its turn while it had steps left.
 */
export interface TaskPlanEndedPayload {
  steps: PlanStep[];
}
