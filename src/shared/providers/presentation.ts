import { approvalLabels, type TaskView } from "../tasks/model.js";
import { claudeTaskFacts } from "./claude/presentation.js";

/** Provider-owned presenters retain native session details without leaking SDK concepts into the inspector. */
const presenters: Partial<
  Record<string, (task: TaskView) => Record<string, string>>
> = {
  claude: claudeTaskFacts,
};

export const providerTaskFacts = (task: TaskView) =>
  presenters[task.provider]?.(task) ?? {
    "Approval mode": approvalLabels[task.approval_mode ?? "ask_user"],
  };
