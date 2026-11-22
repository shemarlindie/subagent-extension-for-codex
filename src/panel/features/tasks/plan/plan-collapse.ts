import type { TaskPlan } from "../../../../shared/tasks/plan";
import { planOpen } from "../../../../shared/tasks/plan";

/** The user's choice to collapse or expand one plan, which the panel keeps per task. */
export type PlanCollapse = { key: string; collapsed: boolean };

/**
 * Names a plan by its steps and whether it's finished. A new list and a
 * plan's last step each change it, which drops the user's earlier choice.
 */
const planKey = (plan: TaskPlan) =>
  `${planOpen(plan.steps) ? "open" : "done"}\n${plan.steps.map((s) => s.content).join("\n")}`;

/**
 * Whether the card shows one row. An open plan starts expanded and a
 * finished one collapsed, until the user chooses otherwise.
 */
export function planCollapsed(plan: TaskPlan, choice?: PlanCollapse) {
  return choice?.key === planKey(plan)
    ? choice.collapsed
    : !planOpen(plan.steps);
}

export const planCollapseChoice = (
  plan: TaskPlan,
  collapsed: boolean,
): PlanCollapse => ({ key: planKey(plan), collapsed });
