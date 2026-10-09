import { approvalLabels, type Task } from "../tasks/model.js";
import { claudeTaskFacts } from "./claude/presentation.js";

/** Provider-owned presenters retain native session details without leaking SDK concepts into the inspector. */
const presenters: Record<string, (task: Task) => Record<string, string>> = {
  claude: claudeTaskFacts,
};

export const providerTaskFacts = (task: Task) =>
  presenters[task.provider]?.(task) ?? {
    "Approval mode": approvalLabels[task.approval_mode ?? "ask_user"],
  };
