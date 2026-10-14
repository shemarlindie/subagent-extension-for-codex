import { readOnlyProfile } from "../../../../../shared/providers/claude/permissions";
import { providerTaskFacts } from "../../../../../shared/providers/presentation";
import { titleCase } from "../../../../../shared/settings/settings-document";
import type { Task } from "../../../../app/state/types";
import { Icon } from "../../../../shared/components/icons/icons";
import { shortPermissionLabel } from "../../../delegation/permission-label";
import { workerProfileIconName } from "../../list/worker-profile-icon";

type TaskRunSettingsProps = { task: Task };

/**
 * The profile, model, reasoning and permission mode a task started with,
 * shown beside the composer. They are fixed for the task's later turns.
 */
export function TaskRunSettings({ task }: TaskRunSettingsProps) {
  const permission = readOnlyProfile(task.worker_profile)
      ? "Read only"
      : providerTaskFacts(task)["Permission mode"],
    effort =
      task.reasoning_effort && task.reasoning_effort !== "default"
        ? titleCase(task.reasoning_effort)
        : "Default",
    icon = workerProfileIconName(task.worker_profile);

  const settings = [
    titleCase(task.worker_profile),
    task.model || "Default model",
    `${effort} effort`,
    ...(permission ? [shortPermissionLabel(permission)] : []),
  ];

  return (
    <ul
      className="task-run-settings"
      aria-label="Task settings"
      title="Set when the task started"
    >
      {settings.map((setting, index) => (
        <li key={setting}>
          {index === 0 && icon && <Icon name={icon} size={10} />}
          {setting}
        </li>
      ))}
    </ul>
  );
}
