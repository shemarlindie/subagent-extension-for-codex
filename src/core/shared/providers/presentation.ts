import { approvalLabels, type TaskView } from "../tasks/model.js";
import { providerDefinitions } from "./registry.js";

export const providerTaskFacts = (task: TaskView) =>
  providerDefinitions()
    .find((definition) => definition.id === task.provider)
    ?.taskFacts?.(task) ?? {
    "Approval mode": approvalLabels[task.approval_mode ?? "ask_user"],
  };
