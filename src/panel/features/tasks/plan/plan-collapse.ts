import type { TaskPlan } from "../../../../core/shared/tasks/plan";

/** The user's choice to collapse or expand one plan, which the panel keeps per task. */
export type PlanCollapse = { key: string; collapsed: boolean };

/** Names a plan by its steps, so a new list drops the user's earlier choice. */
const planKey = (plan: TaskPlan) => plan.steps.map((s) => s.content).join("\n");

/** Whether the card shows one row. A plan starts expanded. */
export const planCollapsed = (plan: TaskPlan, choice?: PlanCollapse) =>
  choice?.key === planKey(plan) && choice.collapsed;

export const planCollapseChoice = (
  plan: TaskPlan,
  collapsed: boolean,
): PlanCollapse => ({ key: planKey(plan), collapsed });
